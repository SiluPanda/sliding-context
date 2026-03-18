# sliding-context — Task Breakdown

Comprehensive task list derived from SPEC.md. All tasks must be completed before v1.0.0 release.

---

## Phase 1: Project Setup and Scaffolding

- [ ] **Install dev dependencies** — Add `typescript`, `vitest`, `eslint`, and `@types/node` as dev dependencies in `package.json`. Verify `npm install` succeeds cleanly. | Status: not_done
- [ ] **Configure ESLint** — Create `.eslintrc` (or equivalent) with TypeScript support. Ensure `npm run lint` runs against `src/`. | Status: not_done
- [ ] **Configure Vitest** — Create `vitest.config.ts` if needed. Ensure `npm run test` discovers and runs `src/__tests__/**/*.test.ts` files. | Status: not_done
- [ ] **Create source file structure** — Create all source files as specified in Section 18: `src/index.ts`, `src/context.ts`, `src/types.ts`, `src/eviction.ts`, `src/summarization.ts`, `src/budget.ts`, `src/token-counter.ts`, `src/serialization.ts`, `src/prompt.ts`. Create empty test directory structure under `src/__tests__/`. | Status: not_done
- [ ] **Create test fixtures directory** — Create `src/__tests__/fixtures/messages.ts` with reusable test message sequences (user/assistant exchanges, tool call pairs, system messages, multi-part messages). Create `src/__tests__/fixtures/mock-summarizer.ts` with mock summarizer implementations (one that works, one that fails, one that returns empty string). | Status: not_done
- [ ] **Verify build pipeline** — Run `npm run build` and confirm `tsc` compiles successfully with the tsconfig.json settings (target ES2022, CommonJS, strict mode, declarations). | Status: not_done

---

## Phase 2: Type Definitions (`src/types.ts`)

- [ ] **Define Message interface** — Define the `Message` interface with fields: `role` (`'system' | 'user' | 'assistant' | 'tool'`), `content` (string), optional `tool_calls` (ToolCall[]), optional `tool_call_id` (string), optional `name` (string). | Status: not_done
- [ ] **Define ToolCall interface** — Define the `ToolCall` interface with fields: `id` (string), `type` (`'function'`), `function` (`{ name: string; arguments: string }`). | Status: not_done
- [ ] **Define TokenCounter type** — Define `TokenCounter` as `(text: string) => number`. | Status: not_done
- [ ] **Define Summarizer type** — Define `Summarizer` as `(messages: Message[], existingSummary?: string) => Promise<string>`. | Status: not_done
- [ ] **Define SummarizationStrategy type** — Define as `'incremental' | 'rolling' | 'anchored'`. | Status: not_done
- [ ] **Define SummaryRole type** — Define as `'system' | 'user'`. | Status: not_done
- [ ] **Define EventHooks interface** — Define with optional callbacks: `onEvict(messages, reason)`, `onSummarize(inputMessages, existingSummary, newSummary, durationMs)`, `onBudgetExceeded(totalTokens, budget)`, `onSummaryCompressed(oldSummary, newSummary)`. | Status: not_done
- [ ] **Define SlidingContextOptions interface** — Define with all configuration fields per Section 8: `tokenBudget` (required), `systemPrompt`, `summarizer`, `strategy`, `maxSummaryTokens`, `minRecentTokens`, `summarizeThresholdTokens`, `summarizeThresholdMessages`, `tokenCounter`, `messageOverhead`, `summaryRole`, `maxSummaryRounds`, `anchor`, `maxAnchorTokens`, `hooks`. | Status: not_done
- [ ] **Define ContextState interface** — Define the serializable state representation per Section 8: `options` (non-function config), `messages`, `summary`, `anchor`, `pendingBuffer`, `summaryRounds`, `tokenCounts`, `version` (literal `1`). | Status: not_done
- [ ] **Define SlidingContext interface** — Define the public instance interface with methods: `addMessage()`, `getMessages()`, `getSummary()`, `getTokenCount()`, `getTokenBreakdown()`, `getRecentMessageCount()`, `getTotalMessageCount()`, `setAnchor()`, `setTokenBudget()`, `clear()`, `serialize()`. | Status: not_done

