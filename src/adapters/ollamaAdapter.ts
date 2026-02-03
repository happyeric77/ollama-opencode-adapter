/**
 * Ollama Adapter
 * Converts between Ollama API format and internal ToolSelection format
 */

import type { OllamaChatRequest, OllamaChatResponse, OllamaMessage, OllamaToolCall } from '../types/ollama.js';
import type { ToolSelection, ExtractionResult } from '../types/tool-selection.js';

/**
 * Extract messages, tools, and detect repeated requests from Ollama chat request
 */
export function extractMessagesAndTools(request: OllamaChatRequest): ExtractionResult {
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
  // BUT: We should allow query tools (GetLiveContext, GetDateTime, etc.) to proceed for answering
  let isRepeatedRequest = false;
  let hasQueryToolResult = false;
  let toolResultContent: string | undefined;
  
  if (request.messages.length >= 2) {
    const lastMsg = request.messages[request.messages.length - 1];
    const secondLastMsg = request.messages[request.messages.length - 2];
    
    console.log('[DEBUG] Checking for repeated request:');
    console.log('Last msg:', { role: lastMsg?.role, content: lastMsg?.content?.substring(0, 50) });
    console.log('Second last:', { role: secondLastMsg?.role, has_tool_calls: !!secondLastMsg?.tool_calls, tool_calls_count: secondLastMsg?.tool_calls?.length || 0 });
    
    // If last message is 'tool' result and second last is our assistant response with tool_calls
    // This means HA executed the tool and is asking us again
    if (lastMsg?.role === 'tool' &&
        secondLastMsg?.role === 'assistant' && 
        secondLastMsg.tool_calls && 
        secondLastMsg.tool_calls.length > 0) {
      
      // Check if the tool was a QUERY tool (needs answer) or CONTROL tool (already done)
      const toolName = secondLastMsg.tool_calls[0]?.function?.name;
      const queryTools = ['GetLiveContext', 'GetDateTime', 'todo_get_items'];
      
      if (toolName && queryTools.includes(toolName)) {
        // This is a query tool - we need to use the result to answer the user
        console.log(`[DEBUG] Tool "${toolName}" is a query tool - NOT treating as repeated request`);
        isRepeatedRequest = false;
        hasQueryToolResult = true;
        toolResultContent = lastMsg.content;
      } else {
        // This is a control tool - already executed, treat as repeated request
        console.log(`[DEBUG] Tool "${toolName || 'unknown'}" is a control tool - treating as repeated request`);
        isRepeatedRequest = true;
      }
    }
  }

  return {
    systemContext: systemContext.trim(),
    userMessage: userMessage.trim(),
    availableTools: request.tools || [],
    isRepeatedRequest,
    hasQueryToolResult,
    toolResultContent,
  };
}

/**
 * Convert tool selection to Ollama chat response format
 * 
 * Key differences from OpenAI:
 * - tool_calls.arguments is an Object, not a JSON string
 * - No tool_calls.id field
 * - Timing metadata in nanoseconds
 */
export function convertToolSelectionToOllama(
  toolSelection: ToolSelection,
  modelId: string,
  processingTimeMs: number
): OllamaChatResponse {
  
  // Handle unknown/invalid tool - return text response instead of tool call
  if (toolSelection.tool_name === 'unknown' || !toolSelection.tool_name) {
    const message: OllamaMessage = {
      role: 'assistant',
      content: "申し訳ございません。デバイスまたはアクションが見つかりませんでした。リクエストを言い換えるか、デバイス名を確認していただけますか？例えば「リビングのライトをつけて」や「音量を50に設定」のように言ってみてください。",
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

  // Build tool call
  const toolCall: OllamaToolCall = {
    function: {
      name: toolSelection.tool_name,
      arguments: toolSelection.arguments, // Object, not JSON.stringify()!
    }
  };

  // Generate confirmation message based on tool name
  const confirmationMessage = generateConfirmationMessage(
    toolSelection.tool_name,
    toolSelection.arguments
  );

  const message: OllamaMessage = {
    role: 'assistant',
    content: confirmationMessage,
    tool_calls: [toolCall],
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

/**
 * Generate human-friendly confirmation message based on tool name and arguments
 */
function generateConfirmationMessage(
  toolName: string,
  args: Record<string, any>
): string {
  const deviceName = args.name || args.area || args.entity_id || 'the device';
  
  // Pattern matching on tool names
  if (toolName.includes('TurnOn')) {
    return `Turned on ${deviceName}`;
  } else if (toolName.includes('TurnOff')) {
    return `Turned off ${deviceName}`;
  } else if (toolName.includes('LightSet')) {
    if (args.brightness !== undefined) {
      return `Set ${deviceName} brightness to ${args.brightness}%`;
    } else if (args.color !== undefined) {
      return `Set ${deviceName} color`;
    }
    return `Adjusted ${deviceName}`;
  } else if (toolName.includes('ClimateSetTemperature')) {
    return `Set temperature to ${args.temperature}°`;
  } else if (toolName.includes('MediaPause')) {
    return `Paused ${deviceName}`;
  } else if (toolName.includes('MediaUnpause')) {
    return `Resumed ${deviceName}`;
  } else if (toolName.includes('MediaNext')) {
    return `Skipped to next on ${deviceName}`;
  } else if (toolName.includes('MediaPrevious')) {
    return `Went back to previous on ${deviceName}`;
  } else if (toolName.includes('SetVolume')) {
    return `Set volume to ${args.volume_level}% on ${deviceName}`;
  } else if (toolName.includes('Mute')) {
    return `Muted ${deviceName}`;
  } else if (toolName.includes('Unmute')) {
    return `Unmuted ${deviceName}`;
  } else if (toolName.includes('ListAdd')) {
    return `Added "${args.item}" to ${args.name}`;
  } else if (toolName.includes('ListComplete')) {
    return `Completed "${args.item}" on ${args.name}`;
  } else if (toolName.includes('CancelAllTimers')) {
    return `Cancelled all timers`;
  } else if (toolName.includes('GetDateTime')) {
    return `Getting current date and time`;
  } else if (toolName.includes('GetLiveContext')) {
    return `Getting live context`;
  } else {
    // Generic fallback
    return `Executed ${toolName}`;
  }
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
