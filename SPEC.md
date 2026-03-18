# sliding-context -- Specification

## 1. Overview

`sliding-context` is a provider-agnostic sliding window context manager for LLM conversations. It maintains a conversation history where recent messages are kept verbatim and older messages are automatically summarized using any LLM, ensuring the total context stays within a configurable token budget. The package accepts messages, manages a token budget divided into zones (system prompt, summary, recent messages), triggers summarization when older messages are evicted from the recent zone, and returns a context-managed message array ready to be sent to any LLM API. It performs no network I/O of its own -- the caller provides a summarizer function that calls whatever LLM they use, and `sliding-context` orchestrates when and what to summarize.

The gap this package fills is specific and well-validated. LangChain's `ConversationSummaryBufferMemory` is the canonical implementation of the "sliding window + summarize old messages" pattern. It maintains a token-limited buffer of recent messages verbatim while compiling older messages into a rolling summary using an LLM. The Python version is mature and widely used. The JavaScript/TypeScript version in LangChain is incomplete -- `ConversationSummaryBufferMemory` was not initially available in the JS library, and when it was added, it remained tightly coupled to LangChain's chain abstraction, memory interface, and LLM wrapper classes. A developer who wants this memory pattern without adopting the full LangChain framework has no standalone option.

Beyond LangChain, the landscape is fragmented. The Vercel AI SDK (v5) introduced a `prepareStep` parameter that allows context compression and filtering, but the implementation is left entirely to the developer -- the SDK provides the hook point, not the logic. Developers building chatbots, agents, and multi-turn applications in JavaScript currently hand-roll context management: manually counting tokens, slicing message arrays, calling summarization endpoints, and stitching summaries back into the conversation. This code is duplicated across projects, is error-prone (off-by-one token counts, lost system prompts, orphaned tool call pairs), and is never tested rigorously.

`sliding-context` provides the context management logic as a standalone, focused package. It accepts any `(messages: Message[], existingSummary?: string) => Promise<string>` function as the summarizer -- the caller wraps their LLM call in this function, and `sliding-context` decides when to invoke it, what messages to summarize, and how to integrate the summary into the conversation. The package does not import any LLM provider SDK. It does not make HTTP requests. It does not manage API keys. It operates entirely on the message-level abstraction: messages in, context-managed messages out.

The package composes with other packages in this monorepo. `context-budget` handles token budget allocation across multiple context sections (system prompt, tools, memory, conversation) -- `sliding-context` manages the conversation section specifically. `convo-compress` implements the "anchored summary + incremental merge" compression pattern -- `sliding-context` can use `convo-compress` as its summarization strategy, or use any other summarizer. `memory-dedup` handles semantic deduplication of memory entries -- complementary to summarization, which compresses, while dedup removes redundancy. `stream-tokens` aggregates streaming tokens into semantic units -- a different concern (streaming output) from context management (input preparation).

---

## 2. Goals and Non-Goals

### Goals

- Provide a `createContext(options)` function that returns a `SlidingContext` instance managing a conversation's context window with automatic summarization of older messages.
- Divide the context window into three zones -- system prompt (fixed), summary (grows as conversation lengthens), and recent messages (verbatim) -- with configurable token budgets for each.
- Automatically trigger summarization when messages are evicted from the recent zone, using a caller-provided summarizer function that can call any LLM.
- Support three summarization strategies: `incremental` (summarize only newly evicted messages and merge with existing summary), `rolling` (re-summarize existing summary together with newly evicted messages), and `anchored` (maintain a permanent summary prefix that is never re-summarized, plus a rolling section for newer content).
- Provide pluggable token counting: a built-in approximate counter (characters / 4) for zero-dependency use, and a pluggable interface for exact counters (tiktoken, gpt-tokenizer, or any custom function).
- Preserve system messages: never summarize or evict system-role messages. The system prompt is always the first element in the returned message array.
- Handle tool call message pairs: when a message contains a tool call, the corresponding tool result message must be kept together with it. Tool call pairs are never split across the summary boundary.
- Provide `serialize()` and `deserialize()` for persistence, enabling conversation state to be saved to any storage backend and restored across sessions.
- Provide event hooks (`onSummarize`, `onEvict`, `onBudgetExceeded`) for observability, logging, and custom logic.
- Be provider-agnostic. Accept any summarizer function. No dependency on any LLM provider SDK.
- Keep runtime dependencies at zero. All context management logic uses built-in JavaScript APIs.

### Non-Goals

- **Not an LLM API client.** This package does not make HTTP requests, manage API keys, handle streaming, or parse provider-specific response envelopes. The caller provides a summarizer function that calls the LLM and returns the summary text. Use the OpenAI SDK, Anthropic SDK, Google AI SDK, or `fetch` to make the actual summarization call.
- **Not a token counting library.** This package includes a rough approximate counter (characters / 4) as a convenience. For accurate token counting, the caller provides a `tokenCounter` function that uses `tiktoken`, `gpt-tokenizer`, or another tokenizer. The package does not bundle any tokenizer.
- **Not a RAG context packer.** This package manages conversational context (multi-turn message history). It does not handle retrieval-augmented generation chunk selection, diversity optimization, or positional bias mitigation. Use `context-packer` for RAG chunk packing and `rag-prompt-builder` for assembling RAG prompts.
- **Not a compression algorithm.** This package does not implement the summarization logic itself. It orchestrates when summarization happens and how the summary integrates into the conversation. The actual summarization is performed by the caller's summarizer function, which can use any technique (LLM-based, extractive, abstractive, or a dedicated package like `convo-compress`).
- **Not a vector memory store.** This package manages linear conversation history with summarization. It does not provide semantic search over past conversations, embedding storage, or retrieval. Use `embed-cache` or `llm-semantic-cache` for embedding-based memory.
- **Not a conversation router or branching tool.** This package manages a single linear conversation thread. For conversation branching, tree-structured dialogues, or multi-path conversations, use `convo-tree`.
- **Not a cost optimizer.** While the package reduces token usage by summarizing older messages (which indirectly reduces cost), it does not track spending, enforce cost budgets, or report cost metrics. Use `ai-cost-compare` or `tool-cost-estimator` for cost analysis.

---

## 3. Target Users and Use Cases

### Chatbot Developers with Token-Limited Models

Developers building conversational chatbots that use models with smaller context windows (4K-32K tokens). A customer support bot running on GPT-4o-mini (128K context) or a local model behind Ollama (4K-8K context) needs aggressive context management to keep long conversations functional. Without summarization, the bot either loses all history when the window fills or crashes with a "context length exceeded" error. `sliding-context` keeps the last N messages verbatim for conversational coherence and summarizes everything older to preserve key facts, decisions, and user preferences. A typical integration is: `const ctx = createContext({ tokenBudget: 4096, summarizer: callOllama, systemPrompt: 'You are a helpful assistant.' })`.

### Agent Framework Authors

Teams building autonomous agent systems where the agent runs for many turns -- planning, executing tool calls, observing results, replanning. An agent that runs for 50+ turns accumulates a massive conversation history, most of which is obsolete debugging information, intermediate reasoning, and tool call noise. The relevant context is the current plan, key observations, and decisions made. `sliding-context` summarizes the older turns to retain decisions and observations while shedding the verbose intermediate steps. The tool call pair handling is critical here: the agent's tool calls and their results must never be split by the summary boundary, because an orphaned tool call without its result confuses the LLM on the next turn.

### Customer Support Applications

Long-running customer support conversations that span many exchanges over minutes or hours. The customer describes a problem, the agent asks clarifying questions, suggests solutions, the customer reports results, and the cycle repeats. By message 30, the initial problem description has been pushed far up in the context and may be lost due to the "lost in the middle" effect, even in models with large context windows. Summarizing older exchanges preserves the problem description, attempted solutions, and their outcomes in a compact summary at the top of the context, while recent exchanges remain verbatim for the agent to respond coherently.

### Cost-Conscious Production Applications

Applications running on large-context models (GPT-4, Claude, Gemini) where context window size is not the constraint -- cost is. Even with 128K-200K context windows, input token pricing means that a 50-turn conversation costs significantly more per API call as the context grows. At GPT-4o's input pricing, a 50K-token context costs roughly 10x more per call than a 5K-token context. `sliding-context` reduces the context size by compressing older messages into a summary, cutting input token costs for every subsequent API call in the conversation. The cost savings compound over the life of a long conversation.

### Applications with Persistence Requirements

Applications that save and restore conversation state across sessions -- a user closes a chat and returns the next day, a server restarts and resumes in-progress agent loops, a mobile app suspends and resumes. `sliding-context` provides `serialize()` and `deserialize()` to export the full context state (messages, summary, token counts, configuration) as JSON, which can be stored in any key-value store (Redis, DynamoDB, localStorage, filesystem). On restore, the conversation continues exactly where it left off, with the summary and recent messages intact.

### Multi-Model Applications

