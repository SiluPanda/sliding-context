# sliding-context

Provider-agnostic sliding window context manager for LLMs. Keeps your conversation within a token budget by evicting old messages, summarizing context, and preserving tool call atomicity.

[![npm version](https://img.shields.io/npm/v/sliding-context.svg)](https://www.npmjs.com/package/sliding-context)
[![npm downloads](https://img.shields.io/npm/dt/sliding-context.svg)](https://www.npmjs.com/package/sliding-context)
[![license](https://img.shields.io/npm/l/sliding-context.svg)](https://github.com/SiluPanda/sliding-context/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/sliding-context.svg)](https://www.npmjs.com/package/sliding-context)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://www.npmjs.com/package/sliding-context)

---

## Description

`sliding-context` manages the conversation history portion of an LLM's context window. It divides the context into three zones -- a fixed system prompt, a rolling summary of older messages, and a verbatim recent-message buffer -- and automatically evicts and summarizes messages to keep the total token count within a configurable budget.

The package is provider-agnostic. It does not import any LLM SDK, make HTTP requests, or manage API keys. You supply a summarizer function that calls whichever LLM you use, and `sliding-context` orchestrates when and what to summarize. It works equally well with OpenAI, Anthropic, Google, Ollama, or any other provider.

Key properties:

- **Zero runtime dependencies.** All logic uses built-in JavaScript APIs.
- **Tool call pair atomicity.** Assistant messages with `tool_calls` and their corresponding tool result messages are always evicted together -- they are never split across the summary boundary.
- **Pluggable token counting.** Ships with a built-in approximate counter (`Math.ceil(text.length / 4)`) and accepts any custom counter (tiktoken, gpt-tokenizer, etc.).
- **Serialization and persistence.** Full context state can be serialized to JSON and restored across sessions, server restarts, or storage backends.
- **Event hooks.** Observe eviction, summarization, budget exceeded, and summary compression events for logging and monitoring.
- **Three summarization strategies.** `incremental`, `rolling`, and `anchored` -- choose the one that fits your use case.

---

## Installation

```bash
npm install sliding-context
```

Requires Node.js >= 18.

---

## Quick Start

```ts
import { createSlidingContext } from "sliding-context";
import type { Message } from "sliding-context";

const ctx = createSlidingContext({
  tokenBudget: 8192,
  systemPrompt: "You are a helpful assistant.",
  summarizer: async (messages: Message[], existingSummary?: string) => {
    // Call your LLM of choice to summarize the evicted messages.
    // Return the summary as a plain string.
    return "Summary of the conversation so far...";
  },
  strategy: "incremental",
});

// Add messages as the conversation progresses
await ctx.addMessage({ role: "user", content: "Hello!" });
await ctx.addMessage({ role: "assistant", content: "Hi there!" });

// Retrieve the context window -- always fits within tokenBudget
const messages = ctx.getMessages();
// => [{ role: 'system', content: 'You are a helpful assistant.' },
//     { role: 'user', content: 'Hello!' },
//     { role: 'assistant', content: 'Hi there!' }]

// Inspect token usage
const breakdown = ctx.getTokenBreakdown();
// => { system: 12, anchor: 0, summary: 0, recent: 18, total: 30 }
```

---

## Features

### Automatic Eviction and Summarization

When the total token count exceeds the configured budget, the oldest messages in the recent zone are evicted into a pending buffer. Once the pending buffer crosses a configurable threshold (by token count or message count), the summarizer is invoked to compress those messages into the rolling summary.

### Tool Call Pair Atomicity

Assistant messages with `tool_calls` are always evicted as an atomic unit together with all corresponding tool result messages. This prevents orphaned tool calls from confusing the LLM.

### Three Summarization Strategies

| Strategy | Behavior |
|---|---|
| `incremental` | Summarizes only newly evicted messages and merges with the existing summary. Most token-efficient. |
| `rolling` | Prepends the existing summary to evicted messages and re-summarizes the whole batch. Produces more coherent summaries. |
| `anchored` | Maintains a permanent anchor (never re-summarized) plus a rolling section for newer content. Best for preserving key context. |

### Dynamic Budget Changes

Call `setTokenBudget()` at any time to resize the context window. Reducing the budget triggers immediate eviction and, if thresholds are met, summarization. This supports multi-model workflows where you switch from a large-context model to a smaller one mid-conversation.

### Serialization and Persistence

Export the full context state as JSON with `serialize()` or `serializeContext()`. Restore it later with `restoreSlidingContext()`, re-supplying function-valued options (summarizer, tokenCounter, hooks) that cannot be serialized. Store state in Redis, DynamoDB, localStorage, or any other backend.

### Event Hooks

Attach callbacks for observability: `onEvict`, `onSummarize`, `onBudgetExceeded`, and `onSummaryCompressed`. Hooks that throw are caught internally and do not crash the context manager.

### Multi-Part Message Support

Messages with array content (text blocks, image blocks) are supported. Text parts are counted with the configured token counter. Non-text parts (images, etc.) use a flat token cost of 85 per part.

---

## API Reference

### `createSlidingContext(options)`

Creates and returns a new `SlidingContext` instance.

```ts
import { createSlidingContext } from "sliding-context";

const ctx = createSlidingContext({ tokenBudget: 4096 });
```

**Parameters:**
- `options` (`SlidingContextOptions`) -- Configuration object. See [Configuration](#configuration) below.

**Returns:** `SlidingContext`

**Throws:** `RangeError` if `tokenBudget` is not a finite number >= 100.

---

### SlidingContext Instance Methods

#### `addMessage(message: Message): Promise<void>`

Appends a message to the context. After each addition, checks the token budget and triggers eviction and summarization as needed.

```ts
await ctx.addMessage({ role: "user", content: "What time is it?" });
```

#### `getMessages(): Message[]`

Returns the current message array, ready to send to any LLM API. The order is:

1. System prompt (if configured)
2. Anchor messages (if set)
3. Pending buffer messages (evicted but not yet summarized)
4. Summary message (if summarization has occurred)
5. Recent messages (verbatim, newest last)

```ts
const messages = ctx.getMessages();
```

#### `getSummary(): string | undefined`

Returns the current rolling summary text, or `undefined` if no summarization has occurred.

```ts
const summary = ctx.getSummary();
```

#### `getTokenCount(): number`

Returns the total token count across all zones (system + anchor + summary + recent + pending).

```ts
const total = ctx.getTokenCount();
```

#### `getTokenBreakdown(): { system, anchor, summary, recent, total }`

Returns a breakdown of token usage by zone.

```ts
const bd = ctx.getTokenBreakdown();
// { system: 12, anchor: 0, summary: 150, recent: 800, total: 962 }
```

#### `getRecentMessageCount(): number`

Returns the count of recent messages (including the pending buffer, excluding system prompt, anchor, and summary).

```ts
const count = ctx.getRecentMessageCount();
```

#### `getTotalMessageCount(): number`

Returns the total count of all messages including system prompt, anchor, summary, pending buffer, and recent.

```ts
const total = ctx.getTotalMessageCount();
```

#### `setAnchor(messages: Message[]): void`

Replaces the anchor message set. Anchor messages are always included verbatim after the system prompt and are never evicted or summarized.

```ts
ctx.setAnchor([
  { role: "system", content: "Important context that must always be present." },
]);
```

#### `setTokenBudget(budget: number): void`

Updates the token budget dynamically. If the current token count exceeds the new budget, eviction is triggered immediately.

```ts
ctx.setTokenBudget(4096);
```

**Throws:** `RangeError` if `budget` is not a finite number >= 100.

#### `clear(): void`

Resets recent messages, pending buffer, summary, and summary round counter to their initial state. The system prompt is retained. Anchor messages are reset to the value from the original options.

```ts
ctx.clear();
```

#### `serialize(): ContextState`

Returns a serializable snapshot of the current context state. Function-valued options (summarizer, tokenCounter, hooks) are excluded. The returned object is JSON-safe.

```ts
const state = ctx.serialize();
// state.version === 1
```

---

### `serializeContext(ctx: SlidingContext): string`

Serializes a `SlidingContext` instance to a JSON string suitable for persistence.

```ts
import { serializeContext } from "sliding-context";

const json = serializeContext(ctx);
await redis.set("ctx:user123", json);
```

---

### `restoreSlidingContext(data: string, options: SlidingContextOptions): SlidingContext`

Restores a `SlidingContext` from a JSON string produced by `serializeContext()`. Re-supply function-valued options since they cannot be serialized.

```ts
import { restoreSlidingContext } from "sliding-context";

const json = await redis.get("ctx:user123");
const ctx = restoreSlidingContext(json, {
  tokenBudget: 4096,
  summarizer: mySummarizer,
  tokenCounter: myTokenCounter,
});
```

---

### `serialize(state: ContextState): string`

Low-level serialization. Converts a `ContextState` object to a JSON string with `version: 1`.

```ts
import { serialize } from "sliding-context";

const json = serialize(ctx.serialize());
```

---

### `deserialize(data: string): ContextState`

Low-level deserialization. Parses a JSON string back to a `ContextState` object. Validates the `version` field.

```ts
import { deserialize } from "sliding-context";

const state = deserialize(json);
```

**Throws:** `Error` if the JSON is malformed or the `version` field does not match the expected schema version (currently `1`).

---

### `approximateTokenCounter(text: string): number`

Built-in approximate token counter. Returns `Math.ceil(text.length / 4)`. Returns `0` for empty or falsy input. Approximates GPT-style tokenization without any external dependency.

```ts
import { approximateTokenCounter } from "sliding-context";

approximateTokenCounter("Hello world"); // 3
```

---

### `countMessageTokens(message: Message, tokenCounter: TokenCounter, messageOverhead: number): number`

Counts tokens for a single `Message`, including:
- String content via the provided `tokenCounter`
- Array content (text parts summed, non-text parts at 85 tokens each)
- `tool_calls` JSON stringified and counted
- `tool_call_id` string counted
- Per-message `messageOverhead` added

```ts
import { countMessageTokens, approximateTokenCounter } from "sliding-context";

const tokens = countMessageTokens(
  { role: "user", content: "Hello" },
  approximateTokenCounter,
  4
);
// => 6  (2 content tokens + 4 overhead)
```

---

### `DEFAULT_MESSAGE_OVERHEAD`

The default per-message token overhead constant: `4`.

```ts
import { DEFAULT_MESSAGE_OVERHEAD } from "sliding-context";
```

---

### `evictMessages(messages, targetTokens, tokenCounter, overhead)`

Low-level eviction function. Removes the oldest non-system messages from the array until total tokens fit within `targetTokens`. Tool call pairs are evicted atomically.

```ts
import { evictMessages } from "sliding-context";

const { evicted, remaining } = evictMessages(
  messages,
  1000,
  approximateTokenCounter,
  4
);
```

**Parameters:**
- `messages` (`Message[]`) -- The message array to evict from.
- `targetTokens` (`number`) -- The target token count for the remaining messages.
- `tokenCounter` (`TokenCounter`) -- Token counting function.
- `overhead` (`number`) -- Per-message token overhead.

**Returns:** `{ evicted: Message[]; remaining: Message[] }`

---

### `allocateBudget(options, systemTokensUsed)`

Computes the token budget allocation across the three context zones.

```ts
import { allocateBudget } from "sliding-context";

const allocation = allocateBudget({ tokenBudget: 4096, summarizer: fn }, 100);
// { systemTokens: 100, summaryTokens: 1228, recentTokens: 2768 }
```

**Parameters:**
- `options` (`SlidingContextOptions`) -- Configuration options.
- `systemTokensUsed` (`number`) -- Actual token count consumed by system + anchor + summary zones.

**Returns:** `BudgetAllocation` -- `{ systemTokens: number; summaryTokens: number; recentTokens: number }`

Priority order: system tokens (fixed), summary tokens (capped at `maxSummaryTokens`; 0 if no summarizer), recent tokens (remainder, enforcing `minRecentTokens`).

---

### `runSummarizer(messages, summarizer, existingSummary)`

Invokes the summarizer function with error handling. Returns `null` if the summarizer throws.

```ts
import { runSummarizer } from "sliding-context";

const summary = await runSummarizer(messages, mySummarizer, existingSummary);
if (summary === null) {
  // summarizer failed; handle gracefully
}
```

**Parameters:**
- `messages` (`Message[]`) -- Messages to summarize.
- `summarizer` (`Summarizer`) -- The summarizer function.
- `existingSummary` (`string | undefined`) -- The current summary, if any.

**Returns:** `Promise<string | null>` -- The summary string, or `null` on failure.

---

### `defaultSummarizationPrompt(messages: Message[]): string`

Returns a summarization prompt for the given messages. Formats each message with its role and content, then wraps in a "Summarize the following conversation concisely" instruction.

```ts
import { defaultSummarizationPrompt } from "sliding-context";

const prompt = defaultSummarizationPrompt(evictedMessages);
// "Summarize the following conversation concisely:\n\nUSER: Hello\nASSISTANT: Hi there"
```

Tool call messages are formatted as `ASSISTANT: [tool_calls] <JSON>`. Tool result messages are formatted as `TOOL(<tool_call_id>): <content>`.

---

## Configuration

All options are passed to `createSlidingContext()`.

| Option | Type | Default | Description |
|---|---|---|---|
| `tokenBudget` | `number` | **required** | Maximum total tokens for the context window. Must be >= 100. |
| `systemPrompt` | `string` | -- | System prompt text. Never evicted or summarized. Always first in `getMessages()`. |
| `summarizer` | `Summarizer` | -- | Async function to summarize evicted messages. If omitted, evicted messages accumulate in the pending buffer without summarization (truncation mode). |
| `strategy` | `SummarizationStrategy` | `'incremental'` | Summarization strategy: `'incremental'`, `'rolling'`, or `'anchored'`. |
| `maxSummaryTokens` | `number` | `Math.floor(tokenBudget * 0.3)` | Maximum tokens allocated to the summary zone. |
| `minRecentTokens` | `number` | `Math.floor(tokenBudget * 0.3)` | Minimum tokens guaranteed for the recent message zone. |
| `summarizeThresholdTokens` | `number` | `Math.floor(tokenBudget * 0.1)` | Token count in the pending buffer that triggers summarization. |
| `summarizeThresholdMessages` | `number` | `6` | Message count in the pending buffer that triggers summarization. Whichever threshold is reached first triggers the call. |
| `tokenCounter` | `TokenCounter` | `approximateTokenCounter` | Custom token counting function. Signature: `(text: string) => number`. |
| `messageOverhead` | `number` | `4` | Per-message token overhead added to every message's token count. |
| `summaryRole` | `SummaryRole` | `'system'` | Role for the injected summary message: `'system'` or `'user'`. |
| `maxSummaryRounds` | `number` | `5` | Maximum number of summarization rounds before the summarizer stops being called. |
| `anchor` | `Message[]` | -- | Initial anchor messages. Included verbatim after the system prompt, never evicted. |
| `maxAnchorTokens` | `number` | `Math.floor(maxSummaryTokens * 0.4)` | Maximum tokens for the anchor section. |
| `hooks` | `EventHooks` | -- | Event callbacks for observability. See [Error Handling and Event Hooks](#error-handling-and-event-hooks). |

---

## Error Handling and Event Hooks

### Construction Errors

`createSlidingContext()` throws a `RangeError` if `tokenBudget` is not a finite number >= 100:

```ts
createSlidingContext({ tokenBudget: 50 });
// RangeError: sliding-context: tokenBudget must be a finite number >= 100, got 50
```

### Budget Enforcement Errors

`setTokenBudget()` throws a `RangeError` for invalid values:

```ts
ctx.setTokenBudget(Infinity);
// RangeError: sliding-context: tokenBudget must be a finite number >= 100, got Infinity
```

### Deserialization Errors

`deserialize()` throws an `Error` for malformed JSON or version mismatches:

```ts
deserialize("not json");
// Error: sliding-context: failed to parse serialized state: ...

deserialize(JSON.stringify({ version: 99 }));
// Error: sliding-context: schema mismatch -- expected version 1, got 99
```

### Summarizer Failure Handling

If the summarizer function throws, the error is caught internally. The pending buffer retains its messages for the next summarization attempt. Summarization failure never crashes the context manager.

### Event Hooks

Attach callbacks via the `hooks` option:

```ts
const ctx = createSlidingContext({
  tokenBudget: 4096,
  summarizer: mySummarizer,
  hooks: {
    onEvict(messages, reason) {
      // reason is 'budget' for normal eviction, 'truncation' for emergency drops
      console.log(`Evicted ${messages.length} messages: ${reason}`);
    },
    onSummarize(inputMessages, existingSummary, newSummary, durationMs) {
      console.log(`Summarized ${inputMessages.length} messages in ${durationMs}ms`);
    },
    onBudgetExceeded(totalTokens, budget) {
      console.log(`Budget exceeded: ${totalTokens} / ${budget}`);
    },
    onSummaryCompressed(oldSummary, newSummary) {
      console.log("Summary was compressed");
    },
  },
});
```

All hooks are optional. Omitting any hook is safe and produces no errors.

---

## Advanced Usage

### Using a Custom Token Counter

For accurate token counting, provide a function backed by a real tokenizer:

```ts
import { encoding_for_model } from "tiktoken";

const enc = encoding_for_model("gpt-4o");

const ctx = createSlidingContext({
  tokenBudget: 8192,
  tokenCounter: (text: string) => enc.encode(text).length,
  summarizer: mySummarizer,
});
```

### Provider Integration Examples

**OpenAI:**

```ts
import OpenAI from "openai";
import { createSlidingContext } from "sliding-context";

const openai = new OpenAI();

const ctx = createSlidingContext({
  tokenBudget: 8192,
  systemPrompt: "You are a helpful assistant.",
  summarizer: async (messages, existingSummary) => {
    const prompt = existingSummary
      ? `Existing summary:\n${existingSummary}\n\nNew messages to incorporate:`
      : "Summarize the following conversation:";
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        ...messages,
      ],
    });
    return response.choices[0].message.content ?? "";
  },
});
```

**Anthropic:**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createSlidingContext } from "sliding-context";

const anthropic = new Anthropic();

const ctx = createSlidingContext({
  tokenBudget: 8192,
  systemPrompt: "You are a helpful assistant.",
  summarizer: async (messages) => {
    const formatted = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Summarize this conversation concisely:\n\n${formatted}`,
        },
      ],
    });
    return response.content[0].type === "text" ? response.content[0].text : "";
  },
});
```

### Truncation Mode (No Summarizer)

When no summarizer is provided, evicted messages accumulate in the pending buffer but are never summarized. The `getMessages()` output includes pending buffer messages along with recent messages. This mode is useful when you want eviction behavior without LLM-based summarization.

```ts
const ctx = createSlidingContext({
  tokenBudget: 4096,
  systemPrompt: "You are a helpful assistant.",
  // No summarizer -- truncation mode
});
```

### Persistence with Redis

```ts
import { createSlidingContext, serializeContext, restoreSlidingContext } from "sliding-context";

// Save
const ctx = createSlidingContext({ tokenBudget: 8192, summarizer: mySummarizer });
await ctx.addMessage({ role: "user", content: "Hello" });
const json = serializeContext(ctx);
await redis.set("session:abc", json);

// Restore
const saved = await redis.get("session:abc");
const restored = restoreSlidingContext(saved, {
  tokenBudget: 8192,
  summarizer: mySummarizer,
});
// Continue the conversation
await restored.addMessage({ role: "user", content: "I'm back!" });
```

### Dynamic Model Switching

```ts
// Start with a large-context model
const ctx = createSlidingContext({
  tokenBudget: 128000,
  summarizer: mySummarizer,
});

// ... many messages later, switch to a smaller model
ctx.setTokenBudget(4096);
// Eviction fires immediately to fit the new budget

const messages = ctx.getMessages();
// messages fit within 4096 tokens
```

### Using Anchor Messages

Anchor messages are pinned after the system prompt and are never evicted or summarized. Use them for persistent instructions, user profile data, or key facts.

```ts
const ctx = createSlidingContext({
  tokenBudget: 8192,
  systemPrompt: "You are a customer support agent.",
  summarizer: mySummarizer,
  strategy: "anchored",
});

ctx.setAnchor([
  {
    role: "system",
    content:
      "Customer: Jane Doe. Account: #12345. Plan: Enterprise. Issue: billing discrepancy.",
  },
]);
```

---

## TypeScript

`sliding-context` is written in TypeScript and ships with full type declarations. All public types are exported from the package root:

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
} from "sliding-context";
```

### Type Reference

| Type | Description |
|---|---|
| `Message` | Chat message with `role` (`'system'`, `'user'`, `'assistant'`, `'tool'`), `content` (`string`), optional `tool_calls` (`ToolCall[]`), optional `tool_call_id` (`string`), optional `name` (`string`). |
| `ToolCall` | Tool/function call descriptor: `{ id: string; type: 'function'; function: { name: string; arguments: string } }`. |
| `TokenCounter` | `(text: string) => number` -- pluggable token counting function. |
| `Summarizer` | `(messages: Message[], existingSummary?: string) => Promise<string>` -- async summarization function. |
| `SummarizationStrategy` | `'incremental' \| 'rolling' \| 'anchored'` |
| `SummaryRole` | `'system' \| 'user'` -- role used for the injected summary message. |
| `EventHooks` | `{ onEvict?, onSummarize?, onBudgetExceeded?, onSummaryCompressed? }` -- optional callbacks for observability. |
| `SlidingContextOptions` | Full configuration object for `createSlidingContext()`. |
| `ContextState` | Serializable snapshot of context state. Contains `version: 1`, `options`, `messages`, `summary`, `anchor`, `pendingBuffer`, `summaryRounds`, and `tokenCounts`. |
| `SlidingContext` | Public interface for the context manager instance with all methods documented above. |

---

## License

MIT
