import type { Message } from '../../types';

export const systemMessage: Message = {
  role: 'system',
  content: 'You are a helpful assistant.',
};

export const userMessage: Message = {
  role: 'user',
  content: 'Hello!',
};

export const assistantMessage: Message = {
  role: 'assistant',
  content: 'Hi there!',
};

export const toolCallMessage: Message = {
  role: 'assistant',
  content: '',
  tool_calls: [
    {
      id: 'call_abc123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"location":"London"}',
      },
    },
  ],
};

export const toolResultMessage: Message = {
  role: 'tool',
  content: 'The weather in London is 15°C and cloudy.',
  tool_call_id: 'call_abc123',
};

export const shortConversation: Message[] = [
  systemMessage,
  userMessage,
  assistantMessage,
];

export const longConversation: Message[] = Array.from({ length: 20 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `Message number ${i + 1}`,
} as Message));