Applications that switch between models during a conversation -- starting with a cheap model for simple queries and escalating to a stronger model for complex ones. When switching from a 128K-context model to a 4K-context model, the conversation history must be compressed to fit. `sliding-context` can be reconfigured with a new token budget on the fly, triggering immediate summarization to fit the smaller window. The `getMessages()` method always returns a message array that fits within the configured budget.

---

## 4. Core Concepts

### Context Window

The context window is the maximum number of tokens an LLM can process in a single API call. This includes the system prompt, the conversation history, and the space reserved for the model's response. Different models have different context window sizes: GPT-4o has 128K tokens, Claude Sonnet 4 has 200K tokens (1M in extended mode), Gemini 2.5 Pro has 1M tokens, and many local models have 4K-8K tokens. `sliding-context` manages the conversation history portion of this window, ensuring it stays within a caller-configured token budget.

### Token Budget

The token budget is the maximum number of tokens that the conversation (system prompt + summary + recent messages) may consume. This is typically the model's context window minus the output token reservation (tokens reserved for the model's response). For a model with a 4096-token context window and a 1024-token output reservation, the token budget is 3072. The caller sets this via the `tokenBudget` option. `sliding-context` ensures that `getMessages()` always returns a message array whose total token count is at or below this budget.

### Zones

The context window managed by `sliding-context` is divided into three zones, ordered from top to bottom in the message array:

1. **System Zone**: The system prompt. Always the first message. Never summarized, never evicted. Its token cost is fixed and subtracted from the budget before allocating the remaining zones. If no system prompt is provided, this zone is empty.

2. **Summary Zone**: A single system or user message containing the rolling summary of older conversation content. Starts empty and grows as messages are evicted from the recent zone and summarized. Has a configurable maximum token allocation (`maxSummaryTokens`). When the summary approaches this maximum, it is itself re-summarized (compressed) to stay within bounds.

3. **Recent Zone**: The most recent messages in the conversation, kept verbatim. This is the remainder of the budget after the system zone and summary zone are allocated. Messages enter at the bottom (most recent) and are evicted from the top (oldest) when the zone's token allocation is exceeded.

### Summarizer

The summarizer is a caller-provided async function that takes a set of messages (and optionally an existing summary) and returns a text summary. This function is the only point where an LLM is called, and the caller controls exactly how the call is made -- which model, which provider, what temperature, what prompt. `sliding-context` invokes the summarizer when messages are evicted from the recent zone and need to be compressed into the summary zone.

### Eviction

Eviction is the process of removing the oldest messages from the recent zone when the zone's token allocation is exceeded. Evicted messages are not discarded -- they are collected in a pending summarization buffer. When the buffer exceeds a configurable threshold (by token count or message count), the summarizer is invoked to compress the buffer into the summary. Between eviction and summarization, the evicted messages are temporarily held and included in the context to prevent information loss.

### Summarization Trigger

Summarization does not happen on every message addition. It is triggered when the pending eviction buffer exceeds a configurable threshold. This batching is intentional: calling the summarizer (which calls an LLM) is expensive, so batching multiple evicted messages into a single summarization call amortizes the cost. The trigger threshold is configurable by token count (`summarizeThresholdTokens`) or message count (`summarizeThresholdMessages`), whichever is reached first.

### Tool Call Pairs

In conversations with tool use, messages come in pairs: an assistant message containing a tool call (function name and arguments) and a subsequent tool-role message containing the tool's result. These pairs must never be split -- an assistant message with a tool call but no corresponding result is malformed and will confuse the LLM. `sliding-context` treats tool call pairs as atomic units during eviction: if the assistant message with the tool call is evicted, the corresponding tool result message is evicted with it.

---

## 5. Architecture

### Context Management Pipeline

```
                              ┌──────────────────────────────┐
                              │     addMessage(message)      │
                              │  User adds a new message     │
                              │  (user, assistant, tool)     │
                              └──────────────┬───────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │  Append to message store      │
                              │  Count tokens for new message │
                              │  Update total token count     │
                              └──────────────┬───────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │  Check: total tokens >        │
                              │  tokenBudget?                 │
                              └──────────┬──────────┬────────┘
                                         │          │
                                    no   ▼          ▼ yes
                              ┌──────────────┐  ┌───────────────────────┐
                              │  No action.  │  │  Evict oldest messages │
                              │  Return.     │  │  from recent zone     │
                              └──────────────┘  │  into pending buffer  │
                                                │  (preserving tool     │
                                                │  call pair atomicity) │
                                                └───────────┬───────────┘
                                                            │
                                                            ▼
                                                ┌───────────────────────┐
                                                │  Check: pending buffer │
                                                │  exceeds threshold?    │
                                                └─────┬──────────┬──────┘
                                                      │          │
                                                 no   ▼          ▼ yes
                                  ┌───────────────────┐  ┌──────────────────────┐
                                  │  Hold evicted msgs │  │  Invoke summarizer    │
                                  │  in pending buffer │  │  with pending buffer  │
                                  │  until threshold   │  │  and existing summary │
                                  └───────────────────┘  └──────────┬───────────┘
                                                                    │
                                                                    ▼
                                                         ┌──────────────────────┐
                                                         │  Merge result into    │
                                                         │  summary zone         │
                                                         │  Clear pending buffer │
                                                         │  Update token counts  │
                                                         └──────────────────────┘
```

### getMessages() Output Structure

When the caller invokes `getMessages()`, the returned message array has this structure:

```
┌─────────────────────────────────────────────────────────────────┐
│  [0] System message (system prompt)                             │
│      "You are a helpful customer support agent..."              │
│      Tokens: fixed, never changes                               │
├─────────────────────────────────────────────────────────────────┤
│  [1] Summary message (role: 'system' or 'user', configurable)  │
│      "Summary of earlier conversation: The user asked about     │
│       their order #12345. The agent confirmed the order was     │
│       shipped on March 15. The user reported it hadn't arrived. │
│       The agent initiated a tracking investigation..."          │
│      Tokens: grows over time, capped at maxSummaryTokens        │
├─────────────────────────────────────────────────────────────────┤
│  [2] Recent messages (verbatim, newest at bottom)               │
│      { role: 'user', content: 'Any update on my package?' }    │
│      { role: 'assistant', content: 'Let me check...',           │
│        tool_calls: [{ id: 'tc_1', ... }] }                     │
│      { role: 'tool', tool_call_id: 'tc_1', content: '...' }   │
│      { role: 'assistant', content: 'Your package is...' }       │
│      { role: 'user', content: 'Great, thanks!' }               │
│      Tokens: fills remaining budget after system + summary      │
└─────────────────────────────────────────────────────────────────┘
```

If no summary exists yet (early in the conversation), the summary message is omitted. If no system prompt was provided, the system message is omitted. The returned array is always a valid message array that can be sent directly to any LLM API.

### Token Budget Allocation

The budget is allocated top-down:

```
totalBudget (e.g., 4096 tokens)
  - systemPromptTokens (e.g., 200 tokens)  → fixed, non-negotiable
  = remainingBudget (3896 tokens)
  - summaryTokens (e.g., up to 800 tokens) → grows as conversation lengthens
  = recentBudget (3096+ tokens)             → fills the rest
```

The `maxSummaryTokens` option caps how large the summary zone can grow. If the summary exceeds this cap, the summary itself is re-summarized (compressed) using the same summarizer function. This prevents the summary from consuming the entire budget in very long conversations.

The `minRecentTokens` option guarantees a minimum allocation for the recent zone. If the summary grows to the point where the recent zone would fall below this minimum, the summary is compressed before any more recent messages are evicted. This ensures there is always room for at least a few recent messages.

---

## 6. Summarization Strategy

### Incremental Strategy

The `incremental` strategy summarizes only the newly evicted messages and merges the result with the existing summary. The summarizer receives the newly evicted messages and the current summary, and returns a new combined summary.

```
Existing summary: "User asked about order #12345. Agent confirmed it shipped March 15."
Newly evicted messages: [user: "It hasn't arrived yet", assistant: "Let me check tracking..."]
Summarizer input: messages + existing summary
Summarizer output: "User asked about order #12345. Agent confirmed it shipped March 15.
                     User reported non-arrival. Agent initiated tracking check."
```

**Advantages**: Cheapest option. The summarizer only processes the new messages plus the existing summary, not the full conversation history. Each summarization call is small and fast.

**Disadvantages**: Summary quality can degrade over many rounds. Each summarization merges new content with an already-compressed summary, and information can be lost or distorted through repeated compression. After 20+ rounds of incremental summarization, the summary may drift from the original conversation content.

### Rolling Strategy

The `rolling` strategy re-summarizes the existing summary together with the newly evicted messages as a single combined text. The summarizer receives the existing summary and the new messages concatenated together, and produces a fresh summary from scratch.

```
Existing summary: "User asked about order #12345. Agent confirmed it shipped March 15."
Newly evicted messages: [user: "It hasn't arrived yet", assistant: "Let me check tracking..."]
Summarizer input: existing summary text + new messages text (combined as input)
Summarizer output: Fresh summary of the combined content
```

