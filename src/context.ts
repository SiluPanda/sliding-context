import type {
  Message,
  SlidingContextOptions,
  ContextState,
  SlidingContext,
} from './types';
import {
  approximateTokenCounter,
  countMessageTokens,
  DEFAULT_MESSAGE_OVERHEAD,
} from './token-counter';
import { evictMessages } from './eviction';
import { allocateBudget } from './budget';
import { runSummarizer } from './summarization';
import { serialize as serializeToJSON, deserialize as parseState } from './serialization';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function msgTokens(message: Message, opts: SlidingContextOptions): number {
  const counter = opts.tokenCounter ?? approximateTokenCounter;
  const overhead = opts.messageOverhead ?? DEFAULT_MESSAGE_OVERHEAD;
  return countMessageTokens(message, counter, overhead);
}

function listTokens(messages: Message[], opts: SlidingContextOptions): number {
  return messages.reduce((sum, m) => sum + msgTokens(m, opts), 0);
}

// ---------------------------------------------------------------------------
// Core factory (accepts optional initial state for restore path)
// ---------------------------------------------------------------------------

function createWithState(
  options: SlidingContextOptions,
  initialState?: ContextState,
): SlidingContext {
  if (!Number.isFinite(options.tokenBudget) || options.tokenBudget < 100) {
    throw new RangeError(
      `sliding-context: tokenBudget must be a finite number >= 100, got ${options.tokenBudget}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Mutable state
  // ---------------------------------------------------------------------------

  let tokenBudget = options.tokenBudget;

  const systemMessage: Message | null = options.systemPrompt
    ? { role: 'system', content: options.systemPrompt }
    : null;

  let anchorMessages: Message[] = initialState
    ? initialState.anchor.slice()
    : options.anchor
      ? options.anchor.slice()
      : [];

  let currentSummary: string | undefined = initialState?.summary;
  let recentMessages: Message[] = initialState ? initialState.messages.slice() : [];
  let pendingBuffer: Message[] = initialState ? initialState.pendingBuffer.slice() : [];
  let summaryRounds = initialState?.summaryRounds ?? 0;

  // ---------------------------------------------------------------------------
  // Token accessors
  // ---------------------------------------------------------------------------

  function effectiveOpts(): SlidingContextOptions {
    return { ...options, tokenBudget };
  }

  function sysTokens(): number {
    return systemMessage ? msgTokens(systemMessage, effectiveOpts()) : 0;
  }

  function ancTokens(): number {
    return listTokens(anchorMessages, effectiveOpts());
  }

  function sumTokens(): number {
    if (currentSummary === undefined) return 0;
    return msgTokens(
      { role: options.summaryRole ?? 'system', content: currentSummary },
      effectiveOpts(),
    );
  }

  function recTokens(): number {
    return listTokens(recentMessages, effectiveOpts());
  }

  function pendTokens(): number {
    return listTokens(pendingBuffer, effectiveOpts());
  }

  // ---------------------------------------------------------------------------
  // Summarization
  // ---------------------------------------------------------------------------

  async function triggerSummarization(): Promise<void> {
    const { summarizer } = options;
    if (!summarizer || pendingBuffer.length === 0) return;

    const maxRounds = options.maxSummaryRounds ?? 5;
    if (summaryRounds >= maxRounds) return;

    const startMs = Date.now();
    const toSummarize = pendingBuffer.slice();
    const existingSummary = currentSummary;

    const newSummary = await runSummarizer(toSummarize, summarizer, existingSummary);
    if (newSummary === null) return;

    summaryRounds += 1;

    if (options.hooks?.onSummarize) {
      options.hooks.onSummarize(
        toSummarize,
        existingSummary,
        newSummary,
        Date.now() - startMs,
      );
    }

    if (existingSummary !== undefined && options.hooks?.onSummaryCompressed) {
      options.hooks.onSummaryCompressed(existingSummary, newSummary);
    }

    currentSummary = newSummary;
    pendingBuffer = [];
  }

  // ---------------------------------------------------------------------------
  // Budget enforcement
  // ---------------------------------------------------------------------------

  async function enforceBudget(): Promise<void> {
    const opts = effectiveOpts();
    const counter = opts.tokenCounter ?? approximateTokenCounter;
    const overhead = opts.messageOverhead ?? DEFAULT_MESSAGE_OVERHEAD;

    const allocation = allocateBudget(opts, sysTokens() + ancTokens() + sumTokens());
    const targetRecent = allocation.recentTokens;

    if (recTokens() <= targetRecent) return;

    if (options.hooks?.onBudgetExceeded) {
      const total = sysTokens() + ancTokens() + sumTokens() + recTokens() + pendTokens();
      options.hooks.onBudgetExceeded(total, tokenBudget);
    }

    const { evicted, remaining } = evictMessages(
      recentMessages,
      targetRecent,
      counter,
      overhead,
    );

    if (evicted.length > 0) {
      recentMessages = remaining;
      pendingBuffer = [...pendingBuffer, ...evicted];
      if (options.hooks?.onEvict) options.hooks.onEvict(evicted, 'budget');
    }

    const thresholdTokens =
      opts.summarizeThresholdTokens ?? Math.floor(tokenBudget * 0.1);
    const thresholdMessages = opts.summarizeThresholdMessages ?? 6;

    if (
      pendingBuffer.length >= thresholdMessages ||
      pendTokens() >= thresholdTokens
    ) {
      await triggerSummarization();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async function addMessage(message: Message): Promise<void> {
    recentMessages.push(message);
    await enforceBudget();
  }

  function getMessages(): Message[] {
    const result: Message[] = [];
    if (systemMessage) result.push(systemMessage);
    if (anchorMessages.length > 0) result.push(...anchorMessages);
    // Pending messages are older than recent — include before summary/recent.
    if (pendingBuffer.length > 0) result.push(...pendingBuffer);
    if (currentSummary !== undefined) {
      result.push({ role: options.summaryRole ?? 'system', content: currentSummary });
    }
    result.push(...recentMessages);
    return result;
  }

  function getSummary(): string | undefined {
    return currentSummary;
  }

  function getTokenCount(): number {
    return sysTokens() + ancTokens() + sumTokens() + recTokens() + pendTokens();
  }

  function getTokenBreakdown(): {
    system: number;
    anchor: number;
    summary: number;
    recent: number;
    total: number;
  } {
    const system = sysTokens();
    const anchor = ancTokens();
    const summary = sumTokens();
    const recent = recTokens() + pendTokens();
    return { system, anchor, summary, recent, total: system + anchor + summary + recent };
  }

  function getRecentMessageCount(): number {
    return recentMessages.length + pendingBuffer.length;
  }

  function getTotalMessageCount(): number {
    let count = recentMessages.length + pendingBuffer.length;
    if (currentSummary !== undefined) count += 1;
    if (systemMessage) count += 1;
    count += anchorMessages.length;
    return count;
  }

  function setAnchor(messages: Message[]): void {
    anchorMessages = messages.slice();
  }

  function setTokenBudget(budget: number): void {
    if (!Number.isFinite(budget) || budget < 100) {
      throw new RangeError(
        `sliding-context: tokenBudget must be a finite number >= 100, got ${budget}`,
      );
    }
    tokenBudget = budget;
    void enforceBudget();
  }

  function clear(): void {
    recentMessages = [];
    pendingBuffer = [];
    currentSummary = undefined;
    summaryRounds = 0;
    anchorMessages = options.anchor ? options.anchor.slice() : [];
  }

  function serialize(): ContextState {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { summarizer, tokenCounter, hooks, ...serializableOptions } = options;
    return {
      options: { ...serializableOptions, tokenBudget },
      messages: recentMessages.slice(),
      summary: currentSummary,
      anchor: anchorMessages.slice(),
      pendingBuffer: pendingBuffer.slice(),
      summaryRounds,
      tokenCounts: {
        system: sysTokens(),
        anchor: ancTokens(),
        summary: sumTokens(),
        recent: recTokens(),
        pending: pendTokens(),
      },
      version: 1,
    };
  }

  return {
    addMessage,
    getMessages,
    getSummary,
    getTokenCount,
    getTokenBreakdown,
    getRecentMessageCount,
    getTotalMessageCount,
    setAnchor,
    setTokenBudget,
    clear,
    serialize,
  };
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Create a new SlidingContext instance.
 */
export function createSlidingContext(options: SlidingContextOptions): SlidingContext {
  return createWithState(options);
}

/**
 * Serialize a SlidingContext's state to a JSON string suitable for storage.
 */
export function serializeContext(ctx: SlidingContext): string {
  return serializeToJSON(ctx.serialize());
}

/**
 * Restore a SlidingContext from a JSON string produced by `serializeContext()`.
 * Re-supply function-valued options (summarizer, tokenCounter, hooks) since
 * they cannot be serialized.
 */
export function restoreSlidingContext(
  data: string,
  options: SlidingContextOptions,
): SlidingContext {
  const state = parseState(data);
  return createWithState({ ...options, tokenBudget: state.options.tokenBudget }, state);
}
