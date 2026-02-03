/**
 * Ollama API Types
 * Based on: https://github.com/ollama/ollama/blob/main/docs/api.md
 */

/**
 * Message in a chat conversation
 */
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

/**
 * Tool call in Ollama format
 * Key difference from OpenAI: arguments is an Object, not a JSON string
 */
export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, any>; // Object, not string!
  };
}

/**
 * Tool definition in Ollama format
 */
export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

/**
 * Chat request to /api/chat
 */
export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  tools?: OllamaTool[];
  format?: string;
  options?: {
    temperature?: number;
    top_p?: number;
    seed?: number;
  };
}

/**
 * Chat response from /api/chat
 */
export interface OllamaChatResponse {
  model: string;
  created_at: string; // ISO 8601 format
  message: OllamaMessage;
  done: boolean;
  done_reason?: string;
  total_duration?: number; // nanoseconds
  load_duration?: number; // nanoseconds
  prompt_eval_count?: number;
  prompt_eval_duration?: number; // nanoseconds
  eval_count?: number;
  eval_duration?: number; // nanoseconds
}

/**
 * Model information for /api/tags
 */
export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string; // ISO 8601 format
  size: number; // bytes
  digest: string;
  details: {
    parent_model?: string;
    format: string;
    family: string;
    families?: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

/**
 * Response from /api/tags
 */
export interface OllamaTagsResponse {
  models: OllamaModel[];
}

/**
 * Response from /api/show
 */
export interface OllamaShowResponse {
  modelfile: string;
  parameters: string;
  template: string;
  details: {
    parent_model?: string;
    format: string;
    family: string;
    families?: string[];
    parameter_size: string;
    quantization_level: string;
  };
  model_info?: Record<string, any>;
}

/**
 * Response from /api/version
 */
export interface OllamaVersionResponse {
  version: string;
}