**Advantages**: Higher quality summaries. Each summarization pass produces a coherent summary from the full accumulated content, reducing drift and information distortion.

**Disadvantages**: More expensive. The summarizer processes the existing summary (which grows over time) plus the new messages on every call. As the conversation lengthens, each summarization call gets larger.

### Anchored Strategy

The `anchored` strategy maintains a permanent summary prefix that is never re-summarized, plus a rolling section for newer content. The permanent prefix captures foundational context that must be preserved throughout the entire conversation (the user's identity, the core problem, key constraints). The rolling section captures more recent context that can be re-summarized as it ages further.

```
Permanent anchor: "Customer: Alice Johnson, Order #12345, Premium member since 2020.
                    Problem: Package shipped March 15 has not arrived."
Rolling section: "Agent checked tracking: shows delivered to mailroom. Customer says
                  mailroom has no record. Agent escalated to shipping team."
Newly evicted: [user: "Any update from shipping?", assistant: "Still investigating..."]
```

The anchor is set once -- either explicitly by the caller via `setAnchor(text)`, or automatically from the first summarization's output (the caller can configure `autoAnchor: true` to extract the anchor from the first summary). The rolling section is re-summarized using the `rolling` strategy. The final summary is the concatenation of the anchor and the rolling section.

**Advantages**: Critical context is never lost, regardless of how long the conversation runs. The anchor survives unlimited rounds of summarization.

**Disadvantages**: The anchor consumes a fixed portion of the summary budget. If the anchor is too large, it crowds out the rolling section. Requires the caller to identify what belongs in the anchor.

### Default Summarization Prompt

When the caller does not provide a summarizer function, `sliding-context` cannot summarize (it has no LLM access). In this case, it operates in truncation mode: evicted messages are simply dropped, and no summary is maintained. This is equivalent to a pure sliding window without summarization.

When the caller provides a summarizer, `sliding-context` passes the messages and existing summary to the function. The package also exports a `defaultSummarizationPrompt` constant that callers can use as a starting point for their summarizer's system prompt:

```
Summarize the following conversation messages concisely. Preserve:
- Key facts, decisions, and agreements
- Named entities (people, products, order numbers, dates)
- User preferences and constraints
- Action items and their status
- Any unresolved questions or pending issues

Omit:
- Pleasantries and acknowledgments ("thanks", "sure", "got it")
- Repeated information already captured in the existing summary
- Debugging back-and-forth and intermediate reasoning steps
- Verbose tool call arguments and raw tool output (summarize the result, not the raw data)

If an existing summary is provided, merge the new information into it without losing previously captured facts.
Return only the summary text, no preamble or formatting.
```

This prompt is a suggestion, not a requirement. The caller's summarizer function controls the actual prompt sent to the LLM.

### Summarization Quality Considerations

Summary quality degrades over many rounds of re-summarization. Research on recursive summarization with LLMs documents this effect: each compression pass can lose nuance, shift emphasis, or silently drop facts that seemed unimportant in isolation but matter in aggregate. This is a fundamental tradeoff -- summarization trades fidelity for space.

Mitigations built into `sliding-context`:

1. **Batched eviction**: Summarizing 5-10 messages at once produces better summaries than summarizing one message at a time, because the summarizer has more context to identify what matters.
2. **Anchored strategy**: Permanent anchors prevent the most critical facts from being lost through repeated summarization.
3. **Summary re-summarization cap**: The `maxSummaryRounds` option limits how many times the summary itself is re-summarized. When the cap is reached, the oldest portion of the rolling summary is dropped rather than re-summarized again, preventing quality degradation from infinite re-summarization depth.
4. **Caller control**: The caller's summarizer function has full control over the summarization quality. A caller who needs high-fidelity summaries can use a stronger model, a more detailed prompt, or a multi-step summarization pipeline.

---

## 7. Token Budget Management

### Budget Allocation Formula

```
systemTokens    = tokenCounter(systemPrompt)                  // fixed
summaryTokens   = tokenCounter(currentSummary)                // grows, capped at maxSummaryTokens
recentTokens    = sum(tokenCounter(msg) for msg in recentMessages)
pendingTokens   = sum(tokenCounter(msg) for msg in pendingBuffer)

totalUsed       = systemTokens + summaryTokens + recentTokens + pendingTokens
available       = tokenBudget - totalUsed
```

When `totalUsed > tokenBudget`, eviction begins. Messages are evicted from the oldest end of the recent zone until `totalUsed <= tokenBudget`.

### Budget Rebalancing

When the summary grows too large (approaching `maxSummaryTokens`), the budget must be rebalanced:

1. **Summary compression**: If `summaryTokens > maxSummaryTokens`, the summary is re-summarized using the same summarizer function, with a target of `maxSummaryTokens * 0.75` to leave headroom for growth.
2. **Forced eviction**: If even after summary compression the total exceeds the budget, more recent messages are evicted and summarized.
3. **Emergency truncation**: If the summarizer fails or is unavailable, the oldest messages in the pending buffer are dropped without summarization. This is a last resort to prevent context overflow. The `onEvict` hook fires with a `reason: 'truncation'` flag so the caller knows information was lost.

### Token Counting

`sliding-context` needs to know the token count of each message to manage the budget. Three counting approaches are supported:

**Approximate (default)**: `Math.ceil(text.length / 4)`. This is the zero-dependency default. It is accurate to within ~20% for English text with typical tokenizers (GPT cl100k_base, Claude's tokenizer). It consistently overestimates, which is safe -- the context will fit within the budget, but some budget will be wasted. For cost-insensitive applications or prototyping, this is adequate.

**Exact (pluggable)**: The caller provides a `tokenCounter` function:

```typescript
tokenCounter: (text: string) => number
```

This function receives the full text content of a message (role prefix + content) and returns the exact token count. The caller implements this using whatever tokenizer matches their model:

- `tiktoken` / `js-tiktoken` for OpenAI models (cl100k_base for GPT-4, o200k_base for GPT-4o)
- `gpt-tokenizer` for OpenAI models (faster, pure JS, no WASM)
- Anthropic's tokenizer for Claude models
- Custom tokenizers for local models

**Per-message overhead**: LLM APIs add overhead tokens per message for role prefixes and formatting. For OpenAI's chat completion API, each message adds approximately 4 tokens of overhead (role name, delimiters). For Anthropic, the overhead differs. The `messageOverhead` option (default: 4) lets the caller specify this overhead, which is added to each message's content token count.

### Why Token Budgeting Matters

Token budgeting matters for two distinct reasons, depending on the model:

**For small-context models** (4K-32K tokens): The context window is a hard limit. Exceeding it causes an API error. Token budgeting prevents this error by ensuring the conversation fits within the window.

**For large-context models** (128K-1M+ tokens): The context window is rarely the constraint, but cost and latency are. Input tokens are priced per token -- at GPT-4o's pricing, a 100K-token context costs approximately $0.25 per API call. Over a 50-message conversation where each API call includes the full history, the cumulative cost is significant. Token budgeting via summarization reduces the context size, cutting cost per call. Additionally, larger contexts increase latency (more tokens to process) and can degrade response quality due to the "lost in the middle" attention phenomenon documented in research from Stanford and UC Berkeley.

---

## 8. API Surface

### Installation

```bash
npm install sliding-context
```

### Primary Function: `createContext`

```typescript
import { createContext } from 'sliding-context';

const ctx = createContext({
  tokenBudget: 4096,
  systemPrompt: 'You are a helpful assistant.',
  summarizer: async (messages, existingSummary) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: defaultSummarizationPrompt },
        {
          role: 'user',
          content: existingSummary
            ? `Existing summary:\n${existingSummary}\n\nNew messages to incorporate:\n${formatMessages(messages)}`
            : `Summarize these messages:\n${formatMessages(messages)}`,
        },
      ],
    });
    return response.choices[0].message.content ?? '';
  },
});

// Add messages as the conversation progresses
ctx.addMessage({ role: 'user', content: 'Hello, I need help with my order.' });
ctx.addMessage({ role: 'assistant', content: 'Of course! What is your order number?' });
ctx.addMessage({ role: 'user', content: 'Order #12345.' });

// Get context-managed messages ready for the next API call
const messages = await ctx.getMessages();
// → [{ role: 'system', content: 'You are a helpful...' },
//    { role: 'user', content: 'Hello, I need help...' },
//    { role: 'assistant', content: 'Of course! What...' },
//    { role: 'user', content: 'Order #12345.' }]

// After many more messages, older ones are summarized automatically
// → [{ role: 'system', content: 'You are a helpful...' },
//    { role: 'system', content: 'Summary: User asked about order #12345...' },
//    { role: 'user', content: 'Any update?' },
//    { role: 'assistant', content: 'Let me check...' }]
```

### Type Definitions

```typescript
// ── Message Types ───────────────────────────────────────────────────

/** A message in the LLM conversation. */
interface Message {
  /** The role of the message sender. */
  role: 'system' | 'user' | 'assistant' | 'tool';

  /** The text content of the message. */
  content: string;

  /**
   * Tool calls made by the assistant.
   * Present when role is 'assistant' and the model invoked tools.
   */
  tool_calls?: ToolCall[];

  /**
   * The ID of the tool call this message is responding to.
   * Present when role is 'tool'.
   */
  tool_call_id?: string;

  /**
   * Optional name for the message sender.
   * Used by some providers for multi-participant conversations.
   */
  name?: string;
}

/** A tool call made by the assistant. */
interface ToolCall {
  /** Unique identifier for this tool call. */
  id: string;

  /** The type of tool call. Currently always 'function'. */
  type: 'function';

  /** The function call details. */
  function: {
    /** The name of the function to call. */
    name: string;

    /** The arguments to pass to the function, as a JSON string. */
    arguments: string;
  };
}

// ── Token Counter ───────────────────────────────────────────────────

/**
 * Function that counts the number of tokens in a text string.
 * The caller implements this using their preferred tokenizer.
 */
type TokenCounter = (text: string) => number;

// ── Summarizer ──────────────────────────────────────────────────────

/**
 * Function that summarizes a set of messages, optionally incorporating
 * an existing summary. The caller wraps their LLM call in this function.
 *
 * @param messages - The messages to summarize (evicted from the recent zone).
 * @param existingSummary - The current summary text, if any. The summarizer
 *   should merge new information into this existing summary.
 * @returns The summary text.
 */
type Summarizer = (
  messages: Message[],
  existingSummary?: string,
) => Promise<string>;

// ── Summarization Strategy ──────────────────────────────────────────

/**
 * The strategy used for summarizing evicted messages.
 *
 * - 'incremental': Summarize only new messages, merge with existing summary.
 * - 'rolling': Re-summarize existing summary + new messages together.
 * - 'anchored': Permanent prefix + rolling summary of newer content.
 */
type SummarizationStrategy = 'incremental' | 'rolling' | 'anchored';

// ── Summary Role ────────────────────────────────────────────────────

/**
 * The role to use for the summary message in the output.
 *
 * - 'system': Summary appears as a system message (recommended for most providers).
 * - 'user': Summary appears as a user message (for providers that restrict system messages).
 */
type SummaryRole = 'system' | 'user';

// ── Event Hooks ─────────────────────────────────────────────────────

/** Event hooks for observability and custom logic. */
interface EventHooks {
  /**
   * Called when messages are evicted from the recent zone.
   * @param messages - The evicted messages.
   * @param reason - Why the messages were evicted: 'budget' (normal eviction)
   *   or 'truncation' (emergency drop without summarization).
   */
  onEvict?: (messages: Message[], reason: 'budget' | 'truncation') => void;

  /**
   * Called when the summarizer is invoked.
   * @param inputMessages - Messages being summarized.
   * @param existingSummary - The current summary before this summarization.
   * @param newSummary - The summary produced by the summarizer.
   * @param durationMs - How long the summarization took.
   */
  onSummarize?: (
    inputMessages: Message[],
    existingSummary: string | null,
    newSummary: string,
    durationMs: number,
  ) => void;

  /**
   * Called when the total token count exceeds the budget before eviction.
   * @param totalTokens - Current total token count.
   * @param budget - The configured token budget.
   */
  onBudgetExceeded?: (totalTokens: number, budget: number) => void;

  /**
   * Called when the summary is re-summarized because it exceeded maxSummaryTokens.
   * @param oldSummary - The summary before compression.
   * @param newSummary - The compressed summary.
   */
  onSummaryCompressed?: (oldSummary: string, newSummary: string) => void;
}

// ── Options ─────────────────────────────────────────────────────────

/** Configuration options for createContext. */
interface SlidingContextOptions {
  /**
   * Maximum total tokens for the context (system prompt + summary + recent messages).
   * Required.
   */
  tokenBudget: number;

  /**
   * The system prompt. Always preserved as the first message.
   * Never summarized or evicted.
   */
  systemPrompt?: string;

  /**
   * The summarizer function. If not provided, the context operates in
   * truncation mode: evicted messages are dropped without summarization.
   */
  summarizer?: Summarizer;

  /**
   * The summarization strategy. Default: 'incremental'.
   */
  strategy?: SummarizationStrategy;

  /**
   * Maximum tokens allocated to the summary zone.
   * Default: Math.floor(tokenBudget * 0.3) — 30% of the total budget.
   */
  maxSummaryTokens?: number;

  /**
   * Minimum tokens guaranteed for the recent zone.
   * If the summary grows to crowd out the recent zone below this minimum,
   * the summary is compressed.
   * Default: Math.floor(tokenBudget * 0.3) — 30% of the total budget.
   */
  minRecentTokens?: number;

  /**
   * Token count threshold for triggering summarization of the pending buffer.
   * When evicted messages in the pending buffer exceed this count, the
   * summarizer is invoked.
   * Default: Math.floor(tokenBudget * 0.1) — 10% of the total budget.
   */
  summarizeThresholdTokens?: number;

  /**
   * Message count threshold for triggering summarization of the pending buffer.
   * When the pending buffer contains this many messages, the summarizer
   * is invoked regardless of token count.
   * Default: 6.
   */
  summarizeThresholdMessages?: number;

  /**
   * Token counter function. Default: approximate counter (Math.ceil(text.length / 4)).
   */
  tokenCounter?: TokenCounter;

  /**
   * Per-message token overhead (role prefix, delimiters).
   * Added to each message's content token count.
   * Default: 4.
   */
  messageOverhead?: number;

  /**
   * The role to use for the summary message in the output.
   * Default: 'system'.
   */
  summaryRole?: SummaryRole;

  /**
   * Maximum number of times the summary itself can be re-summarized
   * (compressed) before the oldest portion is dropped instead.
   * Prevents quality degradation from infinite re-summarization.
   * Default: 5.
   */
  maxSummaryRounds?: number;

  /**
   * For the 'anchored' strategy: initial anchor text that is never re-summarized.
   * If not provided with the 'anchored' strategy, the anchor is extracted
   * from the first summarization output.
   */
  anchor?: string;

  /**
   * For the 'anchored' strategy: maximum tokens for the anchor section.
   * Default: Math.floor(maxSummaryTokens * 0.4).
   */
  maxAnchorTokens?: number;

  /** Event hooks. */
  hooks?: EventHooks;
}

// ── Context State (for serialization) ───────────────────────────────

/** Serializable representation of the context state. */
interface ContextState {
  /** The configuration options (excluding functions). */
  options: {
    tokenBudget: number;
    systemPrompt?: string;
    strategy: SummarizationStrategy;
    maxSummaryTokens: number;
    minRecentTokens: number;
    summarizeThresholdTokens: number;
    summarizeThresholdMessages: number;
    messageOverhead: number;
    summaryRole: SummaryRole;
    maxSummaryRounds: number;
    anchor?: string;
    maxAnchorTokens?: number;
  };

  /** All messages in the conversation (full history). */
  messages: Message[];

  /** The current summary text. Null if no summarization has occurred. */
  summary: string | null;

  /** The anchor text for the 'anchored' strategy. */
  anchor: string | null;

  /** Messages in the pending summarization buffer. */
  pendingBuffer: Message[];

  /** Number of times the summary has been re-summarized (compressed). */
  summaryRounds: number;

  /** Token counts for each zone. */
  tokenCounts: {
    system: number;
    summary: number;
    recent: number;
    pending: number;
    total: number;
  };

  /** Serialization format version for forward compatibility. */
  version: 1;
}

// ── SlidingContext Instance ─────────────────────────────────────────

/** A sliding window context manager instance. */
interface SlidingContext {
  /**
   * Add a message to the conversation.
   * The message is appended to the end of the message history.
   * If the total token count exceeds the budget, older messages
   * are evicted and queued for summarization.
   */
  addMessage(message: Message): void;

  /**
   * Get the context-managed message array ready for an LLM API call.
   * This triggers any pending summarization if needed.
   * Returns: [system prompt?, summary?, ...recent messages]
   *
   * This method is async because it may invoke the summarizer.
   */
  getMessages(): Promise<Message[]>;

  /**
   * Get the current summary text, or null if no summarization has occurred.
   */
  getSummary(): string | null;

  /**
   * Get the current total token count across all zones.
   */
  getTokenCount(): number;

  /**
   * Get token counts broken down by zone.
   */
  getTokenBreakdown(): {
    system: number;
    summary: number;
    recent: number;
    pending: number;
    total: number;
  };

  /**
   * Get the number of messages in the recent zone.
   */
  getRecentMessageCount(): number;

  /**
   * Get the total number of messages added to the conversation
   * (including evicted and summarized ones).
   */
  getTotalMessageCount(): number;

  /**
   * Set the anchor text for the 'anchored' strategy.
   * This replaces any existing anchor.
   */
  setAnchor(text: string): void;

  /**
   * Update the token budget. Triggers eviction and summarization
   * if the new budget is smaller than the current total.
   */
  setTokenBudget(budget: number): Promise<void>;

  /**
   * Clear all messages, summary, and pending buffer.
   * The system prompt and configuration are preserved.
   */
  clear(): void;

  /**
   * Serialize the context state to a JSON-compatible object.
   * The serialized state includes messages, summary, pending buffer,
   * token counts, and configuration. Functions (summarizer, tokenCounter,
   * hooks) are not serialized.
   */
  serialize(): ContextState;

  /**
   * Restore context state from a serialized object.
   * The caller must provide the summarizer, tokenCounter, and hooks
   * separately (they cannot be serialized).
   *
   * @param state - The serialized context state.
   * @param functions - The non-serializable functions to attach.
   */
  // This is a static method on the module, not an instance method.
  // See deserialize below.
}

// ── Module Exports ──────────────────────────────────────────────────

/**
 * Create a new sliding context manager.
 */
function createContext(options: SlidingContextOptions): SlidingContext;

/**
 * Restore a context manager from serialized state.
 *
 * @param state - The serialized context state from SlidingContext.serialize().
 * @param functions - Functions that cannot be serialized: summarizer, tokenCounter, hooks.
 */
function deserialize(
  state: ContextState,
  functions?: {
    summarizer?: Summarizer;
    tokenCounter?: TokenCounter;
    hooks?: EventHooks;
  },
): SlidingContext;

/**
 * Default summarization prompt for use in caller-provided summarizer functions.
 */
const defaultSummarizationPrompt: string;
```

### Function Signatures

```typescript
/**
 * Create a new sliding window context manager.
 *
 * @param options - Configuration options including token budget, system prompt,
 *   summarizer function, and strategy.
 * @returns A SlidingContext instance for managing conversation context.
 * @throws TypeError if tokenBudget is not a positive integer.
 * @throws RangeError if maxSummaryTokens + minRecentTokens > tokenBudget.
 */
function createContext(options: SlidingContextOptions): SlidingContext;

/**
 * Restore a context manager from a serialized state.
 *
 * @param state - The serialized context state.
 * @param functions - Non-serializable functions (summarizer, tokenCounter, hooks).
 * @returns A SlidingContext instance with the restored state.
 * @throws TypeError if state.version is not supported.
 */
function deserialize(
  state: ContextState,
  functions?: {
    summarizer?: Summarizer;
    tokenCounter?: TokenCounter;
    hooks?: EventHooks;
  },
): SlidingContext;
```

---

## 9. Summarizer Interface

### Contract

The summarizer is a function with this signature:

```typescript
type Summarizer = (
  messages: Message[],
  existingSummary?: string,
) => Promise<string>;
```

`sliding-context` invokes this function when evicted messages need to be compressed. The function receives the messages to summarize and the current summary (if any), and must return the new summary text. The function is fully controlled by the caller -- it can call any LLM, use any prompt, implement any summarization logic.

### How Each Strategy Uses the Summarizer

**Incremental**: The summarizer receives only the newly evicted messages and the existing summary. It should merge the new information into the existing summary.

```typescript
// sliding-context calls:
const newSummary = await summarizer(evictedMessages, existingSummary);
```

**Rolling**: The summarizer receives the newly evicted messages. The existing summary is prepended to the message list as a synthetic user message so the summarizer re-summarizes everything together.

```typescript
// sliding-context calls:
const combinedMessages = existingSummary
  ? [{ role: 'user', content: `Previous summary: ${existingSummary}` }, ...evictedMessages]
  : evictedMessages;
const newSummary = await summarizer(combinedMessages);
```

**Anchored**: Same as rolling, but the anchor portion is excluded from re-summarization. The summarizer only processes the rolling section plus new messages.

```typescript
// sliding-context calls:
const newRolling = await summarizer(evictedMessages, existingRollingSection);
// Final summary = anchor + newRolling
```

### Provider-Specific Adapter Patterns

**OpenAI:**

```typescript
import OpenAI from 'openai';
import { createContext, defaultSummarizationPrompt } from 'sliding-context';

const openai = new OpenAI();

const ctx = createContext({
  tokenBudget: 4096,
  systemPrompt: 'You are a helpful assistant.',
  summarizer: async (messages, existingSummary) => {
    const prompt = existingSummary
      ? `Existing summary:\n${existingSummary}\n\nNew messages:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`
      : `Messages:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: defaultSummarizationPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.0,
      max_tokens: 500,
    });
    return response.choices[0].message.content ?? '';
  },
});
```

**Anthropic:**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { createContext, defaultSummarizationPrompt } from 'sliding-context';

const anthropic = new Anthropic();

const ctx = createContext({
  tokenBudget: 8192,
  systemPrompt: 'You are a customer support agent.',
  summarizer: async (messages, existingSummary) => {
    const prompt = existingSummary
      ? `Existing summary:\n${existingSummary}\n\nNew messages:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`
      : `Messages:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-3-5-20241022',
      max_tokens: 500,
      system: defaultSummarizationPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text ?? '';
  },
});
```

**Mock Summarizer for Testing:**

```typescript
import { createContext } from 'sliding-context';

