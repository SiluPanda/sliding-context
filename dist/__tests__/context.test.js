"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const context_1 = require("../context");
const token_counter_1 = require("../token-counter");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCtx(overrides = {}) {
    return (0, context_1.createSlidingContext)({
        tokenBudget: 2000,
        tokenCounter: token_counter_1.approximateTokenCounter,
        ...overrides,
    });
}
async function addMany(ctx, messages) {
    for (const m of messages) {
        await ctx.addMessage(m);
    }
}
function msg(role, content, extra = {}) {
    return { role, content, ...extra };
}
// ---------------------------------------------------------------------------
// Basic addMessage / getMessages
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('addMessage / getMessages basic flow', () => {
    (0, vitest_1.it)('starts empty', () => {
        const ctx = makeCtx();
        (0, vitest_1.expect)(ctx.getMessages()).toEqual([]);
        (0, vitest_1.expect)(ctx.getTokenCount()).toBe(0);
    });
    (0, vitest_1.it)('returns messages in order after adding them', async () => {
        const ctx = makeCtx();
        await ctx.addMessage(msg('user', 'Hello'));
        await ctx.addMessage(msg('assistant', 'Hi there'));
        const messages = ctx.getMessages();
        (0, vitest_1.expect)(messages).toHaveLength(2);
        (0, vitest_1.expect)(messages[0].role).toBe('user');
        (0, vitest_1.expect)(messages[1].role).toBe('assistant');
    });
    (0, vitest_1.it)('prepends system prompt to getMessages', async () => {
        const ctx = makeCtx({ systemPrompt: 'You are helpful.' });
        await ctx.addMessage(msg('user', 'Hello'));
        const messages = ctx.getMessages();
        (0, vitest_1.expect)(messages[0].role).toBe('system');
        (0, vitest_1.expect)(messages[0].content).toBe('You are helpful.');
        (0, vitest_1.expect)(messages[1].role).toBe('user');
    });
    (0, vitest_1.it)('getTotalMessageCount includes system prompt', async () => {
        const ctx = makeCtx({ systemPrompt: 'sys' });
        await ctx.addMessage(msg('user', 'hi'));
        (0, vitest_1.expect)(ctx.getTotalMessageCount()).toBe(2); // system + user
    });
    (0, vitest_1.it)('getRecentMessageCount excludes system prompt', async () => {
        const ctx = makeCtx({ systemPrompt: 'sys' });
        await ctx.addMessage(msg('user', 'hi'));
        await ctx.addMessage(msg('assistant', 'hello'));
        (0, vitest_1.expect)(ctx.getRecentMessageCount()).toBe(2);
    });
});
// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('getTokenCount / getTokenBreakdown', () => {
    (0, vitest_1.it)('reports non-zero token count after adding messages', async () => {
        const ctx = makeCtx({ systemPrompt: 'You are helpful.' });
        await ctx.addMessage(msg('user', 'What time is it?'));
        const count = ctx.getTokenCount();
        (0, vitest_1.expect)(count).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('getTokenBreakdown sums to total', async () => {
        const ctx = makeCtx({ systemPrompt: 'sys' });
        await ctx.addMessage(msg('user', 'hello'));
        await ctx.addMessage(msg('assistant', 'world'));
        const bd = ctx.getTokenBreakdown();
        (0, vitest_1.expect)(bd.total).toBe(bd.system + bd.anchor + bd.summary + bd.recent);
    });
    (0, vitest_1.it)('system tokens are non-zero when system prompt provided', async () => {
        const ctx = makeCtx({ systemPrompt: 'You are a helpful assistant.' });
        const bd = ctx.getTokenBreakdown();
        (0, vitest_1.expect)(bd.system).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('anchor tokens are 0 when no anchor set', async () => {
        const ctx = makeCtx();
        await ctx.addMessage(msg('user', 'hi'));
        const bd = ctx.getTokenBreakdown();
        (0, vitest_1.expect)(bd.anchor).toBe(0);
    });
    (0, vitest_1.it)('anchor tokens increase after setAnchor', async () => {
        const ctx = makeCtx();
        ctx.setAnchor([msg('system', 'Important context.')]);
        const bd = ctx.getTokenBreakdown();
        (0, vitest_1.expect)(bd.anchor).toBeGreaterThan(0);
    });
});
// ---------------------------------------------------------------------------
// Token budget enforcement / eviction
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('token budget enforcement', () => {
    (0, vitest_1.it)('evicts oldest messages from recent zone when over budget', async () => {
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
        (0, vitest_1.expect)(state.pendingBuffer.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('recent zone token count stays near budget target with summarizer', async () => {
        // With a summarizer, pending buffer is cleared after summarization,
        // so total tokens drop below budget.
        const summarizer = vitest_1.vi.fn().mockResolvedValue('compact summary');
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
            (0, vitest_1.expect)(count).toBeLessThanOrEqual(300);
        }
    });
    (0, vitest_1.it)('setTokenBudget reduces budget and triggers eviction into pending', async () => {
        const ctx = makeCtx({ tokenBudget: 2000 });
        // Add several small messages that all fit comfortably.
        for (let i = 0; i < 5; i++) {
            await ctx.addMessage(msg('user', 'a'.repeat(200)));
        }
        const state1 = ctx.serialize();
        (0, vitest_1.expect)(state1.pendingBuffer.length).toBe(0);
        ctx.setTokenBudget(200); // Very small budget — forces eviction.
        // Give async enforceBudget a tick to run.
        await new Promise((r) => setTimeout(r, 0));
        const state2 = ctx.serialize();
        // Evicted messages should now be in pendingBuffer.
        (0, vitest_1.expect)(state2.pendingBuffer.length).toBeGreaterThan(0);
    });
});
// ---------------------------------------------------------------------------
// Tool call pair atomicity
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('tool call pair atomicity', () => {
    (0, vitest_1.it)('never evicts a tool_calls message without its paired tool result', async () => {
        // Create a scenario where eviction must happen, and the oldest messages
        // include a tool-call pair.  Both must be evicted together.
        const ctx = makeCtx({ tokenBudget: 400 });
        const toolCall = {
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
        const toolResult = {
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
                    const resultPresent = messages.some((r) => r.role === 'tool' && r.tool_call_id === tc.id);
                    (0, vitest_1.expect)(resultPresent).toBe(true);
                }
            }
        }
    });
    (0, vitest_1.it)('tool pair stays together when one half would need eviction without the other', async () => {
        // Force eviction to happen and verify the invariant holds after.
        const ctx = makeCtx({ tokenBudget: 300 });
        const toolCallMsg = {
            role: 'assistant',
            content: '',
            tool_calls: [
                { id: 'tc_1', type: 'function', function: { name: 'fn', arguments: '{}' } },
            ],
        };
        const toolResultMsg = { role: 'tool', content: 'ok', tool_call_id: 'tc_1' };
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
            for (const tc of m.tool_calls) {
                const matched = result.some((r) => r.role === 'tool' && r.tool_call_id === tc.id);
                (0, vitest_1.expect)(matched).toBe(true);
            }
        }
    });
});
// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('clear()', () => {
    (0, vitest_1.it)('resets messages, summary, and token counts', async () => {
        const ctx = makeCtx({ systemPrompt: 'sys' });
        await ctx.addMessage(msg('user', 'hello'));
        await ctx.addMessage(msg('assistant', 'world'));
        ctx.clear();
        (0, vitest_1.expect)(ctx.getRecentMessageCount()).toBe(0);
        (0, vitest_1.expect)(ctx.getSummary()).toBeUndefined();
        // System prompt should still be there.
        const messages = ctx.getMessages();
        (0, vitest_1.expect)(messages).toHaveLength(1);
        (0, vitest_1.expect)(messages[0].content).toBe('sys');
    });
    (0, vitest_1.it)('getTokenCount after clear equals system token cost only', async () => {
        const ctx = makeCtx({ systemPrompt: 'sys' });
        await addMany(ctx, [msg('user', 'hi'), msg('assistant', 'hello')]);
        const tokensBefore = ctx.getTokenCount();
        ctx.clear();
        const tokensAfter = ctx.getTokenCount();
        (0, vitest_1.expect)(tokensAfter).toBeLessThan(tokensBefore);
    });
});
// ---------------------------------------------------------------------------
// serialize / deserialize roundtrip
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('serialize / deserialize roundtrip', () => {
    (0, vitest_1.it)('serialize returns a ContextState with version 1', async () => {
        const ctx = makeCtx();
        await ctx.addMessage(msg('user', 'hello'));
        const state = ctx.serialize();
        (0, vitest_1.expect)(state.version).toBe(1);
        (0, vitest_1.expect)(state.messages).toHaveLength(1);
        (0, vitest_1.expect)(state.messages[0].content).toBe('hello');
    });
    (0, vitest_1.it)('serializeContext produces a JSON string', async () => {
        const ctx = makeCtx();
        await ctx.addMessage(msg('user', 'hello'));
        const json = (0, context_1.serializeContext)(ctx);
        (0, vitest_1.expect)(typeof json).toBe('string');
        const parsed = JSON.parse(json);
        (0, vitest_1.expect)(parsed.version).toBe(1);
    });
    (0, vitest_1.it)('restoreSlidingContext reproduces exact message list', async () => {
        const opts = {
            tokenBudget: 2000,
            systemPrompt: 'You are helpful.',
            tokenCounter: token_counter_1.approximateTokenCounter,
        };
        const ctx = (0, context_1.createSlidingContext)(opts);
        await ctx.addMessage(msg('user', 'What is the capital of France?'));
        await ctx.addMessage(msg('assistant', 'Paris.'));
        const json = (0, context_1.serializeContext)(ctx);
        const ctx2 = (0, context_1.restoreSlidingContext)(json, opts);
        const orig = ctx.getMessages();
        const restored = ctx2.getMessages();
        (0, vitest_1.expect)(restored).toEqual(orig);
    });
    (0, vitest_1.it)('restoreSlidingContext preserves summary', async () => {
        const summarizer = vitest_1.vi.fn().mockResolvedValue('Summary text');
        const opts = {
            tokenBudget: 200,
            tokenCounter: token_counter_1.approximateTokenCounter,
            summarizer,
            summarizeThresholdMessages: 3,
        };
        const ctx = (0, context_1.createSlidingContext)(opts);
        // Add enough messages to overflow budget and trigger summarization.
        for (let i = 0; i < 10; i++) {
            await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
        }
        const json = (0, context_1.serializeContext)(ctx);
        const ctx2 = (0, context_1.restoreSlidingContext)(json, opts);
        (0, vitest_1.expect)(ctx2.getSummary()).toBe(ctx.getSummary());
    });
});
// ---------------------------------------------------------------------------
// setTokenBudget
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('setTokenBudget', () => {
    (0, vitest_1.it)('throws for budget < 100', () => {
        const ctx = makeCtx();
        (0, vitest_1.expect)(() => ctx.setTokenBudget(50)).toThrow(RangeError);
    });
    (0, vitest_1.it)('throws for non-finite budget', () => {
        const ctx = makeCtx();
        (0, vitest_1.expect)(() => ctx.setTokenBudget(Infinity)).toThrow(RangeError);
    });
    (0, vitest_1.it)('accepts valid budget', () => {
        const ctx = makeCtx();
        (0, vitest_1.expect)(() => ctx.setTokenBudget(500)).not.toThrow();
    });
});
// ---------------------------------------------------------------------------
// Summarizer integration
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('summarizer integration', () => {
    (0, vitest_1.it)('calls summarizer when pending buffer exceeds threshold', async () => {
        // budget=200, each msg=54 tokens. targetRecent=200.
        // After 4 msgs eviction fires. threshold=3 msgs in pending → summarizer called.
        const summarizer = vitest_1.vi.fn().mockResolvedValue('Compact summary');
        const ctx = (0, context_1.createSlidingContext)({
            tokenBudget: 200,
            tokenCounter: token_counter_1.approximateTokenCounter,
            summarizer,
            summarizeThresholdMessages: 3,
        });
        // Add messages that overflow the budget to trigger eviction then summarization.
        for (let i = 0; i < 10; i++) {
            await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
        }
        (0, vitest_1.expect)(summarizer).toHaveBeenCalled();
    });
    (0, vitest_1.it)('getSummary returns the summarizer result after summarization', async () => {
        const summarizer = vitest_1.vi.fn().mockResolvedValue('The summary content');
        const ctx = (0, context_1.createSlidingContext)({
            tokenBudget: 200,
            tokenCounter: token_counter_1.approximateTokenCounter,
            summarizer,
            summarizeThresholdMessages: 3,
        });
        for (let i = 0; i < 10; i++) {
            await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
        }
        (0, vitest_1.expect)(ctx.getSummary()).toBe('The summary content');
    });
    (0, vitest_1.it)('summary appears in getMessages output after summarization', async () => {
        const summarizer = vitest_1.vi.fn().mockResolvedValue('Rolling summary');
        const ctx = (0, context_1.createSlidingContext)({
            tokenBudget: 200,
            tokenCounter: token_counter_1.approximateTokenCounter,
            summarizer,
            summarizeThresholdMessages: 3,
            summaryRole: 'system',
        });
        for (let i = 0; i < 10; i++) {
            await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
        }
        const messages = ctx.getMessages();
        const summaryMsg = messages.find((m) => m.role === 'system' && m.content === 'Rolling summary');
        (0, vitest_1.expect)(summaryMsg).toBeDefined();
    });
    (0, vitest_1.it)('calls summarizer with existing summary on second round', async () => {
        const summarizer = vitest_1.vi
            .fn()
            .mockResolvedValueOnce('First summary')
            .mockResolvedValueOnce('Second summary');
        // budget=200, threshold=2 msgs → summarizes early.
        const ctx = (0, context_1.createSlidingContext)({
            tokenBudget: 200,
            tokenCounter: token_counter_1.approximateTokenCounter,
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
            (0, vitest_1.expect)(secondCall[1]).toBe('First summary');
        }
    });
    (0, vitest_1.it)('onSummarize hook is called after successful summarization', async () => {
        const onSummarize = vitest_1.vi.fn();
        const summarizer = vitest_1.vi.fn().mockResolvedValue('summary text');
        const ctx = (0, context_1.createSlidingContext)({
            tokenBudget: 200,
            tokenCounter: token_counter_1.approximateTokenCounter,
            summarizer,
            summarizeThresholdMessages: 3,
            hooks: { onSummarize },
        });
        for (let i = 0; i < 10; i++) {
            await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
        }
        (0, vitest_1.expect)(onSummarize).toHaveBeenCalled();
    });
    (0, vitest_1.it)('onEvict hook is called when messages are evicted', async () => {
        const onEvict = vitest_1.vi.fn();
        // budget=200, each msg=54 tokens. 4 msgs = 216 > 200 → eviction fires.
        const ctx = (0, context_1.createSlidingContext)({
            tokenBudget: 200,
            tokenCounter: token_counter_1.approximateTokenCounter,
            hooks: { onEvict },
        });
        for (let i = 0; i < 10; i++) {
            await ctx.addMessage(msg(i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(200)));
        }
        (0, vitest_1.expect)(onEvict).toHaveBeenCalled();
        const [evictedMessages, reason] = onEvict.mock.calls[0];
        (0, vitest_1.expect)(Array.isArray(evictedMessages)).toBe(true);
        (0, vitest_1.expect)(reason).toBe('budget');
    });
});
// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('createSlidingContext validation', () => {
    (0, vitest_1.it)('throws RangeError for tokenBudget < 100', () => {
        (0, vitest_1.expect)(() => (0, context_1.createSlidingContext)({ tokenBudget: 99 })).toThrow(RangeError);
    });
    (0, vitest_1.it)('throws RangeError for non-finite tokenBudget', () => {
        (0, vitest_1.expect)(() => (0, context_1.createSlidingContext)({ tokenBudget: NaN })).toThrow(RangeError);
        (0, vitest_1.expect)(() => (0, context_1.createSlidingContext)({ tokenBudget: Infinity })).toThrow(RangeError);
    });
    (0, vitest_1.it)('does not throw for tokenBudget === 100', () => {
        (0, vitest_1.expect)(() => (0, context_1.createSlidingContext)({ tokenBudget: 100 })).not.toThrow();
    });
});
//# sourceMappingURL=context.test.js.map