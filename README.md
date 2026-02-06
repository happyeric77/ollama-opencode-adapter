# ollama-opencode-adapter

> Use cloud-based LLMs with any Ollama-compatible application — no powerful hardware required

## What Is This?

An adapter that implements the Ollama API, allowing any Ollama-compatible application to use **75+ cloud LLM providers** through OpenCode. Works seamlessly with Home Assistant, n8n, and any other tool that supports Ollama.

**In Simple Terms:**

- Your app thinks it's talking to Ollama
- The adapter translates requests to OpenCode
- OpenCode routes them to your chosen cloud provider (OpenAI, Anthropic, GitHub Copilot, etc.)
- You get powerful cloud models without running anything locally

## Why Use This?

### The Problem with Native Ollama

Running Ollama locally requires:

- Powerful hardware (GPU with sufficient VRAM)
- Large disk space for model weights
- Limited to models that can run on your hardware
- Self-managed model updates

### The Solution: Cloud LLMs via OpenCode

This adapter lets you use:

- **75+ cloud providers** including OpenAI, Anthropic, GitHub Copilot, AWS Bedrock, Google Vertex AI, and more
- **Latest models** like GPT-5.2, Claude 4.5 Sonnet, Gemini 3 Pro
- **Flexible authentication** — OAuth (Google Antigravity, GitHub Copilot, OpenAI), API keys (OpenAI, Claude, ...etc), or Enterprise (AWS IAM, Google Service Accounts)
- **No hardware requirements** — runs on a Raspberry Pi or any low-power device
- **100% Ollama-compatible** — drop-in replacement, no app modifications needed

### Key Advantages

| Feature        | Native Ollama           | This Adapter                  |
| -------------- | ----------------------- | ----------------------------- |
| Hardware       | Powerful GPU required   | Any device (even RPi)         |
| Models         | Limited to local models | 75+ cloud providers           |
| Authentication | N/A                     | OAuth/API keys/Enterprise     |
| Setup          | Download GBs of weights | Configure once, use instantly |
| Cost           | Hardware investment     | Pay-per-use (or free tiers)   |
| Privacy        | Fully local             | Cloud-based                   |

## Quick Start

Choose your preferred deployment method:

