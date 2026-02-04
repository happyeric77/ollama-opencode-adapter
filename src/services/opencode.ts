// OpenCode SDK service wrapper
// Handles session-based communication with OpenCode server

import { createOpencodeClient } from "@opencode-ai/sdk";
import type { OllamaTool, OllamaMessage } from "../types/ollama.js";
import type { UnifiedResponse } from "../types/tool-selection.js";
import { ConversationHelper } from "./conversationHelper.js";
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
   * Generate unified response based on conversation context
   * Replaces extractToolSelection(), handleConversation(), and generateCompletionMessage()
   * 
   * @param systemContext - System context (device list, available data, etc.)
   * @param conversationHistory - Full conversation history
   * @param availableTools - Tools provided by client
   * @returns UnifiedResponse (tool_call, answer, or chat)
   */
  async generateResponse(
    systemContext: string,
    conversationHistory: OllamaMessage[],
    availableTools: OllamaTool[]
  ): Promise<UnifiedResponse> {
    
    // Get recent conversation context (limit to last 10 messages for performance)
    const recentContext = ConversationHelper.buildToolSelectionContext(
      conversationHistory,
      10
    );
    
    // Get the current user message
    const userMessage = ConversationHelper.getLastUserMessage(conversationHistory);
    
    // Format tools into LLM-friendly description
    const toolsDescription = formatToolsForLLM(availableTools);
    
    // Check if last message is a tool result
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    const hasToolResult = lastMessage?.role === 'tool';
    
    const UNIFIED_RESPONSE_PROMPT = `You are an intelligent assistant that decides how to respond to user requests.

Available Context:
${systemContext}
${recentContext}
Available Tools:
${toolsDescription}

User Request: "${userMessage}"

CRITICAL: Respond with VALID JSON ONLY. No markdown, no explanations, no code blocks.

Response Schema - You must choose ONE of these three response types:

1. TOOL_CALL - When you need to call a tool to fulfill the request:
{
  "action": "tool_call",
  "tool_name": "exact tool name from available tools",
  "arguments": {
    // parameters as defined in the tool schema
  }
}

2. ANSWER - When tool results are available and you can answer the question:
{
  "action": "answer",
  "content": "natural language answer based on tool results"
}

3. CHAT - For conversational responses without tools:
{
  "action": "chat",
  "content": "natural conversational response"
}

DECISION RULES (Priority Order):

1. Check conversation history FIRST:
   - If last message is a tool result:
     a) For ACTION requests (turn on/off, set, etc.): Return ANSWER to confirm completion
        Example: User "開燈" → Tool executed → Return {"action": "answer", "content": "客廳燈已經開啟了"}
     b) For QUERY requests (is X on?, what's status?): Return ANSWER with the information
        Example: User "燈是開的嗎" → Tool returns state → Return {"action": "answer", "content": "是的，燈現在是開著的"}
   - CRITICAL: If tool was just executed for current user request, DO NOT execute it again
   - Only execute tool again if user makes a NEW request (different intent or after time passed)

2. Check user intent (only if NO recent tool result):
   - ACTION REQUEST (turn on/off, set, adjust, control) → TOOL_CALL
   - INFORMATION QUERY (is X on?, what's the status?, get data) → TOOL_CALL (use query tools)
   - CONVERSATION (greetings, thanks, general chat) → CHAT

3. When in doubt about device state:
   - DO NOT assume state from old conversation history (>1 minute ago)
   - Prefer calling query tools (Get*, Query*, Fetch*, *Status, *Context) to check current state
   - Devices can be controlled via other interfaces (physical switches, automation, other apps)

4. Handling repeated requests:
   - If user makes the SAME request after receiving an answer: acknowledge instead of re-executing
   - If user makes the SAME request after TIME PASSED (no recent tool result): execute again
   - Example: User "開燈" → executed → immediately says "開燈" again → Return "燈已經開啟了"
   - Example: User "開燈" → executed → 5 mins later says "開燈" → Execute again (state may have changed)

Parameter Extraction Guidelines:
- Extract parameter values directly from user's request
- Use information from the system context when needed
- Match parameter types exactly as defined in tool schema
- For array types, use array format: ["value1", "value2"]

Examples:

User: "hello"
→ {"action": "chat", "content": "Hello! How can I help you?"}

User: "thank you"
→ {"action": "chat", "content": "You're welcome!"}

User: "開客廳的燈"
→ {"action": "tool_call", "tool_name": "HassTurnOn", "arguments": {"area": "Living Room", "domain": ["light"]}}

[After HassTurnOn executed successfully]
User: "開客廳的燈" (same request, tool just executed)
→ {"action": "answer", "content": "客廳燈已經開啟了"}

User: "客廳的燈是開著的嗎" (query request)
→ {"action": "tool_call", "tool_name": "GetLiveContext", "arguments": {}}

[After GetLiveContext returns: "客廳燈: 開啟"]
User: "客廳的燈是開著的嗎" (query result available)
→ {"action": "answer", "content": "是的，客廳的燈現在是開著的"}

User: "開燈" → [Tool executed] → User immediately asks "開燈" again
→ {"action": "answer", "content": "燈已經開啟了"}

User: "開燈" → [Tool executed 5 minutes ago, no recent activity]
→ {"action": "tool_call", "tool_name": "HassTurnOn", "arguments": {...}}
(Reason: Time passed, state may have changed)
`.trim();
    
    console.log('[DEBUG] Starting generateResponse...');
    
    try {
      const fullPrompt = `${UNIFIED_RESPONSE_PROMPT}

Now, analyze the conversation and respond with the appropriate JSON:
${hasToolResult ? '\nNote: A tool result is available in the conversation history. Check if it answers the user\'s question.' : ''}`;
      
      const response = await this.sendPrompt(
        "You are an intelligent assistant. Respond with valid JSON only.",
        fullPrompt,
        {
          sessionTitle: 'unified-response',
          maxWaitMs: 30000,
        }
      );
      
      // Clean markdown code blocks
      const cleaned = response.content
        .trim()
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      // Parse and validate response
      const parsed = JSON.parse(cleaned);
      
      // Validate response action type
      if (!parsed.action || !['tool_call', 'answer', 'chat'].includes(parsed.action)) {
        throw new Error(`Invalid response action: ${parsed.action}`);
      }
      
      return parsed as UnifiedResponse;
      
    } catch (err) {
      console.error('[ERROR] generateResponse failed:', err instanceof Error ? err.message : err);
      console.log('[FALLBACK] Attempting to generate answer from tool result or return chat');
      
      // Fallback: Try to generate answer from tool result if available
      if (hasToolResult) {
        try {
          const answer = await this.generateAnswerFromToolResult(
            conversationHistory,
            systemContext
          );
          return {
            action: 'answer',
            content: answer
          };
        } catch {
          // If that fails too, fall back to chat
        }
      }
      
      // Final fallback: conversational response
      return {
        action: 'chat',
        content: this.getFallbackChatResponse(userMessage)
      };
    }
  }

  /**
   * Generate answer from tool result in conversation history
   * Used as fallback when unified response generation fails
   */
  private async generateAnswerFromToolResult(
    conversationHistory: OllamaMessage[],
    systemContext: string
  ): Promise<string> {
    // Get the last tool result
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage?.role !== 'tool') {
      throw new Error('No tool result available');
    }

    const userMessage = ConversationHelper.getLastUserMessage(conversationHistory);
    const toolResult = typeof lastMessage.content === 'string' 
      ? lastMessage.content 
      : JSON.stringify(lastMessage.content);

    const prompt = `${systemContext}

User asked: "${userMessage}"

Tool returned this result:
${toolResult}

Generate a natural language answer (1-2 sentences) that:
1. Answers the user's question based on the tool result
2. Uses the EXACT SAME language as the user's message
3. Is clear and concise

Generate ONLY the answer, nothing else:`.trim();

    try {
      const response = await this.sendPrompt(
        prompt,
        userMessage,
        {
          sessionTitle: 'generate-answer',
          maxWaitMs: 10000,
        }
      );
      
      return response.content.trim();
    } catch (err) {
      console.error('[ERROR] generateAnswerFromToolResult failed:', err instanceof Error ? err.message : err);
      // Return the raw tool result as fallback
      return toolResult;
    }
  }

  /**
   * Get a simple fallback chat response when all else fails
   */
  private getFallbackChatResponse(userMessage: string): string {
    // Detect language and respond appropriately
    const hasChineseChars = /[\u4e00-\u9fa5]/.test(userMessage);
    const hasJapaneseChars = /[\u3040-\u309f\u30a0-\u30ff]/.test(userMessage);
    
    if (hasChineseChars) {
      return "我現在無法處理這個請求，請稍後再試。";
    } else if (hasJapaneseChars) {
      return "申し訳ございませんが、現在このリクエストを処理できません。";
    } else {
      return "I'm unable to process this request right now. Please try again later.";
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
