# sliding-context

Provider-agnostic sliding window context manager for LLMs. Keeps your conversation within a token budget by evicting old messages, summarizing context, and preserving tool call atomicity.

## Installation

```bash
npm install sliding-context
```

## Quick Start

```ts
import { createSlidingContext } from 'sliding-context';
import type { Message, SlidingContextOptions } from 'sliding-context';

const ctx = createSlidingContext({
  tokenBudget: 8192,
  systemPrompt: 'You are a helpful assistant.',
  summarizer: async (messages, existingSummary) => {
    // Call your LLM to summarize evicted messages
    return 'Summary of the conversation so far...';
  },
  strategy: 'incremental',
});

// Add messages as the conversation progresses
await ctx.addMessage({ role: 'user', content: 'Hello!' });
await ctx.addMessage({ role: 'assistant', content: 'Hi there!' });

// Get the current context window (fits within tokenBudget)
const messages = ctx.getMessages();
// => [systemPrompt, ...recentMessages] or [systemPrompt, summary, ...recentMessages]

// Inspect token usage
const breakdown = ctx.getTokenBreakdown();
// => { system: 12, anchor: 0, summary: 0, recent: 10, total: 22 }
```

## API

### `createSlidingContext(options): SlidingContext`

Creates a new sliding context manager.

```ts
import { createSlidingContext } from 'sliding-context';

const ctx = createSlidingContext({ tokenBudget: 4096 });
```

Throws `RangeError` if `tokenBudget < 100` or is not finite.

### SlidingContext Methods

#### `addMessage(message: Message): Promise<void>`

Adds a message to the context. After each addition, checks if the token budget is exceeded and evicts oldest messages if needed. If a summarizer is configured and the pending eviction buffer reaches the summarization threshold, the summarizer is invoked automatically.

```ts
await ctx.addMessage({ role: 'user', content: 'What time is it?' });
```

#### `getMessages(): Message[]`

Returns the current message array in order:
1. System prompt (if configured)
2. Anchor messages (if set)
3. Pending eviction buffer (messages evicted but not yet summarized)
4. Summary message (if summarization has occurred)
5. Recent messages (verbatim, newest last)

This array is always ready to send directly to any LLM API.

#### `getSummary(): string | undefined`

Returns the current rolling summary text, or `undefined` if summarization has not yet occurred.

#### `getTokenCount(): number`

Returns the total token count across all zones (system + anchor + summary + recent + pending).

#### `getTokenBreakdown(): { system, anchor, summary, recent, total }`

Returns a breakdown of token usage by zone.

```ts
const bd = ctx.getTokenBreakdown();
// { system: 12, anchor: 0, summary: 150, recent: 800, total: 962 }
```

#### `getRecentMessageCount(): number`

Returns the count of recent messages (including pending buffer, excluding system/anchor/summary).

#### `getTotalMessageCount(): number`

Returns the total count of all messages including system prompt, anchor, summary, pending buffer, and recent.

#### `setAnchor(messages: Message[]): void`

Replaces the anchor message set. Anchor messages are always included verbatim after the system prompt and are never evicted.

#### `setTokenBudget(budget: number): void`

Updates the token budget dynamically and immediately re-enforces eviction if needed. Throws `RangeError` if `budget < 100`.

#### `clear(): void`

Resets recent messages, pending buffer, and summary to empty. The system prompt and anchor messages are retained (anchor is reset to initial options value).

#### `serialize(): ContextState`

Returns a serializable snapshot of the current context state (version 1). Does not include function-valued options (summarizer, tokenCounter, hooks).

### `serializeContext(ctx): string`

Serializes a `SlidingContext` to a JSON string suitable for persistence.

```ts
import { serializeContext } from 'sliding-context';

const json = serializeContext(ctx);
await redis.set('ctx:user123', json);
```

### `restoreSlidingContext(data, options): SlidingContext`

Restores a `SlidingContext` from a JSON string. Re-supply function-valued options since they cannot be serialized.

