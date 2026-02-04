// Fastify server setup with Ollama-compatible API endpoints

import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import type {
  OllamaChatRequest,
  OllamaTagsResponse,
  OllamaShowResponse,
  OllamaVersionResponse,
} from "./types/ollama.js";
import type { UnifiedResponse } from "./types/tool-selection.js";
import { getOpencodeService } from "./services/opencode.js";
import { ConversationHelper } from "./services/conversationHelper.js";
import {
  extractMessagesAndTools,
  convertUnifiedResponseToOllama,
  convertErrorToOllama,
} from "./adapters/ollamaAdapter.js";
// TODO: Should use the version from package.json dynamically
const PACKAGE_VERSION = "0.1.0";

export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  // Enable CORS
  await fastify.register(cors, {
    origin: true, // Allow all origins (adjust for production)
  });

  // Health check endpoint
  fastify.get("/health", async () => {
    const opencodeService = getOpencodeService();
    return {
      status: "ok",
      opencode: opencodeService.isConnected() ? "connected" : "disconnected",
      ollama_compatible: true,
    };
  });

  // Ollama-compatible chat endpoint
  fastify.post<{ Body: OllamaChatRequest }>(
    "/api/chat",
    async (request, reply) => {
      const startTime = Date.now();

      try {
        const body = request.body;

        // Log incoming request for debugging
        fastify.log.info(
          {
            model: body.model,
            messageCount: body.messages?.length,
            stream: body.stream,
            toolsCount: body.tools?.length || 0,
          },
          "Received Ollama chat request from HA",
        );

        // Validate request
        if (!body.messages || body.messages.length === 0) {
          return reply.code(400).send({
            error: "messages field is required and must not be empty",
          });
        }

        // Extract messages, tools, and system context
        const {
          systemContext,
          conversationHistory,
          availableTools,
        } = extractMessagesAndTools(body);

        // Validate conversation history
        const userMessage = ConversationHelper.getLastUserMessage(conversationHistory);
        if (!userMessage) {
          return reply.code(400).send({
            error: "At least one user message is required",
          });
        }
        
        const messageCounts = ConversationHelper.countMessagesByRole(conversationHistory);

        fastify.log.info(
          {
            systemContextLength: systemContext.length,
            conversationLength: conversationHistory.length,
            userMessages: messageCounts.user,
            assistantMessages: messageCounts.assistant,
            toolMessages: messageCounts.tool,
            lastUserMessage: userMessage,
            toolsAvailable: availableTools.length,
          },
          "Extracted context and conversation history",
        );

        // ============ Unified Response Generation ============
        // Use OpenCode to generate unified response (tool_call, answer, or chat)
        const opencodeService = getOpencodeService();
        
        let unifiedResponse: UnifiedResponse;
        
        try {
          unifiedResponse = await opencodeService.generateResponse(
            systemContext,
            conversationHistory,
            availableTools
          );
          
          fastify.log.info(
            { 
              action: unifiedResponse.action,
              tool_name: unifiedResponse.action === 'tool_call' ? (unifiedResponse as any).tool_name : undefined 
            },
            "Generated unified response"
          );
        } catch (err) {
          fastify.log.error({ 
            error: err instanceof Error ? {
              message: err.message,
              stack: err.stack,
              name: err.name,
            } : err 
          }, "Error generating unified response");
          
          return reply.code(500).send(
            convertErrorToOllama(
              err instanceof Error ? err : new Error("Failed to generate response"),
              body.model || config.modelId
            )
          );
        }

        // Validate tool_call responses against available tools
        if (unifiedResponse.action === 'tool_call') {
          const toolCallResponse = unifiedResponse; // TypeScript narrows the type here
          const isValidTool = availableTools.some(
            (t) => t.function.name === toolCallResponse.tool_name,
          );

          if (!isValidTool && toolCallResponse.tool_name !== "unknown") {
            fastify.log.warn(
              {
                selected: toolCallResponse.tool_name,
                available: availableTools.map((t) => t.function.name),
              },
              "LLM selected invalid tool name, treating as unknown",
            );
            unifiedResponse = {
              action: 'tool_call',
              tool_name: "unknown",
              arguments: {}
            };
          }
        }

        // Calculate processing time
        const processingTimeMs = Date.now() - startTime;

        // Convert to Ollama response
        const response = convertUnifiedResponseToOllama(
          unifiedResponse,
          body.model || config.modelId,
          processingTimeMs,
        );

        fastify.log.info({ response }, "Sending Ollama response");

        return reply.code(200).send(response);
      } catch (err) {
        fastify.log.error({ 
          error: err instanceof Error ? {
            message: err.message,
            stack: err.stack,
            name: err.name,
          } : err 
        }, "Error processing chat request");

        const errorResponse = convertErrorToOllama(
          err instanceof Error ? err : new Error("Internal server error"),
          config.modelId,
        );

        return reply.code(500).send(errorResponse);
      }
    },
  );

  // Ollama /api/tags endpoint - list available models
  fastify.get("/api/tags", async () => {
    const response: OllamaTagsResponse = {
      models: [
        {
          name: config.modelId,
          model: config.modelId,
          modified_at: new Date().toISOString(),
          size: 0, // Placeholder - we don't have actual model size
          digest: "ha-ai-proxy",
          details: {
            format: "gguf",
            family: "llama",
            families: ["llama"],
            parameter_size: "70B", // Placeholder
            quantization_level: "Q4_0",
          },
        },
      ],
    };
    return response;
  });

  // Ollama /api/show endpoint - show model information
  fastify.post<{ Body: { name: string } }>("/api/show", async () => {
    const response: OllamaShowResponse = {
      modelfile: "# ha-ai proxy model\nFROM ha-ai-proxy",
      parameters: "temperature 0.7",
      template: "{{ .System }}\n{{ .Prompt }}",
      details: {
        format: "gguf",
        family: "llama",
        families: ["llama"],
        parameter_size: "70B",
        quantization_level: "Q4_0",
      },
    };
    return response;
  });

  // Ollama /api/version endpoint
  fastify.get("/api/version", async () => {
    const response: OllamaVersionResponse = {
      version: PACKAGE_VERSION,
    };
    return response;
  });

  return fastify;
}