---

## Phase 3: Token Counting (`src/token-counter.ts`)

- [ ] **Implement approximate token counter** — Implement the default counter: `Math.ceil(text.length / 4)`. Export as `approximateTokenCounter`. Handle empty strings (return 0). | Status: not_done
- [ ] **Implement per-message token counting** — Create a `countMessageTokens(message, tokenCounter, messageOverhead)` function. For string content: `tokenCounter(content) + messageOverhead`. For messages with `tool_calls`: add `tokenCounter(JSON.stringify(tool_calls))`. For tool messages: include `tool_call_id` in overhead. For empty/missing content: return `messageOverhead` plus tool call overhead. | Status: not_done
- [ ] **Handle multi-part message content** — If `content` is an array, sum token counts of text parts via `tokenCounter`, and add a flat `imageTokenCost` (default 85) per non-text part. | Status: not_done
- [ ] **Tests: approximate token counter** — Create `src/__tests__/token-counting/approximate.test.ts`. Test with: empty string, single character, English prose, code, JSON, very long strings. Verify the formula `Math.ceil(text.length / 4)` holds for all cases. | Status: not_done
- [ ] **Tests: pluggable token counter** — Create `src/__tests__/token-counting/pluggable.test.ts`. Test that a custom `tokenCounter` function is called instead of the default. Use a mock counter that returns predetermined values and verify correct results. | Status: not_done
- [ ] **Tests: message overhead calculation** — Create `src/__tests__/token-counting/message-overhead.test.ts`. Test per-message overhead is added correctly. Test tool call overhead. Test messages with empty content. Test messages with only `tool_calls` and no content. | Status: not_done

---

## Phase 4: Default Summarization Prompt (`src/prompt.ts`)

- [ ] **Export defaultSummarizationPrompt** — Create `src/prompt.ts` and export the `defaultSummarizationPrompt` string constant as specified in Section 6 (preserve key facts, named entities, user preferences, action items, unresolved questions; omit pleasantries, repeated information, debugging, verbose tool output). | Status: not_done

---

## Phase 5: Configuration Validation (`src/context.ts` — partial)

- [ ] **Validate tokenBudget** — Must be a positive integer. Throw `TypeError` with message `"tokenBudget must be a positive integer, received <value>"` for zero, negative, non-integer, or non-number values. | Status: not_done
- [ ] **Validate maxSummaryTokens** — Must be positive and less than `tokenBudget`. Throw `RangeError` with message `"maxSummaryTokens (<value>) exceeds tokenBudget (<value>)"` when violated. | Status: not_done
- [ ] **Validate maxSummaryTokens + minRecentTokens** — Their sum must not exceed `tokenBudget` minus system prompt tokens. Throw `RangeError` with descriptive message when violated. | Status: not_done
- [ ] **Validate summarizeThresholdTokens** — Must be positive. Throw `TypeError` for zero or negative values. | Status: not_done
- [ ] **Validate summarizeThresholdMessages** — Must be a positive integer. Throw `TypeError` for zero or non-integer values. | Status: not_done
- [ ] **Validate strategy** — Must be `'incremental'`, `'rolling'`, or `'anchored'`. Throw `TypeError` with message listing valid values for invalid input. | Status: not_done
- [ ] **Validate summaryRole** — Must be `'system'` or `'user'`. Throw `TypeError` for invalid values. | Status: not_done
- [ ] **Validate maxSummaryRounds** — Must be a positive integer. Throw `TypeError` for zero or negative values. | Status: not_done
- [ ] **Validate anchor token count** — If `strategy` is `'anchored'` and `anchor` is provided, its token count must not exceed `maxAnchorTokens`. Throw `RangeError` with descriptive message when violated. | Status: not_done
- [ ] **Apply default values** — For all optional fields, apply defaults per Section 13: `strategy` defaults to `'incremental'`, `maxSummaryTokens` to `Math.floor(tokenBudget * 0.3)`, `minRecentTokens` to `Math.floor(tokenBudget * 0.3)`, `summarizeThresholdTokens` to `Math.floor(tokenBudget * 0.1)`, `summarizeThresholdMessages` to `6`, `tokenCounter` to the approximate counter, `messageOverhead` to `4`, `summaryRole` to `'system'`, `maxSummaryRounds` to `5`, `maxAnchorTokens` to `Math.floor(maxSummaryTokens * 0.4)`. | Status: not_done

