/**
 * Unit tests for ConversationHelper
 * 
 * Tests all 6 static methods with various scenarios including:
 * - Empty history
 * - Single message
 * - Multiple messages
 * - Tool calls
 * - Tool results
 * - Edge cases
 */

import { describe, it, expect } from 'vitest';
import { ConversationHelper } from '../../src/services/conversationHelper.js';
import type { OllamaMessage } from '../../src/types/ollama.js';

describe('ConversationHelper', () => {
  // Test fixtures
  const emptyHistory: OllamaMessage[] = [];
  
  const singleUserMessage: OllamaMessage[] = [
    { role: 'user', content: 'Hello' }
  ];
  
  const basicConversation: OllamaMessage[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'How are you?' },
    { role: 'assistant', content: 'I am doing well, thanks!' }
  ];
  
  const conversationWithToolCall: OllamaMessage[] = [
    { role: 'user', content: 'Turn on the light' },
    { 
      role: 'assistant', 
      content: '',
      tool_calls: [{
        function: {
          name: 'HassTurnOn',
          arguments: { domain: ['light'], area: 'Living Room' }
        }
      }]
    },
    { role: 'tool', content: 'Light turned on successfully' },
    { role: 'assistant', content: 'I have turned on the light in the living room.' }
  ];
  
  const conversationWithMultipleToolCalls: OllamaMessage[] = [
    { role: 'user', content: 'Turn on the light' },
    { 
      role: 'assistant', 
      content: '',
      tool_calls: [{
        function: {
          name: 'HassTurnOn',
          arguments: { domain: ['light'], area: 'Living Room' }
        }
      }]
    },
    { role: 'tool', content: 'Light turned on' },
    { role: 'assistant', content: 'Light is on.' },
    { role: 'user', content: 'Now turn it off' },
    { 
      role: 'assistant', 
      content: '',
      tool_calls: [{
        function: {
          name: 'HassTurnOff',
          arguments: { domain: ['light'], area: 'Living Room' }
        }
      }]
    },
    { role: 'tool', content: 'Light turned off' },
    { role: 'assistant', content: 'Light is off.' }
  ];

  describe('getLastUserMessage', () => {
    it('should return empty string for empty history', () => {
      expect(ConversationHelper.getLastUserMessage(emptyHistory)).toBe('');
    });

    it('should return the user message for single message', () => {
      expect(ConversationHelper.getLastUserMessage(singleUserMessage)).toBe('Hello');
    });

    it('should return the last user message from conversation', () => {
      expect(ConversationHelper.getLastUserMessage(basicConversation)).toBe('How are you?');
    });

    it('should return the last user message when conversation has tool calls', () => {
      expect(ConversationHelper.getLastUserMessage(conversationWithToolCall)).toBe('Turn on the light');
    });

    it('should return the last user message from multiple tool interactions', () => {
      expect(ConversationHelper.getLastUserMessage(conversationWithMultipleToolCalls)).toBe('Now turn it off');
    });

    it('should return empty string for history with only assistant messages', () => {
      const assistantOnly: OllamaMessage[] = [
        { role: 'assistant', content: 'Hello' }
      ];
      expect(ConversationHelper.getLastUserMessage(assistantOnly)).toBe('');
    });
  });

  describe('formatConversationHistory', () => {
    it('should return empty string for empty history', () => {
      expect(ConversationHelper.formatConversationHistory(emptyHistory)).toBe('');
    });

    it('should format single user message', () => {
      const result = ConversationHelper.formatConversationHistory(singleUserMessage);
      expect(result).toBe('User: Hello');
    });

    it('should format basic conversation', () => {
      const result = ConversationHelper.formatConversationHistory(basicConversation);
      expect(result).toBe(
        'User: Hello\n' +
        'Assistant: Hi there!\n' +
        'User: How are you?\n' +
        'Assistant: I am doing well, thanks!'
      );
    });

    it('should show tool calls when includeToolCalls is true', () => {
      const result = ConversationHelper.formatConversationHistory(
        conversationWithToolCall,
        { includeToolCalls: true, includeToolResults: false }
      );
      expect(result).toContain('User: Turn on the light');
      expect(result).toContain('Assistant: [Called HassTurnOn]');
      expect(result).toContain('Assistant: I have turned on the light');
      expect(result).not.toContain('Tool Result');
    });

    it('should hide tool calls when includeToolCalls is false', () => {
      const result = ConversationHelper.formatConversationHistory(
        conversationWithToolCall,
        { includeToolCalls: false, includeToolResults: false }
      );
      expect(result).toContain('User: Turn on the light');
      expect(result).not.toContain('[Called HassTurnOn]');
      expect(result).toContain('Assistant: I have turned on the light');
    });

    it('should show tool results when includeToolResults is true', () => {
      const result = ConversationHelper.formatConversationHistory(
        conversationWithToolCall,
        { includeToolCalls: true, includeToolResults: true }
      );
      expect(result).toContain('[Tool Result: Light turned on successfully]');
    });

    it('should respect maxMessages option', () => {
      const result = ConversationHelper.formatConversationHistory(
        basicConversation,
        { maxMessages: 2 }
      );
      expect(result).toBe(
        'User: How are you?\n' +
        'Assistant: I am doing well, thanks!'
      );
      expect(result).not.toContain('Hello');
    });

    it('should handle empty assistant content gracefully', () => {
      const historyWithEmpty: OllamaMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: '' }
      ];
      const result = ConversationHelper.formatConversationHistory(historyWithEmpty);
      expect(result).toBe('User: Hello');
    });
  });

  describe('buildConversationPrompt', () => {
    it('should build prompt with default system context', () => {
      const result = ConversationHelper.buildConversationPrompt(
        singleUserMessage,
        undefined,
        { includeDateTime: false }
      );
      expect(result).toContain('You are a helpful AI assistant');
      expect(result).toContain('User: Hello');
    });

    it('should build prompt with custom system context', () => {
      const result = ConversationHelper.buildConversationPrompt(
        singleUserMessage,
        'You are a helpful AI assistant',
        { includeDateTime: false }
      );
      expect(result).toContain('You are a helpful AI assistant');
      expect(result).toContain('User: Hello');
    });

    it('should include date/time when includeDateTime is true', () => {
      const result = ConversationHelper.buildConversationPrompt(
        singleUserMessage,
        'Test context',
        { includeDateTime: true }
      );
      expect(result).toContain('Current Date and Time (UTC):');
      expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO date format
    });

    it('should not include date/time when includeDateTime is false', () => {
      const result = ConversationHelper.buildConversationPrompt(
        singleUserMessage,
        'Test context',
        { includeDateTime: false }
      );
      expect(result).not.toContain('Current Date and Time');
    });

    it('should respect maxHistoryMessages option', () => {
      const result = ConversationHelper.buildConversationPrompt(
        basicConversation,
        'Test',
        { includeDateTime: false, maxHistoryMessages: 2 }
      );
      expect(result).toContain('How are you?');
      expect(result).not.toContain('Hello');
    });

    it('should handle empty history gracefully', () => {
      const result = ConversationHelper.buildConversationPrompt(
        emptyHistory,
        'Test context',
        { includeDateTime: false }
      );
      expect(result).toBe('Test context');
    });
  });

  describe('buildToolSelectionContext', () => {
    it('should return empty for single message', () => {
      expect(ConversationHelper.buildToolSelectionContext(singleUserMessage)).toBe('');
    });

    it('should return empty for empty history', () => {
      expect(ConversationHelper.buildToolSelectionContext(emptyHistory)).toBe('');
    });

    it('should build context for basic conversation', () => {
      const result = ConversationHelper.buildToolSelectionContext(basicConversation);
      expect(result).toContain('Recent Conversation Context:');
      expect(result).toContain('User: Hello');
      expect(result).toContain('Assistant: Hi there!');
    });

    it('should include tool execution details', () => {
      const result = ConversationHelper.buildToolSelectionContext(conversationWithToolCall);
      expect(result).toContain('User: Turn on the light');
      expect(result).toContain('[Executed HassTurnOn');
      expect(result).toContain('"domain":["light"]');
      expect(result).toContain('"area":"Living Room"');
    });

    it('should respect maxMessages parameter', () => {
      const result = ConversationHelper.buildToolSelectionContext(
        conversationWithMultipleToolCalls,
        4  // Last 4 messages: user message, tool call, tool result, assistant response
      );
      expect(result).toContain('Now turn it off');
      expect(result).not.toContain('Turn on the light');
    });

    it('should use default maxMessages of 10', () => {
      const longHistory: OllamaMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));
      const result = ConversationHelper.buildToolSelectionContext(longHistory);
      expect(result).toContain('Message 14');
      expect(result).toContain('Message 5');
      expect(result).not.toContain('Message 4');
    });
  });

  describe('getOriginalUserRequest', () => {
    it('should return empty for empty history', () => {
      expect(ConversationHelper.getOriginalUserRequest(emptyHistory)).toBe('');
    });

    it('should return user message for single message', () => {
      expect(ConversationHelper.getOriginalUserRequest(singleUserMessage)).toBe('Hello');
    });

    it('should return last user message from basic conversation', () => {
      expect(ConversationHelper.getOriginalUserRequest(basicConversation)).toBe('How are you?');
    });

    it('should return original request before tool execution', () => {
      expect(ConversationHelper.getOriginalUserRequest(conversationWithToolCall)).toBe('Turn on the light');
    });

    it('should return most recent user request in multi-tool conversation', () => {
      expect(ConversationHelper.getOriginalUserRequest(conversationWithMultipleToolCalls)).toBe('Now turn it off');
    });

    it('should return empty for history with only assistant messages', () => {
      const assistantOnly: OllamaMessage[] = [
        { role: 'assistant', content: 'Hello' },
        { role: 'assistant', content: 'How can I help?' }
      ];
      expect(ConversationHelper.getOriginalUserRequest(assistantOnly)).toBe('');
    });
  });

  describe('countMessagesByRole', () => {
    it('should return zero counts for empty history', () => {
      const counts = ConversationHelper.countMessagesByRole(emptyHistory);
      expect(counts).toEqual({
        user: 0,
        assistant: 0,
        tool: 0,
        total: 0
      });
    });

    it('should count single user message', () => {
      const counts = ConversationHelper.countMessagesByRole(singleUserMessage);
      expect(counts).toEqual({
        user: 1,
        assistant: 0,
        tool: 0,
        total: 1
      });
    });

    it('should count basic conversation correctly', () => {
      const counts = ConversationHelper.countMessagesByRole(basicConversation);
      expect(counts).toEqual({
        user: 2,
        assistant: 2,
        tool: 0,
        total: 4
      });
    });

    it('should count conversation with tool calls', () => {
      const counts = ConversationHelper.countMessagesByRole(conversationWithToolCall);
      expect(counts).toEqual({
        user: 1,
        assistant: 2,
        tool: 1,
        total: 4
      });
    });

    it('should count multiple tool interactions', () => {
      const counts = ConversationHelper.countMessagesByRole(conversationWithMultipleToolCalls);
      expect(counts).toEqual({
        user: 2,
        assistant: 4,
        tool: 2,
        total: 8
      });
    });
  });
});
