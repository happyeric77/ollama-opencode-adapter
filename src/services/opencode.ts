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
    const session = await this.client.session.create({
      body: { title: sessionTitle },
    });
    const sessionId = session.data?.id;

    if (!sessionId) {
      throw new Error("Failed to create OpenCode session");
    }

    try {
      const startTime = Date.now();

      // Send prompt
      await this.client.session.prompt({
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

      // Poll for assistant response
      let assistantContent: string | null = null;

      while (Date.now() - startTime < maxWaitMs) {
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
      // Always cleanup session
      try {
        await this.client.session.delete({ path: { id: sessionId } });
      } catch (err) {
        console.error("Failed to delete OpenCode session:", err);
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
  "tool_name": "exact tool name from the available actions above",
  "arguments": {
    // parameters as defined in the tool schema
    // Match the device from the context above
    // Use exact device names from the 'names' field
  }
}

Rules:
1. Choose the most appropriate tool from the list above
2. Match the user's request to a device from the Static Context
3. Use exact device names from the 'names' field (e.g., "Light living room")
4. For parameters with type 'array', use array format (e.g., "domain": ["light"])
5. CRITICAL - Parameter selection for device control (HassTurnOn, HassTurnOff, etc.):
   - If targeting a SPECIFIC DEVICE by name → use ONLY "name" + "domain" (do NOT include "area")
   - If targeting ALL DEVICES in an area → use ONLY "area" + "domain" (do NOT include "name")
   - NEVER include both "area" and "name" in the same request
6. If you cannot determine the appropriate tool or device, return:
   {"tool_name": "unknown", "arguments": {}}

Examples:
User: "turn on living room light"  ← Specific device
Device: "names: Light living room, domain: light"
→ {"tool_name": "HassTurnOn", "arguments": {"name": "Light living room", "domain": ["light"]}}
  NOTE: NO "area" field included!

User: "turn off all living room lights"  ← All devices in area
→ {"tool_name": "HassTurnOff", "arguments": {"area": "Living Room", "domain": ["light"]}}
  NOTE: NO "name" field included!

User: "set bedroom light to 50%"  ← Specific device
Device: "names: Indirect light bedroom, domain: light"
→ {"tool_name": "HassLightSet", "arguments": {"name": "Indirect light bedroom", "brightness": 50}}
  NOTE: NO "area" field included!

User: "play music"
Device: "names: Speaker living room, domain: media_player"
→ {"tool_name": "HassMediaSearchAndPlay", "arguments": {"search_query": "music", "name": "Speaker living room"}}

User: "what time is it?"
→ {"tool_name": "GetDateTime", "arguments": {}}
`.trim();
    
    const response = await this.sendPrompt(TOOL_SELECTION_PROMPT, userMessage, {
      sessionTitle: 'tool-selection',
      maxWaitMs: 15000,
    });
    
    // Clean markdown code blocks
    const cleaned = response.content
      .trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    return cleaned;
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