---

## Phase 6: Core Context Management (`src/context.ts`)

- [ ] **Implement createContext factory function** — Accept `SlidingContextOptions`, validate config, compute defaults, initialize internal state (message array, token counts, empty summary, empty pending buffer), return a `SlidingContext` object. | Status: not_done
- [ ] **Implement addMessage()** — Append message to internal store. Compute and cache token count for the message. Update zone token counts. Check if total exceeds `tokenBudget` and trigger eviction if needed. Must be synchronous (no async). | Status: not_done
- [ ] **Implement getMessages() — basic assembly** — Return message array in order: [system prompt (if present), summary message (if summary exists), ...recent messages]. The summary message should use the configured `summaryRole`. This method is async because it may trigger summarization. | Status: not_done
- [ ] **Implement getSummary()** — Return the current summary string or `null` if no summarization has occurred. | Status: not_done
- [ ] **Implement getTokenCount()** — Return the cached total token count across all zones. Must be O(1). | Status: not_done
- [ ] **Implement getTokenBreakdown()** — Return an object with `{ system, summary, recent, pending, total }` token counts. Must be O(1) using cached values. | Status: not_done
- [ ] **Implement getRecentMessageCount()** — Return the number of messages currently in the recent zone. | Status: not_done
- [ ] **Implement getTotalMessageCount()** — Return the total number of messages ever added to the conversation (including evicted/summarized ones). | Status: not_done
- [ ] **Implement clear()** — Reset all messages, summary, pending buffer, and token counts to initial state. Preserve system prompt and configuration. | Status: not_done
- [ ] **System prompt handling** — Never summarize or evict the system prompt. Always place it as the first element in `getMessages()`. Its token cost is fixed and subtracted from the budget. If no system prompt is provided, omit it from the output. | Status: not_done
- [ ] **Additional system messages** — System messages added via `addMessage()` (beyond the initial system prompt) are treated as regular messages: they enter the recent zone and can be evicted and summarized. | Status: not_done

---

## Phase 7: Eviction Logic (`src/eviction.ts`)

- [ ] **Implement oldest-first eviction** — When total tokens exceed `tokenBudget`, evict the oldest messages from the recent zone into the pending buffer. Continue evicting until total tokens are at or below the budget. | Status: not_done
- [ ] **Implement tool call pair atomicity** — When evicting, detect assistant messages with `tool_calls`. Find all corresponding tool result messages (matched by `tool_call_id`). Evict the entire group (assistant message + all matching tool messages) as an atomic unit. Never split a tool call pair across the summary boundary. | Status: not_done
- [ ] **Handle parallel tool calls** — An assistant message may have multiple `tool_calls`, each with its own tool result message. All tool results for a given assistant message must be evicted together with that assistant message. | Status: not_done
- [ ] **Handle consecutive tool calls** — Multiple consecutive assistant-tool call pairs at the eviction boundary. Each pair is atomic independently, but consecutive pairs can be evicted separately. | Status: not_done
- [ ] **Handle tool call without result** — If an assistant message with `tool_calls` has no corresponding tool result messages, it is evicted as a normal message (degenerate case per Section 14). | Status: not_done
- [ ] **Tests: basic eviction** — Create `src/__tests__/eviction/basic-eviction.test.ts`. Test: messages evicted in oldest-first order; eviction stops when budget is satisfied; evicted messages appear in pending buffer; recently added messages remain in recent zone. | Status: not_done
- [ ] **Tests: tool call pair atomicity** — Create `src/__tests__/eviction/tool-call-pairs.test.ts`. Test: single tool call pair evicted atomically; parallel tool calls (multi-tool_calls) evicted atomically; consecutive tool call pairs at boundary; tool call without result; tool call pair that spans multiple messages. | Status: not_done
- [ ] **Tests: multi-part messages** — Create `src/__tests__/eviction/multi-part-messages.test.ts`. Test: multi-part messages are evicted like regular messages; token counting uses flat cost for non-text parts. | Status: not_done

