/**
 * Tool Selection Types
 * 
 * Types for dynamic tool selection approach where the LLM selects
 * from available tools provided by Home Assistant.
 */

import type { OllamaTool, OllamaMessage } from './ollama.js';

/**
 * Result of LLM tool selection
 */
export interface ToolSelection {
  /** Name of the selected tool (e.g., "HassTurnOn", "HassLightSet") */
  tool_name: string;
  
  /** Arguments for the tool as key-value pairs */
  arguments: Record<string, any>;
}

/**
 * Extended extraction result with tool information
 */
export interface ExtractionResult {
  /** System context (YAML device list from HA) */
  systemContext: string;
  
  /** Full conversation history (replaces userMessage) */
  conversationHistory: OllamaMessage[];
  
  /** Available tools from HA request */
  availableTools: OllamaTool[];
  
  /** Whether this is a repeated request (HA循環) */
  isRepeatedRequest: boolean;
  
  /** Whether this is a query tool result that needs an answer */
  hasQueryToolResult: boolean;
  
  /** The tool result content if hasQueryToolResult is true */
  toolResultContent: string | undefined;
}
