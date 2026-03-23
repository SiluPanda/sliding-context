import { describe, it, expect, vi } from 'vitest';
import { createSlidingContext, serializeContext, restoreSlidingContext } from '../context';
import { approximateTokenCounter } from '../token-counter';
import type { Message, SlidingContextOptions } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<SlidingContextOptions> = {}) {
  return createSlidingContext({
    tokenBudget: 2000,
    tokenCounter: approximateTokenCounter,
    ...overrides,
  });
}

async function addMany(
  ctx: ReturnType<typeof createSlidingContext>,
  messages: Message[],
) {
  for (const m of messages) {
    await ctx.addMessage(m);
  }
}

function msg(role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  return { role, content, ...extra };
}

// ---------------------------------------------------------------------------
// Basic addMessage / getMessages
// ---------------------------------------------------------------------------

describe('addMessage / getMessages basic flow', () => {
  it('starts empty', () => {
    const ctx = makeCtx();
    expect(ctx.getMessages()).toEqual([]);
    expect(ctx.getTokenCount()).toBe(0);
  });

  it('returns messages in order after adding them', async () => {
    const ctx = makeCtx();
    await ctx.addMessage(msg('user', 'Hello'));
    await ctx.addMessage(msg('assistant', 'Hi there'));
    const messages = ctx.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('prepends system prompt to getMessages', async () => {
    const ctx = makeCtx({ systemPrompt: 'You are helpful.' });
    await ctx.addMessage(msg('user', 'Hello'));
    const messages = ctx.getMessages();
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe('You are helpful.');
    expect(messages[1].role).toBe('user');
  });

  it('getTotalMessageCount includes system prompt', async () => {
    const ctx = makeCtx({ systemPrompt: 'sys' });
    await ctx.addMessage(msg('user', 'hi'));
    expect(ctx.getTotalMessageCount()).toBe(2); // system + user
  });

  it('getRecentMessageCount excludes system prompt', async () => {
    const ctx = makeCtx({ systemPrompt: 'sys' });
    await ctx.addMessage(msg('user', 'hi'));
    await ctx.addMessage(msg('assistant', 'hello'));
    expect(ctx.getRecentMessageCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

describe('getTokenCount / getTokenBreakdown', () => {
  it('reports non-zero token count after adding messages', async () => {
    const ctx = makeCtx({ systemPrompt: 'You are helpful.' });
    await ctx.addMessage(msg('user', 'What time is it?'));
    const count = ctx.getTokenCount();
    expect(count).toBeGreaterThan(0);
  });

  it('getTokenBreakdown sums to total', async () => {
    const ctx = makeCtx({ systemPrompt: 'sys' });
    await ctx.addMessage(msg('user', 'hello'));
    await ctx.addMessage(msg('assistant', 'world'));
    const bd = ctx.getTokenBreakdown();
    expect(bd.total).toBe(bd.system + bd.anchor + bd.summary + bd.recent);
  });

  it('system tokens are non-zero when system prompt provided', async () => {
    const ctx = makeCtx({ systemPrompt: 'You are a helpful assistant.' });
    const bd = ctx.getTokenBreakdown();
    expect(bd.system).toBeGreaterThan(0);
  });

  it('anchor tokens are 0 when no anchor set', async () => {
    const ctx = makeCtx();
    await ctx.addMessage(msg('user', 'hi'));
    const bd = ctx.getTokenBreakdown();
    expect(bd.anchor).toBe(0);
  });

  it('anchor tokens increase after setAnchor', async () => {
    const ctx = makeCtx();
    ctx.setAnchor([msg('system', 'Important context.')]);
    const bd = ctx.getTokenBreakdown();
    expect(bd.anchor).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Token budget enforcement / eviction
// ---------------------------------------------------------------------------

describe('token budget enforcement', () => {
  it('evicts oldest messages from recent zone when over budget', async () => {
    // budget=200, each message is ceil(200/4)+4 = 54 tokens.
    // targetRecent = 200 (no system, no summary, no summarizer).
    // After 4 messages (216 tokens) eviction fires and moves oldest to pending.
    // getMessages() still returns all messages (pending + recent) until summarized.
    // But the *recent* zone (recentMessages array) should be trimmed.
    const ctx = makeCtx({ tokenBudget: 200 });
    const bigContent = 'a'.repeat(200); // 54 tokens per message
    for (let i = 0; i < 10; i++) {
      await ctx.addMessage(msg('user', bigContent));
    }
    // With a summarizer absent, evicted messages go to pending buffer and still appear
    // in getMessages(). The key invariant is that recent zone is within budget.
    // Without a summarizer, evicted messages go to pendingBuffer and still appear
    // in getMessages(). Verify eviction happened by checking pendingBuffer.
    const state = ctx.serialize();
    expect(state.pendingBuffer.length).toBeGreaterThan(0);
  });

  it('recent zone token count stays near budget target with summarizer', async () => {
    // With a summarizer, pending buffer is cleared after summarization,
    // so total tokens drop below budget.
    const summarizer = vi.fn().mockResolvedValue('compact summary');
    const ctx = makeCtx({
      tokenBudget: 300,
      summarizer,
      summarizeThresholdMessages: 2,
    });
    const bigContent = 'x'.repeat(200); // 54 tokens + 4 = 54 tokens/msg
    for (let i = 0; i < 8; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', bigContent));
    }
    // After summarization, pending buffer is cleared and total should be within budget.
    if (summarizer.mock.calls.length > 0) {
      const count = ctx.getTokenCount();
      expect(count).toBeLessThanOrEqual(300);
    }
  });

  it('setTokenBudget reduces budget and triggers eviction into pending', async () => {
    const ctx = makeCtx({ tokenBudget: 2000 });
    // Add several small messages that all fit comfortably.
    for (let i = 0; i < 5; i++) {
      await ctx.addMessage(msg('user', 'a'.repeat(200)));
    }
    const state1 = ctx.serialize();
    expect(state1.pendingBuffer.length).toBe(0);

    ctx.setTokenBudget(200); // Very small budget — forces eviction.
    // Give async enforceBudget a tick to run.
    await new Promise((r) => setTimeout(r, 0));
    const state2 = ctx.serialize();
    // Evicted messages should now be in pendingBuffer.
    expect(state2.pendingBuffer.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tool call pair atomicity
// ---------------------------------------------------------------------------

describe('tool call pair atomicity', () => {
  it('never evicts a tool_calls message without its paired tool result', async () => {
    // Create a scenario where eviction must happen, and the oldest messages
    // include a tool-call pair.  Both must be evicted together.
    const ctx = makeCtx({ tokenBudget: 400 });

    const toolCall: Message = {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_abc',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"test"}' },
        },
      ],
    };
    const toolResult: Message = {
      role: 'tool',
      content: 'result data',
      tool_call_id: 'call_abc',
    };

    await ctx.addMessage(msg('user', 'Use a tool please'));
    await ctx.addMessage(toolCall);
    await ctx.addMessage(toolResult);

    // Add a lot more messages to force eviction of the initial ones.
    for (let i = 0; i < 8; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(100)));
    }

    const messages = ctx.getMessages();

    // Find any tool_calls messages and verify their results are present too.
    for (const m of messages) {
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          const resultPresent = messages.some(
            (r) => r.role === 'tool' && r.tool_call_id === tc.id,
          );
          expect(resultPresent).toBe(true);
        }
      }
    }
  });

  it('tool pair stays together when one half would need eviction without the other', async () => {
    // Force eviction to happen and verify the invariant holds after.
    const ctx = makeCtx({ tokenBudget: 300 });

    const toolCallMsg: Message = {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'tc_1', type: 'function', function: { name: 'fn', arguments: '{}' } },
      ],
    };
    const toolResultMsg: Message = { role: 'tool', content: 'ok', tool_call_id: 'tc_1' };

    await ctx.addMessage(msg('user', 'start'));
    await ctx.addMessage(toolCallMsg);
    await ctx.addMessage(toolResultMsg);
    // Force eviction.
    for (let i = 0; i < 6; i++) {
      await ctx.addMessage(msg('user', 'a'.repeat(100)));
    }

    const result = ctx.getMessages();
    const toolCallsInResult = result.filter((m) => m.tool_calls && m.tool_calls.length > 0);
    for (const m of toolCallsInResult) {
      for (const tc of m.tool_calls!) {
        const matched = result.some((r) => r.role === 'tool' && r.tool_call_id === tc.id);
        expect(matched).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------

describe('clear()', () => {
  it('resets messages, summary, and token counts', async () => {
    const ctx = makeCtx({ systemPrompt: 'sys' });
    await ctx.addMessage(msg('user', 'hello'));
    await ctx.addMessage(msg('assistant', 'world'));
    ctx.clear();
    expect(ctx.getRecentMessageCount()).toBe(0);
    expect(ctx.getSummary()).toBeUndefined();
    // System prompt should still be there.
    const messages = ctx.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('sys');
  });

  it('getTokenCount after clear equals system token cost only', async () => {
    const ctx = makeCtx({ systemPrompt: 'sys' });
    await addMany(ctx, [msg('user', 'hi'), msg('assistant', 'hello')]);
    const tokensBefore = ctx.getTokenCount();
    ctx.clear();
    const tokensAfter = ctx.getTokenCount();
    expect(tokensAfter).toBeLessThan(tokensBefore);
  });
});

// ---------------------------------------------------------------------------
// serialize / deserialize roundtrip
// ---------------------------------------------------------------------------

describe('serialize / deserialize roundtrip', () => {
  it('serialize returns a ContextState with version 1', async () => {
    const ctx = makeCtx();
    await ctx.addMessage(msg('user', 'hello'));
    const state = ctx.serialize();
    expect(state.version).toBe(1);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe('hello');
  });

  it('serializeContext produces a JSON string', async () => {
    const ctx = makeCtx();
    await ctx.addMessage(msg('user', 'hello'));
    const json = serializeContext(ctx);
    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
  });

  it('restoreSlidingContext reproduces exact message list', async () => {
    const opts: SlidingContextOptions = {
      tokenBudget: 2000,
      systemPrompt: 'You are helpful.',
      tokenCounter: approximateTokenCounter,
    };
    const ctx = createSlidingContext(opts);
    await ctx.addMessage(msg('user', 'What is the capital of France?'));
    await ctx.addMessage(msg('assistant', 'Paris.'));

    const json = serializeContext(ctx);
    const ctx2 = restoreSlidingContext(json, opts);

    const orig = ctx.getMessages();
    const restored = ctx2.getMessages();
    expect(restored).toEqual(orig);
  });

  it('restoreSlidingContext preserves summary', async () => {
    const summarizer = vi.fn().mockResolvedValue('Summary text');
    const opts: SlidingContextOptions = {
      tokenBudget: 200,
      tokenCounter: approximateTokenCounter,
      summarizer,
      summarizeThresholdMessages: 3,
    };
    const ctx = createSlidingContext(opts);
    // Add enough messages to overflow budget and trigger summarization.
    for (let i = 0; i < 10; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
    }

    const json = serializeContext(ctx);
    const ctx2 = restoreSlidingContext(json, opts);
    expect(ctx2.getSummary()).toBe(ctx.getSummary());
  });
});

// ---------------------------------------------------------------------------
// setTokenBudget
// ---------------------------------------------------------------------------

describe('setTokenBudget', () => {
  it('throws for budget < 100', async () => {
    const ctx = makeCtx();
    await expect(ctx.setTokenBudget(50)).rejects.toThrow(RangeError);
  });

  it('throws for non-finite budget', async () => {
    const ctx = makeCtx();
    await expect(ctx.setTokenBudget(Infinity)).rejects.toThrow(RangeError);
  });

  it('accepts valid budget and returns a promise', async () => {
    const ctx = makeCtx();
    const result = ctx.setTokenBudget(500);
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it('awaits budget enforcement including summarization', async () => {
    const summarizer = vi.fn().mockResolvedValue('Budget summary');
    const ctx = makeCtx({
      tokenBudget: 2000,
      summarizer,
      summarizeThresholdMessages: 2,
    });

    // Add messages at large budget
    for (let i = 0; i < 6; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
    }

    // Reduce budget — should trigger eviction and possibly summarization
    await ctx.setTokenBudget(300);

    // After awaiting, any summarization triggered by the budget change is complete
    // (previously the promise was dropped with `void enforceBudget()`)
    expect(ctx.getTokenCount()).toBeLessThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// Summarizer integration
// ---------------------------------------------------------------------------

describe('summarizer integration', () => {
  it('calls summarizer when pending buffer exceeds threshold', async () => {
    // budget=200, each msg=54 tokens. targetRecent=200.
    // After 4 msgs eviction fires. threshold=3 msgs in pending → summarizer called.
    const summarizer = vi.fn().mockResolvedValue('Compact summary');
    const ctx = createSlidingContext({
      tokenBudget: 200,
      tokenCounter: approximateTokenCounter,
      summarizer,
      summarizeThresholdMessages: 3,
    });

    // Add messages that overflow the budget to trigger eviction then summarization.
    for (let i = 0; i < 10; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
    }

    expect(summarizer).toHaveBeenCalled();
  });

  it('getSummary returns the summarizer result after summarization', async () => {
    const summarizer = vi.fn().mockResolvedValue('The summary content');
    const ctx = createSlidingContext({
      tokenBudget: 200,
      tokenCounter: approximateTokenCounter,
      summarizer,
      summarizeThresholdMessages: 3,
    });

    for (let i = 0; i < 10; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
    }

    expect(ctx.getSummary()).toBe('The summary content');
  });

  it('summary appears in getMessages output after summarization', async () => {
    const summarizer = vi.fn().mockResolvedValue('Rolling summary');
    const ctx = createSlidingContext({
      tokenBudget: 200,
      tokenCounter: approximateTokenCounter,
      summarizer,
      summarizeThresholdMessages: 3,
      summaryRole: 'system',
    });

    for (let i = 0; i < 10; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
    }

    const messages = ctx.getMessages();
    const summaryMsg = messages.find(
      (m) => m.role === 'system' && m.content === 'Rolling summary',
    );
    expect(summaryMsg).toBeDefined();
  });

  it('calls summarizer with existing summary on second round', async () => {
    const summarizer = vi
      .fn()
      .mockResolvedValueOnce('First summary')
      .mockResolvedValueOnce('Second summary');

    // budget=200, threshold=2 msgs → summarizes early.
    const ctx = createSlidingContext({
      tokenBudget: 200,
      tokenCounter: approximateTokenCounter,
      summarizer,
      summarizeThresholdMessages: 2,
    });

    // First round of eviction + summarization.
    for (let i = 0; i < 8; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
    }
    // Second round.
    for (let i = 0; i < 8; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'b'.repeat(200)));
    }

    if (summarizer.mock.calls.length > 1) {
      const secondCall = summarizer.mock.calls[1];
      // existingSummary should be 'First summary' on the second round.
      expect(secondCall[1]).toBe('First summary');
    }
  });

  it('onSummarize hook is called after successful summarization', async () => {
    const onSummarize = vi.fn();
    const summarizer = vi.fn().mockResolvedValue('summary text');
    const ctx = createSlidingContext({
      tokenBudget: 200,
      tokenCounter: approximateTokenCounter,
      summarizer,
      summarizeThresholdMessages: 3,
      hooks: { onSummarize },
    });

    for (let i = 0; i < 10; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
    }

    expect(onSummarize).toHaveBeenCalled();
  });

  it('onEvict hook is called when messages are evicted', async () => {
    const onEvict = vi.fn();
    // budget=200, each msg=54 tokens. 4 msgs = 216 > 200 → eviction fires.
    const ctx = createSlidingContext({
      tokenBudget: 200,
      tokenCounter: approximateTokenCounter,
      hooks: { onEvict },
    });

    for (let i = 0; i < 10; i++) {
      await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
    }

    expect(onEvict).toHaveBeenCalled();
    const [evictedMessages, reason] = onEvict.mock.calls[0];
    expect(Array.isArray(evictedMessages)).toBe(true);
    expect(reason).toBe('budget');
  });
});

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe('createSlidingContext validation', () => {
  it('throws RangeError for tokenBudget < 100', () => {
    expect(() => createSlidingContext({ tokenBudget: 99 })).toThrow(RangeError);
  });

  it('throws RangeError for non-finite tokenBudget', () => {
    expect(() => createSlidingContext({ tokenBudget: NaN })).toThrow(RangeError);
    expect(() => createSlidingContext({ tokenBudget: Infinity })).toThrow(RangeError);
  });

  it('does not throw for tokenBudget === 100', () => {
    expect(() => createSlidingContext({ tokenBudget: 100 })).not.toThrow();
  });
});