---

## Phase 8: Budget Allocation (`src/budget.ts`)

- [ ] **Implement zone allocation formula** — Compute `systemTokens` (fixed), `summaryTokens` (capped at `maxSummaryTokens`), `recentTokens` (remainder: `tokenBudget - systemTokens - summaryTokens`). Ensure `minRecentTokens` is guaranteed. | Status: not_done
- [ ] **Implement budget rebalancing — summary compression trigger** — When `summaryTokens > maxSummaryTokens`, trigger summary re-summarization targeting `maxSummaryTokens * 0.75`. | Status: not_done
- [ ] **Implement budget rebalancing — forced eviction** — If total still exceeds budget after summary compression, evict more recent messages. | Status: not_done
- [ ] **Implement budget rebalancing — emergency truncation** — If the summarizer fails or is unavailable and the pending buffer exceeds the budget, drop the oldest pending messages without summarization. Fire `onEvict` hook with `reason: 'truncation'`. | Status: not_done
- [ ] **Implement minRecentTokens enforcement** — If the summary grows to the point where the recent zone falls below `minRecentTokens`, compress the summary before evicting more recent messages. | Status: not_done
- [ ] **Tests: budget allocation** — Create `src/__tests__/budget/allocation.test.ts`. Test: zone allocation formula; `maxSummaryTokens` cap is respected; `minRecentTokens` guarantee is maintained; budget after system prompt is correctly computed. | Status: not_done
- [ ] **Tests: budget rebalancing** — Create `src/__tests__/budget/rebalancing.test.ts`. Test: summary compression triggers at correct threshold; forced eviction after compression; emergency truncation with failed summarizer; `minRecentTokens` enforcement. | Status: not_done

---

## Phase 9: Summarization Orchestration (`src/summarization.ts`)

- [ ] **Implement summarization trigger** — Check pending buffer against `summarizeThresholdTokens` and `summarizeThresholdMessages`. Trigger summarization when either threshold is exceeded (whichever is reached first). | Status: not_done
- [ ] **Implement incremental strategy** — Pass only newly evicted messages and the existing summary to the summarizer: `summarizer(evictedMessages, existingSummary)`. Store the returned string as the new summary. | Status: not_done
- [ ] **Implement rolling strategy** — If existing summary exists, prepend it as a synthetic user message (`{ role: 'user', content: 'Previous summary: ...' }`) to the evicted messages. Call `summarizer(combinedMessages)` without passing `existingSummary`. Replace the summary with the result. | Status: not_done
- [ ] **Implement anchored strategy** — Maintain separate `anchor` and `rollingSection`. Summarize only the rolling section plus new messages (exclude anchor from re-summarization). Final summary is `anchor + rollingSection`. | Status: not_done
- [ ] **Implement setAnchor()** — Allow caller to set/replace anchor text for the anchored strategy. Validate anchor token count against `maxAnchorTokens`. | Status: not_done
- [ ] **Implement auto-anchor extraction** — When strategy is `'anchored'` and no anchor is set, extract the anchor from the first summarization output. Use the first portion of the summary (up to `maxAnchorTokens`) as the anchor. | Status: not_done
- [ ] **Implement summary compression** — When summary exceeds `maxSummaryTokens`, re-summarize targeting `maxSummaryTokens * 0.75`. Track compression rounds. If `maxSummaryRounds` is reached, truncate the oldest portion of the summary at a sentence boundary instead of re-summarizing. Fire `onSummaryCompressed` hook on each compression attempt. | Status: not_done
- [ ] **Implement summarizer failure handling** — Catch errors thrown by the summarizer. Do not re-throw (summarization failure must not crash the conversation). Keep evicted messages in the pending buffer for the next attempt. If pending buffer grows beyond budget, apply emergency truncation. Handle empty string returns as failures. | Status: not_done
- [ ] **Integrate summarization into getMessages()** — When `getMessages()` is called and the pending buffer exceeds the trigger threshold, invoke summarization before assembling the output. Measure duration for the `onSummarize` hook. | Status: not_done
- [ ] **Summary message injection** — Insert the summary as a message (using configured `summaryRole`) after the system prompt and before recent messages. Omit if no summary exists. | Status: not_done
- [ ] **Tests: incremental strategy** — Create `src/__tests__/summarization/incremental.test.ts`. Test: summarizer receives correct arguments (evicted messages + existing summary); summary is updated correctly; multiple rounds of incremental summarization produce correct results. | Status: not_done
- [ ] **Tests: rolling strategy** — Create `src/__tests__/summarization/rolling.test.ts`. Test: existing summary is prepended as synthetic message; summarizer receives combined messages without existingSummary param; summary is replaced fully. | Status: not_done
- [ ] **Tests: anchored strategy** — Create `src/__tests__/summarization/anchored.test.ts`. Test: anchor is preserved across summarizations; rolling section is re-summarized; auto-anchor extraction from first summary; setAnchor() replaces existing anchor; anchor token budget is respected. | Status: not_done
- [ ] **Tests: trigger threshold** — Create `src/__tests__/summarization/trigger-threshold.test.ts`. Test: summarization triggers at token threshold; summarization triggers at message count threshold; whichever threshold is reached first triggers; no summarization below thresholds. | Status: not_done
- [ ] **Tests: summary compression** — Create `src/__tests__/summarization/summary-compression.test.ts`. Test: compression triggers when summary exceeds `maxSummaryTokens`; compression targets 75% of max; `maxSummaryRounds` cap is respected; truncation at sentence boundary after max rounds. | Status: not_done
- [ ] **Tests: failure handling** — Create `src/__tests__/summarization/failure-handling.test.ts`. Test: summarizer error is caught and not re-thrown; pending buffer retains messages after failure; empty string return is treated as failure; emergency truncation fires `onEvict` with `reason: 'truncation'`; `getMessages()` returns best available context after failure. | Status: not_done

