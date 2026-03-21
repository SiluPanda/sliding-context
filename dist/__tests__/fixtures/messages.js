"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.longConversation = exports.shortConversation = exports.toolResultMessage = exports.toolCallMessage = exports.assistantMessage = exports.userMessage = exports.systemMessage = void 0;
exports.systemMessage = {
    role: 'system',
    content: 'You are a helpful assistant.',
};
exports.userMessage = {
    role: 'user',
    content: 'Hello!',
};
exports.assistantMessage = {
    role: 'assistant',
    content: 'Hi there!',
};
exports.toolCallMessage = {
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
exports.toolResultMessage = {
    role: 'tool',
    content: 'The weather in London is 15°C and cloudy.',
    tool_call_id: 'call_abc123',
};
exports.shortConversation = [
    exports.systemMessage,
    exports.userMessage,
    exports.assistantMessage,
];
exports.longConversation = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message number ${i + 1}`,
}));
//# sourceMappingURL=messages.js.map