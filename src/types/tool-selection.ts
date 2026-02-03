/**
 * Tool Selection Types
 * 
 * Types for dynamic tool selection approach where the LLM selects
 * from available tools provided by Home Assistant.
 */

import type { OllamaTool } from './ollama.js';

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
  
  /** User's message/command */
  userMessage: string;
  
  /** Available tools from HA request */
  availableTools: OllamaTool[];
  
  /** Whether this is a repeated request (HA循環) */
  isRepeatedRequest: boolean;
}
