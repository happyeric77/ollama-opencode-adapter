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

      // Add timeout to prompt call itself (40 seconds for complex prompts with many tools)
      const promptTimeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("session.prompt() timeout after 40s")),
          40000,
        ),
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
        const deletePromise = this.client.session.delete({
          path: { id: sessionId },
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Session delete timeout")), 5000),
        );
        await Promise.race([deletePromise, timeoutPromise]);
      } catch (err) {
        console.error(
          `Failed to delete OpenCode session ${sessionId}:`,
          err instanceof Error ? err.message : err,
        );
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
    availableTools: OllamaTool[],
  ): Promise<UnifiedResponse> {
    // Get recent conversation context (limit to last 10 messages for performance)
    const recentContext = ConversationHelper.buildToolSelectionContext(
      conversationHistory,
      10,
    );

    // Get the current user message
    const userMessage =
      ConversationHelper.getLastUserMessage(conversationHistory);

    // Format tools into LLM-friendly description
    const toolsDescription = formatToolsForLLM(availableTools);

    // Check if last message is a tool result
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    const hasToolResult = lastMessage?.role === "tool";

    // Extract tool result content if available
    let toolResultText = "";
    if (hasToolResult && lastMessage) {
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      // Parse tool result if it's JSON
      try {
        const toolResultObj = JSON.parse(content);
        if (toolResultObj.result) {
          toolResultText = `\nTool Result:\n${toolResultObj.result}`;
        } else {
          toolResultText = `\nTool Result:\n${content}`;
        }
      } catch {
        toolResultText = `\nTool Result:\n${content}`;
      }
    }

    const UNIFIED_RESPONSE_PROMPT =
      `You are an intelligent assistant that decides how to respond to user requests.

Available Context:
${systemContext}
${recentContext}${toolResultText}
Available Tools:
${toolsDescription}

User Request: "${userMessage}"

CRITICAL ANALYSIS:
1. Is this an ACTION request (turn on/off, open/close, set, lock/unlock)?
   - YES → Return TOOL_CALL with appropriate tool
2. Is this a QUERY request (is X on?, what's the status?, 是...嗎?)?
   - If tool result available → Return ANSWER with info
   - If no tool result → Return TOOL_CALL to get info
3. Is this a CHAT request (greeting, thanks, general conversation)?
   - YES → Return CHAT

CRITICAL: Respond with VALID JSON ONLY. No markdown, no explanations, no code blocks.

Response Schema - Choose ONE:

1. TOOL_CALL - Need to call a tool:
{"action": "tool_call", "tool_name": "tool name", "arguments": {...}}

2. ANSWER - Have tool result or can answer directly:
{"action": "answer", "content": "natural language answer"}

3. CHAT - Conversational response:
{"action": "chat", "content": "conversational response"}

DECISION RULES:

1. IF last message is a tool result:
   - ACTION result (turn on/off, set) → Return ANSWER to confirm
   - QUERY result (is X on?, status) → Return ANSWER with info
   - CRITICAL: Do NOT execute tool again if just executed

2. IF no recent tool result:
   - ACTION request (turn on/off, open/close, set, adjust, 開/關/設定/打開) → TOOL_CALL
   - Follow-up ACTION with pronouns (那打開他, 關掉它, turn it on) → TOOL_CALL (refer to recent context)
   - QUERY request (is X on?, status, 是...嗎?, 狀態) → TOOL_CALL (use Get*/Query*/Context tools)
   - CHAT request (greetings, thanks, general questions) → CHAT

3. Repeated requests:
   - Same request + just executed → ANSWER (acknowledge)
   - Same request + time passed → TOOL_CALL (re-execute)

4. Context references:
   - User says "打開他/它" or "turn it on" → Check recent conversation for device reference
   - If recent conversation mentioned a device, execute action on that device

Examples:

User: "開客廳的燈"
→ {"action": "tool_call", "tool_name": "HassTurnOn", "arguments": {"area": "Living Room", "domain": ["light"]}}

[After tool executed]
→ {"action": "answer", "content": "客廳燈已經開啟了"}

User: "請關閉客廳燈"
→ {"action": "tool_call", "tool_name": "HassTurnOff", "arguments": {"area": "Living Room", "domain": ["light"]}}

[After tool executed]
→ {"action": "answer", "content": "客廳燈已經關閉了"}

User: "客廳的燈是開著的嗎"
→ {"action": "tool_call", "tool_name": "GetLiveContext", "arguments": {}}

[After GetLiveContext returns: "客廳燈: 關閉"]
→ {"action": "answer", "content": "不，客廳的燈現在是關著的"}

User: "那打開它"
→ {"action": "tool_call", "tool_name": "HassTurnOn", "arguments": {"area": "Living Room", "domain": ["light"]}}
→ {"action": "tool_call", "tool_name": "GetLiveContext", "arguments": {}}

[After GetLiveContext returns: "客廳燈: 開啟"]
→ {"action": "answer", "content": "是的，客廳的燈現在是開著的"}
`.trim();

    console.log("[DEBUG] Starting generateResponse...");
    console.log("[DEBUG] conversationLength:", conversationHistory.length);
    console.log("[DEBUG] hasToolResult:", hasToolResult);
    console.log("[DEBUG] userMessage:", userMessage);
    console.log("[DEBUG] recentContext length:", recentContext.length);

    // Log tool result if available
    if (hasToolResult && lastMessage) {
      const content =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      console.log("[DEBUG] Tool result:", content.substring(0, 500));
    }

    try {
      const fullPrompt = `${UNIFIED_RESPONSE_PROMPT}

Now, analyze the conversation and respond with the appropriate JSON:
${hasToolResult ? "\nNote: A tool result is available in the conversation history. Check if it answers the user's question." : ""}`;

      console.log("[DEBUG] Full prompt length:", fullPrompt.length);
      console.log("[DEBUG] Recent context:", recentContext);
      console.log(
        "[DEBUG] Prompt preview (first 2000 chars):",
        fullPrompt.substring(0, 2000),
      );

      const response = await this.sendPrompt(
        "You are an intelligent assistant. Respond with valid JSON only.",
        fullPrompt,
        {
          sessionTitle: "unified-response",
          maxWaitMs: 50000, // Increased from 30s to 50s for complex prompts
        },
      );

      console.log("[DEBUG] Raw LLM response:", response.content);

      // Clean markdown code blocks and handle duplicated JSON
      let cleaned = response.content
        .trim()
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      console.log("[DEBUG] Cleaned response:", cleaned);

      // Parse and validate response
      const parsed = JSON.parse(cleaned);

      // Validate response action type
      if (
        !parsed.action ||
        !["tool_call", "answer", "chat"].includes(parsed.action)
      ) {
        throw new Error(`Invalid response action: ${parsed.action}`);
      }

      return parsed as UnifiedResponse;
    } catch (err) {
      console.error(
        "[ERROR] generateResponse failed:",
        err instanceof Error ? err.message : err,
      );
      console.log("[FALLBACK] Attempting fallback strategies");

      // Fallback Strategy 1: Try to generate answer from tool result if available
      if (hasToolResult) {
        console.log("[FALLBACK] Found tool result, trying to generate answer");
        try {
          const answer = await this.generateAnswerFromToolResult(
            conversationHistory,
            systemContext,
          );
          return {
            action: "answer",
            content: answer,
          };
        } catch (fallbackErr) {
          console.error(
            "[FALLBACK] generateAnswerFromToolResult failed:",
            fallbackErr instanceof Error ? fallbackErr.message : fallbackErr,
          );
        }
      }

      // Fallback Strategy 2: For query requests, try to call GetLiveContext
      const isQueryRequest = this.isQueryRequest(userMessage);
      const hasGetLiveContext = availableTools.some(
        (t) =>
          t.function.name === "GetLiveContext" ||
          t.function.name.toLowerCase().includes("context"),
      );

      if (isQueryRequest && hasGetLiveContext && !hasToolResult) {
        console.log(
          "[FALLBACK] Query request detected, calling GetLiveContext",
        );
        return {
          action: "tool_call",
          tool_name: "GetLiveContext",
          arguments: {},
        };
      }

      // Fallback Strategy 3: Return error-specific message
      console.log("[FALLBACK] Using final fallback chat response");
      return {
        action: "chat",
        content: this.getFallbackChatResponse(userMessage),
      };
    }
  }

  /**
   * Generate answer from tool result in conversation history
   * Used as fallback when unified response generation fails
   */
  private async generateAnswerFromToolResult(
    conversationHistory: OllamaMessage[],
    systemContext: string,
  ): Promise<string> {
    // Get the last tool result
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage?.role !== "tool") {
      throw new Error("No tool result available");
    }

    const userMessage =
      ConversationHelper.getLastUserMessage(conversationHistory);
    const toolResult =
      typeof lastMessage.content === "string"
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
      const response = await this.sendPrompt(prompt, userMessage, {
        sessionTitle: "generate-answer",
        maxWaitMs: 10000,
      });

      return response.content.trim();
    } catch (err) {
      console.error(
        "[ERROR] generateAnswerFromToolResult failed:",
        err instanceof Error ? err.message : err,
      );
      // Return the raw tool result as fallback
      return toolResult;
    }
  }

  /**
   * Detect if user message is a query request (asking for information)
   */
  private isQueryRequest(userMessage: string): boolean {
    const queryPatterns = [
      /是.*嗎/, // Chinese: 是...嗎
      /現在.*是/, // Chinese: 現在...是
      /什麼.*狀態/, // Chinese: 什麼狀態
      /^請問/, // Chinese: 請問
      /^is\s/i, // English: is...
      /^are\s/i, // English: are...
      /\bstatus\b/i, // English: status
      /\bstate\b/i, // English: state
      /^what/i, // English: what...
    ];

    return queryPatterns.some((pattern) => pattern.test(userMessage));
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
  return tools
    .map((tool, index) => {
      const func = tool.function;
      const params = func.parameters;
      const requiredParams = params.required || [];

      // Format parameters
      const paramsText = Object.entries(params.properties || {})
        .map(([key, schema]: [string, any]) => {
          const required = requiredParams.includes(key) ? " (required)" : "";
          const desc = schema.description ? ` - ${schema.description}` : "";
          const type = schema.type || "any";
          const itemsType = schema.items?.type ? `<${schema.items.type}>` : "";
          return `  - ${key}${required}: ${type}${itemsType}${desc}`;
        })
        .join("\n");

      return `
${index + 1}. ${func.name}
   Description: ${func.description}
   Parameters:
${paramsText || "   (no parameters)"}
    `.trim();
    })
    .join("\n\n");
}

// Singleton instance
let instance: OpencodeService | null = null;

export function getOpencodeService(): OpencodeService {
  if (!instance) {
    instance = new OpencodeService();
  }
  return instance;
}
