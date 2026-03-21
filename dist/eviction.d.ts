import type { Message, TokenCounter } from './types';
/**
 * Evict the oldest messages from `messages` until `totalTokens` fits within
 * `targetTokens`.  Tool-call pairs are kept atomic: an assistant message with
 * `tool_calls` is always evicted together with all its paired `tool` result
 * messages.
 *
 * Returns `{ evicted, remaining }`.
 */
export declare function evictMessages(messages: Message[], targetTokens: number, tokenCounter: TokenCounter, overhead: number): {
    evicted: Message[];
    remaining: Message[];
};
//# sourceMappingURL=eviction.d.ts.map