---

## Phase 10: Serialization and Deserialization (`src/serialization.ts`)

- [ ] **Implement serialize()** — Export full context state as a `ContextState` object: all messages, summary, anchor, pending buffer, summary rounds, token counts, and non-function configuration values. The result must be JSON-safe (`JSON.stringify` compatible). Do not include `summarizer`, `tokenCounter`, or `hooks`. | Status: not_done
- [ ] **Implement deserialize()** — Accept a `ContextState` and optional `{ summarizer, tokenCounter, hooks }`. Reconstruct a `SlidingContext` instance with the restored state. Validate `version` field; throw `TypeError` for unsupported versions. If no summarizer is provided, operate in truncation mode. | Status: not_done
- [ ] **Version field handling** — Serialize with `version: 1`. On deserialization, check the version. If version is `1`, load directly. If version is unrecognized, throw `TypeError` with clear message (e.g., `"Unsupported context state version: 2"`). | Status: not_done
- [ ] **Tests: serialization** — Create `src/__tests__/persistence/serialize.test.ts`. Test: serialize empty context; serialize context with messages; serialize context with summary; serialize context with pending buffer; serialize context with anchor; verify output is JSON-safe; verify functions are excluded. | Status: not_done
- [ ] **Tests: deserialization** — Create `src/__tests__/persistence/deserialize.test.ts`. Test: deserialize and verify `getMessages()` matches pre-serialization output; deserialize without summarizer (truncation mode); deserialize with re-attached functions; add messages after deserialization and verify correct behavior; reject unknown version with TypeError. | Status: not_done
- [ ] **Tests: round-trip persistence** — Test full round-trip: create context, add messages, trigger summarization, serialize, deserialize with functions, continue conversation, verify coherent state. | Status: not_done

---

## Phase 11: Event Hooks (`src/context.ts` — hooks integration)

