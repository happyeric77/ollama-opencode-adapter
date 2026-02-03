# ha-ai

OpenAI-compatible proxy server for Home Assistant using OpenCode SDK and GitHub Copilot.

## Overview

**ha-ai** allows Home Assistant to use GitHub Copilot (via OpenCode) as its voice assistant LLM backend for smart home device control. It translates natural language commands into Home Assistant tool calls using the native OpenAI integration.

## Architecture

```
Home Assistant (192.168.68.60)
  └─ OpenAI Integration
      └─ ha-ai Proxy (port 3000)
          └─ @opencode-ai/sdk
              └─ opencode serve (localhost:7272)
                  └─ GitHub Copilot / gpt-4o
```

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- Intent extraction from natural language commands
- Automatic mapping to Home Assistant tool calls (HassTurnOn, HassTurnOff, etc.)
- Session-based communication with OpenCode SDK
- Structured logging with Pino

## Prerequisites

1. **OpenCode CLI** installed and authenticated with GitHub Copilot
   ```bash
   npm install -g opencode
   opencode auth login
   ```

2. **OpenCode server running**
   ```bash
   opencode serve --port 7272
   ```

3. **Node.js v22+** installed

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `LOG_LEVEL` | info | Log level (fatal, error, warn, info, debug, trace) |
| `OPENCODE_URL` | http://localhost | OpenCode server URL |
| `OPENCODE_PORT` | 7272 | OpenCode server port |
| `MODEL_PROVIDER` | github-copilot | LLM provider |
| `MODEL_ID` | gpt-4o | Model ID |
| `API_KEY` | - | Optional API key for securing the proxy |

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Testing

```bash
npm test
npm run test:ui    # Run tests with UI
npm run test:run   # Run tests once
```

## API Endpoints

### Health Check

```bash
GET /health
```

### Chat Completions (OpenAI-compatible)

```bash
POST /v1/chat/completions
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "user",
      "content": "Turn on the living room light"
    }
  ]
}
```

Response:

```json
{
  "id": "chatcmpl-1234567890",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_1234567890",
            "type": "function",
            "function": {
              "name": "HassTurnOn",
              "arguments": "{\"name\":\"living room light\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

## Supported Intents

| Intent | Home Assistant Tool | Example |
|--------|---------------------|---------|
| turn_on | HassTurnOn | "Turn on the living room light" |
| turn_off | HassTurnOff | "Turn off kitchen lights" |
| set_temperature | HassTurnOn (with temp) | "Set temperature to 22 degrees" |
| set_brightness | HassLightSet | "Set brightness to 80%" |

## Project Structure

```
ha-ai/
├── src/
│   ├── index.ts              # Main entry point
│   ├── server.ts             # Fastify server setup
│   ├── config.ts             # Configuration loader
│   ├── types/
│   │   ├── openai.ts         # OpenAI API types
│   │   └── intent.ts         # Intent extraction types
│   └── services/
│       └── opencode.ts       # OpenCode SDK wrapper
├── tests/
│   ├── unit/
│   └── integration/
├── poc/                      # Phase 0 PoC tests
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Development Notes

- Phase 0 (PoC) completed with 100% success rate on intent extraction
- Uses session-based OpenCode SDK (create → prompt → poll → delete)
- Response times: 1-4 seconds (acceptable for voice assistant)
- No custom Home Assistant components needed

## License

ISC
