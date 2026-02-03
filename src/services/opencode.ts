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
      sessionTitle = "ha-ai-session",
      maxWaitMs = 30000,
      pollIntervalMs = 300,
    } = options;

    // Create session
    console.log(`[DEBUG sendPrompt] Creating session: ${sessionTitle}...`);
    const session = await this.client.session.create({
      body: { title: sessionTitle },
    });
    const sessionId = session.data?.id;

    if (!sessionId) {
      throw new Error("Failed to create OpenCode session");
    }
    console.log(`[DEBUG sendPrompt] Session created: ${sessionId}`);

    try {
      const startTime = Date.now();

      // Send prompt with timeout
      console.log(`[DEBUG sendPrompt] Sending prompt to session ${sessionId}...`);
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
      
      // Add timeout to prompt call itself (10 seconds)
      const promptTimeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('session.prompt() timeout after 10s')), 10000)
      );
      
      await Promise.race([promptPromise, promptTimeoutPromise]);

      console.log(`[DEBUG sendPrompt] Prompt sent for session ${sessionId}, waiting for response...`);

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

        // Log every 10 polls
        if (pollCount % 10 === 0) {
          console.log(`[DEBUG sendPrompt] Poll #${pollCount}: ${assistantMsgs.length} assistant messages, elapsed ${Date.now() - startTime}ms`);
        }

        // Get the last assistant message
        const lastAssistant = assistantMsgs[assistantMsgs.length - 1];

        if (lastAssistant?.parts?.length > 0) {
          const textPart = lastAssistant.parts.find(
            (p: any) => p.type === "text",
          );
          if (textPart?.text) {
            assistantContent = textPart.text;
            console.log(`[DEBUG sendPrompt] Got response after ${pollCount} polls, ${Date.now() - startTime}ms`);
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      const elapsed = Date.now() - startTime;

      if (!assistantContent) {
        console.log(`[DEBUG sendPrompt] TIMEOUT after ${pollCount} polls, ${elapsed}ms`);
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
   * @param haSystemContext - YAML device list from HA
   * @param userMessage - User's command
   * @param availableTools - Tools provided by HA
   * @returns JSON string with tool selection
   */
  async extractToolSelection(
    haSystemContext: string,
    userMessage: string,
    availableTools: OllamaTool[]
  ): Promise<string> {
    
    // Format tools into LLM-friendly description
    const toolsDescription = formatToolsForLLM(availableTools);
    
    const TOOL_SELECTION_PROMPT = `You are a smart home assistant for Home Assistant.

${haSystemContext}

Available actions you can perform:
${toolsDescription}

User request: "${userMessage}"

CRITICAL: Respond with VALID JSON ONLY. No markdown, no explanations, no code blocks.

Response Schema:
{
  "tool_name": "exact tool name from the available actions above OR 'chat' for conversation",
  "arguments": {
    // parameters as defined in the tool schema (only if tool_name is not 'chat')
  }
}

Rules:
1. DETERMINE REQUEST TYPE (CRITICAL - ALWAYS return valid JSON):
   a) If the user wants to CONTROL HOME DEVICES (turn on/off, set brightness, change temperature, etc.):
      → Choose appropriate tool from the list above
   
   b) If the user asks about DEVICE STATUS or STATE (is X on/off, what's the temperature, is X open/closed):
      → Use GetLiveContext tool if available
      → Return: {"tool_name": "GetLiveContext", "arguments": {}}
      → Examples: "is the light on?", "what's the temperature?", "is the door locked?"
   
   c) If the user is having a CONVERSATION (greeting, question, chat, general inquiry):
      → MUST return: {"tool_name": "chat", "arguments": {}}
      → Examples: "hello", "how are you", "thank you", "what time is it", "tell me a joke"

2. For HOME DEVICE CONTROL requests:
   - Match device names exactly from the Static Context above
   - Use exact device names from 'names' field (e.g., "Light living room")
   - For parameters with type 'array', use array format (e.g., "domain": ["light"])
   
3. CRITICAL - Parameter selection for device control:
   - If targeting a SPECIFIC DEVICE by name → use ONLY "name" + "domain" (do NOT include "area")
   - If targeting ALL DEVICES in an area → use ONLY "area" + "domain" (do NOT include "name")
   - NEVER include both "area" and "name" in the same request

4. If you cannot determine which tool to use for a HOME CONTROL request:
   - Return: {"tool_name": "unknown", "arguments": {}}

Examples:
User: "turn on living room light"  ← Home control
Device: "names: Light living room, domain: light"
→ {"tool_name": "HassTurnOn", "arguments": {"name": "Light living room", "domain": ["light"]}}
  NOTE: NO "area" field included!

User: "turn off all living room lights"  ← All devices in area
→ {"tool_name": "HassTurnOff", "arguments": {"area": "Living Room", "domain": ["light"]}}
  NOTE: NO "name" field included!

User: "こんにちは"  ← Conversation (Japanese greeting)
→ {"tool_name": "chat", "arguments": {}}

User: "ありがとう"  ← Conversation (Japanese thanks)
→ {"tool_name": "chat", "arguments": {}}

User: "今何時ですか？"  ← Conversation (Japanese time query)
→ {"tool_name": "chat", "arguments": {}}

User: "リビングのライトはついていますか？"  ← Status query (Japanese)
→ {"tool_name": "GetLiveContext", "arguments": {}}

User: "現在客廳的燈是亮著的嗎"  ← Status query (Chinese)
→ {"tool_name": "GetLiveContext", "arguments": {}}

User: "溫度是多少"  ← Status query (Chinese)
→ {"tool_name": "GetLiveContext", "arguments": {}}

User: "set bedroom light to 50%"  ← Specific device
Device: "names: Indirect light bedroom, domain: light"
→ {"tool_name": "HassLightSet", "arguments": {"name": "Indirect light bedroom", "brightness": 50}}
  NOTE: NO "area" field included!
`.trim();
    
    console.log('[DEBUG] Starting extractToolSelection...');
    const startTime = Date.now();
    
    try {
      const response = await this.sendPrompt(TOOL_SELECTION_PROMPT, userMessage, {
        sessionTitle: 'tool-selection',
        maxWaitMs: 30000,  // Increased from 15s to 30s
      });
      
      const elapsed = Date.now() - startTime;
      console.log(`[DEBUG] extractToolSelection completed in ${elapsed}ms`);
      
      // Clean markdown code blocks
      const cleaned = response.content
        .trim()
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      return cleaned;
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.error(`[ERROR] extractToolSelection failed after ${elapsed}ms:`, err instanceof Error ? err.message : err);
      console.log('[FALLBACK] Using rule-based tool selection...');
      
      // Fallback: Use simple rule-based tool selection
      return this.fallbackToolSelection(userMessage);
    }
  }

  /**
   * Fallback rule-based tool selection when OpenCode fails
   */
  private fallbackToolSelection(userMessage: string): string {
    const msg = userMessage.toLowerCase();
    
    // Status query patterns
    const statusPatterns = [
      /是.*的嗎/, /現在.*嗎/, /.*狀態/, /.*如何/, /幾度/, /多少/,
      /is.*on/, /is.*off/, /what.*temperature/, /how.*bright/,
      /ついています/, /状態/, /温度/
    ];
    
    const isStatusQuery = statusPatterns.some(pattern => pattern.test(msg));
    
    if (isStatusQuery) {
      console.log('[FALLBACK] Detected status query → GetLiveContext');
      return JSON.stringify({ tool_name: 'GetLiveContext', arguments: {} });
    }
    
    // Control patterns
    const turnOnPatterns = [/開/, /turn on/, /つけ/];
    const turnOffPatterns = [/關/, /turn off/, /消/];
    
    if (turnOnPatterns.some(p => p.test(msg))) {
      console.log('[FALLBACK] Detected turn on command → HassTurnOn');
      // Extract device name (simplified)
      return JSON.stringify({ tool_name: 'HassTurnOn', arguments: {} });
    }
    
    if (turnOffPatterns.some(p => p.test(msg))) {
      console.log('[FALLBACK] Detected turn off command → HassTurnOff');
      return JSON.stringify({ tool_name: 'HassTurnOff', arguments: {} });
    }
    
    // Default: treat as conversation
    console.log('[FALLBACK] No pattern matched → chat');
    return JSON.stringify({ tool_name: 'chat', arguments: {} });
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
