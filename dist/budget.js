"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocateBudget = allocateBudget;
/**
 * Allocate token budget across the three context zones.
 *
 * Priority order:
 *   1. System tokens (fixed — caller provides actual count)
 *   2. Summary tokens (capped at maxSummaryTokens; 0 if no summarizer)
 *   3. Recent tokens (remainder, enforcing minRecentTokens)
 */
function allocateBudget(options, systemTokensUsed) {
    const total = options.tokenBudget;
    const afterSystem = Math.max(0, total - systemTokensUsed);
    const hasSummarizer = typeof options.summarizer === 'function';
    const defaultMaxSummary = Math.floor(total * 0.3);
    const maxSummaryTokens = hasSummarizer
        ? (options.maxSummaryTokens ?? defaultMaxSummary)
        : 0;
    const defaultMinRecent = Math.floor(total * 0.3);
    const minRecentTokens = options.minRecentTokens ?? defaultMinRecent;
    // How much can summary actually use?
    const summaryTokens = Math.min(maxSummaryTokens, Math.max(0, afterSystem - minRecentTokens));
    const recentTokens = Math.max(0, afterSystem - summaryTokens);
    return {
        systemTokens: systemTokensUsed,
        summaryTokens,
        recentTokens,
    };
}
//# sourceMappingURL=budget.js.map