"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSlidingContext = createSlidingContext;
exports.serializeContext = serializeContext;
exports.restoreSlidingContext = restoreSlidingContext;
const token_counter_1 = require("./token-counter");
const eviction_1 = require("./eviction");
const budget_1 = require("./budget");
const summarization_1 = require("./summarization");
const serialization_1 = require("./serialization");
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function msgTokens(message, opts) {
    const counter = opts.tokenCounter ?? token_counter_1.approximateTokenCounter;
    const overhead = opts.messageOverhead ?? token_counter_1.DEFAULT_MESSAGE_OVERHEAD;
    return (0, token_counter_1.countMessageTokens)(message, counter, overhead);
}
function listTokens(messages, opts) {
    return messages.reduce((sum, m) => sum + msgTokens(m, opts), 0);
}
// ---------------------------------------------------------------------------
// Core factory (accepts optional initial state for restore path)
// ---------------------------------------------------------------------------
function createWithState(options, initialState) {
    if (!Number.isFinite(options.tokenBudget) || options.tokenBudget < 100) {
        throw new RangeError(`sliding-context: tokenBudget must be a finite number >= 100, got ${options.tokenBudget}`);
    }
    // ---------------------------------------------------------------------------
    // Mutable state
    // ---------------------------------------------------------------------------
    let tokenBudget = options.tokenBudget;
    const systemMessage = options.systemPrompt
        ? { role: 'system', content: options.systemPrompt }
        : null;
    let anchorMessages = initialState
        ? initialState.anchor.slice()
        : options.anchor
            ? options.anchor.slice()
            : [];
    let currentSummary = initialState?.summary;
    let recentMessages = initialState ? initialState.messages.slice() : [];
    let pendingBuffer = initialState ? initialState.pendingBuffer.slice() : [];
    let summaryRounds = initialState?.summaryRounds ?? 0;
    // ---------------------------------------------------------------------------
    // Token accessors
    // ---------------------------------------------------------------------------
    function effectiveOpts() {
        return { ...options, tokenBudget };
    }
    function sysTokens() {
        return systemMessage ? msgTokens(systemMessage, effectiveOpts()) : 0;
    }
    function ancTokens() {
        return listTokens(anchorMessages, effectiveOpts());
    }
    function sumTokens() {
        if (currentSummary === undefined)
            return 0;
        return msgTokens({ role: options.summaryRole ?? 'system', content: currentSummary }, effectiveOpts());
    }
    function recTokens() {
        return listTokens(recentMessages, effectiveOpts());
    }
    function pendTokens() {
        return listTokens(pendingBuffer, effectiveOpts());
    }
    // ---------------------------------------------------------------------------
    // Summarization
    // ---------------------------------------------------------------------------
    async function triggerSummarization() {
        const { summarizer } = options;
        if (!summarizer || pendingBuffer.length === 0)
            return;
        const maxRounds = options.maxSummaryRounds ?? 5;
        if (summaryRounds >= maxRounds)
            return;
        const startMs = Date.now();
        const toSummarize = pendingBuffer.slice();
        const existingSummary = currentSummary;
        const newSummary = await (0, summarization_1.runSummarizer)(toSummarize, summarizer, existingSummary);
        if (newSummary === null)
            return;
        summaryRounds += 1;
        if (options.hooks?.onSummarize) {
            options.hooks.onSummarize(toSummarize, existingSummary, newSummary, Date.now() - startMs);
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
    async function enforceBudget() {
        const opts = effectiveOpts();
        const counter = opts.tokenCounter ?? token_counter_1.approximateTokenCounter;
        const overhead = opts.messageOverhead ?? token_counter_1.DEFAULT_MESSAGE_OVERHEAD;
        const allocation = (0, budget_1.allocateBudget)(opts, sysTokens() + ancTokens() + sumTokens());
        const targetRecent = allocation.recentTokens;
        if (recTokens() <= targetRecent)
            return;
        if (options.hooks?.onBudgetExceeded) {
            const total = sysTokens() + ancTokens() + sumTokens() + recTokens() + pendTokens();
            options.hooks.onBudgetExceeded(total, tokenBudget);
        }
        const { evicted, remaining } = (0, eviction_1.evictMessages)(recentMessages, targetRecent, counter, overhead);
        if (evicted.length > 0) {
            recentMessages = remaining;
            pendingBuffer = [...pendingBuffer, ...evicted];
            if (options.hooks?.onEvict)
                options.hooks.onEvict(evicted, 'budget');
        }
        const thresholdTokens = opts.summarizeThresholdTokens ?? Math.floor(tokenBudget * 0.1);
        const thresholdMessages = opts.summarizeThresholdMessages ?? 6;
        if (pendingBuffer.length >= thresholdMessages ||
            pendTokens() >= thresholdTokens) {
            await triggerSummarization();
        }
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    async function addMessage(message) {
        recentMessages.push(message);
        await enforceBudget();
    }
    function getMessages() {
        const result = [];
        if (systemMessage)
            result.push(systemMessage);
        if (anchorMessages.length > 0)
            result.push(...anchorMessages);
        // Pending messages are older than recent — include before summary/recent.
        if (pendingBuffer.length > 0)
            result.push(...pendingBuffer);
        if (currentSummary !== undefined) {
            result.push({ role: options.summaryRole ?? 'system', content: currentSummary });
        }
        result.push(...recentMessages);
        return result;
    }
    function getSummary() {
        return currentSummary;
    }
    function getTokenCount() {
        return sysTokens() + ancTokens() + sumTokens() + recTokens() + pendTokens();
    }
    function getTokenBreakdown() {
        const system = sysTokens();
        const anchor = ancTokens();
        const summary = sumTokens();
        const recent = recTokens() + pendTokens();
        return { system, anchor, summary, recent, total: system + anchor + summary + recent };
    }
    function getRecentMessageCount() {
        return recentMessages.length + pendingBuffer.length;
    }
    function getTotalMessageCount() {
        let count = recentMessages.length + pendingBuffer.length;
        if (currentSummary !== undefined)
            count += 1;
        if (systemMessage)
            count += 1;
        count += anchorMessages.length;
        return count;
    }
    function setAnchor(messages) {
        anchorMessages = messages.slice();
    }
    function setTokenBudget(budget) {
        if (!Number.isFinite(budget) || budget < 100) {
            throw new RangeError(`sliding-context: tokenBudget must be a finite number >= 100, got ${budget}`);
        }
        tokenBudget = budget;
        void enforceBudget();
    }
    function clear() {
        recentMessages = [];
        pendingBuffer = [];
        currentSummary = undefined;
        summaryRounds = 0;
        anchorMessages = options.anchor ? options.anchor.slice() : [];
    }
    function serialize() {
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
function createSlidingContext(options) {
    return createWithState(options);
}
/**
 * Serialize a SlidingContext's state to a JSON string suitable for storage.
 */
function serializeContext(ctx) {
    return (0, serialization_1.serialize)(ctx.serialize());
}
/**
 * Restore a SlidingContext from a JSON string produced by `serializeContext()`.
 * Re-supply function-valued options (summarizer, tokenCounter, hooks) since
 * they cannot be serialized.
 */
function restoreSlidingContext(data, options) {
    const state = (0, serialization_1.deserialize)(data);
    return createWithState({ ...options, tokenBudget: state.options.tokenBudget }, state);
}
//# sourceMappingURL=context.js.map