export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}
export type TokenCounter = (text: string) => number;
export type Summarizer = (messages: Message[], existingSummary?: string) => Promise<string>;
export type SummarizationStrategy = 'incremental' | 'rolling' | 'anchored';
export type SummaryRole = 'system' | 'user';
export interface EventHooks {
    onEvict?: (messages: Message[], reason: string) => void;
    onSummarize?: (inputMessages: Message[], existingSummary: string | undefined, newSummary: string, durationMs: number) => void;
    onBudgetExceeded?: (totalTokens: number, budget: number) => void;
    onSummaryCompressed?: (oldSummary: string, newSummary: string) => void;
}
export interface SlidingContextOptions {
    tokenBudget: number;
    systemPrompt?: string;
    summarizer?: Summarizer;
    strategy?: SummarizationStrategy;
    maxSummaryTokens?: number;
    minRecentTokens?: number;
    summarizeThresholdTokens?: number;
    summarizeThresholdMessages?: number;
    tokenCounter?: TokenCounter;
    messageOverhead?: number;
    summaryRole?: SummaryRole;
    maxSummaryRounds?: number;
    anchor?: Message[];
    maxAnchorTokens?: number;
    hooks?: EventHooks;
}
export interface ContextState {
    options: Omit<SlidingContextOptions, 'summarizer' | 'tokenCounter' | 'hooks'>;
    messages: Message[];
    summary: string | undefined;
    anchor: Message[];
    pendingBuffer: Message[];
    summaryRounds: number;
    tokenCounts: Record<string, number>;
    version: 1;
}
export interface SlidingContext {
    addMessage(message: Message): Promise<void>;
    getMessages(): Message[];
    getSummary(): string | undefined;
    getTokenCount(): number;
    getTokenBreakdown(): {
        system: number;
        anchor: number;
        summary: number;
        recent: number;
        total: number;
    };
    getRecentMessageCount(): number;
    getTotalMessageCount(): number;
    setAnchor(messages: Message[]): void;
    setTokenBudget(budget: number): void;
    clear(): void;
    serialize(): ContextState;
}
//# sourceMappingURL=types.d.ts.map