import type { Message, Summarizer } from './types';
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
export declare function runSummarizer(messages: Message[], summarizer: Summarizer, existingSummary: string | undefined): Promise<string | null>;
//# sourceMappingURL=summarization.d.ts.map