- **[Docker Deployment](#docker-deployment)** (Recommended) - Quickest setup, no Node.js required
- **[Manual Installation](#manual-installation)** - For development or custom configurations

Both methods require OpenCode CLI to be running. If using Docker, OpenCode is included in the container.

---

## Docker Deployment

### Prerequisites

- Docker and Docker Compose installed ([Get Docker](https://docs.docker.com/get-docker/))

### Using Docker Compose (Recommended)

**Step 1: Clone the repository and use the provided configuration**

```bash
git clone https://github.com/happyeric77/ollama-opencode-adapter
cd ollama-opencode-adapter

# (Optional) Edit docker-compose.yml to customize MODEL_PROVIDER and MODEL_ID
nano docker-compose.yml
```

Or download just the `docker-compose.yml`:

```bash
curl -O https://raw.githubusercontent.com/happyeric77/ollama-opencode-adapter/main/docker-compose.yml
```

**Step 2: Start the service**

```bash
docker compose up -d
```

**Step 3: Authenticate with OpenCode (One-time)**

```bash
# Enter the running container
docker exec -it ollama-adapter bash

# Run the OpenCode CLI `auth login` command to authenticate
opencode auth login
# Select your provider (e.g., GitHub Copilot, OpenAI, Anthropic)
# Complete the authentication flow

# Exit the container
exit
```

**Important:** Authentication is persisted in the `opencode-auth` volume, so you only need to do this once. The credentials survive container restarts.

**Step 4: Verify**

```bash
# Check service status
docker compose ps

# Check health endpoint
curl http://localhost:3000/health
# Should return: {"status":"ok","opencode":"connected","ollama_compatible":true}

# View logs
docker compose logs -f
```

**Useful Commands:**

```bash
# Stop the service
docker compose down

# Update to latest image
docker compose pull && docker compose up -d

# Restart the service
docker compose restart
```

### Using Docker CLI

If you prefer using Docker CLI directly:

```bash
# Create volume for authentication persistence
docker volume create opencode-auth

# Run the container
docker run -d \
  --name ollama-adapter \
  -p 3000:3000 \
  -p 7272:7272 \
  -e MODEL_PROVIDER=github-copilot \
  -e MODEL_ID=gpt-4o \
  -v opencode-auth:/root/.local/share/opencode \
  ghcr.io/happyeric77/ollama-opencode-adapter:latest

# Authenticate (same as Docker Compose Step 3)
docker exec -it ollama-adapter bash
opencode auth login
exit
```

### Next Steps

After Docker deployment, proceed to [Connect Your Application](#connect-your-application) to integrate with Home Assistant, n8n, or other Ollama-compatible apps.

---

## Manual Installation

Use this method if you need to customize the code or run the adapter in development mode.

### Prerequisites

1. **OpenCode CLI** installed and running

```bash
# Install OpenCode (if not already installed)
npm install -g @opencode-ai/cli

# Start OpenCode server
opencode serve --port 7272
```

2. **Node.js v22+** installed

### Step 1: Authenticate with OpenCode (One-time Setup)

Authentication happens in OpenCode, not in this adapter. You only need to do this once:

```bash
# Open OpenCode CLI
opencode

# Connect to your preferred provider
/connect

# Follow the prompts to select a provider:
# - GitHub Copilot (OAuth, recommended for personal use)
# - OpenAI (API key)
# - Anthropic (API key)
# - AWS Bedrock (IAM credentials)
# - Google Vertex AI (Service Account)
# ... and 70+ more options
```

After authentication, OpenCode stores your credentials securely. The adapter will use these credentials automatically.

### Step 2: Install and Configure the Adapter

```bash
# Clone the repository
git clone https://github.com/happyeric77/ollama-opencode-adapter
cd ollama-opencode-adapter

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env to select your provider and model
nano .env
```

**Example `.env` configuration:**

```bash
# Server settings
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# OpenCode connection
OPENCODE_URL=http://localhost
OPENCODE_PORT=7272

# Model selection (choose the provider you authenticated with)
MODEL_PROVIDER=github-copilot
MODEL_ID=gpt-4o

# Popular provider examples:
# MODEL_PROVIDER=openai
# MODEL_ID=gpt-4o

# MODEL_PROVIDER=anthropic
# MODEL_ID=claude-3-5-sonnet-20241022

# MODEL_PROVIDER=deepseek
# MODEL_ID=deepseek-chat
```

**Important:** `MODEL_PROVIDER` and `MODEL_ID` just tell the adapter which provider to use. Authentication is handled by OpenCode (see Step 1).

### Step 3: Start the Adapter

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm run build
npm start
```

The adapter will be available at `http://localhost:3000` with full Ollama API compatibility.

## Connect Your Application

After deploying the adapter (via Docker or manual installation), point your Ollama-compatible app to the adapter:

**Home Assistant Example:**

```yaml
# configuration.yaml
conversation:
  - platform: ollama
    url: http://localhost:3000 # ← Point to the adapter
    model: gpt-4o # ← Match MODEL_ID in .env
```

**n8n Example:**

In your n8n Ollama node configuration:

- Base URL: `http://localhost:3000`
- Model: `gpt-4o`

**Generic Ollama Client:**

```bash
# Any tool using Ollama API
export OLLAMA_HOST=http://localhost:3000
```

That's it! Your application now uses cloud LLMs through the Ollama API.

## How It Works

```
┌─────────────────────┐
│   Your Application  │  (Home Assistant, n8n, etc.)
│   (Ollama API)      │
└──────────┬──────────┘
           │ POST /api/chat
           │ {messages, tools}
           ▼
┌─────────────────────────────────────┐
│  ollama-opencode-adapter            │
│  (Port 3000)                        │
│                                     │
│  • Receives Ollama API requests     │
│  • Translates to OpenCode format    │
│  • Handles function calling logic   │
│  • Converts responses back          │
└──────────┬──────────────────────────┘
           │ OpenCode SDK
           ▼
┌─────────────────────┐
│  OpenCode Server    │  (Port 7272)
│                     │
│  • Manages auth     │
│  • Routes to cloud  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Cloud Provider     │  (OpenAI, Anthropic, etc.)
│  (Your choice)      │
└─────────────────────┘
```

## Features

### 1. 100% Ollama API Compatible

Implements all essential Ollama endpoints:

- `POST /api/chat` — Chat completions with function calling
- `GET /api/tags` — List available models
- `POST /api/show` — Show model information
- `GET /api/version` — Version information
- `GET /health` — Health check

Your existing Ollama-compatible applications work without modifications.

### 2. 75+ Cloud Provider Support

Access a wide range of providers through OpenCode.

See [OpenCode Providers](https://opencode.ai/docs/providers) for the complete list.

### 3. Full Function Calling Support

The adapter implements function calling (tools) through intelligent LLM-based decision making:

- Parses tool definitions from Ollama API
- Uses LLM to decide between three response types:
  - **Tool Call**: Execute an action or query device state
  - **Answer**: Generate answer based on available tool results
  - **Chat**: Respond conversationally (greetings, thanks, general chat)
- Returns properly formatted responses in Ollama format
- Supports multi-step tool execution

### 4. Multi-turn Conversations

Maintains full conversation history:

- Preserves all previous messages (user, assistant, tool results)
- Context-aware responses based on conversation flow
- No state assumptions — always checks current state when needed
- LLM generates natural language responses in user's language

### 5. Chat-Only Mode

Works perfectly even without tools:

- If no tools are provided, responds conversationally
- Automatically detects when to use tools vs. chat responses
- Falls back gracefully when tool execution fails

### 6. Graceful Error Handling

Robust error handling for production use:

- Timeouts and retries for OpenCode communication
- Fallback to conversational mode on errors
- Detailed logging for debugging
- Health check endpoint for monitoring

## Authentication

### How Authentication Works

**Important:** This adapter does **not** handle authentication. Authentication is managed entirely by OpenCode.

**The Flow:**

1. You authenticate once with OpenCode using `/connect`
2. OpenCode securely stores your credentials
3. The adapter tells OpenCode which provider to use (`MODEL_PROVIDER`)
4. OpenCode uses its stored credentials to communicate with the provider
5. The adapter never sees your API keys or OAuth tokens

### Setting Up Authentication

**Step 1: Authenticate via OpenCode CLI**

```bash
opencode
/connect
```

**Step 2: Choose Your Provider**

OpenCode supports multiple authentication methods:

| Method         | Providers                                | Use Case                         |
| -------------- | ---------------------------------------- | -------------------------------- |
| **OAuth**      | GitHub Copilot, Claude Pro, ChatGPT Plus | Personal use, no API keys needed |
| **API Key**    | OpenAI, Anthropic, DeepSeek, Groq        | Developer accounts               |
| **Enterprise** | AWS Bedrock, Google Vertex AI, Azure     | Corporate deployments            |

**Step 3: Configure the Adapter**

Edit `.env` to specify which authenticated provider to use:

```bash
MODEL_PROVIDER=github-copilot  # Must match what you authenticated with
MODEL_ID=gpt-4o
```

**Step 4: Verify**

```bash
# Start the adapter
npm start

# Check health endpoint
curl http://localhost:3000/health

# Should return:
# {"status":"ok","opencode":"connected","ollama_compatible":true}
```

### Popular Provider Setup Examples

**GitHub Copilot (OAuth)**

```bash
# In OpenCode CLI:
/connect
# Select: GitHub Copilot
# Authenticate via GitHub OAuth

# In .env:
MODEL_PROVIDER=github-copilot
MODEL_ID=gpt-4o
```

For other providers, see [OpenCode Authentication Guide](https://opencode.ai/docs/authentication).

## Configuration

### Environment Variables

All configuration is done via environment variables (`.env` file):

```bash
# Server Configuration
PORT=3000                    # Port for the adapter to listen on
HOST=0.0.0.0                # Listen on all network interfaces
LOG_LEVEL=info              # Logging level: fatal|error|warn|info|debug|trace

# OpenCode Connection
OPENCODE_URL=http://localhost   # OpenCode server URL
OPENCODE_PORT=7272             # OpenCode server port (default: 7272)

# Model Selection
MODEL_PROVIDER=github-copilot  # Provider ID (must match OpenCode authentication)
MODEL_ID=gpt-4o               # Model ID for the selected provider
```

### Understanding MODEL_PROVIDER and MODEL_ID

These variables tell the adapter **which provider to use**, not how to authenticate:

- **MODEL_PROVIDER**: The provider identifier in OpenCode (e.g., `github-copilot`, `openai`, `anthropic`)
- **MODEL_ID**: The specific model to use from that provider (e.g., `gpt-5` )

**Important:** You must have already authenticated with this provider in OpenCode (via `/connect`).

For more details on opencode providers and models, see [OpenCode Models](https://opencode.ai/docs/models/).

### Network Configuration

**Local Setup (default):**

```bash
OPENCODE_URL=http://localhost
OPENCODE_PORT=7272
```

**Remote OpenCode Server:**

```bash
OPENCODE_URL=http://your-server-ip
OPENCODE_PORT=7272
```

**Expose Adapter on Network:**

```bash
HOST=0.0.0.0  # Allow connections from other devices
PORT=3000
```

## Use Cases

### Home Assistant Voice Assistant

Use cloud LLMs for natural voice interactions with your smart home.

1. Add Ollama Integration.
2. Add a new conversation agent under `Devices & Services -> Ollama`

- Set URL to `http://localhost:3000`
- Set Model to `gpt-4o`

3. Go to `Settings -> Voice Assistants`
4. Select your Ollama agent for voice commands

### n8n Workflow Automation

Integrate cloud LLMs into your n8n workflows:

1. Add an "Ollama" node to your workflow
2. Configure:
   - Base URL: `http://localhost:3000`
   - Model: `gpt-4o`
3. Use function calling to interact with other services

### Custom Applications

Any application supporting Ollama can benefit:

```javascript
// Example: Using with Ollama client library
import { Ollama } from "ollama";

const ollama = new Ollama({
  host: "http://localhost:3000",
});

const response = await ollama.chat({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
  tools: [
    /* your function definitions */
  ],
});
```

## API Reference

This adapter implements the Ollama API specification. For complete API documentation, see [Ollama API Documentation](https://github.com/ollama/ollama/blob/main/docs/api.md).

### Key Endpoints

**POST /api/chat**

- Standard chat completion with tool support
- Accepts: `{model, messages, tools, stream}`
- Returns: Ollama-formatted chat response with tool calls

**GET /api/tags**

- List available models
- Returns: Model information including name, size, format

**GET /health**

- Health check endpoint
- Returns: `{status, opencode, ollama_compatible}`

### Differences from Native Ollama

While this adapter aims for 100% compatibility, there are some implementation differences:

1. **Streaming**: Not yet supported (responses are always complete)
2. **Model Management**: Models are not downloaded locally (handled by cloud providers)
3. **Response Times**: Slightly slower due to additional processing layer

For most use cases, these differences are transparent to the client application.

## Limitations & Trade-offs

### Performance

| Aspect      | Native Ollama  | This Adapter              |
| ----------- | -------------- | ------------------------- |
| Latency     | 1-2 seconds    | 3-5 seconds               |
| Throughput  | Limited by GPU | Limited by API quotas     |
| Offline Use | ✅ Yes         | ❌ No (requires internet) |

**Why Slower?**

- Network round-trip to cloud provider
- Additional processing layer for function calling
- OpenCode session management overhead

### Privacy Considerations

**Native Ollama:**

- All data stays local
- Complete privacy
- No data sent externally

**This Adapter:**

- Messages sent to cloud providers
- Subject to provider's privacy policy
- Not suitable for sensitive/confidential data

**Recommendation:** Use native Ollama for sensitive applications. Use this adapter for convenience and access to powerful models.

### Reliability

The adapter depends on:

1. **OpenCode Server** — Must be running and accessible
2. **Internet Connection** — Required for cloud provider communication
3. **Provider Availability** — Subject to cloud provider uptime
4. **API Quotas** — Limited by your provider's rate limits

**Mitigation:** The adapter includes timeout handling, retries, and graceful degradation to chat-only mode on errors.

### Cost

**Native Ollama:** Free (but requires hardware investment)

**This Adapter:** Pay-per-use based on provider pricing

- **Free Tiers Available:** Many providers offer free usage tiers
- **OpenAI:** Pay-as-you-go api token usage or Openai Plus subscription
- **Google:** Pay -as-you-go based on token usage or Google AI Pro subscription
- **GitHub Copilot:** GitHub Copilot subscription

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

**Test Coverage:**

- ✅ 37 unit tests for ConversationHelper
- ✅ 11 unit tests for OllamaAdapter
- ✅ 7 integration tests
- **Total: 55 tests passing**

### Development Mode

```bash
# Start with auto-reload
npm run dev

# Type checking
npm run type-check

# Linting
npm run lint
```

### Building for Production

```bash
# Build TypeScript
npm run build

# Run built version
npm start
```

## Project Structure

```
ollama-opencode-adapter/
├── src/
│   ├── index.ts                    # Entry point
│   ├── server.ts                   # Fastify server, request orchestration
│   ├── config.ts                   # Configuration loader
│   │
│   ├── types/
│   │   ├── ollama.ts               # Ollama API types
│   │   └── tool-selection.ts       # Internal tool selection types
│   │
│   ├── services/
│   │   ├── opencode.ts             # OpenCode SDK wrapper
│   │   └── conversationHelper.ts   # Conversation history utilities
│   │
│   └── adapters/
│       └── ollamaAdapter.ts        # Format conversions (Ollama ↔ internal)
│
├── tests/
│   ├── unit/
│   │   ├── conversationHelper.test.ts   # 37 tests
│   │   └── ollamaAdapter.test.ts        # 11 tests
│   └── integration/
│       └── context-aware.test.ts        # 7 tests
│
├── docs/
│   └── ARCHITECTURE.md             # Technical deep-dive
│
├── .env.example                    # Configuration template
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### For Developers

Want to understand how the adapter works internally? See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for:

- Why manual function calling is complex
- Tool selection strategy and prompt engineering
- Conversation history implementation
- OpenCode session management
- Error handling and fallback mechanisms

## Troubleshooting

### Debug Mode

Enable detailed logging for troubleshooting:

```bash
# In .env
LOG_LEVEL=debug

# Restart adapter
npm start

# Logs will show:
# - Incoming requests
# - Tool selection prompts
# - OpenCode responses
# - Conversation history
# - Error details
```

### Getting Help

- **Issues:** [GitHub Issues](https://github.com/happyeric77/ollama-opencode-adapter/issues)
- **Discussions:** [GitHub Discussions](https://github.com/happyeric77/ollama-opencode-adapter/discussions)
- **OpenCode Docs:** [https://opencode.ai/docs](https://opencode.ai/docs)

## Why This Exists

OpenCode provides access to 75+ LLM providers with flexible authentication, but it doesn't expose a function calling API like OpenAI's Chat Completions API or Ollama's native function calling.

This adapter bridges that gap by:

1. Implementing the Ollama API specification
2. Translating function calling requests into OpenCode prompts
3. Intelligently selecting tools via prompt engineering
4. Converting responses back to Ollama format

This allows any Ollama-compatible application to leverage OpenCode's provider ecosystem without modification.

**Note:** This is a workaround necessitated by OpenCode's current API design. If OpenCode adds native function calling support in the future, much of this complexity could be removed.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.
