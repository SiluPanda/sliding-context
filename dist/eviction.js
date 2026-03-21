"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evictMessages = evictMessages;
const token_counter_1 = require("./token-counter");
/**
 * Build a set of tool_call_id values that are "anchored" to a given assistant
 * message — i.e. the message contains tool_calls whose results we still need.
 */
function toolCallIds(message) {
    const ids = new Set();
    if (message.tool_calls) {
        for (const tc of message.tool_calls) {
            ids.add(tc.id);
        }
    }
    return ids;
}
/**
 * Compute total tokens for a list of messages.
 */
function totalTokens(messages, tokenCounter, overhead) {
    return messages.reduce((sum, m) => sum + (0, token_counter_1.countMessageTokens)(m, tokenCounter, overhead), 0);
}
/**
 * Evict the oldest messages from `messages` until `totalTokens` fits within
 * `targetTokens`.  Tool-call pairs are kept atomic: an assistant message with
 * `tool_calls` is always evicted together with all its paired `tool` result
 * messages.
 *
 * Returns `{ evicted, remaining }`.
 */
function evictMessages(messages, targetTokens, tokenCounter, overhead) {
    // Nothing to evict.
    if (totalTokens(messages, tokenCounter, overhead) <= targetTokens) {
        return { evicted: [], remaining: messages.slice() };
    }
    const remaining = messages.slice();
    const evicted = [];
    while (remaining.length > 0 &&
        totalTokens(remaining, tokenCounter, overhead) > targetTokens) {
        // Find the first non-system message to evict.
        const idx = remaining.findIndex((m) => m.role !== 'system');
        if (idx === -1) {
            // Only system messages left — cannot evict further.
            break;
        }
        const candidate = remaining[idx];
        // Collect the group to evict atomically.
        const group = [candidate];
        if (candidate.tool_calls && candidate.tool_calls.length > 0) {
            // This is a tool-call message.  Find all paired tool-result messages that
            // immediately follow it (they may be interspersed in the remaining list).
            const pendingIds = toolCallIds(candidate);
            let searchIdx = idx + 1;
            while (pendingIds.size > 0 && searchIdx < remaining.length) {
                const next = remaining[searchIdx];
                if (next.role === 'tool' && next.tool_call_id && pendingIds.has(next.tool_call_id)) {
                    group.push(next);
                    pendingIds.delete(next.tool_call_id);
                }
                searchIdx++;
            }
        }
        // Remove the group from remaining.
        const groupSet = new Set(group);
        const newRemaining = remaining.filter((m) => !groupSet.has(m));
        // Safety: never leave remaining empty if we started with messages.
        // If removing the group would empty everything, stop.
        if (newRemaining.length === 0 && messages.length > group.length) {
            break;
        }
        // Commit the eviction.
        evicted.push(...group);
        remaining.splice(0, remaining.length, ...newRemaining);
    }
    return { evicted, remaining };
}
//# sourceMappingURL=eviction.js.map