const ctx = createContext({
  tokenBudget: 200,
  summarizer: async (messages, existingSummary) => {
    const newContent = messages.map(m => m.content.substring(0, 20)).join('; ');
    return existingSummary
      ? `${existingSummary} | ${newContent}`
      : `Summary: ${newContent}`;
  },
});
```

### Summarizer Failure Handling

If the summarizer throws an error or returns an empty string:

1. The error is caught and not re-thrown (summarization failure should not crash the conversation).
2. The evicted messages remain in the pending buffer for the next summarization attempt.
3. If the pending buffer grows to exceed the budget even without summarization, emergency truncation drops the oldest pending messages.
4. The `onEvict` hook fires with `reason: 'truncation'` when messages are dropped.
5. If the caller needs to handle summarizer errors explicitly, they should catch errors within their summarizer function.

---

## 10. Token Counting

### Built-in Approximate Counter

The default token counter estimates tokens as `Math.ceil(text.length / 4)`. This approximation is based on the empirical observation that common BPE tokenizers (GPT's cl100k_base, o200k_base) produce roughly one token per 4 characters for English text. The ratio varies by language and content type:

| Content Type | Actual Chars/Token | Approximate Accuracy |
|---|---|---|
| English prose | ~4.0 | ~95% |
| Code (JavaScript/Python) | ~3.5 | ~85% (overestimates slightly) |
| JSON data | ~3.0 | ~75% (overestimates more) |
| CJK text (Chinese, Japanese, Korean) | ~1.5 | ~35% (severely underestimates) |
| URLs and technical strings | ~2.5 | ~60% (overestimates) |

The approximate counter consistently overestimates for English text and code, which is safe -- the context will fit within the budget, but some budget capacity is wasted. For CJK text, the approximate counter severely underestimates, which is unsafe -- the context may exceed the model's limit. Callers working with CJK text should provide an exact token counter.

### Pluggable Exact Counter

The caller provides a `tokenCounter` function for exact counting:

```typescript
// Using gpt-tokenizer (pure JS, fast, no WASM)
import { encode } from 'gpt-tokenizer';
import { createContext } from 'sliding-context';