```ts
import { restoreSlidingContext } from 'sliding-context';

const json = await redis.get('ctx:user123');
const ctx = restoreSlidingContext(json, {
  tokenBudget: 4096,
  summarizer: myLLMSummarizer,
});
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tokenBudget` | `number` | *required* | Maximum total tokens for the context window |
| `systemPrompt` | `string` | — | System prompt (never evicted or summarized) |
| `summarizer` | `Summarizer` | — | Async function to summarize evicted messages |
| `strategy` | `SummarizationStrategy` | `'incremental'` | Summarization strategy |
| `maxSummaryTokens` | `number` | `floor(budget * 0.3)` | Max tokens for the summary zone |
| `minRecentTokens` | `number` | `floor(budget * 0.3)` | Minimum tokens reserved for recent messages |
| `summarizeThresholdTokens` | `number` | `floor(budget * 0.1)` | Token count in pending buffer to trigger summarization |
| `summarizeThresholdMessages` | `number` | `6` | Message count in pending buffer to trigger summarization |
| `tokenCounter` | `TokenCounter` | `approximateTokenCounter` | Custom token counting function |
| `messageOverhead` | `number` | `4` | Per-message token overhead |
| `summaryRole` | `SummaryRole` | `'system'` | Role for injected summary messages |
| `maxSummaryRounds` | `number` | `5` | Max summarization rounds before stopping |
| `anchor` | `Message[]` | — | Initial anchor messages |
| `maxAnchorTokens` | `number` | `floor(maxSummaryTokens * 0.4)` | Max tokens for anchor section |
| `hooks` | `EventHooks` | — | Event callbacks for observability |

## Token Counting

Built-in approximate token counter and message token counting utilities:

```ts
import {
  approximateTokenCounter,
  countMessageTokens,
  DEFAULT_MESSAGE_OVERHEAD,
} from 'sliding-context';
```

### `approximateTokenCounter(text: string): number`

Returns `Math.ceil(text.length / 4)`. Approximates GPT-style tokenization. Returns `0` for empty input.

### `countMessageTokens(message, tokenCounter, messageOverhead): number`

Counts tokens for a single `Message`, including content, `tool_calls` JSON, `tool_call_id`, and per-message overhead.

### `DEFAULT_MESSAGE_OVERHEAD`

The default per-message token overhead: `4`.

## Event Hooks

```ts
const ctx = createSlidingContext({
  tokenBudget: 4096,
  hooks: {
    onEvict: (messages, reason) => console.log('Evicted', messages.length, 'messages:', reason),
    onSummarize: (input, existing, summary, durationMs) =>
      console.log('Summarized in', durationMs, 'ms'),
    onBudgetExceeded: (total, budget) =>
      console.log('Budget exceeded:', total, '/', budget),
    onSummaryCompressed: (old, next) => console.log('Summary compressed'),
  },
});
```

## Serialization / Deserialization

```ts
import { serialize, deserialize } from 'sliding-context';

// Low-level: serialize a ContextState object to JSON string.
const json = serialize(ctx.serialize());

// Low-level: parse a JSON string back to ContextState.
const state = deserialize(json); // throws on version mismatch
```

## Types

```ts
import type {
  Message,
  ToolCall,
  TokenCounter,
  Summarizer,
  SummarizationStrategy,
  SummaryRole,
  EventHooks,
  SlidingContextOptions,
  ContextState,
  SlidingContext,
} from 'sliding-context';
```

| Type | Description |
|------|-------------|
| `Message` | Chat message with `role`, `content`, optional `tool_calls`, `tool_call_id`, `name` |
| `ToolCall` | Tool/function call descriptor with `id`, `type`, and `function` |
| `TokenCounter` | `(text: string) => number` — pluggable token counting function |
| `Summarizer` | `(messages: Message[], existingSummary?: string) => Promise<string>` |
| `SummarizationStrategy` | `'incremental' \| 'rolling' \| 'anchored'` |
| `SummaryRole` | `'system' \| 'user'` — role used for injected summary messages |
| `EventHooks` | Callbacks for eviction, summarization, budget, and compression events |
| `SlidingContextOptions` | Full configuration for the context manager |
| `ContextState` | Serializable snapshot of context state (version 1) |
| `SlidingContext` | Public interface for the context manager instance |

## License

MIT
