"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSummarizer = runSummarizer;
/**
 * Invoke the summarizer with `messages` and the optional `existingSummary`.
 * Returns the summary string on success, or `null` if the summarizer throws.
 *
 * The `prompt` function is intentionally not used here because the Summarizer
 * type already receives the raw messages and existing summary — the caller
 * (typically the LLM wrapper) is responsible for prompt construction.  The
 * `prompt` parameter is retained for callers that want to inspect or log the
 * prompt used.
 */
async function runSummarizer(messages, summarizer, existingSummary) {
    try {
        const result = await summarizer(messages, existingSummary);
        return result;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=summarization.js.map