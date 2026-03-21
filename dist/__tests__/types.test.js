"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
(0, vitest_1.describe)('types', () => {
    (0, vitest_1.describe)('Message', () => {
        (0, vitest_1.it)('accepts role: system', () => {
            const msg = { role: 'system', content: 'You are helpful.' };
            (0, vitest_1.expect)(msg.role).toBe('system');
            (0, vitest_1.expect)(msg.content).toBe('You are helpful.');
        });
        (0, vitest_1.it)('accepts role: user', () => {
            const msg = { role: 'user', content: 'Hello' };
            (0, vitest_1.expect)(msg.role).toBe('user');
        });
        (0, vitest_1.it)('accepts role: assistant', () => {
            const msg = { role: 'assistant', content: 'Hi!' };
            (0, vitest_1.expect)(msg.role).toBe('assistant');
        });
        (0, vitest_1.it)('accepts role: tool', () => {
            const msg = { role: 'tool', content: 'result data', tool_call_id: 'call_1' };
            (0, vitest_1.expect)(msg.role).toBe('tool');
            (0, vitest_1.expect)(msg.tool_call_id).toBe('call_1');
        });
        (0, vitest_1.it)('accepts optional tool_calls', () => {
            const msg = {
                role: 'assistant',
                content: '',
                tool_calls: [
                    { id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{}' } },
                ],
            };
            (0, vitest_1.expect)(msg.tool_calls).toHaveLength(1);
        });
        (0, vitest_1.it)('accepts optional name field', () => {
            const msg = { role: 'user', content: 'hi', name: 'alice' };
            (0, vitest_1.expect)(msg.name).toBe('alice');
        });
    });
    (0, vitest_1.describe)('ToolCall', () => {
        (0, vitest_1.it)('has correct shape', () => {
            const tc = {
                id: 'call_xyz',
                type: 'function',
                function: { name: 'search', arguments: '{"q":"test"}' },
            };
            (0, vitest_1.expect)(tc.id).toBe('call_xyz');
            (0, vitest_1.expect)(tc.type).toBe('function');
            (0, vitest_1.expect)(tc.function.name).toBe('search');
            (0, vitest_1.expect)(tc.function.arguments).toBe('{"q":"test"}');
        });
    });
    (0, vitest_1.describe)('SlidingContextOptions', () => {
        (0, vitest_1.it)('requires only tokenBudget', () => {
            const opts = { tokenBudget: 4096 };
            (0, vitest_1.expect)(opts.tokenBudget).toBe(4096);
        });
        (0, vitest_1.it)('accepts all optional fields', () => {
            const opts = {
                tokenBudget: 8192,
                systemPrompt: 'Be helpful',
                strategy: 'incremental',
                maxSummaryTokens: 512,
                minRecentTokens: 256,
                summarizeThresholdTokens: 3000,
                summarizeThresholdMessages: 10,
                messageOverhead: 4,
                summaryRole: 'system',
                maxSummaryRounds: 3,
                maxAnchorTokens: 1024,
            };
            (0, vitest_1.expect)(opts.tokenBudget).toBe(8192);
            (0, vitest_1.expect)(opts.strategy).toBe('incremental');
            (0, vitest_1.expect)(opts.summaryRole).toBe('system');
        });
    });
    (0, vitest_1.describe)('ContextState', () => {
        (0, vitest_1.it)('version is literal 1', () => {
            const state = {
                options: { tokenBudget: 4096 },
                messages: [],
                summary: undefined,
                anchor: [],
                pendingBuffer: [],
                summaryRounds: 0,
                tokenCounts: {},
                version: 1,
            };
            (0, vitest_1.expect)(state.version).toBe(1);
        });
    });
});
//# sourceMappingURL=types.test.js.map