const ctx = createContext({
  tokenBudget: 4096,
  tokenCounter: (text) => encode(text).length,
  // ...
});
```

```typescript
// Using js-tiktoken
import { encodingForModel } from 'js-tiktoken';
import { createContext } from 'sliding-context';

const enc = encodingForModel('gpt-4o');

const ctx = createContext({
  tokenBudget: 128000,
  tokenCounter: (text) => enc.encode(text).length,
  // ...
});
```

### Per-Message Token Counting

When counting tokens for a message, the total is:

```
messageTokens = tokenCounter(message.content) + messageOverhead
```

The `messageOverhead` (default: 4) accounts for the role prefix tokens and delimiter tokens that LLM APIs add per message. For OpenAI, each message adds approximately 4 tokens of overhead. For messages with `tool_calls`, additional overhead is added for the tool call structure:

```
toolCallOverhead = tokenCounter(JSON.stringify(message.tool_calls))
```

Tool call messages (role: 'tool') include the `tool_call_id` in their overhead.

### Token Count Caching

Token counts are computed once per message when the message is added via `addMessage()` and cached. They are not recomputed on `getMessages()`. The summary's token count is updated when the summary changes. This means `getTokenCount()` is O(1) -- it returns the cached total, not a recomputation.

---

## 11. Persistence

### serialize()

The `serialize()` method returns a `ContextState` object that captures the full state of the context manager:

```typescript
const state = ctx.serialize();
// state is a plain object, safe for JSON.stringify
const json = JSON.stringify(state);
```

The serialized state includes:
- All messages in the conversation (both recent and evicted-but-pending)
- The current summary text
- The anchor text (for anchored strategy)
- The pending summarization buffer
- The number of summary compression rounds
- Token counts for each zone
- Configuration values (budget, thresholds, strategy, etc.)

The serialized state does NOT include:
- The `summarizer` function (functions cannot be serialized)
- The `tokenCounter` function
- Event hooks

### deserialize()

The `deserialize()` function restores a `SlidingContext` from a serialized state:

```typescript
import { deserialize } from 'sliding-context';

