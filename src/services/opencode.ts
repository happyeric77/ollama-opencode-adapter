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
   * 
   * @private Internal method - use generateResponse() for external calls
   */
  private async sendPrompt(
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
      `Analyze the user request and decide how to respond.

=== CONTEXT ===
${systemContext}
${recentContext}${toolResultText}

=== AVAILABLE TOOLS ===
${toolsDescription}

=== USER REQUEST ===
"${userMessage}"

=== OUTPUT FORMAT ===
Respond with EXACTLY ONE JSON object in one of these formats:

A) Call a tool:
{"action": "tool_call", "tool_name": "ExactToolName", "arguments": {...}}

B) Provide an answer:
{"action": "answer", "content": "your response"}

C) Chat conversationally:
{"action": "chat", "content": "your response"}

=== DECISION LOGIC ===

1. If the request requires executing a tool:
   → Use Format A with the appropriate tool and arguments

2. If a tool result is available and answers the request:
   → Use Format B to provide answer based on the tool result

3. If no tools are needed or available:
   → Use Format C for conversational response

${hasToolResult ? "\nNOTE: A tool result is available above. Use it to answer if it's relevant to the user's request.\n" : ""}
=== CONSTRAINTS ===
- Output EXACTLY ONE JSON object
- Start with { and end with }
- No text before or after the JSON
- Match the user's language in responses
- Extract tool arguments accurately from the request

Output your JSON:`.trim();

    try {
      const fullPrompt = `${UNIFIED_RESPONSE_PROMPT}

Now, analyze the conversation and respond with the appropriate JSON:
${hasToolResult ? "\nNote: A tool result is available in the conversation history. Check if it answers the user's question." : ""}`;

      const response = await this.sendPrompt(
        "You are an intelligent assistant. Respond with valid JSON only.",
        fullPrompt,
        {
          sessionTitle: "unified-response",
          maxWaitMs: 50000, // Increased from 30s to 50s for complex prompts
        },
      );

      // Clean markdown code blocks
      let cleaned = response.content
        .trim()
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      // Detect and extract first valid JSON object (Ref: https://community.openai.com/t/2-json-objects-returned-when-using-function-calling-and-json-mode/574348)
      const jsonMatch = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON object found in LLM response");
      }

      // Warn if multiple JSON objects detected
      const allMatches = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
      if (allMatches && allMatches.length > 1) {
        console.warn(
          `[WARN] LLM returned ${allMatches.length} JSON objects, using first one`,
        );
        console.warn("[WARN] Full response:", cleaned);
      }

      // Use only the first JSON object
      cleaned = jsonMatch[0];

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

      // Fallback Strategy 1: Try to generate answer from tool result if available
      if (hasToolResult) {
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

      // Fallback Strategy 2: Return friendly error message
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
   * Get a simple fallback chat response when all else fails
   * Language detection priority: Japanese (kana) > Chinese (hanzi) > English
   */
  private getFallbackChatResponse(userMessage: string): string {
    // Detect Japanese first (Japanese always contains kana, Chinese doesn't)
    const hasJapaneseKana = /[\u3040-\u309f\u30a0-\u30ff]/.test(userMessage);
    const hasChineseChars = /[\u4e00-\u9fa5]/.test(userMessage);

    if (hasJapaneseKana) {
      // Japanese (even if it contains kanji/Chinese characters)
      return "申し訳ございませんが、現在このリクエストを処理できません。";
    }
    if (hasChineseChars) {
      // Chinese (hanzi only, no kana)
      return "我現在無法處理這個請求，請稍後再試。";
    }
    // English or other languages
    return "I'm unable to process this request right now. Please try again later.";
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
