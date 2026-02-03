// OpenCode SDK service wrapper
// Handles session-based communication with OpenCode server

import { createOpencodeClient } from "@opencode-ai/sdk";
import type { OllamaTool } from "../types/ollama.js";
import { config } from "../config.js";

export interface OpencodeMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpencodeResponse {
  content: string;
  elapsed: number; // milliseconds
}

export class OpencodeService {
  private client: any;

  async connect(): Promise<void> {
    if (this.client) {
      return; // Already connected
    }

    // Connect to existing OpenCode server (don't start a new one)
    this.client = createOpencodeClient({
      baseUrl: `${config.opencodeUrl}:${config.opencodePort}`,
    });
  }

  async close(): Promise<void> {
    if (this.client) {
      this.client = null;
    }
  }

  /**
   * Send a prompt to OpenCode and wait for response
   * Uses session-based API pattern:
   * 1. Create session
   * 2. Send prompt
   * 3. Poll for response
   * 4. Delete session (cleanup)
   */
  async sendPrompt(
    systemPrompt: string,
    userMessage: string,
    options: {
      sessionTitle?: string;
      maxWaitMs?: number;
      pollIntervalMs?: number;
    } = {},
  ): Promise<OpencodeResponse> {
    if (!this.client) {
      throw new Error("OpencodeService not connected. Call connect() first.");
    }
    
    const {
      sessionTitle = "ollama-opencode-session",
      maxWaitMs = 30000,
      pollIntervalMs = 300,
    } = options;

    // Create session
    const session = await this.client.session.create({
      body: { title: sessionTitle },
    });
    const sessionId = session.data?.id;

    if (!sessionId) {
      throw new Error("Failed to create OpenCode session");
    }

    try {
      const startTime = Date.now();

      // Send prompt with timeout
      const promptPromise = this.client.session.prompt({
        path: { id: sessionId },
        body: {
          model: {
            providerID: config.modelProvider,
            modelID: config.modelId,
          },
          system: systemPrompt,
          parts: [{ type: "text", text: userMessage }],
        },
      });
      
      // Add timeout to prompt call itself (20 seconds for tool selection)
      const promptTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('session.prompt() timeout after 20s')), 20000)
      );
      
      await Promise.race([promptPromise, promptTimeoutPromise]);

      // Poll for assistant response
      let assistantContent: string | null = null;
      let pollCount = 0;

      while (Date.now() - startTime < maxWaitMs) {
        pollCount++;
        const messages = await this.client.session.messages({
          path: { id: sessionId },
        });

        const assistantMsgs =
          messages.data?.filter((m: any) => m.info?.role === "assistant") || [];

        // Get the last assistant message
        const lastAssistant = assistantMsgs[assistantMsgs.length - 1];

        if (lastAssistant?.parts?.length > 0) {
          const textPart = lastAssistant.parts.find(
            (p: any) => p.type === "text",
          );
          if (textPart?.text) {
            assistantContent = textPart.text;
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      const elapsed = Date.now() - startTime;

      if (!assistantContent) {
        throw new Error(`OpenCode response timeout after ${maxWaitMs}ms`);
      }

      return {
        content: assistantContent,
        elapsed,
      };
    } finally {
      // Always cleanup session (with timeout to prevent hanging)
      try {
        const deletePromise = this.client.session.delete({ path: { id: sessionId } });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Session delete timeout')), 5000)
        );
        await Promise.race([deletePromise, timeoutPromise]);
      } catch (err) {
        console.error(`Failed to delete OpenCode session ${sessionId}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /**
   * Extract tool selection from user message using available tools
   * 
   * @param systemContext - System context (device list, available data, etc.)
   * @param userMessage - User's command
   * @param availableTools - Tools provided by client
   * @returns JSON string with tool selection
   */
  async extractToolSelection(
    systemContext: string,
    userMessage: string,
    availableTools: OllamaTool[]
  ): Promise<string> {
    
    // Format tools into LLM-friendly description
    const toolsDescription = formatToolsForLLM(availableTools);
    
    const TOOL_SELECTION_PROMPT = `You are a tool selection expert.

Available Context:
${systemContext}

Available Tools:
${toolsDescription}

User Request: "${userMessage}"

CRITICAL: Respond with VALID JSON ONLY. No markdown, no explanations, no code blocks.

Response Schema:
{
  "tool_name": "exact tool name from available tools OR 'chat' for conversation",
  "arguments": {
    // parameters as defined in the tool schema (only if tool_name is not 'chat')
  }
}

Rules for Intent Detection (Priority Order):

1. ACTION REQUEST (user wants to perform an action)
   → Select the most appropriate action tool from the available tools list
   → Fill in required parameters based on user's request and available context
   → Extract parameter values from the user's request
   
2. INFORMATION QUERY (user asks about status, state, or information)
   → CRITICAL: Look for query-type tools in the available tools list
   → Query tools often have names like "Get*", "Query*", "Fetch*", "*Status", "*Context"
   → IMPORTANT: Status questions like "is X on?", "what's the status?", "is X open?" MUST use query tools
   → If a query tool exists, use it with appropriate parameters
   → If no query tool exists, return: {"tool_name": "chat", "arguments": {}}
   
3. CONVERSATION (greetings, thanks, general chat, unrelated questions)
   → MUST return: {"tool_name": "chat", "arguments": {}}
   → Examples: "hello", "how are you", "thank you", "tell me a joke"
   → Time queries without a time tool: "what time is it?" → chat

Parameter Extraction Guidelines:
- Extract parameter values directly from user's request
- Use information from the system context when needed
- Match parameter types exactly as defined in tool schema
- For array types, use array format: ["value1", "value2"]
- Do not include optional parameters if not mentioned by user

Handling Ambiguity:
- If user's intent is unclear for action requests: {"tool_name": "unknown", "arguments": {}}
- If user asks for information but no query tool exists: {"tool_name": "chat", "arguments": {}}
- When in doubt between action and conversation: prefer "chat"

Examples:

User: "hello"
→ {"tool_name": "chat", "arguments": {}}

User: "thank you"
→ {"tool_name": "chat", "arguments": {}}

User: "what time is it?" (no time-related tool available)
→ {"tool_name": "chat", "arguments": {}}

User: "is the light on?" (GetLiveContext available)
→ {"tool_name": "GetLiveContext", "arguments": {}}

User: "what's the temperature?" (GetLiveContext available)
→ {"tool_name": "GetLiveContext", "arguments": {}}

User: "現在客廳燈是開著的嗎" (GetLiveContext available)
→ {"tool_name": "GetLiveContext", "arguments": {}}
`.trim();
    
    console.log('[DEBUG] Starting extractToolSelection...');
    
    try {
      // Combine everything into the user message for better OpenCode compatibility
      const fullPrompt = `${TOOL_SELECTION_PROMPT}

Now, analyze this user request and respond with the JSON:
User Request: "${userMessage}"`;
      
      const response = await this.sendPrompt(
        "You are a tool selection expert. Respond with valid JSON only.",
        fullPrompt,
        {
          sessionTitle: 'tool-selection',
          maxWaitMs: 30000,
        }
      );
      
      // Clean markdown code blocks
      const cleaned = response.content
        .trim()
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      return cleaned;
    } catch (err) {
      console.error('[ERROR] extractToolSelection failed:', err instanceof Error ? err.message : err);
      console.log('[FALLBACK] Returning conversational mode');
      
      // Fallback: Use simple rule-based tool selection
      return this.fallbackToolSelection(userMessage);
    }
  }

  /**
   * Fallback tool selection when OpenCode is unavailable
   * Returns "chat" to maintain service availability without assuming tool names
   */
  private fallbackToolSelection(_userMessage: string): string {
    // Always return "chat" - let conversation handler deal with the message
    // This is safer than guessing which tools exist
    return JSON.stringify({ 
      tool_name: 'chat', 
      arguments: {} 
    });
  }

  /**
   * Handle conversational requests
   * 
   * @param userMessage - User's message
   * @param systemContext - Client's system prompt (from messages[0])
   * @returns Natural language response
   */
  async handleConversation(
    userMessage: string,
    systemContext?: string
  ): Promise<string> {
    
    // Use client's system context, or provide a minimal default
    const conversationPrompt = systemContext || 
      `You are a helpful AI assistant. Respond naturally and concisely.`;
    
    // Get current time in UTC (more universal)
    const now = new Date();
    const utcTime = now.toISOString();

    const fullPrompt = `${conversationPrompt}

Current Date and Time (UTC): ${utcTime}

User: "${userMessage}"

Instructions:
1. Respond naturally and helpfully
2. Keep responses concise (1-3 sentences) unless detailed information is requested
3. If you don't have information to answer, politely explain your limitations

Respond now:`;

    const response = await this.sendPrompt(
      fullPrompt,
      userMessage,
      {
        sessionTitle: 'conversation',
        maxWaitMs: 30000,
      }
    );

    return response.content.trim();
  }

  /**
   * Generate completion message for tool execution
   * Uses LLM to create natural, multi-language confirmation message
   * 
   * @param userMessage - Original user's request
   * @param toolName - Name of the executed tool
   * @param toolArgs - Arguments passed to the tool
   * @param systemContext - System context for reference
   * @returns Natural language completion message in user's language
   */
  async generateCompletionMessage(
    userMessage: string,
    toolName: string,
    toolArgs: Record<string, any>,
    systemContext: string
  ): Promise<string> {
    const prompt = `${systemContext}

User said: "${userMessage}"

The system has SUCCESSFULLY COMPLETED the following action:
Tool: ${toolName}
Arguments: ${JSON.stringify(toolArgs, null, 2)}

Generate a short, natural confirmation message (1 sentence, maximum 10 words) that:
1. Confirms the action was COMPLETED successfully
2. Uses the EXACT SAME language as the user's message
3. Is friendly and concise
4. Does NOT ask questions or suggest next actions

Language Examples:
- User: "開客廳的燈" (Chinese) → "客廳的燈已經開啟了" (Chinese)
- User: "turn on living room light" (English) → "Living room light is now on" (English)
- User: "リビングの電気をつけて" (Japanese) → "リビングの電気をつけました" (Japanese)
- User: "set volume to 50" (English) → "Volume set to 50" (English)

Generate ONLY the confirmation message in the user's language, nothing else:`.trim();

    try {
      const response = await this.sendPrompt(
        prompt,
        userMessage,
        {
          sessionTitle: 'generate-completion',
          maxWaitMs: 10000,  // 10 second timeout
        }
      );
      
      return response.content.trim();
    } catch (err) {
      console.error('[ERROR] generateCompletionMessage failed:', err instanceof Error ? err.message : err);
      // Fallback to simple "Done"
      return "Done";
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}

/**
 * Format tools into LLM-friendly text description
 */
function formatToolsForLLM(tools: OllamaTool[]): string {
  return tools.map((tool, index) => {
    const func = tool.function;
    const params = func.parameters;
    const requiredParams = params.required || [];
    
    // Format parameters
    const paramsText = Object.entries(params.properties || {})
      .map(([key, schema]: [string, any]) => {
        const required = requiredParams.includes(key) ? ' (required)' : '';
        const desc = schema.description ? ` - ${schema.description}` : '';
        const type = schema.type || 'any';
        const itemsType = schema.items?.type ? `<${schema.items.type}>` : '';
        return `  - ${key}${required}: ${type}${itemsType}${desc}`;
      })
      .join('\n');
    
    return `
${index + 1}. ${func.name}
   Description: ${func.description}
   Parameters:
${paramsText || '   (no parameters)'}
    `.trim();
  }).join('\n\n');
}

// Singleton instance
let instance: OpencodeService | null = null;

export function getOpencodeService(): OpencodeService {
  if (!instance) {
    instance = new OpencodeService();
  }
  return instance;
}
