# sliding-context

Provider-agnostic sliding window context manager for LLMs. Keeps your conversation within a token budget by evicting old messages, summarizing context, and preserving tool call atomicity.

## Installation

```bash
npm install sliding-context
```

## Quick Start

The core context manager (`createSlidingContext`) is under active development. The planned usage pattern:

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

## Available Exports

### Types

All core type definitions are available today:

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
| `TokenCounter` | `(text: string) => number` -- pluggable token counting function |
| `Summarizer` | `(messages: Message[], existingSummary?: string) => Promise<string>` |
| `SummarizationStrategy` | `'incremental' \| 'rolling' \| 'anchored'` |
| `SummaryRole` | `'system' \| 'user'` -- role used for injected summary messages |
| `EventHooks` | Callbacks for eviction, summarization, budget, and compression events |
| `SlidingContextOptions` | Full configuration for the context manager |
| `ContextState` | Serializable snapshot of context state (version 1) |
| `SlidingContext` | Public interface for the context manager instance |

### Token Counting

The built-in approximate token counter and message token counting utilities are available now:

```ts
import {
  approximateTokenCounter,
  countMessageTokens,
  DEFAULT_MESSAGE_OVERHEAD,
} from 'sliding-context';
```

#### `approximateTokenCounter(text: string): number`

A fast, zero-dependency token estimator. Returns `Math.ceil(text.length / 4)`, which approximates GPT-style tokenization. Returns `0` for empty or falsy input.

```ts
approximateTokenCounter('Hello, world!');
// => 4 (ceil(13 / 4))

approximateTokenCounter('');
// => 0
```

#### `countMessageTokens(message, tokenCounter, messageOverhead): number`

Counts tokens for a single `Message`, including:

- String content via the provided `tokenCounter`
- Array content (multi-part): text parts counted via `tokenCounter`, non-text parts (e.g., images) add a flat 85-token cost each
- `tool_calls` JSON serialization cost
- `tool_call_id` cost
- Per-message overhead

```ts
import type { Message } from 'sliding-context';

const msg: Message = { role: 'user', content: 'What is 2+2?' };
countMessageTokens(msg, approximateTokenCounter, DEFAULT_MESSAGE_OVERHEAD);
// => ceil(12/4) + 4 = 7
```

#### `DEFAULT_MESSAGE_OVERHEAD`

The default per-message token overhead: `4`. This accounts for role tokens and message framing in typical LLM APIs.

## Configuration Options

The `SlidingContextOptions` interface accepts:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tokenBudget` | `number` | *required* | Maximum total tokens for the context window |
| `systemPrompt` | `string` | -- | System prompt (never evicted or summarized) |
| `summarizer` | `Summarizer` | -- | Async function to summarize evicted messages |
| `strategy` | `SummarizationStrategy` | `'incremental'` | Summarization strategy |
| `maxSummaryTokens` | `number` | `floor(budget * 0.3)` | Max tokens for the summary |
| `minRecentTokens` | `number` | `floor(budget * 0.3)` | Minimum tokens reserved for recent messages |
| `summarizeThresholdTokens` | `number` | `floor(budget * 0.1)` | Token threshold to trigger summarization |
| `summarizeThresholdMessages` | `number` | `6` | Message count threshold to trigger summarization |
| `tokenCounter` | `TokenCounter` | `approximateTokenCounter` | Custom token counting function |
| `messageOverhead` | `number` | `4` | Per-message token overhead |
| `summaryRole` | `SummaryRole` | `'system'` | Role for injected summary messages |
| `maxSummaryRounds` | `number` | `5` | Max re-summarization attempts for compression |
| `anchor` | `Message[]` | -- | Anchored messages (for `'anchored'` strategy) |
| `maxAnchorTokens` | `number` | `floor(maxSummaryTokens * 0.4)` | Max tokens for anchor section |
| `hooks` | `EventHooks` | -- | Event callbacks for observability |

## Future API

The following features are planned for upcoming releases:

- **Context management** (`createSlidingContext`) -- factory function, message addition, eviction, budget allocation
- **Eviction** -- oldest-first eviction with tool call pair atomicity
- **Summarization orchestration** -- incremental, rolling, and anchored strategies with compression
- **Serialization** -- `serialize()` / `deserialize()` for persisting context across sessions
- **Event hooks** -- `onEvict`, `onSummarize`, `onBudgetExceeded`, `onSummaryCompressed`
- **Dynamic budget changes** -- `setTokenBudget()` for mid-conversation budget adjustments

## License

MIT
