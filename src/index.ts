// Main entry point for ollama-opencode-adapter

import { createServer } from './server.js';
import { config } from './config.js';
import { getOpencodeService } from './services/opencode.js';

async function start() {
  try {
    console.log('Starting ollama-opencode-adapter...');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Log level: ${config.logLevel}`);

    // Connect to OpenCode
    console.log(`Connecting to OpenCode at ${config.opencodeUrl}:${config.opencodePort}...`);
    const opencodeService = getOpencodeService();
    await opencodeService.connect();
    console.log('Connected to OpenCode successfully');

    // Create and start Fastify server
    const server = await createServer();
    
    await server.listen({
      host: config.host,
      port: config.port,
    });

    console.log(`Server listening on ${config.host}:${config.port}`);
    console.log(`Model: ${config.modelProvider} / ${config.modelId}`);
    console.log('');
    console.log('Ollama-compatible API endpoints:');
    console.log(`  GET  http://${config.host}:${config.port}/health`);
    console.log(`  POST http://${config.host}:${config.port}/api/chat`);
    console.log(`  GET  http://${config.host}:${config.port}/api/tags`);
    console.log(`  POST http://${config.host}:${config.port}/api/show`);
    console.log(`  GET  http://${config.host}:${config.port}/api/version`);
    console.log('');
    console.log('Ready to accept requests from Ollama-compatible clients!');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down gracefully...`);
      
      try {
        await server.close();
        console.log('Server closed');
        
        await opencodeService.close();
        console.log('OpenCode connection closed');
        
        process.exit(0);
      } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