- [ ] **Implement onEvict hook** — Fire when messages are evicted from the recent zone. Pass the evicted messages and the reason (`'budget'` for normal eviction, `'truncation'` for emergency drops). | Status: not_done
- [ ] **Implement onSummarize hook** — Fire after the summarizer completes. Pass `inputMessages`, `existingSummary` (or null), `newSummary`, and `durationMs` (elapsed time of the summarizer call). | Status: not_done
- [ ] **Implement onBudgetExceeded hook** — Fire when total token count exceeds the budget, before eviction begins. Pass `totalTokens` and `budget`. | Status: not_done
- [ ] **Implement onSummaryCompressed hook** — Fire when the summary is re-summarized because it exceeded `maxSummaryTokens`. Pass `oldSummary` and `newSummary`. | Status: not_done
- [ ] **Tests: event hooks** — Create `src/__tests__/hooks/event-hooks.test.ts`. Test: each hook fires at the correct time with correct arguments; hooks are optional (no error if not provided); hooks that throw do not crash the context manager; multiple hooks fire in expected order during a single `getMessages()` call. | Status: not_done

---

## Phase 12: Dynamic Budget Changes

- [ ] **Implement setTokenBudget()** — Accept a new `tokenBudget` value. If the current total exceeds the new budget, trigger eviction immediately. If eviction produces a pending buffer exceeding the threshold, trigger summarization. Method is async because it may invoke the summarizer. Validate the new budget (positive integer). | Status: not_done
- [ ] **Tests: budget change** — Create `src/__tests__/budget/budget-change.test.ts`. Test: reducing budget triggers eviction; reducing budget triggers summarization if threshold met; increasing budget does not trigger eviction; invalid budget throws TypeError; budget change mid-conversation produces correct `getMessages()` output. | Status: not_done

---

## Phase 13: Multi-Part Message Support

- [ ] **Handle array content in messages** — When `message.content` is an array of parts (text blocks, image blocks, etc.), count tokens for text parts using `tokenCounter` and add flat `imageTokenCost` (default 85) for each non-text part. | Status: not_done
- [ ] **Pass full message to summarizer** — When multi-part messages are evicted and summarized, pass the full message object to the summarizer. The caller's summarizer function decides how to handle non-text content. | Status: not_done

---

## Phase 14: Public API Exports (`src/index.ts`)

- [ ] **Export createContext** — Re-export the `createContext` factory function from `src/context.ts`. | Status: not_done
- [ ] **Export deserialize** — Re-export the `deserialize` function from `src/serialization.ts`. | Status: not_done
- [ ] **Export defaultSummarizationPrompt** — Re-export the prompt constant from `src/prompt.ts`. | Status: not_done
- [ ] **Export all types** — Re-export all public TypeScript types: `Message`, `ToolCall`, `TokenCounter`, `Summarizer`, `SummarizationStrategy`, `SummaryRole`, `EventHooks`, `SlidingContextOptions`, `ContextState`, `SlidingContext`. | Status: not_done

---

## Phase 15: Edge Case Handling and Hardening

- [ ] **Single very long message** — A message whose token count exceeds the entire recent zone budget. The message is added, immediately evicted, queued for summarization. If even the summary exceeds the budget, apply emergency truncation with `reason: 'truncation'`. | Status: not_done
- [ ] **Summary larger than budget** — Summarizer returns a summary exceeding `maxSummaryTokens`. Re-summarize targeting `maxSummaryTokens * 0.75`. If still too large after `maxSummaryRounds`, truncate at a sentence boundary. | Status: not_done
- [ ] **Empty conversation** — `getMessages()` on a fresh context returns `[systemMessage]` (if system prompt exists) or `[]`. No summarization attempted. Token count is 0 or system prompt tokens. | Status: not_done
- [ ] **Rapid message addition** — Adding many messages in a loop without calling `getMessages()`. Eviction is synchronous in `addMessage()`, summarization is deferred to `getMessages()`. Pending buffer may grow larger than threshold. Next `getMessages()` processes the full buffer. | Status: not_done
- [ ] **Token budget change mid-conversation** — `setTokenBudget()` with a smaller budget triggers immediate eviction and possibly summarization. | Status: not_done
- [ ] **Tool call without result** — Orphaned tool calls are evicted as normal messages. | Status: not_done
- [ ] **Duplicate messages** — No deduplication. Same message added twice appears twice. | Status: not_done
- [ ] **Truncation-mode operation (no summarizer)** — When no summarizer is provided, evicted messages are simply dropped. No summary is maintained. `getMessages()` returns system prompt + recent messages only. | Status: not_done
- [ ] **Tests: edge cases** — Add edge case tests across existing test files or create dedicated tests: empty conversation, only system messages, only tool calls, single message exceeding budget, token budget of very small value (e.g., 100), rapid addition of 1000 messages, conversation with no summarizer. | Status: not_done

