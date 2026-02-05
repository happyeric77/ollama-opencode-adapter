# Architecture Documentation

> Technical deep-dive into the ollama-opencode-adapter implementation

This document is for developers who want to understand how the adapter works internally. If you just want to use the adapter, see the main [README.md](../README.md).

## Table of Contents

- [Why Is This Complex?](#why-is-this-complex)
- [Architecture Overview](#architecture-overview)
- [Component Details](#component-details)
- [Function Calling Implementation](#function-calling-implementation)
- [Conversation History](#conversation-history)
- [Tool Selection Strategy](#tool-selection-strategy)
- [Error Handling](#error-handling)
- [Performance Considerations](#performance-considerations)

## Why Is This Complex?

You might expect a simple adapter between two APIs to be ~50-100 lines of code. This implementation is ~1,100 lines. Here's why:

### 1. Unified Response Generation (~300 lines)

**The Problem:**

- OpenCode doesn't support function calling natively
- It only has a simple prompt API: send text, get text back
- Ollama API expects native function calling support
- Need to decide between tool calls, answers, and chat responses

**Our Solution:**

- LLM-based unified response generation
- Single decision point: tool_call, answer, or chat
- No hardcoded tool type assumptions
- No state assumptions from conversation history
- Intelligent handling of tool results

**Code Locations:**

- `src/services/opencode.ts` — `generateResponse()` method (~170 lines)
- `src/adapters/ollamaAdapter.ts` — Format conversions (~150 lines)
- `src/server.ts` — Unified flow orchestration (~80 lines)

**Complexity Factors:**

- LLMs don't always return valid JSON
- Tool names might be hallucinated
- Parameter extraction from natural language
- Multi-language support (detect user's language)
- Fallback when response generation fails

### 2. Stability & Fallback Mechanisms (~300 lines)

**The Problem:**

- OpenCode can timeout or become unresponsive
- Cloud providers can be slow or unavailable
- Session management can fail

**Our Solution:**

- Implement comprehensive timeout handling
- Retry logic for transient failures
- Fallback to chat-only mode on errors
- Session cleanup in finally blocks
- Health check endpoint for monitoring

**Code Locations:**

- `src/services/opencode.ts` — Session management with timeouts (~150 lines)
- `src/server.ts` — Error handling and fallbacks (~100 lines)
- Timeout configurations scattered throughout (~50 lines)

**Key Patterns:**

```typescript
// Promise.race for timeout handling
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error("Timeout")), 20000),
);
await Promise.race([operation(), timeoutPromise]);

// Fallback to chat mode on errors
try {
  return await extractToolSelection();
} catch (err) {
  console.error("Tool selection failed, falling back to chat");
  return { tool_name: "chat", arguments: {} };
}

// Session cleanup in finally block
try {
  const session = await createSession();
  // ... use session
} finally {
  await deleteSession(session.id); // Always cleanup
}
```

### 3. Multi-turn Conversation Handling (~200 lines)

**The Problem:**

- Need to preserve conversation history across turns
- Detect when to use tool calls vs. generate answers vs. chat
- Handle tool result processing (convert to natural language)
- Support multi-language conversations
- Device state can change outside our control

**Our Solution:**

- Full conversation history preservation (no truncation)
- Smart context selection (last 10 messages for tool selection)
- Dedicated `ConversationHelper` service with 6 utility methods
- LLM generates all responses in user's language
- No repeated request detection — always check current state

**Code Locations:**

- `src/services/conversationHelper.ts` — 6 static utility methods (~200 lines)
- `src/services/opencode.ts` — Unified response generation (~100 lines)
- `src/server.ts` — Single unified flow (~80 lines)

**Key Features:**

```typescript
// Build tool selection context (last N messages)
ConversationHelper.buildToolSelectionContext(history, 10);

// Build full conversation prompt (all messages)
ConversationHelper.buildConversationPrompt(history, systemContext);

// Extract last user message
ConversationHelper.getLastUserMessage(history);

// Count messages by role
ConversationHelper.countMessagesByRole(history);
```

### 4. Format Conversions (~200 lines)

**The Problem:**

- Three different message formats:
  - Ollama format (from client)
  - Internal format (our processing)
  - OpenCode format (SDK API)
- Tool schema transformations
- Error format conversions

**Our Solution:**

- Dedicated adapter layer for format conversions
- Type-safe transformations with TypeScript
- Bidirectional conversions (Ollama ↔ internal ↔ OpenCode)
- Comprehensive error mapping

**Code Locations:**

- `src/adapters/ollamaAdapter.ts` — All format conversions (~200 lines)

### 5. Edge Cases & Design Philosophy (~100 lines)

**Design Philosophy:**

- **No state assumptions** — Never assume device state from conversation history
- **Always verify** — Devices can be controlled via other interfaces (physical switches, automation, other apps)
- **Idempotent operations** — Repeated requests should execute again, not assume previous state
- **LLM-driven decisions** — Let the LLM decide everything based on current context

**Edge cases we handle:**

- Invalid tool selection (validate against available tools)
- Missing or malformed messages
- Tool results that need natural language answers
- Multi-language support (detect and respond in same language)
- No tools provided (chat-only mode)

**Code Locations:**

- `src/server.ts` — Unified flow with edge case handling (~80 lines)
- `src/services/opencode.ts` — Fallback mechanisms (~70 lines)

## Architecture Overview

### Request Flow

```
1. Client sends Ollama API request
   ↓
2. server.ts receives POST /api/chat
   ↓
3. ollamaAdapter.extractMessagesAndTools()
   - Parse Ollama format
   - Extract system context, conversation history, tools
   ↓
4. ConversationHelper utilities
   - Validate conversation history
   - Build appropriate context
   - Extract user message
   ↓
5. Unified Response Generation:
   opencode.generateResponse()
   - LLM decides: tool_call, answer, or chat
   - Considers conversation history and available tools
   - Checks if tool results can answer the question
   - Returns UnifiedResponse
   ↓
6. Validate tool_call responses
   - Check tool_name against available tools
   - Set to "unknown" if invalid
   ↓
7. Convert to Ollama format
   ollamaAdapter.convertUnifiedResponseToOllama()
   - Handle three response types:
     • tool_call → Ollama tool_calls format
     • answer → Assistant message with content
     • chat → Assistant message with content
   ↓
8. Return Ollama-formatted response to client
```

### Component Hierarchy

```
┌──────────────────────────────────────────────┐
│              server.ts                       │
│  - Request routing                           │
│  - Orchestration logic                       │
│  - Error handling                            │
└────────┬─────────────────────────────────────┘
         │
         ├─────────────────────────────────────┐
         │                                     │
         ▼                                     ▼
┌─────────────────────┐            ┌──────────────────────┐
│  ollamaAdapter.ts   │            │  opencode.ts         │
│  - Format parsing   │            │  - SDK wrapper       │
│  - Conversions      │            │  - Session mgmt      │
│  - Validation       │            │  - Tool selection    │
└─────────────────────┘            │  - Conversation      │
                                   └──────────┬───────────┘
                                              │
                                              ▼
                                   ┌──────────────────────┐
                                   │ conversationHelper.ts│
                                   │ - History utilities  │
                                   │ - Context building   │
                                   │ - Message filtering  │
                                   └──────────────────────┘
```

## Component Details

### server.ts

**Responsibilities:**

- HTTP server setup (Fastify)
- Endpoint implementations (`/api/chat`, `/api/tags`, etc.)
- Request validation
- Unified flow orchestration
- Error handling and response formatting
- Logging

**Key Functions:**

1. **POST /api/chat Handler** (~80 lines)
   - Extract messages and tools
   - Call unified response generation
   - Validate tool selections
   - Convert to Ollama format
   - Return response

**Simplification (Phase 4):**

- **Before**: 476 lines with multiple special case handlers
  - Query tool result handling (~60 lines)
  - Repeated request handling (~65 lines)
  - Chat-only mode handling (~45 lines)
  - Normal tool selection (~100 lines)
- **After**: 243 lines with single unified flow
  - **Removed**: 233 lines of special case code 🎉
  - **Result**: Single code path for all requests

### services/opencode.ts

**Responsibilities:**

- OpenCode SDK wrapper
- Session lifecycle management
- Unified response generation
- Fallback mechanisms

**Key Methods:**

1. **connect() / close()**
   - Initialize/cleanup OpenCode client
   - Connection management

2. **generateResponse(systemContext, conversationHistory, availableTools)**
   - **Main public API** - unified method replacing three old methods
   - Uses LLM to decide response type: tool_call, answer, or chat
   - Formats tools into LLM-friendly description
   - Sends unified prompt to LLM
   - Parses and validates response
   - Returns: `UnifiedResponse`

3. **isConnected()**
   - Check connection status
   - Returns: boolean

**Private Implementation Methods:**

4. **sendPrompt(systemPrompt, userMessage, options)** (private)
   - Core communication with OpenCode
   - Session creation, prompt sending, response polling
   - Timeout handling and cleanup
   - Returns: `{content, elapsed}`

5. **generateAnswerFromToolResult(conversationHistory, systemContext)** (private)
   - Fallback helper when unified response generation fails
   - Generates natural language answer from tool result
   - Returns: Answer string

6. **getFallbackChatResponse(userMessage)** (private)
   - Final fallback for error cases
   - Detects user language and responds appropriately
   - Returns: Simple error message in user's language

### services/conversationHelper.ts

**Responsibilities:**

- Conversation history utilities
- Message filtering and extraction
- Context building for different purposes
- History analysis

**Static Methods:**

1. **getLastUserMessage(history): string**
   - Finds the most recent user message
   - Used throughout for extracting current request

2. **countMessagesByRole(history): {user, assistant, tool}**
   - Counts messages by role
   - Used for logging and debugging

3. **buildToolSelectionContext(history, maxMessages): string**
   - Builds context string from recent messages
   - Limits to last N messages for performance
   - Formats for tool selection prompt

4. **buildConversationPrompt(history, systemContext?, options): string**
   - Builds full conversation prompt
   - Includes all history (no limit)
   - Optionally includes date/time
   - Used for conversational responses

5. **getOriginalUserRequest(history): string**
   - Extracts the original user request
   - Skips tool results to find user's intent
   - Used for completion message generation

6. **hasToolResult(history): boolean**
   - Checks if history contains tool results
   - Used for flow decision making

**Design Decisions:**

- **All static methods** — Stateless utility class, no need for instances
- **No history truncation** — Preserve full context (cloud models have large context windows)
- **Selective context** — Different methods for different use cases (tool selection vs conversation)
- **Type-safe** — Leverages TypeScript for compile-time safety

### adapters/ollamaAdapter.ts

**Responsibilities:**

- Parse Ollama API requests
- Extract messages, tools, context
- Detect special request patterns
- Convert tool selections to Ollama format
- Convert errors to Ollama format

**Key Functions:**

1. **extractMessagesAndTools(request): ExtractionResult**
   - Parses Ollama request body
   - Separates system messages from conversation
   - Extracts tool definitions
   - Returns: `{systemContext, conversationHistory, availableTools}`
   - **Simplified in Phase 2**: Removed repeated request and query tool detection

2. **convertUnifiedResponseToOllama(response, model, processingTime): OllamaChatResponse**
   - Converts UnifiedResponse to Ollama format
   - Handles three response types: tool_call, answer, chat
   - Adds metadata (timing, model info)
   - **New in Phase 2**: Replaces `convertToolSelectionToOllama()`

3. **convertErrorToOllama(error, model): OllamaChatResponse**
   - Converts errors to Ollama error format
   - Preserves error messages for debugging

## Unified Response Implementation

### The Challenge

OpenCode provides a simple API:

```typescript
// What OpenCode gives us:
session.prompt({
  model: {...},
  system: "You are helpful",
  parts: [{type: "text", text: "User message"}]
});

// Returns: plain text response
```

Ollama API expects:

```typescript
// What clients send us:
{
  messages: [...],
  tools: [
    {
      type: "function",
      function: {
        name: "GetWeather",
        description: "...",
        parameters: {...}
      }
    }
  ]
}

// Clients expect:
{
  message: {
    role: "assistant",
    tool_calls: [{
      function: {
        name: "GetWeather",
        arguments: {location: "Tokyo"}
      }
    }]
  }
}
```

### Our Approach

**Step 1: Format tools for LLM** (unchanged)

```typescript
function formatToolsForLLM(tools: OllamaTool[]): string {
  return tools
    .map((tool, index) => {
      const func = tool.function;
      const params = func.parameters;

      return `
${index + 1}. ${func.name}
   Description: ${func.description}
   Parameters:
${formatParameters(params.properties, params.required)}
    `.trim();
    })
    .join("\n\n");
}
```

**Step 2: Craft unified response prompt**

The prompt includes:

- System context (from client)
- Recent conversation history
- Available tools (formatted above)
- Current user request
- Three response types: tool_call, answer, chat
- Decision rules (see "Unified Response Generation" section)
- Examples

**Step 3: Send to LLM via OpenCode**

```typescript
const response = await this.sendPrompt(
  "You are an intelligent assistant. Respond with valid JSON only.",
  fullPrompt,
  { sessionTitle: "unified-response", maxWaitMs: 30000 },
);
```

**Step 4: Parse and validate response**

````typescript
// Clean markdown code blocks
const cleaned = response.content
  .trim()
  .replace(/```json\n?/g, "")
  .replace(/```\n?/g, "")
  .trim();

// Parse JSON
const unifiedResponse = JSON.parse(cleaned) as UnifiedResponse;

// Validate response action type
if (!["tool_call", "answer", "chat"].includes(unifiedResponse.action)) {
  throw new Error(`Invalid response action: ${unifiedResponse.action}`);
}
````

**Step 5: Convert to Ollama format**

```typescript
if (unifiedResponse.action === "tool_call") {
  // Tool call
  return {
    message: {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          function: {
            name: unifiedResponse.tool_name,
            arguments: unifiedResponse.arguments,
          },
        },
      ],
    },
  };
} else if (
  unifiedResponse.action === "answer" ||
  unifiedResponse.action === "chat"
) {
  // Answer or conversational response
  return {
    message: {
      role: "assistant",
      content: unifiedResponse.content,
    },
  };
}
```

### Handling Edge Cases

**Invalid JSON:**

```typescript
try {
  unifiedResponse = JSON.parse(cleaned);
} catch (err) {
  // Fallback: Try to generate answer from tool result
  if (hasToolResult) {
    const answer = await generateAnswerFromToolResult(...);
    return {action: 'answer', content: answer};
  }
  // Final fallback: Chat response
  return {action: 'chat', content: getFallbackChatResponse(userMessage)};
}
```

**Hallucinated tool names:**

```typescript
if (unifiedResponse.action === "tool_call") {
  const isValidTool = availableTools.some(
    (t) => t.function.name === unifiedResponse.tool_name,
  );

  if (!isValidTool && unifiedResponse.tool_name !== "unknown") {
    // Return "unknown" to let client handle
    unifiedResponse.tool_name = "unknown";
  }
}
```

**Tool result available:**

```typescript
// LLM checks if tool result answers the question
// If yes: return {action: 'answer', content: "..."}
// If no: return {action: 'tool_call', ...} to get more info
```

## Conversation History

### Design Goals

1. **Full history preservation** — Don't truncate conversation
2. **Context-aware tool selection** — Use recent messages for tool decisions
3. **Natural conversations** — Support multi-turn dialogue
4. **Multi-language support** — Detect and maintain user's language

### Implementation

**Data Flow:**

```typescript
// 1. Client sends full conversation
{
  messages: [
    {role: "system", content: "You are a helpful assistant"},
    {role: "user", content: "Turn on the light"},
    {role: "assistant", content: "", tool_calls: [...]},
    {role: "tool", content: "Light turned on"},
    {role: "user", content: "Is the light on?"}  // New question
  ]
}

// 2. Extract and categorize
const {systemContext, conversationHistory, availableTools} = extractMessagesAndTools(body);

// systemContext: "You are a helpful assistant"
// conversationHistory: [
//   {role: "user", content: "Turn on the light"},
//   {role: "assistant", content: "", tool_calls: [...]},
//   {role: "tool", content: "Light turned on"},
//   {role: "user", content: "Is the light on?"}
// ]

// 3. For unified response: use recent context (last 10 messages)
const recentContext = ConversationHelper.buildToolSelectionContext(
  conversationHistory,
  10
);

// 4. Generate unified response
const unifiedResponse = await opencodeService.generateResponse(
  systemContext,
  conversationHistory,
  availableTools
);

// LLM sees tool result and decides:
// {action: 'answer', content: 'Yes, the light is currently on.'}
```

### Why Separate Contexts?

**Unified Response Generation (last 10 messages):**

- **Speed** — Less tokens = faster response
- **Focus** — Recent context is most relevant for decision
- **Cost** — Fewer tokens = lower API cost
- **Efficiency** — Handles both tool selection and answer generation

**Note**: We no longer have separate "tool selection" and "conversation" modes. The unified approach handles everything.

### ConversationHelper Methods

**1. getLastUserMessage()**

```typescript
// Find the most recent user message
const userMessages = history.filter((m) => m.role === "user");
return userMessages[userMessages.length - 1]?.content || "";
```

**2. buildToolSelectionContext(history, maxMessages)**

```typescript
// Build context from recent messages
const recentMessages = history.slice(-maxMessages);
return recentMessages.map((m) => `${m.role}: ${m.content}`).join("\n");
```

**3. buildConversationPrompt(history, systemContext, options)**

```typescript
// Build full prompt with all history
const conversationText = history
  .map((m) => {
    if (m.role === "tool") {
      return `Tool Result:\n${m.content}`;
    }
    return `${capitalize(m.role)}:\n${m.content}`;
  })
  .join("\n\n");

return `${systemContext}

${conversationText}

Current date/time: ${new Date().toISOString()}`;
```

## Unified Response Generation

### Design Philosophy

**Key Insight**: Device state can change outside our control through:

- Physical switches
- Automation rules
- Other apps/interfaces
- Time passing

**Therefore**: Never assume device state from conversation history.

**Approach**: Let LLM decide everything based on current context using a unified prompt.

### Three Response Types

**1. TOOL_CALL** - Execute an action or query

```typescript
{
  action: "tool_call",
  tool_name: "CallService",
  arguments: {domain: "light", service: "turn_on", ...}
}
```

**2. ANSWER** - Generate answer from tool results

```typescript
{
  action: "answer",
  content: "是的，客廳的燈現在是開著的"
}
```

**3. CHAT** - Conversational response

```typescript
{
  action: "chat",
  content: "Hello! How can I help you?"
}
```

### Decision Rules

The unified prompt enforces this decision flow:

**1. Check conversation history:**

- If last message is a tool result, analyze if it answers the user's question
- **IMPORTANT**: Tool results show state at execution time, but state may have changed
- If tool result answers the question, return ANSWER with natural language explanation
- If tool result doesn't fully answer, consider calling another tool

**2. Check user intent:**

- **ACTION REQUEST** (turn on/off, set, adjust, control) → TOOL_CALL
- **INFORMATION QUERY** (is X on?, what's the status?, get data) → TOOL_CALL (use query tools)
- **CONVERSATION** (greetings, thanks, general chat) → CHAT

**3. When in doubt about device state:**

- DO NOT assume state from conversation history
- Prefer calling query tools (Get*, Query*, Fetch*, *Status, \*Context) to check current state
- Devices can be controlled via other interfaces

**4. Handling repeated requests:**

- If user requests the same action again, **EXECUTE IT AGAIN** (don't assume state)
- Example: User says "開燈" → executed → 5 mins later says "開燈" → **EXECUTE AGAIN**
- Rationale: Device may have been turned off by automation or physical switch

### Prompt Engineering Details

**JSON Schema Enforcement:**

```
CRITICAL: Respond with VALID JSON ONLY. No markdown, no explanations, no code blocks.

Response Schema - You must choose ONE of these three response types:

1. TOOL_CALL:
{
  "action": "tool_call",
  "tool_name": "exact tool name from available tools",
  "arguments": { ... }
}

2. ANSWER:
{
  "action": "answer",
  "content": "natural language answer based on tool results"
}

3. CHAT:
{
  "action": "chat",
  "content": "natural conversational response"
}
```

**Parameter Extraction Guidelines:**

```
- Extract parameter values directly from user's request
- Use information from the system context when needed
- Match parameter types exactly as defined in tool schema
- For array types, use array format: ["value1", "value2"]
```

**Examples in Prompt:**

```
User: "hello"
→ {"action": "chat", "content": "Hello! How can I help you?"}

User: "開客廳的燈"
→ {"action": "tool_call", "tool_name": "CallService", "arguments": {...}}

User: "客廳的燈是開著的嗎" (GetLiveContext available)
→ {"action": "tool_call", "tool_name": "GetLiveContext", "arguments": {}}

[After GetLiveContext returns: "客廳燈: 開啟"]
→ {"action": "answer", "content": "是的，客廳的燈現在是開著的"}

User: "開燈" (light already turned on 5 minutes ago in history)
→ {"action": "tool_call", "tool_name": "CallService", "arguments": {...}}
(Reason: Don't assume it's still on - it may have been turned off by automation)
```

### Handling Ambiguity

**Unclear action requests:**

```typescript
toolSelection = {
  tool_name: "unknown",
  arguments: {},
};
// Client sees this and can prompt user for clarification
```

**Information query without query tool:**

```typescript
toolSelection = {
  tool_name: "chat",
  arguments: {},
};
// LLM generates conversational response like:
// "I don't have access to real-time information right now."
```

**When in doubt:**

```
// Prompt says:
"When in doubt between action and conversation: prefer 'chat'"
```

## Error Handling

### Timeout Strategy

**Multiple timeout layers:**

1. **Session prompt timeout (20s):**

```typescript
const promptTimeoutPromise = new Promise((_, reject) =>
  setTimeout(
    () => reject(new Error("session.prompt() timeout after 20s")),
    20000,
  ),
);
await Promise.race([promptPromise, promptTimeoutPromise]);
```

2. **Response polling timeout (30s):**

```typescript
const maxWaitMs = 30000;
while (Date.now() - startTime < maxWaitMs) {
  // Poll for response
  const messages = await this.client.session.messages({...});
  // Check for assistant response
}
```

3. **Session deletion timeout (5s):**

```typescript
const deletePromise = this.client.session.delete({...});
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('Session delete timeout')), 5000)
);
await Promise.race([deletePromise, timeoutPromise]);
```

### Graceful Degradation

**Fallback hierarchy:**

```
1. Try normal tool selection
   ↓ fails
2. Try fallback tool selection (rule-based)
   ↓ fails
3. Return chat mode
   ↓ fails
4. Return error to client
```

**Implementation:**

```typescript
try {
  // Primary: LLM-based tool selection
  const toolSelection = await extractToolSelection(...);
  return toolSelection;
} catch (err) {
  console.error('Tool selection failed, falling back');

  try {
    // Secondary: Rule-based fallback
    return fallbackToolSelection(userMessage);
  } catch (err2) {
    console.error('Fallback failed, returning error');

    // Tertiary: Error response
    return convertErrorToOllama(err2, model);
  }
}
```

### Session Cleanup

**Always cleanup, even on errors:**

```typescript
try {
  const session = await this.client.session.create({...});
  const sessionId = session.data?.id;

  try {
    // Use session
    const response = await this.client.session.prompt({...});
    return response;
  } finally {
    // Always delete session (with timeout)
    try {
      await Promise.race([
        this.client.session.delete({ path: { id: sessionId } }),
        timeoutPromise(5000)
      ]);
    } catch (cleanupErr) {
      // Log but don't throw - cleanup is best-effort
      console.error('Session cleanup failed:', cleanupErr);
    }
  }
} catch (err) {
  // Session creation failed
  throw err;
}
```

### Error Conversion

**Convert all errors to Ollama format:**

```typescript
function convertErrorToOllama(error: Error, model: string): OllamaChatResponse {
  return {
    model,
    created_at: new Date().toISOString(),
    message: {
      role: "assistant",
      content: `Error: ${error.message}`,
    },
    done: true,
    done_reason: "error",
    error: error.message,
  };
}
```

## Performance Considerations

### Latency Breakdown

**Typical request (~3-5 seconds):**

1. **Parsing and validation** — 10-50ms
   - Extract messages and tools
   - Validate request structure

2. **OpenCode session creation** — 100-300ms
   - Create new session
   - Network round-trip

3. **Tool selection LLM call** — 1-2 seconds
   - Send tool selection prompt
   - Wait for LLM response
   - Parse JSON

4. **Format conversion** — 10-50ms
   - Convert to Ollama format
   - Add metadata

5. **Session cleanup** — 100-300ms
   - Delete session
   - Best-effort, doesn't block response

**Chat-only mode:**

- Slightly faster (no tool selection needed)
- Still ~2-3 seconds due to LLM call

**Comparison to native Ollama:**

- Native Ollama: ~1-2 seconds (local inference)
- This adapter: ~3-5 seconds (network + cloud inference + processing)

### Optimization Opportunities

**1. Session reuse**

- Currently: Create/delete session per request
- Potential: Reuse sessions for same client
- Savings: ~200-600ms per request
- Trade-off: Session management complexity

**2. Tool selection caching**

- Currently: Call LLM for every tool selection
- Potential: Cache tool selections for identical requests
- Savings: ~1-2 seconds on cache hit
- Trade-off: Context changes might be missed

**3. Streaming responses**

- Currently: Wait for complete response
- Potential: Stream tokens as they arrive
- Savings: Perceived latency improvement
- Trade-off: Significant implementation complexity

**4. Parallel processing**

- Currently: Sequential processing
- Potential: Parallel tool selection + conversation context building
- Savings: Minimal (most time is in LLM call)
- Trade-off: Code complexity

### Memory Usage

**Conversation history:**

- No truncation by design
- Can grow large over long sessions
- Cloud models handle large contexts well

**Potential issue:**

- Very long conversations (100+ messages) might hit provider limits
- Consider truncation for extremely long histories

**Current approach:**

- Trust cloud providers' context limits (128k+ tokens)
- Monitor for issues in production
- Add truncation if needed

## Future Enhancements

See [FUTURE_ENHANCEMENTS.md](./FUTURE_ENHANCEMENTS.md) for planned features including:

- Streaming support
- Session reuse for performance
- Tool selection caching
- Enhanced error recovery
- Metrics and monitoring
- Additional provider configurations

## Contributing

When contributing to the adapter, please:

1. **Maintain separation of concerns**
   - Keep format conversions in `ollamaAdapter.ts`
   - Keep OpenCode logic in `opencode.ts`
   - Keep orchestration in `server.ts`

2. **Add tests for new features**
   - Unit tests for utilities
   - Integration tests for flows

3. **Update this documentation**
   - Architecture changes should be documented
   - Complex logic should be explained

4. **Consider performance**
   - Minimize LLM calls
   - Use timeouts appropriately
   - Clean up resources

5. **Handle errors gracefully**
   - Always have fallbacks
   - Log for debugging
   - Return user-friendly errors
