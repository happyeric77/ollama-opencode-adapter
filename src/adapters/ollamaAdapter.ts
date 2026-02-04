/**
 * Ollama Adapter
 * Converts between Ollama API format and internal UnifiedResponse format
 */

import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaMessage,
  OllamaToolCall,
} from "../types/ollama.js";
import type {
  UnifiedResponse,
  ExtractionResult,
} from "../types/tool-selection.js";

/**
 * Extract messages, tools from Ollama chat request
 * 
 * Simplified from previous version - no longer detects repeated requests
 * or query tool results. These are now handled by unified response generation.
 */
export function extractMessagesAndTools(
  request: OllamaChatRequest,
): ExtractionResult {
  let systemContext = "";

  // Extract system messages into systemContext
  for (const msg of request.messages) {
    if (msg.role === "system") {
      systemContext += msg.content + "\n";
    }
  }

  // Extract conversation history (exclude system messages)
  const conversationHistory = request.messages.filter(
    (msg) => msg.role !== "system",
  );

  return {
    systemContext: systemContext.trim(),
    conversationHistory,
    availableTools: request.tools || [],
  };
}

/**
 * Convert unified response to Ollama chat response format
 * 
 * Handles three response types:
 * - tool_call: Returns assistant message with tool_calls array
 * - answer: Returns assistant message with content (from tool results)
 * - chat: Returns assistant message with content (conversational)
 * 
 * Key differences from OpenAI:
 * - tool_calls.arguments is an Object, not a JSON string
 * - No tool_calls.id field
 * - Timing metadata in nanoseconds
 */
export function convertUnifiedResponseToOllama(
  response: UnifiedResponse,
  modelId: string,
  processingTimeMs: number,
): OllamaChatResponse {
  const totalDurationNs = processingTimeMs * 1_000_000;

  if (response.action === "tool_call") {
    // Return tool call response
    const toolCall: OllamaToolCall = {
      function: {
        name: response.tool_name,
        arguments: response.arguments, // Object, not JSON.stringify()!
      },
    };

    const message: OllamaMessage = {
      role: "assistant",
      content: "", // Empty string - client won't display during tool execution
      tool_calls: [toolCall],
    };

    return {
      model: modelId,
      created_at: new Date().toISOString(),
      message,
      done: true,
      done_reason: "stop",
      total_duration: totalDurationNs,
      eval_count: 1,
      eval_duration: totalDurationNs,
    };
  } else {
    // Return text response (answer or chat)
    const message: OllamaMessage = {
      role: "assistant",
      content: response.content,
    };

    return {
      model: modelId,
      created_at: new Date().toISOString(),
      message,
      done: true,
      done_reason: "stop",
      total_duration: totalDurationNs,
      eval_count: 1,
      eval_duration: totalDurationNs,
    };
  }
}

/**
 * Convert error to Ollama error response
 */
export function convertErrorToOllama(
  error: Error,
  modelId: string,
): OllamaChatResponse {
  const message: OllamaMessage = {
    role: "assistant",
    content: `Error: ${error.message}`,
  };

  const response: OllamaChatResponse = {
    model: modelId,
    created_at: new Date().toISOString(),
    message,
    done: true,
    done_reason: "stop",
    total_duration: 0,
  };

  return response;
}
