"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSummarizationPrompt = defaultSummarizationPrompt;
/**
 * Formats a message array into a plain-text block for the summarization prompt.
 */
function formatMessages(messages) {
    return messages
        .map((m) => {
        const role = m.role.toUpperCase();
        if (m.tool_calls && m.tool_calls.length > 0) {
            return `${role}: [tool_calls] ${JSON.stringify(m.tool_calls)}`;
        }
        if (m.role === 'tool') {
            return `TOOL(${m.tool_call_id ?? ''}): ${m.content}`;
        }
        return `${role}: ${m.content}`;
    })
        .join('\n');
}
/**
 * Returns a summarization prompt for the given messages.
 */
function defaultSummarizationPrompt(messages) {
    const formatted = formatMessages(messages);
    return `Summarize the following conversation concisely:\n\n${formatted}`;
}
//# sourceMappingURL=prompt.js.map