/**
 * ConversationHelper
 * 
 * Utility class for handling conversation history in Ollama-compatible format.
 * Provides helper methods for extracting, formatting, and building prompts
 * from conversation history.
 * 
 * All methods are static as they are stateless utilities.
 */

import type { OllamaMessage } from '../types/ollama.js';

export interface FormatHistoryOptions {
  maxMessages?: number;
  includeToolCalls?: boolean;
  includeToolResults?: boolean;
}

export interface BuildPromptOptions {
  includeDateTime?: boolean;
  maxHistoryMessages?: number;
}

export class ConversationHelper {
  /**
   * Get the last user message from conversation history
   * 
   * @param conversationHistory - Array of conversation messages
   * @returns The content of the last user message, or empty string if none found
   * 
   * @example
   * const lastMessage = ConversationHelper.getLastUserMessage([
   *   {role: 'user', content: 'Hello'},
   *   {role: 'assistant', content: 'Hi!'},
   *   {role: 'user', content: 'How are you?'}
   * ]);
   * // Returns: "How are you?"
   */
  static getLastUserMessage(conversationHistory: OllamaMessage[]): string {
    const userMessages = conversationHistory.filter(msg => msg.role === 'user');
    if (userMessages.length === 0) {
      return '';
    }
    const lastMessage = userMessages[userMessages.length - 1];
    return lastMessage?.content || '';
  }

  /**
   * Format conversation history as readable text
   * 
   * @param history - Conversation history to format
   * @param options - Formatting options
   * @returns Formatted conversation text with role prefixes
   * 
   * @example
   * const formatted = ConversationHelper.formatConversationHistory(
   *   [{role: 'user', content: 'Hello'}, {role: 'assistant', content: 'Hi!'}],
   *   {maxMessages: 10}
   * );
   * // Returns: "User: Hello\nAssistant: Hi!"
   */
  static formatConversationHistory(
    history: OllamaMessage[],
    options?: FormatHistoryOptions
  ): string {
    const {
      maxMessages,
      includeToolCalls = true,
      includeToolResults = false,
    } = options || {};

    const messagesToUse = maxMessages 
      ? history.slice(-maxMessages) 
      : history;
    
    return messagesToUse
      .map(msg => {
        if (msg.role === 'user') {
          return `User: ${msg.content}`;
        } else if (msg.role === 'assistant') {
          // If assistant has tool_calls, show that instead of empty content
          if (msg.tool_calls && msg.tool_calls.length > 0 && includeToolCalls) {
            const toolCall = msg.tool_calls[0];
            if (toolCall) {
              return `Assistant: [Called ${toolCall.function.name}]`;
            }
          }
          return msg.content ? `Assistant: ${msg.content}` : '';
        } else if (msg.role === 'tool' && includeToolResults) {
          return `[Tool Result: ${msg.content}]`;
        }
        return '';
      })
      .filter(line => line.length > 0)
      .join('\n');
  }

  /**
   * Build conversation prompt for LLM with system context and history
   * 
   * @param conversationHistory - Conversation history
   * @param systemContext - System prompt/context
   * @param options - Build options
   * @returns Complete prompt ready for LLM
   * 
   * @example
   * const prompt = ConversationHelper.buildConversationPrompt(
   *   conversationHistory,
   *   "You are a helpful assistant",
   *   {includeDateTime: true}
   * );
   */
  static buildConversationPrompt(
    conversationHistory: OllamaMessage[],
    systemContext?: string,
    options?: BuildPromptOptions
  ): string {
    const {
      includeDateTime = true,
      maxHistoryMessages,
    } = options || {};

    const conversationPrompt = systemContext || 
      `You are a helpful AI assistant. Respond naturally and concisely.`;
    
    let prompt = conversationPrompt;

    if (includeDateTime) {
      const now = new Date();
      const utcTime = now.toISOString();
      prompt += `\n\nCurrent Date and Time (UTC): ${utcTime}`;
    }

    const historyOptions: FormatHistoryOptions = { 
      includeToolResults: true,
      includeToolCalls: true,
    };
    if (maxHistoryMessages !== undefined) {
      historyOptions.maxMessages = maxHistoryMessages;
    }

    const historyText = this.formatConversationHistory(
      conversationHistory,
      historyOptions
    );

    if (historyText) {
      prompt += `\n\nConversation History:\n${historyText}`;
    }

    return prompt;
  }

  /**
   * Build recent conversation context for tool selection
   * Returns formatted recent messages for context-aware tool selection
   * 
   * @param conversationHistory - Full conversation history
   * @param maxMessages - Maximum number of recent messages to include (default: 10)
   * @returns Formatted context string, or empty if no relevant history
   * 
   * @example
   * const context = ConversationHelper.buildToolSelectionContext(history, 10);
   * // Returns: "\nRecent Conversation Context:\nUser: turn on light\nAssistant: [Executed HassTurnOn]\n"
   */
  static buildToolSelectionContext(
    conversationHistory: OllamaMessage[],
    maxMessages: number = 10
  ): string {
    if (conversationHistory.length <= 1) {
      return '';
    }

    const recentHistory = conversationHistory.slice(-maxMessages);
    
    const context = recentHistory
      .map(msg => {
        if (msg.role === 'user') {
          return `User: ${msg.content}`;
        } else if (msg.role === 'assistant') {
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            const toolCall = msg.tool_calls[0];
            if (toolCall) {
              const args = JSON.stringify(toolCall.function.arguments);
              return `Assistant: [Executed ${toolCall.function.name}(${args})]`;
            }
          }
          return msg.content ? `Assistant: ${msg.content}` : '';
        }
        return '';
      })
      .filter(line => line.length > 0)
      .join('\n');
    
    return context ? `\nRecent Conversation Context:\n${context}\n` : '';
  }

  /**
   * Get original user request before tool execution
   * Useful for generating completion messages after tool execution
   * 
   * @param conversationHistory - Conversation history
   * @returns The last user message content, or empty string
   * 
   * @example
   * // History: [user: "turn on light", assistant: [tool_call], tool: "OK"]
   * const request = ConversationHelper.getOriginalUserRequest(history);
   * // Returns: "turn on light"
   */
  static getOriginalUserRequest(conversationHistory: OllamaMessage[]): string {
    // Find the last user message before the tool was executed
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const msg = conversationHistory[i];
      if (msg && msg.role === 'user') {
        return msg.content || '';
      }
    }
    return '';
  }

  /**
   * Count messages by role in conversation history
   * Useful for debugging and logging
   * 
   * @param conversationHistory - Conversation history
   * @returns Object with counts by role
   */
  static countMessagesByRole(conversationHistory: OllamaMessage[]): {
    user: number;
    assistant: number;
    tool: number;
    total: number;
  } {
    const counts = {
      user: 0,
      assistant: 0,
      tool: 0,
      total: conversationHistory.length,
    };

    for (const msg of conversationHistory) {
      if (msg.role === 'user') counts.user++;
      else if (msg.role === 'assistant') counts.assistant++;
      else if (msg.role === 'tool') counts.tool++;
    }

    return counts;
  }
}
