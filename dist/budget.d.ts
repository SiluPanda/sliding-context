import type { SlidingContextOptions } from './types';
export interface BudgetAllocation {
    systemTokens: number;
    summaryTokens: number;
    recentTokens: number;
}
/**
 * Allocate token budget across the three context zones.
 *
 * Priority order:
 *   1. System tokens (fixed — caller provides actual count)
 *   2. Summary tokens (capped at maxSummaryTokens; 0 if no summarizer)
 *   3. Recent tokens (remainder, enforcing minRecentTokens)
 */
export declare function allocateBudget(options: SlidingContextOptions, systemTokensUsed: number): BudgetAllocation;
//# sourceMappingURL=budget.d.ts.map