const json = await redis.get('conversation:user123');
const state = JSON.parse(json);

const ctx = deserialize(state, {
  summarizer: mySummarizer,
  tokenCounter: myTokenCounter,
  hooks: myHooks,
});

// Continue the conversation
ctx.addMessage({ role: 'user', content: 'I am back!' });
const messages = await ctx.getMessages();
```

The caller must provide the non-serializable functions separately. If no summarizer is provided on deserialization, the context operates in truncation mode.

### Version Field

The `ContextState` includes a `version` field (currently `1`). Future versions of `sliding-context` may change the state schema. The `deserialize` function checks the version and applies migrations if needed. If the version is unrecognized, `deserialize` throws a `TypeError` with a clear message.

### Storage Agnosticism

`sliding-context` does not provide storage adapters. The serialized state is a plain JavaScript object that can be `JSON.stringify`'d and stored anywhere:

- **Redis**: `await redis.set('ctx:user123', JSON.stringify(ctx.serialize()))`
- **DynamoDB**: `await dynamodb.put({ Item: { pk: 'user123', state: ctx.serialize() } })`
- **localStorage**: `localStorage.setItem('ctx', JSON.stringify(ctx.serialize()))`
- **Filesystem**: `await fs.writeFile('ctx.json', JSON.stringify(ctx.serialize()))`

---

## 12. Message Types

### Text Messages (user, assistant, system)

Standard text messages with `role` and `content` fields. These are the primary message type and are handled straightforwardly:

- **user** messages: Added to the recent zone. Evicted and summarized normally.
- **assistant** messages: Added to the recent zone. Evicted and summarized normally. If the assistant message contains `tool_calls`, it is treated as part of a tool call pair (see below).
- **system** messages: The first system message is treated as the system prompt and is never evicted. Additional system messages added via `addMessage()` are treated as regular messages in the recent zone and can be evicted and summarized.

### Tool Call Messages

Tool calls create pairs of messages that must be kept together:

1. An **assistant** message with `tool_calls` (the model's request to call a tool)
2. One or more **tool** messages with `tool_call_id` (the results of the tool calls)

These pairs are atomic during eviction. If the assistant message is the oldest in the recent zone and needs to be evicted, all corresponding tool messages are evicted with it. Conversely, the tool messages cannot be evicted without their parent assistant message.

When summarizing tool call pairs, the summarizer receives both the assistant message (with tool call details) and the tool result messages. The summary should capture the outcome of the tool call, not the raw call details:

```
Tool call: search_orders({ customer_id: "cust_123" })
Tool result: { orders: [{ id: "12345", status: "shipped" }] }
Summary: "Searched orders for customer cust_123, found order #12345 with status shipped."
```

### Multi-Part Messages (text + images)

Some LLM APIs support multi-part messages where `content` is an array of parts (text, images, audio) rather than a single string. `sliding-context` handles this with the following policy:

- If `content` is a string, it is counted and handled normally.
- If `content` is an array, only the text parts are counted for token budgeting. Image and audio parts are assigned a configurable flat token cost (`imageTokenCost`, default: 85 -- matching a low-res image tile in OpenAI's pricing) per non-text part.
- Multi-part messages are evicted and summarized like any other message. The summarizer receives the full message object, and the caller's summarizer function decides how to handle non-text content (typically by describing it or dropping it from the summary).

### Messages Without Content

Some messages may have empty or missing `content` (e.g., assistant messages that only contain `tool_calls`). These are assigned a token count equal to `messageOverhead` plus the token count of the serialized `tool_calls` array.

---

## 13. Configuration

### Default Values

| Option | Default | Description |
|---|---|---|
| `tokenBudget` | (required) | Maximum total tokens for the context. |
| `systemPrompt` | `undefined` | System prompt text. Always preserved. |
| `summarizer` | `undefined` | Summarizer function. If absent, truncation mode. |
| `strategy` | `'incremental'` | Summarization strategy. |
| `maxSummaryTokens` | `Math.floor(tokenBudget * 0.3)` | Maximum tokens for the summary zone. |
| `minRecentTokens` | `Math.floor(tokenBudget * 0.3)` | Minimum tokens guaranteed for the recent zone. |
| `summarizeThresholdTokens` | `Math.floor(tokenBudget * 0.1)` | Pending buffer token threshold for triggering summarization. |
| `summarizeThresholdMessages` | `6` | Pending buffer message count threshold. |
| `tokenCounter` | `(text) => Math.ceil(text.length / 4)` | Token counting function. |
| `messageOverhead` | `4` | Per-message overhead tokens. |
| `summaryRole` | `'system'` | Role for the summary message. |
| `maxSummaryRounds` | `5` | Maximum summary re-summarization rounds. |
| `anchor` | `undefined` | Anchor text for anchored strategy. |
| `maxAnchorTokens` | `Math.floor(maxSummaryTokens * 0.4)` | Maximum anchor tokens. |
| `hooks` | `{}` | Event hooks. |

### Configuration Validation

All configuration values are validated at `createContext()` call time. Invalid values produce clear, actionable error messages:

- `tokenBudget` must be a positive integer. Zero or negative values throw `TypeError: tokenBudget must be a positive integer, received -1`.
- `maxSummaryTokens` must be positive and less than `tokenBudget`. Values exceeding the budget throw `RangeError: maxSummaryTokens (5000) exceeds tokenBudget (4096)`.
- `maxSummaryTokens + minRecentTokens` must not exceed `tokenBudget` (after subtracting system prompt tokens). Violating this throws `RangeError: maxSummaryTokens (2000) + minRecentTokens (2500) exceeds available budget (3896)`.
- `summarizeThresholdTokens` must be positive. Zero or negative values throw `TypeError`.
- `summarizeThresholdMessages` must be a positive integer. Zero throws `TypeError`.
- `strategy` must be one of `'incremental'`, `'rolling'`, `'anchored'`. Invalid values throw `TypeError: strategy must be 'incremental', 'rolling', or 'anchored', received 'unknown'`.
- `summaryRole` must be `'system'` or `'user'`. Invalid values throw `TypeError`.
- `maxSummaryRounds` must be a positive integer. Zero or negative values throw `TypeError`.
- If `strategy` is `'anchored'` and `anchor` is provided, its token count must not exceed `maxAnchorTokens`. Violating this throws `RangeError: anchor token count (500) exceeds maxAnchorTokens (400)`.

---

## 14. Edge Cases

### Single Very Long Message

A user or assistant message whose token count exceeds the entire recent zone budget. Behavior:

1. The message is still added to the message store (it is part of the conversation history).
2. If the message alone exceeds `tokenBudget - systemTokens - summaryTokens`, it is immediately evicted and queued for summarization.
3. If the summarizer produces a summary that fits, the conversation continues.
4. If the message is so long that even its summary exceeds the budget, emergency truncation drops the message with a `reason: 'truncation'` event.

### Summary Larger Than Budget

If the summarizer returns a summary that is larger than `maxSummaryTokens`:

1. The summary is re-summarized (compressed) with a target of `maxSummaryTokens * 0.75`.
2. If the compressed summary still exceeds the limit after `maxSummaryRounds` attempts, the oldest portion of the summary is truncated (character-level truncation at a sentence boundary).
3. The `onSummaryCompressed` hook fires on each compression attempt.

### Summarizer Failure

If the summarizer function throws an error:

1. The error is caught and swallowed (logged via `onEvict` with `reason: 'truncation'` if messages must be dropped).
2. Evicted messages remain in the pending buffer for the next summarization attempt.
3. `getMessages()` returns the best available context: system prompt + current summary (if any) + as many recent messages as fit in the budget.
4. If the pending buffer grows beyond the budget, the oldest pending messages are dropped.

### Empty Conversation

Calling `getMessages()` on a newly created context with no messages returns either `[systemMessage]` (if a system prompt was provided) or `[]`. No summarization is attempted. Token count is zero (or the system prompt token count).

### Rapid Message Addition

Adding many messages in a tight loop before calling `getMessages()`. Eviction happens synchronously during `addMessage()`, but summarization is deferred to `getMessages()` (which is async). This means the pending buffer may grow larger than the threshold if many messages are added without calling `getMessages()`. This is safe -- the next `getMessages()` call processes the entire pending buffer.

### Token Budget Change

Calling `setTokenBudget()` with a smaller budget mid-conversation:

1. If the current total exceeds the new budget, eviction begins immediately.
2. If eviction produces a pending buffer that exceeds the threshold, summarization is triggered.
3. `setTokenBudget()` is async because it may invoke the summarizer.

### Tool Call Without Result

If an assistant message with `tool_calls` is added but the corresponding tool result is never added, the orphaned tool call is evicted as a normal message. The summarizer receives it without a result, and the summary should note that a tool call was made but no result was received. This is a degenerate case that the caller should avoid.

### Duplicate Messages

`sliding-context` does not deduplicate messages. If the caller adds the same message twice, it appears twice in the conversation. Deduplication is the responsibility of the caller or the `memory-dedup` package.

---

## 15. Testing Strategy

### Test Categories

**Unit tests: Token counting** -- The approximate token counter is tested with English text, code, JSON, and edge cases (empty string, single character, very long strings). The pluggable counter interface is tested with a mock counter that returns predetermined values.

**Unit tests: Message addition and eviction** -- Messages are added to a context with a small token budget. Tests verify that messages appear in the correct order, that eviction removes the oldest messages when the budget is exceeded, and that tool call pairs are evicted atomically. Edge cases: single message that exceeds the budget, empty messages, messages with only tool calls and no content.

**Unit tests: Budget allocation** -- Tests verify that the token budget is correctly divided between system, summary, and recent zones. Tests verify that `maxSummaryTokens` and `minRecentTokens` are respected. Tests verify budget rebalancing when the summary grows too large.

**Unit tests: Tool call pair atomicity** -- Tests create conversations with interleaved tool call pairs and verify that eviction never splits a pair. Tests cover: single tool call, parallel tool calls (one assistant message with multiple tool_calls, each with its own tool result), consecutive tool calls, tool calls at the eviction boundary.

**Integration tests: Summarization strategies** -- Each strategy (incremental, rolling, anchored) is tested with a mock summarizer. Tests verify: the summarizer receives the correct arguments, the summary is integrated correctly into the context, the strategy-specific behavior (incremental merges, rolling re-summarizes, anchored preserves anchor). Tests simulate conversations of 20+ messages to verify that summarization triggers correctly and the context stays within budget.

**Integration tests: Full conversation lifecycle** -- End-to-end tests that simulate a complete conversation with a mock summarizer. A conversation of 50+ messages is progressively added, with periodic `getMessages()` calls verifying that the context fits within the budget, the summary grows appropriately, and recent messages are verbatim. The conversation is then serialized, deserialized, and continued, verifying that the restored context matches the original.

**Integration tests: Summarizer failure** -- Tests where the mock summarizer throws errors or returns empty strings. Verify that the context degrades gracefully (truncation mode) and that error events fire correctly.

**Edge case tests** -- Empty conversation, conversation with only system messages, conversation with only tool calls, single message exceeding the budget, token budget of 1, token budget change mid-conversation, rapid addition of 1000 messages.

**Persistence tests** -- Serialize and deserialize a context at various states (empty, with summary, with pending buffer, with anchor). Verify that the deserialized context produces identical `getMessages()` output. Test version migration (mock a v2 state schema and verify that deserialization handles unknown versions correctly).

### Test Organization

```
src/__tests__/
  context.test.ts                  -- Full context lifecycle integration tests
  token-counting/
    approximate.test.ts            -- Approximate token counter
    pluggable.test.ts              -- Pluggable counter interface
    message-overhead.test.ts       -- Per-message overhead calculation
  eviction/
    basic-eviction.test.ts         -- Message eviction when budget exceeded
    tool-call-pairs.test.ts        -- Tool call pair atomicity
    multi-part-messages.test.ts    -- Multi-part message handling
  summarization/
    incremental.test.ts            -- Incremental strategy
    rolling.test.ts                -- Rolling strategy
    anchored.test.ts               -- Anchored strategy
    trigger-threshold.test.ts      -- Summarization trigger logic
    summary-compression.test.ts    -- Summary re-summarization
    failure-handling.test.ts       -- Summarizer error handling
  budget/
    allocation.test.ts             -- Budget zone allocation
    rebalancing.test.ts            -- Budget rebalancing
    budget-change.test.ts          -- Token budget change mid-conversation
  persistence/
    serialize.test.ts              -- Serialization
    deserialize.test.ts            -- Deserialization and version handling
  hooks/
    event-hooks.test.ts            -- All event hooks fire correctly
  fixtures/
    messages.ts                    -- Test message sequences
    mock-summarizer.ts             -- Mock summarizer implementations