---

## Phase 16: Integration Tests

- [ ] **Full conversation lifecycle test** — Create `src/__tests__/context.test.ts`. Simulate a 50+ message conversation with a mock summarizer. Periodically call `getMessages()` and verify: context fits within budget, summary grows appropriately, recent messages are verbatim, system prompt is always first, tool call pairs are preserved. | Status: not_done
- [ ] **Serialize-deserialize-continue test** — Within the lifecycle test: serialize mid-conversation, deserialize with functions re-attached, continue adding messages, verify the context behaves identically to a non-serialized continuation. | Status: not_done
- [ ] **Strategy comparison test** — Run the same conversation through all three strategies (incremental, rolling, anchored) with the same mock summarizer. Verify each strategy invokes the summarizer with the correct arguments and produces valid context. | Status: not_done
- [ ] **Truncation mode lifecycle test** — Run a conversation without a summarizer. Verify evicted messages are dropped, no summary exists, `getMessages()` returns system prompt + recent messages within budget. | Status: not_done
- [ ] **Multi-model budget change test** — Start a conversation with a large budget (e.g., 16000), add many messages, then reduce the budget (e.g., to 4000) via `setTokenBudget()`. Verify aggressive eviction and summarization produce a valid context within the new budget. | Status: not_done

---

## Phase 17: Performance Validation

- [ ] **Benchmark addMessage() performance** — Verify `addMessage()` is synchronous and fast. Profile with 1000+ messages. Token counting and eviction should not cause noticeable latency. | Status: not_done
- [ ] **Verify O(1) token count retrieval** — Confirm `getTokenCount()` and `getTokenBreakdown()` return cached values without recomputation. | Status: not_done
- [ ] **Verify token count caching** — Token counts are computed once per message at `addMessage()` time and cached. Summary token count is updated only when summary changes. No recomputation on `getMessages()`. | Status: not_done

---

## Phase 18: Documentation

- [ ] **Write README.md** — Comprehensive README with: package description, installation instructions, quick start example, full configuration reference table (all options with defaults and descriptions), provider integration examples (OpenAI, Anthropic, Ollama), strategy selection guidance (when to use incremental vs rolling vs anchored), persistence example, cost optimization guidance, API reference for all public methods. | Status: not_done
- [ ] **Add JSDoc comments** — Add JSDoc comments to all public functions, types, and interfaces. Include parameter descriptions, return types, throws clauses, and usage examples where helpful. | Status: not_done

---

## Phase 19: Final Verification and Publishing Prep

- [ ] **Run full test suite** — Execute `npm run test` and verify all tests pass. | Status: not_done
- [ ] **Run linter** — Execute `npm run lint` and fix any issues. | Status: not_done
- [ ] **Run build** — Execute `npm run build` and verify `dist/` output includes `.js`, `.d.ts`, `.d.ts.map`, and `.js.map` files for all source modules. | Status: not_done
- [ ] **Verify package.json fields** — Confirm `main` points to `dist/index.js`, `types` points to `dist/index.d.ts`, `files` includes only `dist`, `engines` requires `>=18`, `publishConfig.access` is `public`. | Status: not_done
- [ ] **Verify zero runtime dependencies** — Confirm `package.json` has no `dependencies` (only `devDependencies`). | Status: not_done
- [ ] **Test npm pack** — Run `npm pack --dry-run` and verify the tarball includes only the expected files (dist/, package.json, README.md). No source files, no test files, no SPEC.md. | Status: not_done
- [ ] **Version bump** — Bump version in `package.json` to the appropriate version per the roadmap phase being released. | Status: not_done
