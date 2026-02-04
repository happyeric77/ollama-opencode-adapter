/**
 * Unit tests for Ollama adapter with unified response
 */

import { describe, it, expect } from 'vitest';
import {
  extractMessagesAndTools,
  convertUnifiedResponseToOllama,
  convertErrorToOllama,
} from '../../src/adapters/ollamaAdapter.js';
import type { OllamaChatRequest, OllamaTool } from '../../src/types/ollama.js';
import type {
  UnifiedResponse,
  ToolCallResponse,
  AnswerResponse,
  ChatResponse,
} from '../../src/types/tool-selection.js';

// Sample tools for testing (mimicking HA's tools)
const sampleTools: OllamaTool[] = [
  {
    type: 'function',
    function: {
      name: 'TurnOnLight',
      description: 'Turns on/opens a light',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          entity: { type: 'string', description: 'Entity ID of light' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TurnOffLight',
      description: 'Turns off/closes a light',
      parameters: {
        type: 'object',
        required: [],
        properties: {
          entity: { type: 'string', description: 'Entity ID of light' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'GetLiveContext',
      description: 'Get current status of devices',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

describe('Ollama Adapter - Unified Response', () => {
  describe('extractMessagesAndTools', () => {
    it('should extract system context and conversation history', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful home assistant.',
          },
          {
            role: 'user',
            content: 'Turn on the living room light',
          },
        ],
        tools: sampleTools,
      };

      const result = extractMessagesAndTools(request);

      expect(result.systemContext).toBe('You are a helpful home assistant.');
      expect(result.conversationHistory).toHaveLength(1);
      expect(result.conversationHistory[0].role).toBe('user');
      expect(result.conversationHistory[0].content).toBe(
        'Turn on the living room light',
      );
      expect(result.availableTools).toHaveLength(3);
      expect(result.availableTools[0].function.name).toBe('TurnOnLight');
    });

    it('should handle request without tools', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const result = extractMessagesAndTools(request);

      expect(result.availableTools).toHaveLength(0);
      expect(result.conversationHistory).toHaveLength(1);
      expect(result.conversationHistory[0].content).toBe('Hello');
    });

    it('should preserve full conversation history', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'Turn on light' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { function: { name: 'TurnOnLight', arguments: { entity: 'light.living_room' } } },
            ],
          },
          { role: 'tool', content: 'Light turned on successfully' },
          { role: 'user', content: 'Is the light on?' },
        ],
        tools: sampleTools,
      };

      const result = extractMessagesAndTools(request);

      expect(result.systemContext).toBe('System prompt');
      expect(result.conversationHistory).toHaveLength(4); // Excludes system
      expect(result.conversationHistory[0].role).toBe('user');
      expect(result.conversationHistory[1].role).toBe('assistant');
      expect(result.conversationHistory[2].role).toBe('tool');
      expect(result.conversationHistory[3].role).toBe('user');
    });

    it('should handle multiple system messages', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Context line 1' },
          { role: 'system', content: 'Context line 2' },
          { role: 'user', content: 'Test message' },
        ],
        tools: [],
      };

      const result = extractMessagesAndTools(request);

      expect(result.systemContext).toBe('Context line 1\nContext line 2');
      expect(result.conversationHistory).toHaveLength(1);
      expect(result.conversationHistory[0].content).toBe('Test message');
    });

    it('should handle empty tools array', () => {
      const request: OllamaChatRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
      };

      const result = extractMessagesAndTools(request);

      expect(result.availableTools).toHaveLength(0);
    });
  });

  describe('convertUnifiedResponseToOllama', () => {
    describe('ToolCallResponse', () => {
      it('should convert tool_call to Ollama response', () => {
        const unifiedResponse: ToolCallResponse = {
          action: 'tool_call',
          tool_name: 'TurnOnLight',
          arguments: {
            entity: 'light.living_room',
          },
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        expect(response.model).toBe('gpt-4o');
        expect(response.done).toBe(true);
        expect(response.done_reason).toBe('stop');
        expect(response.message.role).toBe('assistant');
        expect(response.message.content).toBe(''); // Empty during tool execution
        expect(response.message.tool_calls).toBeDefined();
        expect(response.message.tool_calls).toHaveLength(1);

        const toolCall = response.message.tool_calls![0];
        expect(toolCall.function.name).toBe('TurnOnLight');

        // CRITICAL: arguments must be an Object, not a string
        expect(typeof toolCall.function.arguments).toBe('object');
        expect(toolCall.function.arguments).toEqual({
          entity: 'light.living_room',
        });

        // Check timing metadata is in nanoseconds
        expect(response.total_duration).toBe(100 * 1_000_000);
        expect(response.eval_duration).toBe(100 * 1_000_000);
        expect(response.eval_count).toBe(1);
      });

      it('should handle tool call with empty arguments', () => {
        const unifiedResponse: ToolCallResponse = {
          action: 'tool_call',
          tool_name: 'GetLiveContext',
          arguments: {},
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        expect(response.message.tool_calls).toBeDefined();
        expect(response.message.tool_calls).toHaveLength(1);
        expect(response.message.tool_calls![0].function.arguments).toEqual({});
      });

      it('should handle tool call with complex nested arguments', () => {
        const unifiedResponse: ToolCallResponse = {
          action: 'tool_call',
          tool_name: 'ComplexTool',
          arguments: {
            entity: 'light.living_room',
            config: {
              brightness: 100,
              color: 'red',
            },
            tags: ['home', 'automation'],
          },
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        const toolCall = response.message.tool_calls![0];
        expect(toolCall.function.arguments).toEqual({
          entity: 'light.living_room',
          config: {
            brightness: 100,
            color: 'red',
          },
          tags: ['home', 'automation'],
        });
      });
    });

    describe('AnswerResponse', () => {
      it('should convert answer to Ollama response', () => {
        const unifiedResponse: AnswerResponse = {
          action: 'answer',
          content: 'The living room light is currently on.',
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        expect(response.model).toBe('gpt-4o');
        expect(response.done).toBe(true);
        expect(response.done_reason).toBe('stop');
        expect(response.message.role).toBe('assistant');
        expect(response.message.content).toBe('The living room light is currently on.');
        expect(response.message.tool_calls).toBeUndefined();

        // Check timing metadata
        expect(response.total_duration).toBe(100 * 1_000_000);
        expect(response.eval_duration).toBe(100 * 1_000_000);
        expect(response.eval_count).toBe(1);
      });

      it('should handle multi-language answers', () => {
        const testCases = [
          {
            lang: 'Chinese',
            content: '客廳的燈現在是開著的。',
          },
          {
            lang: 'Japanese',
            content: 'リビングのライトがついています。',
          },
          {
            lang: 'English',
            content: 'The living room light is on.',
          },
        ];

        testCases.forEach(({ lang, content }) => {
          const unifiedResponse: AnswerResponse = {
            action: 'answer',
            content,
          };

          const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

          expect(response.message.content).toBe(content);
          expect(response.message.tool_calls).toBeUndefined();
        });
      });

      it('should handle empty answer content', () => {
        const unifiedResponse: AnswerResponse = {
          action: 'answer',
          content: '',
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        expect(response.message.content).toBe('');
        expect(response.message.tool_calls).toBeUndefined();
      });
    });

    describe('ChatResponse', () => {
      it('should convert chat to Ollama response', () => {
        const unifiedResponse: ChatResponse = {
          action: 'chat',
          content: 'Hello! How can I help you today?',
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        expect(response.model).toBe('gpt-4o');
        expect(response.done).toBe(true);
        expect(response.done_reason).toBe('stop');
        expect(response.message.role).toBe('assistant');
        expect(response.message.content).toBe('Hello! How can I help you today?');
        expect(response.message.tool_calls).toBeUndefined();

        // Check timing metadata
        expect(response.total_duration).toBe(100 * 1_000_000);
        expect(response.eval_duration).toBe(100 * 1_000_000);
        expect(response.eval_count).toBe(1);
      });

      it('should handle conversational greetings', () => {
        const greetings = [
          'Hello!',
          '你好！',
          'こんにちは！',
          'Bonjour!',
        ];

        greetings.forEach((greeting) => {
          const unifiedResponse: ChatResponse = {
            action: 'chat',
            content: greeting,
          };

          const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

          expect(response.message.content).toBe(greeting);
          expect(response.message.tool_calls).toBeUndefined();
        });
      });
    });

    describe('Timing Metadata', () => {
      it('should convert milliseconds to nanoseconds correctly', () => {
        const response: UnifiedResponse = {
          action: 'chat',
          content: 'Test',
        };

        const result = convertUnifiedResponseToOllama(response, 'gpt-4o', 123);

        expect(result.total_duration).toBe(123 * 1_000_000);
        expect(result.eval_duration).toBe(123 * 1_000_000);
        expect(result.eval_count).toBe(1);
      });

      it('should have valid ISO 8601 created_at timestamp', () => {
        const response: UnifiedResponse = {
          action: 'chat',
          content: 'Test',
        };

        const result = convertUnifiedResponseToOllama(response, 'gpt-4o', 100);

        const date = new Date(result.created_at);
        expect(date.toISOString()).toBe(result.created_at);
      });
    });

    describe('Real-world Scenarios', () => {
      it('should handle action command scenario', () => {
        // User: "Turn on the living room light"
        const unifiedResponse: ToolCallResponse = {
          action: 'tool_call',
          tool_name: 'TurnOnLight',
          arguments: { entity: 'light.living_room' },
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        expect(response.message.tool_calls).toBeDefined();
        expect(response.message.tool_calls![0].function.name).toBe('TurnOnLight');
        expect(response.message.content).toBe(''); // Empty during execution
      });

      it('should handle query with tool result scenario', () => {
        // LLM generates answer based on tool result
        const unifiedResponse: AnswerResponse = {
          action: 'answer',
          content: 'Yes, the living room light is currently on.',
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        expect(response.message.content).toContain('light');
        expect(response.message.content).toContain('on');
        expect(response.message.tool_calls).toBeUndefined();
      });

      it('should handle greeting scenario', () => {
        // User: "Hello"
        const unifiedResponse: ChatResponse = {
          action: 'chat',
          content: 'Hello! How can I help you today?',
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        expect(response.message.content).toContain('Hello');
        expect(response.message.tool_calls).toBeUndefined();
      });

      it('should handle repeated action without assuming state', () => {
        // User repeats: "Turn on light" (5 minutes later, might be off)
        // System should call tool again, not assume it's still on
        const unifiedResponse: ToolCallResponse = {
          action: 'tool_call',
          tool_name: 'TurnOnLight',
          arguments: { entity: 'light.living_room' },
        };

        const response = convertUnifiedResponseToOllama(unifiedResponse, 'gpt-4o', 100);

        // Should still return tool call, not assume state
        expect(response.message.tool_calls).toBeDefined();
        expect(response.message.tool_calls![0].function.name).toBe('TurnOnLight');
      });
    });
  });

  describe('convertErrorToOllama', () => {
    it('should convert error to Ollama response format', () => {
      const error = new Error('Test error message');
      const response = convertErrorToOllama(error, 'gpt-4o');

      expect(response.model).toBe('gpt-4o');
      expect(response.done).toBe(true);
      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toBe('Error: Test error message');
      expect(response.message.tool_calls).toBeUndefined();
    });

    it('should handle error with special characters', () => {
      const error = new Error('Error: 無法連接 / Connection failed');
      const response = convertErrorToOllama(error, 'gpt-4o');

      expect(response.message.content).toContain('無法連接');
      expect(response.message.content).toContain('Connection failed');
    });
  });
});
