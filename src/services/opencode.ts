// OpenCode SDK service wrapper
// Handles session-based communication with OpenCode server

import { createOpencodeClient } from "@opencode-ai/sdk";
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
    // TDOOD: Why override options?
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
   * Extract intent from HA messages (Context-Aware)
   * Takes the full messages array from HA (including system context)
   * Returns structured JSON response
   */
  async extractIntent(
    haSystemContext: string,
    userMessage: string,
  ): Promise<string> {
    // Extract entity list from HA's system context
    // HA sends devices in YAML format, not CSV!
    let entityList = "";

    // Try to extract YAML device list
    const yamlMatch = haSystemContext.match(
      /Static Context:[\s\S]*?(?=\n\n|$)/,
    );
    if (yamlMatch) {
      entityList = yamlMatch[0];
      console.log(
        "[DEBUG] Extracted YAML entity list:",
        entityList.substring(0, 500),
      );
    } else {
      // TODO: Do we still need CSV??
      // Fallback: try CSV format (for compatibility)
      const csvMatch = haSystemContext.match(
        /Available Devices:[\s\S]*?```csv\n([\s\S]*?)```/,
      );
      if (csvMatch && csvMatch[1]) {
        entityList = csvMatch[1].trim();
        console.log(
          "[DEBUG] Extracted CSV entity list:",
          entityList.substring(0, 500),
        );
      } else {
        console.warn("[WARN] No device list found in HA system context");
        console.log(
          "[DEBUG] System context preview:",
          haSystemContext.substring(0, 500),
        );
      }
    }
    // TODO: Why ignore HA's chat instructions? why not concatenate?
    // Build our own system prompt (IGNORE HA's chat instructions)
    const EXTRACTION_PROMPT = `You are a smart home intent extractor for Home Assistant.

${entityList}

Your task: Extract the user's intent and return ONLY valid JSON.

CRITICAL: You MUST respond with VALID JSON ONLY. No explanations, no markdown, no code blocks, no conversation.

Response Schema:
{
  "intent": "turn_on | turn_off | set_temperature | set_brightness | unknown",
  "domain": "light | switch | climate | media_player | cover | fan | unknown",
  "entity_id": "",
  "device_name": "EXACT device name from 'names' field above (e.g., 'Light living room')",
  "attributes": {}
}

Rules:
1. Match the user's command to a device from the list above
2. Extract the intent (turn_on, turn_off, etc.)
3. Use the EXACT value from the "names:" field as device_name
4. For the device "names: Light living room" with "domain: light", use device_name="Light living room" and domain="light"
5. Return ONLY the JSON object, nothing else
6. If you cannot determine the intent or find the device, return: {"intent": "unknown", "domain": "unknown", "entity_id": "", "device_name": ""}

Examples:
User: "開啟客廳的燈" (turn on living room light)
Device: "names: Light living room, domain: light"
Response: {"intent": "turn_on", "domain": "light", "entity_id": "", "device_name": "Light living room", "attributes": {}}

User: "turn off bedroom ceiling light"
Device: "names: Ceiling light bedroom, domain: switch"
Response: {"intent": "turn_off", "domain": "switch", "entity_id": "", "device_name": "Ceiling light bedroom", "attributes": {}}

User: "set bedroom light to 50 percent"
Device: "names: Indirect light bedroom, domain: light"
Response: {"intent": "set_brightness", "domain": "light", "entity_id": "", "device_name": "Indirect light bedroom", "attributes": {"brightness": 50}}`;

    const response = await this.sendPrompt(EXTRACTION_PROMPT, userMessage, {
      sessionTitle: "intent-extraction",
      maxWaitMs: 15000,
    });

    // Remove potential markdown code blocks
    const cleaned = response.content
      .trim()
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    return cleaned;
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}

// Singleton instance
let instance: OpencodeService | null = null;

export function getOpencodeService(): OpencodeService {
  if (!instance) {
    instance = new OpencodeService();
  }
  return instance;
}
