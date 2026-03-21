import { describe, it, expect } from 'vitest';
import type {
  Message,
  ToolCall,
  SlidingContextOptions,
  ContextState,
} from '../types';

describe('types', () => {
  describe('Message', () => {
    it('accepts role: system', () => {
      const msg: Message = { role: 'system', content: 'You are helpful.' };
      expect(msg.role).toBe('system');
      expect(msg.content).toBe('You are helpful.');
    });

    it('accepts role: user', () => {
      const msg: Message = { role: 'user', content: 'Hello' };
      expect(msg.role).toBe('user');
    });

    it('accepts role: assistant', () => {
      const msg: Message = { role: 'assistant', content: 'Hi!' };
      expect(msg.role).toBe('assistant');
    });

    it('accepts role: tool', () => {
      const msg: Message = { role: 'tool', content: 'result data', tool_call_id: 'call_1' };
      expect(msg.role).toBe('tool');
      expect(msg.tool_call_id).toBe('call_1');
    });

    it('accepts optional tool_calls', () => {
      const msg: Message = {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'fn', arguments: '{}' } },
        ],
      };
      expect(msg.tool_calls).toHaveLength(1);
    });

    it('accepts optional name field', () => {
      const msg: Message = { role: 'user', content: 'hi', name: 'alice' };
      expect(msg.name).toBe('alice');
    });
  });

  describe('ToolCall', () => {
    it('has correct shape', () => {
      const tc: ToolCall = {
        id: 'call_xyz',
        type: 'function',
        function: { name: 'search', arguments: '{"q":"test"}' },
      };
      expect(tc.id).toBe('call_xyz');
      expect(tc.type).toBe('function');
      expect(tc.function.name).toBe('search');
      expect(tc.function.arguments).toBe('{"q":"test"}');
    });
  });

  describe('SlidingContextOptions', () => {
    it('requires only tokenBudget', () => {
      const opts: SlidingContextOptions = { tokenBudget: 4096 };
      expect(opts.tokenBudget).toBe(4096);
    });

    it('accepts all optional fields', () => {
      const opts: SlidingContextOptions = {
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
      expect(opts.tokenBudget).toBe(8192);
      expect(opts.strategy).toBe('incremental');
      expect(opts.summaryRole).toBe('system');
    });
  });

  describe('ContextState', () => {
    it('version is literal 1', () => {
      const state: ContextState = {
        options: { tokenBudget: 4096 },
        messages: [],
        summary: undefined,
        anchor: [],
        pendingBuffer: [],
        summaryRounds: 0,
        tokenCounts: {},
        version: 1,
      };
      expect(state.version).toBe(1);
    });
  });
});
