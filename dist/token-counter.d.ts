import type { Message, TokenCounter } from './types';
export declare const DEFAULT_MESSAGE_OVERHEAD = 4;
/** Default token counter: Math.ceil(text.length / 4). Returns 0 for empty/null. */
export declare function approximateTokenCounter(text: string): number;
/** Count tokens for a single message including per-message overhead. */
export declare function countMessageTokens(message: Message, tokenCounter: TokenCounter, messageOverhead: number): number;
//# sourceMappingURL=token-counter.d.ts.map