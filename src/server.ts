// Fastify server setup with Ollama-compatible API endpoints

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import type {
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaTagsResponse,
  OllamaShowResponse,
  OllamaVersionResponse,
} from './types/ollama.js';
import { getOpencodeService } from './services/opencode.js';
import type { Intent } from './types/intent.js';
import {
  extractMessagesFromOllama,
  convertIntentToOllama,
  convertErrorToOllama,
} from './adapters/ollamaAdapter.js';

const PACKAGE_VERSION = '0.1.0';

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
  fastify.get('/health', async () => {
    const opencodeService = getOpencodeService();
    return {
      status: 'ok',
      opencode: opencodeService.isConnected() ? 'connected' : 'disconnected',
      ollama_compatible: true,
    };
  });

  // Ollama-compatible chat endpoint
  fastify.post<{ Body: OllamaChatRequest }>(
    '/api/chat',
    async (request, reply) => {
      const startTime = Date.now();

      try {
        const body = request.body;

        // Log incoming request for debugging
        fastify.log.info({
          model: body.model,
          messageCount: body.messages?.length,
          stream: body.stream,
        }, 'Received Ollama chat request from HA');

        // Validate request
        if (!body.messages || body.messages.length === 0) {
          return reply.code(400).send({
            error: 'messages field is required and must not be empty',
          });
        }

        // Extract system context and user message
        const { systemContext, userMessage, isRepeatedRequest } = extractMessagesFromOllama(body);

        // Debug: log message history
        console.log('\n[DEBUG] Message history from HA:');
        console.log('Total messages:', body.messages.length);
        body.messages.slice(-5).forEach((msg, i) => {
          console.log(`Message ${i}:`, {
            role: msg.role,
            content: msg.content?.substring(0, 100),
            has_tool_calls: !!msg.tool_calls,
            tool_calls_count: msg.tool_calls?.length || 0,
          });
        });
        console.log('\n');

        if (!userMessage) {
          return reply.code(400).send({
            error: 'At least one user message is required',
          });
        }

        fastify.log.info({
          systemContextLength: systemContext.length,
          systemContextPreview: systemContext.substring(0, 200),
          userMessage,
          isRepeatedRequest,
        }, 'Extracted context and user message');

        // If this is a repeated request (HA is retrying after tool execution), return acknowledgment
        if (isRepeatedRequest) {
          fastify.log.info('Detected repeated request after tool execution, returning acknowledgment only');
          const processingTimeMs = Date.now() - startTime;
          const acknowledgment: OllamaChatResponse = {
            model: body.model || config.modelId,
            created_at: new Date().toISOString(),
            message: {
              role: 'assistant',
              content: 'Done',
            },
            done: true,
            done_reason: 'stop',
            total_duration: processingTimeMs * 1_000_000,
            eval_count: 1,
            eval_duration: processingTimeMs * 1_000_000,
          };
          return reply.code(200).send(acknowledgment);
        }

        // Debug: log full system context to console
        console.log('\n[DEBUG] Full system context:\n', systemContext, '\n');

        // Extract intent using OpenCode (Context-Aware)
        const opencodeService = getOpencodeService();
        const intentJsonStr = await opencodeService.extractIntent(
          systemContext,
          userMessage
        );

        fastify.log.info({ intentJson: intentJsonStr }, 'Extracted intent JSON');

        // Parse intent
        let intent: Intent;
        try {
          intent = JSON.parse(intentJsonStr);
          fastify.log.info({ parsedIntent: intent }, 'Successfully parsed intent');
        } catch (err) {
          // If LLM didn't return JSON (e.g., for "hello"), treat as unknown intent
          fastify.log.warn({ error: err, raw: intentJsonStr }, 'Failed to parse intent JSON, treating as unknown');
          intent = {
            intent: 'unknown',
            domain: 'unknown',
            entity_id: '',
          };
        }

        // Calculate processing time
        const processingTimeMs = Date.now() - startTime;

        // Convert intent to Ollama response
        const response: OllamaChatResponse = convertIntentToOllama(
          intent,
          body.model || config.modelId,
          processingTimeMs
        );

        fastify.log.info({ response }, 'Sending Ollama response');
        
        // Debug: log full response as JSON string
        console.log('\n[DEBUG] Full Ollama response being sent to HA:');
        console.log(JSON.stringify(response, null, 2));
        console.log('\n');

        return reply.code(200).send(response);
      } catch (err) {
        fastify.log.error({ error: err }, 'Error processing chat request');
        
        const errorResponse = convertErrorToOllama(
          err instanceof Error ? err : new Error('Internal server error'),
          config.modelId
        );

        return reply.code(500).send(errorResponse);
      }
    }
  );

  // Ollama /api/tags endpoint - list available models
  fastify.get('/api/tags', async () => {
    const response: OllamaTagsResponse = {
      models: [
        {
          name: config.modelId,
          model: config.modelId,
          modified_at: new Date().toISOString(),
          size: 0, // Placeholder - we don't have actual model size
          digest: 'ha-ai-proxy',
          details: {
            format: 'gguf',
            family: 'llama',
            families: ['llama'],
            parameter_size: '70B', // Placeholder
            quantization_level: 'Q4_0',
          },
        },
      ],
    };
    return response;
  });

  // Ollama /api/show endpoint - show model information
  fastify.post<{ Body: { name: string } }>('/api/show', async () => {
    const response: OllamaShowResponse = {
      modelfile: '# ha-ai proxy model\nFROM ha-ai-proxy',
      parameters: 'temperature 0.7',
      template: '{{ .System }}\n{{ .Prompt }}',
      details: {
        format: 'gguf',
        family: 'llama',
        families: ['llama'],
        parameter_size: '70B',
        quantization_level: 'Q4_0',
      },
    };
    return response;
  });

  // Ollama /api/version endpoint
  fastify.get('/api/version', async () => {
    const response: OllamaVersionResponse = {
      version: PACKAGE_VERSION,
    };
    return response;
  });

  return fastify;
}
