/**
 * Ollama Adapter
 * Converts between Ollama API format and internal Intent format
 */

import type { OllamaChatRequest, OllamaChatResponse, OllamaMessage, OllamaToolCall } from '../types/ollama.js';
import type { Intent, IntentType } from '../types/intent.js';
import { HA_TOOLS } from '../types/intent.js';

/**
 * Maps intent types to Home Assistant tool names
 */
const INTENT_TO_TOOL_MAP: Record<IntentType, string | null> = {
  turn_on: HA_TOOLS.TURN_ON,
  turn_off: HA_TOOLS.TURN_OFF,
  set_temperature: HA_TOOLS.LIGHT_SET, // Climate uses generic set
  set_brightness: HA_TOOLS.LIGHT_SET,
  unknown: null,
};

/**
 * Extract messages from Ollama chat request
 * Returns system context, user message, and whether this is a repeated request
 */
export function extractMessagesFromOllama(request: OllamaChatRequest): {
  systemContext: string;
  userMessage: string;
  isRepeatedRequest: boolean;
} {
  let systemContext = '';
  let userMessage = '';

  for (const msg of request.messages) {
    if (msg.role === 'system') {
      systemContext += msg.content + '\n';
    } else if (msg.role === 'user') {
      userMessage = msg.content;
    }
  }

  // Check for repeated request pattern
  // HA sends: [..., assistant (with tool_calls), tool, assistant (with tool_calls), tool, ...]
  // If the LAST message is 'tool' and the one before it is assistant with tool_calls, it's a repeat
  let isRepeatedRequest = false;
  
  if (request.messages.length >= 2) {
    const lastMsg = request.messages[request.messages.length - 1];
    const secondLastMsg = request.messages[request.messages.length - 2];
    
    console.log('[DEBUG] Checking for repeated request:');
    console.log('Last msg:', { role: lastMsg?.role, content: lastMsg?.content?.substring(0, 50) });
    console.log('Second last:', { role: secondLastMsg?.role, has_tool_calls: !!secondLastMsg?.tool_calls, tool_calls_count: secondLastMsg?.tool_calls?.length || 0 });
    
    // If last message is 'tool' result and second last is our assistant response with tool_calls
    // This means HA executed the tool and is asking us again (循環)
    if (lastMsg?.role === 'tool' &&
        secondLastMsg?.role === 'assistant' && 
        secondLastMsg.tool_calls && 
        secondLastMsg.tool_calls.length > 0) {
      isRepeatedRequest = true;
      console.log('[DEBUG] DETECTED REPEATED REQUEST! (pattern: assistant+tool_calls -> tool)');
    }
  }

  return {
    systemContext: systemContext.trim(),
    userMessage: userMessage.trim(),
    isRepeatedRequest,
  };
}

/**
 * Convert Intent to Ollama chat response format
 * 
 * Key differences from OpenAI:
 * - tool_calls.arguments is an Object, not a JSON string
 * - No tool_calls.id field
 * - Timing metadata in nanoseconds
 */
export function convertIntentToOllama(
  intent: Intent,
  modelId: string,
  processingTimeMs: number
): OllamaChatResponse {
  const toolName = INTENT_TO_TOOL_MAP[intent.intent];

  // Handle unknown intent - return text response instead of tool call
  if (!toolName || intent.intent === 'unknown' || (!intent.entity_id && !intent.device_name)) {
    const message: OllamaMessage = {
      role: 'assistant',
      content: "I'm sorry, I couldn't understand that command or find the device you mentioned. Please try again.",
    };

    const totalDurationNs = processingTimeMs * 1_000_000;

    return {
      model: modelId,
      created_at: new Date().toISOString(),
      message,
      done: true,
      done_reason: 'stop',
      total_duration: totalDurationNs,
      eval_count: 1,
      eval_duration: totalDurationNs,
    };
  }

  // Build tool call arguments
  // CRITICAL: arguments must be an Object, not a JSON string
  // Use device_name (friendly name) if available, otherwise fallback to entity_id
  const toolArguments: Record<string, any> = {
    name: intent.device_name || intent.entity_id,
    domain: intent.domain,
  };

  // Add additional attributes if present
  if (intent.attributes) {
    Object.assign(toolArguments, intent.attributes);
  }

  const toolCall: OllamaToolCall = {
    function: {
      name: toolName,
      arguments: toolArguments, // Object, not JSON.stringify()!
    },
  };

  // Generate a confirmation message based on the intent
  let confirmationMessage = '';
  const deviceName = intent.device_name || intent.entity_id || 'the device';
  
  switch (intent.intent) {
    case 'turn_on':
      confirmationMessage = `Turned on ${deviceName}`;
      break;
    case 'turn_off':
      confirmationMessage = `Turned off ${deviceName}`;
      break;
    case 'set_brightness':
      confirmationMessage = `Set ${deviceName} brightness to ${intent.attributes?.brightness}%`;
      break;
    case 'set_temperature':
      confirmationMessage = `Set ${deviceName} temperature to ${intent.attributes?.temperature}°`;
      break;
    default:
      confirmationMessage = `Executed command on ${deviceName}`;
  }

  const message: OllamaMessage = {
    role: 'assistant',
    content: confirmationMessage,
    tool_calls: [toolCall],
  };

  // Convert processing time to nanoseconds
  const totalDurationNs = processingTimeMs * 1_000_000;

  const response: OllamaChatResponse = {
    model: modelId,
    created_at: new Date().toISOString(),
    message,
    done: true,
    done_reason: 'stop',
    total_duration: totalDurationNs,
    eval_count: 1,
    eval_duration: totalDurationNs,
  };

  return response;
}

/**
 * Convert error to Ollama error response
 */
export function convertErrorToOllama(
  error: Error,
  modelId: string
): OllamaChatResponse {
  const message: OllamaMessage = {
    role: 'assistant',
    content: `Error: ${error.message}`,
  };

  const response: OllamaChatResponse = {
    model: modelId,
    created_at: new Date().toISOString(),
    message,
    done: true,
    done_reason: 'stop',
    total_duration: 0,
  };

  return response;
}
