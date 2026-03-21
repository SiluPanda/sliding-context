"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const token_counter_1 = require("../token-counter");
(0, vitest_1.describe)('approximateTokenCounter', () => {
    (0, vitest_1.it)('returns 0 for empty string', () => {
        (0, vitest_1.expect)((0, token_counter_1.approximateTokenCounter)('')).toBe(0);
    });
    (0, vitest_1.it)('returns 1 for single character (ceil(1/4))', () => {
        (0, vitest_1.expect)((0, token_counter_1.approximateTokenCounter)('a')).toBe(1);
    });
    (0, vitest_1.it)('returns 1 for exactly 4 characters', () => {
        (0, vitest_1.expect)((0, token_counter_1.approximateTokenCounter)('abcd')).toBe(1);
    });
    (0, vitest_1.it)('returns 2 for 5 characters (ceil(5/4))', () => {
        (0, vitest_1.expect)((0, token_counter_1.approximateTokenCounter)('abcde')).toBe(2);
    });
    (0, vitest_1.it)('returns 25 for 100-character string', () => {
        const str = 'a'.repeat(100);
        (0, vitest_1.expect)((0, token_counter_1.approximateTokenCounter)(str)).toBe(25);
    });
});
(0, vitest_1.describe)('DEFAULT_MESSAGE_OVERHEAD', () => {
    (0, vitest_1.it)('is 4', () => {
        (0, vitest_1.expect)(token_counter_1.DEFAULT_MESSAGE_OVERHEAD).toBe(4);
    });
});
(0, vitest_1.describe)('countMessageTokens', () => {
    (0, vitest_1.it)('counts basic string content plus overhead', () => {
        const message = { role: 'user', content: 'abcd' }; // 1 token
        const result = (0, token_counter_1.countMessageTokens)(message, token_counter_1.approximateTokenCounter, 4);
        (0, vitest_1.expect)(result).toBe(1 + 4); // 5
    });
    (0, vitest_1.it)('returns messageOverhead for empty content', () => {
        const message = { role: 'user', content: '' };
        const result = (0, token_counter_1.countMessageTokens)(message, token_counter_1.approximateTokenCounter, 4);
        (0, vitest_1.expect)(result).toBe(4);
    });
    (0, vitest_1.it)('adds tool_calls JSON token cost', () => {
        const message = {
            role: 'assistant',
            content: '',
            tool_calls: [
                {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'fn', arguments: '{}' },
                },
            ],
        };
        const toolCallsJson = JSON.stringify(message.tool_calls);
        const expectedToolTokens = (0, token_counter_1.approximateTokenCounter)(toolCallsJson);
        const result = (0, token_counter_1.countMessageTokens)(message, token_counter_1.approximateTokenCounter, 4);
        (0, vitest_1.expect)(result).toBe(0 + expectedToolTokens + 4);
    });
    (0, vitest_1.it)('adds tool_call_id token cost', () => {
        const message = {
            role: 'tool',
            content: 'result',
            tool_call_id: 'call_abc123',
        };
        const contentTokens = (0, token_counter_1.approximateTokenCounter)('result'); // ceil(6/4) = 2
        const idTokens = (0, token_counter_1.approximateTokenCounter)('call_abc123'); // ceil(11/4) = 3
        const result = (0, token_counter_1.countMessageTokens)(message, token_counter_1.approximateTokenCounter, 4);
        (0, vitest_1.expect)(result).toBe(contentTokens + idTokens + 4);
    });
    (0, vitest_1.it)('uses custom tokenCounter', () => {
        const mockCounter = vitest_1.vi.fn().mockReturnValue(10);
        const message = { role: 'user', content: 'hello world' };
        const result = (0, token_counter_1.countMessageTokens)(message, mockCounter, 2);
        (0, vitest_1.expect)(mockCounter).toHaveBeenCalledWith('hello world');
        (0, vitest_1.expect)(result).toBe(10 + 2);
    });
    (0, vitest_1.it)('uses custom tokenCounter with tool_calls and tool_call_id', () => {
        const mockCounter = vitest_1.vi.fn().mockReturnValue(5);
        const message = {
            role: 'tool',
            content: 'some result',
            tool_call_id: 'call_xyz',
        };
        // Called twice: once for content, once for tool_call_id
        const result = (0, token_counter_1.countMessageTokens)(message, mockCounter, 3);
        (0, vitest_1.expect)(mockCounter).toHaveBeenCalledTimes(2);
        (0, vitest_1.expect)(result).toBe(5 + 5 + 3); // content + id + overhead
    });
    (0, vitest_1.it)('handles array content: text parts summed, image parts use IMAGE_TOKEN_COST', () => {
        // Simulate array content by casting through unknown
        const imageTokenCost = 85;
        const arrayContent = [
            { type: 'text', text: 'abcd' }, // ceil(4/4) = 1 token
            { type: 'image_url', url: 'http://example.com/img.png' }, // 85 tokens
            { type: 'text', text: 'efgh' }, // ceil(4/4) = 1 token
        ];
        const message = {
            role: 'user',
            content: arrayContent,
        };
        const result = (0, token_counter_1.countMessageTokens)(message, token_counter_1.approximateTokenCounter, 4);
        (0, vitest_1.expect)(result).toBe(1 + imageTokenCost + 1 + 4); // 91
    });
    (0, vitest_1.it)('handles array content with only text parts', () => {
        const arrayContent = [
            { type: 'text', text: 'hello' }, // ceil(5/4) = 2
            { type: 'text', text: 'world' }, // ceil(5/4) = 2
        ];
        const message = {
            role: 'user',
            content: arrayContent,
        };
        const result = (0, token_counter_1.countMessageTokens)(message, token_counter_1.approximateTokenCounter, 4);
        (0, vitest_1.expect)(result).toBe(2 + 2 + 4); // 8
    });
    (0, vitest_1.it)('handles array content with undefined type (treated as text)', () => {
        const arrayContent = [{ text: 'abcdefgh' }]; // ceil(8/4) = 2
        const message = {
            role: 'user',
            content: arrayContent,
        };
        const result = (0, token_counter_1.countMessageTokens)(message, token_counter_1.approximateTokenCounter, 4);
        (0, vitest_1.expect)(result).toBe(2 + 4); // 6
    });
});
//# sourceMappingURL=token-counter.test.js.map