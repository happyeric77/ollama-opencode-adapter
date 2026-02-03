// Fastify server setup with Ollama-compatible API endpoints

import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaTagsResponse,
  OllamaShowResponse,
  OllamaVersionResponse,
} from "./types/ollama.js";
import type { ToolSelection } from "./types/tool-selection.js";
import { getOpencodeService } from "./services/opencode.js";
import {
  extractMessagesAndTools,
  convertToolSelectionToOllama,
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

        // Extract messages, tools, and detect repeated requests
        const {
          systemContext,
          userMessage,
          availableTools,
          isRepeatedRequest,
          hasQueryToolResult,
          toolResultContent,
        } = extractMessagesAndTools(body);

        // Debug: log tools from HA
        console.log("\n[DEBUG] Request tools from HA:");
        console.log("Tools count:", availableTools.length);
        if (availableTools.length > 0) {
          console.log(
            "Tool names:",
            availableTools.map((t) => t.function.name).join(", "),
          );
        }
        console.log("\n");

        // Debug: log message history
        console.log("\n[DEBUG] Message history from HA:");
        console.log("Total messages:", body.messages.length);
        body.messages.slice(-5).forEach((msg, i) => {
          console.log(`Message ${i}:`, {
            role: msg.role,
            content: msg.content?.substring(0, 100),
            has_tool_calls: !!msg.tool_calls,
            tool_calls_count: msg.tool_calls?.length || 0,
          });
        });
        console.log("\n");

        if (!userMessage) {
          return reply.code(400).send({
            error: "At least one user message is required",
          });
        }

        fastify.log.info(
          {
            systemContextLength: systemContext.length,
            userMessage,
            toolsAvailable: availableTools.length,
            isRepeatedRequest,
            hasQueryToolResult,
          },
          "Extracted context and user message",
        );

        // ============ Handle query tool results ============
        // If this is a query tool result (e.g., GetLiveContext), generate answer using the result
        if (hasQueryToolResult && toolResultContent) {
          fastify.log.info("Detected query tool result, generating answer from tool result");
          
          try {
            const opencodeService = getOpencodeService();
            
            // Create a prompt to generate answer based on tool result
            const answerPrompt = `${systemContext}

User asked: ${userMessage}

System Information:
${toolResultContent}

Based on the system information above, answer the user's question naturally and concisely.

CRITICAL: Detect the user's language and respond in the SAME language.
`.trim();

            const answerResponse = await opencodeService.sendPrompt(
              answerPrompt,
              userMessage,
              {
                sessionTitle: 'query-tool-answer',
                maxWaitMs: 30000,  // Increased from 15s to 30s
              }
            );
            
            const processingTimeMs = Date.now() - startTime;
            const totalDurationNs = processingTimeMs * 1_000_000;
            
            const response: OllamaChatResponse = {
              model: body.model || config.modelId,
              created_at: new Date().toISOString(),
              message: {
                role: 'assistant',
                content: answerResponse.content.trim(),
              },
              done: true,
              done_reason: 'stop',
              total_duration: totalDurationNs,
              eval_count: 1,
              eval_duration: totalDurationNs,
            };
            
            fastify.log.info({ answer: answerResponse.content }, "Generated answer from tool result");
            return reply.code(200).send(response);
          } catch (err) {
            fastify.log.error({ 
              error: err instanceof Error ? {
                message: err.message,
                stack: err.stack,
                name: err.name,
              } : err 
            }, "Error generating answer from tool result");
            // Fall through to normal error handling
          }
        }
        // ============ End query tool result handling ============

        // If this is a repeated request (HA is retrying after tool execution), return acknowledgment
        if (isRepeatedRequest) {
          fastify.log.info(
            "Detected repeated request after tool execution, returning acknowledgment only",
          );
          const processingTimeMs = Date.now() - startTime;
          const acknowledgment: OllamaChatResponse = {
            model: body.model || config.modelId,
            created_at: new Date().toISOString(),
            message: {
              role: "assistant",
              // TODO: If this means call_tool succeeded, we should make the content more informative
              content: "Done",
            },
            done: true,
            done_reason: "stop",
            total_duration: processingTimeMs * 1_000_000,
            eval_count: 1,
            eval_duration: processingTimeMs * 1_000_000,
          };
          return reply.code(200).send(acknowledgment);
        }

        // Check if tools are provided
        if (!availableTools || availableTools.length === 0) {
          fastify.log.error("No tools provided in request");
          return reply
            .code(400)
            .send(
              convertErrorToOllama(
                new Error(
                  "No tools provided in request. Please ensure tools are included in the API call.",
                ),
                body.model || config.modelId,
              ),
            );
        }

        // Debug: log full system context to console
        console.log("\n[DEBUG] Full system context:\n", systemContext, "\n");

        // Extract tool selection using OpenCode
        const opencodeService = getOpencodeService();
        const toolSelectionStr = await opencodeService.extractToolSelection(
          systemContext,
          userMessage,
          availableTools,
        );

        fastify.log.info({ toolSelectionStr }, "Extracted tool selection JSON");

        // Parse tool selection
        let toolSelection: ToolSelection;
        try {
          toolSelection = JSON.parse(toolSelectionStr);
          fastify.log.info(
            { toolSelection },
            "Successfully parsed tool selection",
          );
        } catch (err) {
          // If LLM didn't return JSON, treat as unknown
          fastify.log.warn(
            { error: err, raw: toolSelectionStr },
            "Failed to parse tool selection JSON",
          );
          toolSelection = {
            tool_name: "unknown",
            arguments: {},
          };
        }

        // ============ Handle conversational requests ============
        if (toolSelection.tool_name === "chat") {
          fastify.log.info("Detected conversational request, generating chat response");
          
          try {
            const chatResponse = await opencodeService.handleConversation(
              userMessage,
              systemContext  // Pass client's system context
            );
            
            const processingTimeMs = Date.now() - startTime;
            const totalDurationNs = processingTimeMs * 1_000_000;
            
            const response: OllamaChatResponse = {
              model: body.model || config.modelId,
              created_at: new Date().toISOString(),
              message: {
                role: 'assistant',
                content: chatResponse,
              },
              done: true,
              done_reason: 'stop',
              total_duration: totalDurationNs,
              eval_count: 1,
              eval_duration: totalDurationNs,
            };
            
            fastify.log.info({ response: chatResponse }, "Sending chat response");
            return reply.code(200).send(response);
          } catch (err) {
            fastify.log.error({ 
              error: err instanceof Error ? {
                message: err.message,
                stack: err.stack,
                name: err.name,
              } : err 
            }, "Error generating chat response");
            // Fall through to normal error handling
          }
        }
        // ============ End conversational handling ============

        // Validate tool_name against available tools
        const isValidTool = availableTools.some(
          (t) => t.function.name === toolSelection.tool_name,
        );

        if (!isValidTool && toolSelection.tool_name !== "unknown" && toolSelection.tool_name !== "chat") {
          fastify.log.warn(
            {
              selected: toolSelection.tool_name,
              available: availableTools.map((t) => t.function.name),
            },
            "LLM selected invalid tool name, treating as unknown",
          );
          toolSelection.tool_name = "unknown";
        }

        // Calculate processing time
        const processingTimeMs = Date.now() - startTime;

        // Convert to Ollama response
        const response = convertToolSelectionToOllama(
          toolSelection,
          body.model || config.modelId,
          processingTimeMs,
        );

        fastify.log.info({ response }, "Sending Ollama response");

        // Debug: log full response as JSON string
        console.log("\n[DEBUG] Full Ollama response being sent to HA:");
        console.log(JSON.stringify(response, null, 2));
        console.log("\n");

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
