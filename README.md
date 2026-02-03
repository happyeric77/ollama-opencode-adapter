# ollama-opencode-adapter

> Universal adapter implementing Ollama-compatible API using OpenCode SDK with manual function calling support

## What Is This?

This is a **protocol adapter** that allows applications expecting Ollama's API (with native function calling) to use OpenCode SDK instead.

**The Problem:**
- **Standard**: Ollama API with native function calling (what apps expect)
- **Reality**: OpenCode SDK with simple prompt API (what we have)
- **Gap**: OpenCode doesn't support function calling natively

**The Solution:**
- Implement Ollama API endpoints (`/api/chat`, etc.)
- Manually parse tools and user intent via prompt engineering
- Invoke OpenCode to make tool selection decisions
- Convert responses back to Ollama format

## Why Is This Complex?

You might expect ~50 lines for format conversion. We have ~500 lines because:

1. **Manual Function Calling** (~200 lines)
   - OpenCode doesn't support function calling
   - We must prompt the LLM to select tools
   - We must parse JSON from unstructured text responses

2. **Stability & Fallback** (~100 lines)
   - OpenCode can timeout or become unresponsive
   - We implement timeouts, retries, fallback mechanisms
   - Graceful degradation when OpenCode is unavailable

3. **Multi-turn Conversations** (~100 lines)
   - Detect when user wants chat vs tool execution
   - Handle tool result processing (convert to natural language)
   - Prevent infinite loops from repeated requests

4. **Format Conversions** (~100 lines)
   - Ollama format ↔ internal format ↔ OpenCode format
   - Tool schema transformations
   - Error handling and logging

## Architecture

```
┌─────────────────┐
│  Client App     │  (e.g., Home Assistant, Custom App)
│  (Ollama API)   │
└────────┬────────┘
         │ POST /api/chat
         │ {messages, tools}
         ▼
┌─────────────────────────────────────────┐
│  ollama-opencode-adapter (this project) │
│                                         │
│  1. Parse Ollama request                │
│  2. Extract system context & tools      │
│  3. Call OpenCode for tool selection    │
│  4. Parse response, detect intent       │
│  5. Return Ollama-formatted response    │
└────────┬────────────────────────────────┘
         │ OpenCode SDK
         ▼
┌─────────────────┐
│  OpenCode       │  (port 7272)
│  Server         │
└─────────────────┘
```

## Use Cases

### Example 1: Home Assistant

Home Assistant's Ollama integration can point to this adapter to leverage OpenCode/GitHub Copilot for voice assistant functionality.

```yaml
# Home Assistant configuration.yaml
conversation:
  - platform: ollama
    url: http://localhost:3000  # ← This adapter
    model: gpt-4o
```

### Example 2: Custom Tool-Based App

Any application that:
- Has defined tools/functions
- Wants to use OpenCode/GitHub Copilot
- Expects Ollama-compatible API

Can use this adapter without modifications.

## Installation & Setup

### Prerequisites

1. **OpenCode Server** running on port 7272
   ```bash
   opencode serve --port 7272
   ```

2. **Node.js v22+**

### Setup

1. Clone and install:
   ```bash
   git clone <repo>
   cd ollama-opencode-adapter
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. Run:
   ```bash
   npm run dev   # Development
   npm run build && npm start  # Production
   ```

## Configuration

```bash
# Server
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# OpenCode
OPENCODE_URL=http://localhost
OPENCODE_PORT=7272

# Model
MODEL_PROVIDER=github-copilot
MODEL_ID=gpt-4o

# Optional: API Key for securing the proxy
# API_KEY=your-secret-key-here
```

## API Reference

### POST /api/chat

Standard Ollama chat completion endpoint with tool support.

**Request:**
```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant"},
    {"role": "user", "content": "What's the weather?"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "GetWeather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          }
        }
      }
    }
  ]
}
```

**Response:**
```json
{
  "model": "gpt-4o",
  "created_at": "2026-02-03T...",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "function": {
          "name": "GetWeather",
          "arguments": {"location": "Tokyo"}
        }
      }
    ]
  },
  "done": true
}
```

## Limitations & Trade-offs

### Compared to Native Ollama

| Feature | Native Ollama | This Adapter |
|---------|--------------|--------------|
| Function calling | ✅ Native | ⚠️ Manual (via prompting) |
| Response time | Fast (~1-2s) | Slower (~3-5s) |
| Reliability | Very stable | Depends on OpenCode |
| Accuracy | High | Good (depends on prompt) |

### Known Issues

1. **OpenCode Timeouts**: OpenCode occasionally times out. We have fallback mechanisms that return conversational responses.
2. **Prompt Engineering**: Tool selection accuracy depends on prompt quality. The current prompt works well but may need tuning for specific use cases.
3. **Latency**: Extra LLM calls add ~2-3s compared to native function calling.

## Project Structure

```
ollama-opencode-adapter/
├── src/
│   ├── index.ts              # Main entry point
│   ├── server.ts             # Fastify server, request orchestration
│   ├── config.ts             # Configuration loader
│   ├── types/
│   │   ├── ollama.ts         # Ollama API types
│   │   └── tool-selection.ts # Internal tool selection types
│   ├── services/
│   │   └── opencode.ts       # OpenCode SDK wrapper, tool selection logic
│   └── adapters/
│       └── ollamaAdapter.ts  # Format conversions (Ollama ↔ internal)
├── tests/
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
├── docs/
│   └── FUTURE_ENHANCEMENTS.md
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Development

```bash
# Run tests
npm test

# Run with watch mode
npm run dev

# Type checking
npm run build
```

## Why This Exists

OpenCode SDK is powerful but doesn't expose function calling APIs like OpenAI's Chat Completion API. This adapter bridges that gap, allowing any Ollama-compatible application to leverage OpenCode and its underlying models (like GitHub Copilot) without modification.

This is a **workaround** necessitated by OpenCode's current API design. If OpenCode adds native function calling support in the future, much of this complexity could be removed.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

ISC