```

### Test Runner

`vitest` (already configured in `package.json`).

---

## 16. Performance

### Latency Overhead

`sliding-context` adds negligible latency to the hot path (`addMessage`). The per-message overhead consists of: one token count computation (the approximate counter is a single division and ceiling, sub-microsecond; an exact counter depends on the tokenizer but is typically under 1ms), one comparison against the budget, and potentially moving references from the recent array to the pending array. No async operations occur during `addMessage()`.

The potentially expensive operation is `getMessages()`, which may invoke the summarizer. Summarization calls an LLM, which takes 500ms to 5s depending on the model, the amount of content to summarize, and network latency. This latency is inherent to the summarization approach -- it is the cost of calling an LLM to summarize. `sliding-context` minimizes the frequency of these calls through batched eviction (summarizing multiple evicted messages at once rather than one at a time).

For applications where `getMessages()` latency is critical, the `summarizeThresholdTokens` can be increased to batch more messages per summarization call (fewer calls, but each call processes more content). Alternatively, the caller can invoke summarization eagerly by calling `getMessages()` after adding several messages during a natural pause (e.g., while waiting for the user's next input).

### Memory Usage

Memory usage is proportional to the number of messages stored. Each message is stored once in the message array (the recent zone and pending buffer are views into this array, not copies). The summary is a single string. For a conversation of 100 messages with an average of 500 characters each, the total memory footprint is approximately 50KB for messages plus the summary string (typically 200-1000 characters). This is negligible for any runtime environment.

Token counts are cached per message (one number per message), adding 8 bytes per message.

### Token Counting Performance

The approximate counter is O(1) per message (string length is cached by JavaScript engines). Exact counters using `gpt-tokenizer` are O(n) in the text length, with typical throughput of 1-5 million characters per second. For a 1000-character message, exact counting takes under 1ms.

Token counts are computed once and cached. `getTokenCount()` and `getTokenBreakdown()` return cached values in O(1).

---

## 17. Dependencies

### Runtime Dependencies

None. `sliding-context` has zero required runtime dependencies. All context management logic -- eviction, budget allocation, message ordering, serialization -- uses built-in JavaScript APIs (arrays, objects, `JSON.stringify`, `Math.ceil`).

### Peer Dependencies

None. The package does not depend on any specific tokenizer or LLM SDK.

### Optional Integration Dependencies

| Package | Purpose |
|---|---|
| `gpt-tokenizer` | Exact token counting for OpenAI models. Caller provides as `tokenCounter`. |
| `js-tiktoken` | Alternative exact token counting for OpenAI models. Caller provides as `tokenCounter`. |
| `convo-compress` | Advanced compression for the summarizer function. Caller wraps in `summarizer`. |

These are not peer dependencies -- `sliding-context` has no knowledge of them. The caller uses them to implement the `tokenCounter` or `summarizer` functions they pass in.

### Development Dependencies

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `vitest` | Test runner |
| `eslint` | Linting |
| `@types/node` | Node.js type definitions |

### Why Zero Dependencies

The package orchestrates context management logic using fundamental data structures (arrays, strings, numbers). It does not perform network I/O, cryptographic operations, or complex parsing that would benefit from external libraries. The two potentially external concerns -- token counting and summarization -- are deliberately pluggable via function parameters, keeping the dependency choice with the caller. This results in zero install weight, zero supply chain risk, and zero version conflict potential.

---

## 18. File Structure

```
sliding-context/
  package.json
  tsconfig.json
  SPEC.md
  README.md
  src/
    index.ts                       -- Public API exports (createContext, deserialize, defaultSummarizationPrompt)
    context.ts                     -- SlidingContext class implementation
    types.ts                       -- All TypeScript type definitions
    eviction.ts                    -- Eviction logic (oldest-first, tool call pair atomicity)
    summarization.ts               -- Summarization orchestration (strategy dispatch, trigger logic)
    budget.ts                      -- Token budget allocation and rebalancing
    token-counter.ts               -- Built-in approximate counter, counter interface
    serialization.ts               -- serialize() and deserialize() implementation
    prompt.ts                      -- Default summarization prompt constant
  src/__tests__/
    context.test.ts                -- Full lifecycle integration tests
    token-counting/
      approximate.test.ts
      pluggable.test.ts
      message-overhead.test.ts
    eviction/
      basic-eviction.test.ts
      tool-call-pairs.test.ts
      multi-part-messages.test.ts
    summarization/
      incremental.test.ts
      rolling.test.ts
      anchored.test.ts
      trigger-threshold.test.ts
      summary-compression.test.ts
      failure-handling.test.ts
    budget/
      allocation.test.ts
      rebalancing.test.ts
      budget-change.test.ts
    persistence/
      serialize.test.ts
      deserialize.test.ts
    hooks/
      event-hooks.test.ts
    fixtures/
      messages.ts
      mock-summarizer.ts
  dist/                            -- Compiled output (generated by tsc)
