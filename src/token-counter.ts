import type { Message, TokenCounter } from './types';

const IMAGE_TOKEN_COST = 85;

export const DEFAULT_MESSAGE_OVERHEAD = 4;

/** Default token counter: Math.ceil(text.length / 4). Returns 0 for empty/null. */
export function approximateTokenCounter(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Count tokens for a single message including per-message overhead. */
export function countMessageTokens(
  message: Message,
  tokenCounter: TokenCounter,
  messageOverhead: number,
): number {
  let contentTokens = 0;
  const content = message.content as unknown;

  if (Array.isArray(content)) {
    for (const part of content as Array<{ type?: string; text?: string }>) {
      if (part.type === 'text' || part.type === undefined) {
        contentTokens += tokenCounter(part.text ?? '');
      } else {
        contentTokens += IMAGE_TOKEN_COST;
      }
    }
  } else if (typeof content === 'string' && content) {
    contentTokens = tokenCounter(content);
  }

  let toolTokens = 0;
  if (message.tool_calls && message.tool_calls.length > 0) {
    toolTokens = tokenCounter(JSON.stringify(message.tool_calls));
  }

  let toolIdTokens = 0;
  if (message.tool_call_id) {
    toolIdTokens = tokenCounter(message.tool_call_id);
  }

  return contentTokens + toolTokens + toolIdTokens + messageOverhead;
}
