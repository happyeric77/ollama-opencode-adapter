/**
 * Unit tests for Unified Response Types
 * 
 * Tests the new type system for unified response generation.
 */

import { describe, it, expect } from 'vitest';
import type {
  UnifiedResponse,
  ToolCallResponse,
  AnswerResponse,
  ChatResponse,
} from '../../src/types/tool-selection.js';

describe('UnifiedResponse Types', () => {
  describe('ToolCallResponse', () => {
    it('should have correct structure for tool call', () => {
      const response: ToolCallResponse = {
        action: 'tool_call',
        tool_name: 'TurnOnLight',
        arguments: { entity: 'light.living_room' },
      };

      expect(response.action).toBe('tool_call');
      expect(response.tool_name).toBe('TurnOnLight');
      expect(response.arguments).toEqual({ entity: 'light.living_room' });
    });

    it('should allow empty arguments object', () => {
      const response: ToolCallResponse = {
        action: 'tool_call',
        tool_name: 'GetLiveContext',
        arguments: {},
      };

      expect(response.action).toBe('tool_call');
      expect(response.tool_name).toBe('GetLiveContext');
      expect(response.arguments).toEqual({});
    });

    it('should allow complex nested arguments', () => {
      const response: ToolCallResponse = {
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

      expect(response.arguments).toHaveProperty('entity');
      expect(response.arguments).toHaveProperty('config');
      expect(response.arguments.config).toHaveProperty('brightness', 100);
      expect(response.arguments.tags).toContain('home');
    });
  });

  describe('AnswerResponse', () => {
    it('should have correct structure for answer', () => {
      const response: AnswerResponse = {
        action: 'answer',
        content: 'The living room light is currently on.',
      };

      expect(response.action).toBe('answer');
      expect(response.content).toBe('The living room light is currently on.');
    });

    it('should support multi-language content', () => {
      const responses: AnswerResponse[] = [
        {
          action: 'answer',
          content: 'The light is on.',
        },
        {
          action: 'answer',
          content: '客廳的燈現在是開著的。',
        },
        {
          action: 'answer',
          content: 'リビングのライトがついています。',
        },
      ];

      responses.forEach((response) => {
        expect(response.action).toBe('answer');
        expect(typeof response.content).toBe('string');
        expect(response.content.length).toBeGreaterThan(0);
      });
    });

    it('should allow empty content string', () => {
      const response: AnswerResponse = {
        action: 'answer',
        content: '',
      };

      expect(response.action).toBe('answer');
      expect(response.content).toBe('');
    });
  });

  describe('ChatResponse', () => {
    it('should have correct structure for chat', () => {
      const response: ChatResponse = {
        action: 'chat',
        content: 'Hello! How can I help you today?',
      };

      expect(response.action).toBe('chat');
      expect(response.content).toBe('Hello! How can I help you today?');
    });

    it('should support conversational content', () => {
      const greetings: ChatResponse[] = [
        {
          action: 'chat',
          content: 'Hello!',
        },
        {
          action: 'chat',
          content: '你好！',
        },
        {
          action: 'chat',
          content: 'こんにちは！',
        },
      ];

      greetings.forEach((response) => {
        expect(response.action).toBe('chat');
        expect(typeof response.content).toBe('string');
      });
    });
  });

  describe('UnifiedResponse Type Union', () => {
    it('should accept ToolCallResponse', () => {
      const response: UnifiedResponse = {
        action: 'tool_call',
        tool_name: 'TurnOnLight',
        arguments: {},
      };

      expect(response.action).toBe('tool_call');
      if (response.action === 'tool_call') {
        expect(response.tool_name).toBe('TurnOnLight');
        expect(response.arguments).toEqual({});
      }
    });

    it('should accept AnswerResponse', () => {
      const response: UnifiedResponse = {
        action: 'answer',
        content: 'The light is on.',
      };

      expect(response.action).toBe('answer');
      if (response.action === 'answer') {
        expect(response.content).toBe('The light is on.');
      }
    });

    it('should accept ChatResponse', () => {
      const response: UnifiedResponse = {
        action: 'chat',
        content: 'Hello!',
      };

      expect(response.action).toBe('chat');
      if (response.action === 'chat') {
        expect(response.content).toBe('Hello!');
      }
    });

    it('should allow type discrimination by action field', () => {
      const responses: UnifiedResponse[] = [
        { action: 'tool_call', tool_name: 'Test', arguments: {} },
        { action: 'answer', content: 'Answer' },
        { action: 'chat', content: 'Chat' },
      ];

      const toolCalls = responses.filter((r) => r.action === 'tool_call');
      const answers = responses.filter((r) => r.action === 'answer');
      const chats = responses.filter((r) => r.action === 'chat');

      expect(toolCalls).toHaveLength(1);
      expect(answers).toHaveLength(1);
      expect(chats).toHaveLength(1);
    });

    it('should support switch-case pattern matching', () => {
      const processResponse = (response: UnifiedResponse): string => {
        switch (response.action) {
          case 'tool_call':
            return `Calling tool: ${response.tool_name}`;
          case 'answer':
            return `Answering: ${response.content}`;
          case 'chat':
            return `Chatting: ${response.content}`;
          default:
            // TypeScript exhaustiveness check
            const _exhaustive: never = response;
            return `Unknown: ${_exhaustive}`;
        }
      };

      const response: UnifiedResponse = {
        action: 'tool_call',
        tool_name: 'Test',
        arguments: {},
      };

      const result = processResponse(response);
      expect(result).toBe('Calling tool: Test');
    });
  });

  describe('Type Safety', () => {
    it('should enforce action-specific properties via discriminated unions', () => {
      const toolCall: UnifiedResponse = {
        action: 'tool_call',
        tool_name: 'Test',
        arguments: {},
      };

      // TypeScript should enforce that tool_call has tool_name and arguments
      expect(toolCall.action).toBe('tool_call');
      if (toolCall.action === 'tool_call') {
        expect(toolCall).toHaveProperty('tool_name');
        expect(toolCall).toHaveProperty('arguments');
      }
    });

    it('should enforce content property for answer and chat', () => {
      const answer: UnifiedResponse = {
        action: 'answer',
        content: 'Test answer',
      };

      const chat: UnifiedResponse = {
        action: 'chat',
        content: 'Test chat',
      };

      expect(answer.action).toBe('answer');
      if (answer.action === 'answer') {
        expect(answer).toHaveProperty('content');
      }

      expect(chat.action).toBe('chat');
      if (chat.action === 'chat') {
        expect(chat).toHaveProperty('content');
      }
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle action command scenario', () => {
      // User: "Turn on living room light"
      const response: UnifiedResponse = {
        action: 'tool_call',
        tool_name: 'TurnOnLight',
        arguments: { entity: 'light.living_room' },
      };

      expect(response.action).toBe('tool_call');
      if (response.action === 'tool_call') {
        expect(response.tool_name).toBe('TurnOnLight');
        expect(response.arguments.entity).toBe('light.living_room');
      }
    });

    it('should handle query with tool result scenario', () => {
      // Conversation has tool result, LLM generates answer
      const response: UnifiedResponse = {
        action: 'answer',
        content: 'Yes, the living room light is currently on.',
      };

      expect(response.action).toBe('answer');
      if (response.action === 'answer') {
        expect(response.content).toContain('light');
        expect(response.content).toContain('on');
      }
    });

    it('should handle greeting scenario', () => {
      // User: "Hello"
      const response: UnifiedResponse = {
        action: 'chat',
        content: 'Hello! How can I help you today?',
      };

      expect(response.action).toBe('chat');
      if (response.action === 'chat') {
        expect(response.content).toContain('Hello');
      }
    });

    it('should handle multi-language action', () => {
      // User: "開燈" (Turn on light in Chinese)
      const response: UnifiedResponse = {
        action: 'tool_call',
        tool_name: 'TurnOnLight',
        arguments: { entity: 'light.living_room' },
      };

      expect(response.action).toBe('tool_call');
    });

    it('should handle multi-language answer', () => {
      // Tool result processed, answer in Chinese
      const response: UnifiedResponse = {
        action: 'answer',
        content: '客廳的燈現在是開著的。',
      };

      expect(response.action).toBe('answer');
      if (response.action === 'answer') {
        expect(response.content).toBeTruthy();
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle tool call with no arguments', () => {
      const response: UnifiedResponse = {
        action: 'tool_call',
        tool_name: 'GetLiveContext',
        arguments: {},
      };

      expect(response.action).toBe('tool_call');
      if (response.action === 'tool_call') {
        expect(Object.keys(response.arguments)).toHaveLength(0);
      }
    });

    it('should handle empty content strings', () => {
      const answer: UnifiedResponse = {
        action: 'answer',
        content: '',
      };

      const chat: UnifiedResponse = {
        action: 'chat',
        content: '',
      };

      expect(answer.action).toBe('answer');
      expect(chat.action).toBe('chat');
    });

    it('should handle very long content', () => {
      const longContent = 'A'.repeat(10000);
      const response: UnifiedResponse = {
        action: 'answer',
        content: longContent,
      };

      expect(response.action).toBe('answer');
      if (response.action === 'answer') {
        expect(response.content.length).toBe(10000);
      }
    });

    it('should handle special characters in content', () => {
      const response: UnifiedResponse = {
        action: 'chat',
        content: '你好！こんにちは！Hello! 🌟✨🎉',
      };

      expect(response.action).toBe('chat');
      if (response.action === 'chat') {
        expect(response.content).toContain('🌟');
        expect(response.content).toContain('你好');
        expect(response.content).toContain('こんにちは');
      }
    });
  });
});