```

---

## 19. Implementation Roadmap

### Phase 1: Core Context Management (v0.1.0)

Implement the foundation: message storage, eviction, token counting, and basic context assembly.

1. **Types**: Define all TypeScript types in `types.ts` -- `Message`, `ToolCall`, `TokenCounter`, `Summarizer`, `SlidingContextOptions`, `ContextState`, `SlidingContext`.
2. **Approximate token counter**: Implement the `Math.ceil(text.length / 4)` default counter with per-message overhead.
3. **Message storage**: Implement `addMessage()` -- append to the message array, compute and cache token count, update total.
4. **Eviction**: Implement oldest-first eviction when the total exceeds the token budget. Move evicted messages to the pending buffer. Implement tool call pair atomicity -- detect `tool_calls` on assistant messages and find matching tool result messages by `tool_call_id`.
5. **getMessages() without summarization**: Assemble the output array: system prompt + any pending buffer messages + recent messages. In this phase, without a summarizer, this is truncation mode.
6. **Budget allocation**: Implement the zone allocation formula (system, summary, recent) with `maxSummaryTokens` and `minRecentTokens`.
7. **Configuration validation**: Validate all options at `createContext()` time.
8. **Tests**: Token counting, message addition, eviction, tool call pair atomicity, budget allocation, configuration validation.

### Phase 2: Summarization (v0.2.0)

Add the summarizer integration and summarization strategies.

1. **Summarization trigger**: Implement the threshold-based trigger (token count and message count thresholds for the pending buffer).
2. **Incremental strategy**: Implement incremental summarization -- pass evicted messages and existing summary to the summarizer, store the returned summary.
3. **Rolling strategy**: Implement rolling summarization -- combine existing summary with evicted messages, pass to summarizer, replace summary.
4. **Summary integration**: Inject the summary message into the `getMessages()` output at the correct position (after system prompt, before recent messages).
5. **Summary compression**: When the summary exceeds `maxSummaryTokens`, re-summarize it to reduce size. Implement `maxSummaryRounds` cap.
6. **Budget rebalancing**: When the summary grows, ensure `minRecentTokens` is maintained by compressing the summary if needed.
7. **Summarizer failure handling**: Catch errors, hold messages in pending buffer, fall back to truncation.
8. **Default summarization prompt**: Export the prompt constant.
9. **Tests**: Summarization triggers, each strategy, summary compression, failure handling.

### Phase 3: Advanced Features (v0.3.0)

Add anchored strategy, persistence, event hooks, and multi-part message support.

1. **Anchored strategy**: Implement permanent anchor + rolling section. Implement `setAnchor()`, auto-anchor extraction from first summary, anchor token budget.
2. **Serialization**: Implement `serialize()` -- capture all state as a plain object.
3. **Deserialization**: Implement `deserialize()` -- restore state from a serialized object, accept functions separately, validate version.
4. **Event hooks**: Implement all hook invocations at the correct points: `onEvict`, `onSummarize`, `onBudgetExceeded`, `onSummaryCompressed`.
5. **Multi-part messages**: Handle array-typed `content` fields, flat token cost for non-text parts.
6. **setTokenBudget()**: Implement dynamic budget changes with immediate eviction and summarization.
7. **Tests**: Anchored strategy, serialization round-trip, event hooks, multi-part messages, budget changes.

### Phase 4: Polish and Production Readiness (v1.0.0)

Harden for production use.

1. **Edge case hardening**: Test with extreme configurations (budget of 100 tokens, budget of 1M tokens, summarizer that always fails, messages with only tool calls, conversations of 1000+ messages).
2. **Performance optimization**: Profile `addMessage()` and `getMessages()` with large message arrays. Optimize eviction to avoid unnecessary array copies. Benchmark token counting with both approximate and exact counters.
3. **Thread safety considerations**: Document that `SlidingContext` is not thread-safe -- concurrent `addMessage()` and `getMessages()` calls from multiple async contexts can race. The caller should serialize access or use one instance per conversation.
4. **Documentation**: Comprehensive README with installation, quick start, configuration reference, provider integration examples, and strategy selection guidance.

---

## 20. Example Use Cases

### Chatbot with Token-Limited Model

A chatbot using a local Ollama model with a 4096-token context window. The context must aggressively summarize to keep the conversation functional:

```typescript
import { createContext, defaultSummarizationPrompt } from 'sliding-context';

const ctx = createContext({
  tokenBudget: 3072, // 4096 context - 1024 reserved for response
  systemPrompt: 'You are a helpful assistant. Be concise.',
  strategy: 'incremental',
  maxSummaryTokens: 800,
  minRecentTokens: 1000,
  summarizeThresholdMessages: 4,
  summarizer: async (messages, existingSummary) => {
    const prompt = existingSummary
      ? `Existing summary:\n${existingSummary}\n\nNew messages:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`
      : `Messages:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;

    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        messages: [
          { role: 'system', content: defaultSummarizationPrompt },
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: { temperature: 0.0 },
      }),
    });
    const data = await response.json();
    return data.message.content;
  },
});

// Conversation loop
while (true) {
  const userInput = await getUserInput();
  ctx.addMessage({ role: 'user', content: userInput });

  const messages = await ctx.getMessages();
  const response = await callOllama(messages);

  ctx.addMessage({ role: 'assistant', content: response });
  displayResponse(response);
}
```

### Agent with Tool Calls

An agent that uses tools for many turns. The context must handle tool call pairs correctly during summarization:

```typescript
import { createContext } from 'sliding-context';

const ctx = createContext({
  tokenBudget: 16000,
  systemPrompt: `You are a research agent. Use tools to find information.
Available tools: search_web, read_url, calculate.`,
  strategy: 'rolling',
  maxSummaryTokens: 4000,
  summarizer: async (messages, existingSummary) => {
    // Use a dedicated summarization model
    return await callSummarizationModel(messages, existingSummary);
  },
  hooks: {
    onSummarize: (input, existing, newSummary, durationMs) => {
      console.log(`Summarized ${input.length} messages in ${durationMs}ms`);
    },
    onEvict: (messages, reason) => {
      if (reason === 'truncation') {
        console.warn(`Dropped ${messages.length} messages without summarization`);
      }
    },
  },
});

// Agent loop with tool calls
async function agentLoop(task: string) {
  ctx.addMessage({ role: 'user', content: task });

  for (let turn = 0; turn < 50; turn++) {
    const messages = await ctx.getMessages();
    const response = await callLLM(messages);

    if (response.tool_calls) {
      ctx.addMessage({
        role: 'assistant',
        content: response.content ?? '',
        tool_calls: response.tool_calls,
      });

      for (const toolCall of response.tool_calls) {
        const result = await executeTool(toolCall);
        ctx.addMessage({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    } else {
      ctx.addMessage({ role: 'assistant', content: response.content });
      return response.content; // Agent is done
    }
  }
}
```

### Persistent Conversation Across Sessions

A web application that saves and restores conversation state using Redis:

```typescript
import { createContext, deserialize } from 'sliding-context';
import { Redis } from 'ioredis';

const redis = new Redis();

// Shared summarizer and counter (not serializable)
const summarizer = async (messages: Message[], existingSummary?: string) => {
  return await callGPT4oMini(messages, existingSummary);
};
const tokenCounter = (text: string) => encode(text).length;

// Start or resume a conversation
async function getOrCreateContext(userId: string): Promise<SlidingContext> {
  const saved = await redis.get(`ctx:${userId}`);

  if (saved) {
    const state = JSON.parse(saved);
    return deserialize(state, { summarizer, tokenCounter });
  }

  return createContext({
    tokenBudget: 8192,
    systemPrompt: 'You are a customer support agent for Acme Corp.',
    strategy: 'anchored',
    anchor: 'Customer support session.',
    summarizer,
    tokenCounter,
  });
}

// Save after each exchange
async function handleMessage(userId: string, userMessage: string) {
  const ctx = await getOrCreateContext(userId);

  ctx.addMessage({ role: 'user', content: userMessage });
  const messages = await ctx.getMessages();
  const response = await callLLM(messages);
  ctx.addMessage({ role: 'assistant', content: response });

  // Persist the state
  await redis.set(`ctx:${userId}`, JSON.stringify(ctx.serialize()), 'EX', 86400);

  return response;
}
```

### Cost-Optimized High-Volume Application

An application processing thousands of conversations where reducing input tokens directly reduces cost:

```typescript
import { createContext } from 'sliding-context';
import { encode } from 'gpt-tokenizer';

// Use exact token counting to maximize budget utilization
const ctx = createContext({
  tokenBudget: 4000,  // Aggressive budget to minimize cost
  systemPrompt: 'You are a concise assistant. Keep responses short.',
  strategy: 'incremental', // Cheapest summarization strategy
  maxSummaryTokens: 1000,
  summarizeThresholdTokens: 600,
  tokenCounter: (text) => encode(text).length,
  summarizer: async (messages, existingSummary) => {
    // Use the cheapest model for summarization
    return await callGPT4oMini(messages, existingSummary);
  },
  hooks: {
    onSummarize: (_, __, ___, durationMs) => {
      metrics.recordSummarizationLatency(durationMs);
    },
    onBudgetExceeded: (total, budget) => {
      metrics.incrementCounter('context_budget_exceeded');
    },
  },
});
```
