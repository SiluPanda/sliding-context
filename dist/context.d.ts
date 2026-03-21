import type { SlidingContextOptions, SlidingContext } from './types';
/**
 * Create a new SlidingContext instance.
 */
export declare function createSlidingContext(options: SlidingContextOptions): SlidingContext;
/**
 * Serialize a SlidingContext's state to a JSON string suitable for storage.
 */
export declare function serializeContext(ctx: SlidingContext): string;
/**
 * Restore a SlidingContext from a JSON string produced by `serializeContext()`.
 * Re-supply function-valued options (summarizer, tokenCounter, hooks) since
 * they cannot be serialized.
 */
export declare function restoreSlidingContext(data: string, options: SlidingContextOptions): SlidingContext;
//# sourceMappingURL=context.d.ts.map