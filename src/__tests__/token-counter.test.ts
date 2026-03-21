import { describe, it, expect, vi } from 'vitest';
import {
  approximateTokenCounter,
  countMessageTokens,
  DEFAULT_MESSAGE_OVERHEAD,
} from '../token-counter';
import type { Message } from '../types';

describe('approximateTokenCounter', () => {
  it('returns 0 for empty string', () => {
    expect(approximateTokenCounter('')).toBe(0);
  });

  it('returns 1 for single character (ceil(1/4))', () => {
    expect(approximateTokenCounter('a')).toBe(1);
  });

  it('returns 1 for exactly 4 characters', () => {
    expect(approximateTokenCounter('abcd')).toBe(1);
  });

  it('returns 2 for 5 characters (ceil(5/4))', () => {
    expect(approximateTokenCounter('abcde')).toBe(2);
  });

  it('returns 25 for 100-character string', () => {
    const str = 'a'.repeat(100);
    expect(approximateTokenCounter(str)).toBe(25);
  });
});

describe('DEFAULT_MESSAGE_OVERHEAD', () => {
  it('is 4', () => {
    expect(DEFAULT_MESSAGE_OVERHEAD).toBe(4);
  });
});

describe('countMessageTokens', () => {
  it('counts basic string content plus overhead', () => {
    const message: Message = { role: 'user', content: 'abcd' }; // 1 token
    const result = countMessageTokens(message, approximateTokenCounter, 4);
    expect(result).toBe(1 + 4); // 5
  });

  it('returns messageOverhead for empty content', () => {
    const message: Message = { role: 'user', content: '' };
    const result = countMessageTokens(message, approximateTokenCounter, 4);
    expect(result).toBe(4);
  });

  it('adds tool_calls JSON token cost', () => {
    const message: Message = {
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
    const expectedToolTokens = approximateTokenCounter(toolCallsJson);
    const result = countMessageTokens(message, approximateTokenCounter, 4);
    expect(result).toBe(0 + expectedToolTokens + 4);
  });

  it('adds tool_call_id token cost', () => {
    const message: Message = {
      role: 'tool',
      content: 'result',
      tool_call_id: 'call_abc123',
    };
    const contentTokens = approximateTokenCounter('result'); // ceil(6/4) = 2
    const idTokens = approximateTokenCounter('call_abc123'); // ceil(11/4) = 3
    const result = countMessageTokens(message, approximateTokenCounter, 4);
    expect(result).toBe(contentTokens + idTokens + 4);
  });

  it('uses custom tokenCounter', () => {
    const mockCounter = vi.fn().mockReturnValue(10);
    const message: Message = { role: 'user', content: 'hello world' };
    const result = countMessageTokens(message, mockCounter, 2);
    expect(mockCounter).toHaveBeenCalledWith('hello world');
    expect(result).toBe(10 + 2);
  });

  it('uses custom tokenCounter with tool_calls and tool_call_id', () => {
    const mockCounter = vi.fn().mockReturnValue(5);
    const message: Message = {
      role: 'tool',
      content: 'some result',
      tool_call_id: 'call_xyz',
    };
    // Called twice: once for content, once for tool_call_id
    const result = countMessageTokens(message, mockCounter, 3);
    expect(mockCounter).toHaveBeenCalledTimes(2);
    expect(result).toBe(5 + 5 + 3); // content + id + overhead
  });

  it('handles array content: text parts summed, image parts use IMAGE_TOKEN_COST', () => {
    // Simulate array content by casting through unknown
    const imageTokenCost = 85;
    const arrayContent = [
      { type: 'text', text: 'abcd' },       // ceil(4/4) = 1 token
      { type: 'image_url', url: 'http://example.com/img.png' }, // 85 tokens
      { type: 'text', text: 'efgh' },       // ceil(4/4) = 1 token
    ];
    const message = {
      role: 'user' as const,
      content: arrayContent as unknown as string,
    };
    const result = countMessageTokens(message, approximateTokenCounter, 4);
    expect(result).toBe(1 + imageTokenCost + 1 + 4); // 91
  });

  it('handles array content with only text parts', () => {
    const arrayContent = [
      { type: 'text', text: 'hello' },   // ceil(5/4) = 2
      { type: 'text', text: 'world' },   // ceil(5/4) = 2
    ];
    const message = {
      role: 'user' as const,
      content: arrayContent as unknown as string,
    };
    const result = countMessageTokens(message, approximateTokenCounter, 4);
    expect(result).toBe(2 + 2 + 4); // 8
  });

  it('handles array content with undefined type (treated as text)', () => {
    const arrayContent = [{ text: 'abcdefgh' }]; // ceil(8/4) = 2
    const message = {
      role: 'user' as const,
      content: arrayContent as unknown as string,
    };
    const result = countMessageTokens(message, approximateTokenCounter, 4);
    expect(result).toBe(2 + 4); // 6
  });
});
