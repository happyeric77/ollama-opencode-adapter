/**
 * Unified Response Generation Types
 * 
 * Types for unified response generation approach where the LLM decides
 * whether to call a tool, generate an answer, or chat conversationally.
 * 
 * This replaces the previous tool-selection-only approach.
 */

import type { OllamaTool, OllamaMessage } from './ollama.js';

/**
 * Unified response from LLM
 * 
 * The LLM can return one of three action types:
 * - tool_call: Call a specific tool with arguments
 * - answer: Generate a natural language answer (e.g., based on tool results)
 * - chat: Respond conversationally (e.g., greetings, small talk)
 */
export type UnifiedResponse = 
  | ToolCallResponse
  | AnswerResponse
  | ChatResponse;

/**
 * Tool call response - LLM wants to call a tool
 */
export interface ToolCallResponse {
  /** Action type identifier */
  action: "tool_call";
  
  /** Name of the tool to call (e.g., "TurnOnLight", "GetLiveContext") */
  tool_name: string;
  
  /** Arguments for the tool as key-value pairs */
  arguments: Record<string, any>;
}

/**
 * Answer response - LLM generates an answer based on context (e.g., tool results)
 */
export interface AnswerResponse {
  /** Action type identifier */
  action: "answer";
  
  /** Natural language answer in user's language */
  content: string;
}

/**
 * Chat response - LLM responds conversationally
 */
export interface ChatResponse {
  /** Action type identifier */
  action: "chat";
  
  /** Conversational response in user's language */
  content: string;
}

/**
 * Extraction result from Ollama request
 * 
 * Simplified from previous version - removed repeated request detection
 * and query tool result handling as these are now handled by the unified
 * response generation logic.
 */
export interface ExtractionResult {
  /** System context (e.g., YAML device list from HA) */
  systemContext: string;
  
  /** Full conversation history */
  conversationHistory: OllamaMessage[];
  
  /** Available tools from client request */
  availableTools: OllamaTool[];
}

/**
 * Legacy type for backward compatibility during migration
 * @deprecated Use UnifiedResponse instead
 */
export interface ToolSelection {
  tool_name: string;
  arguments: Record<string, any>;
}
