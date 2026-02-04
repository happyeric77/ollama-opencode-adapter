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

You might expect a simple adapter between two APIs to be ~50-100 lines of code. This implementation is ~1,500 lines. Here's why:

### 1. Manual Function Calling (~400 lines)

**The Problem:**
- OpenCode doesn't support function calling natively
- It only has a simple prompt API: send text, get text back
- Ollama API expects native function calling support

**Our Solution:**
- Manually parse tool definitions from Ollama requests
- Craft prompts that instruct the LLM to select tools
- Parse JSON responses from unstructured LLM output
- Handle JSON parsing failures gracefully
- Validate tool selections against available tools

**Code Locations:**
- `src/services/opencode.ts` — `extractToolSelection()` method (~100 lines)
- `src/adapters/ollamaAdapter.ts` — Format conversions (~150 lines)
- `src/server.ts` — Tool selection orchestration (~150 lines)

**Complexity Factors:**
- LLMs don't always return valid JSON
- Tool names might be hallucinated
- Parameter extraction from natural language
- Multi-language support (detect user's language)
- Fallback when tool selection fails

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
  setTimeout(() => reject(new Error('Timeout')), 20000)
);
await Promise.race([operation(), timeoutPromise]);

// Fallback to chat mode on errors
try {
  return await extractToolSelection();
} catch (err) {
  console.error('Tool selection failed, falling back to chat');
  return { tool_name: 'chat', arguments: {} };
}

// Session cleanup in finally block
try {
  const session = await createSession();
  // ... use session
} finally {
  await deleteSession(session.id); // Always cleanup
}
```

### 3. Multi-turn Conversation Handling (~400 lines)

**The Problem:**
- Need to preserve conversation history across turns
- Detect when user wants chat vs tool execution
- Handle tool result processing (convert to natural language)
- Prevent infinite loops from repeated requests
- Support multi-language conversations

**Our Solution:**
- Full conversation history preservation (no truncation)
- Smart context selection (last 10 messages for tool selection)
- Dedicated `ConversationHelper` service with 6 utility methods
- LLM-generated completion messages in user's language
- Repeated request detection and handling

**Code Locations:**
- `src/services/conversationHelper.ts` — 6 static utility methods (~200 lines)
- `src/services/opencode.ts` — Conversation handling methods (~100 lines)
- `src/server.ts` — Multi-turn orchestration (~100 lines)

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

### 5. Edge Cases & Special Handling (~200 lines)

**Examples of edge cases we handle:**
- Repeated user requests (detect and confirm completion)
- Query tool results (GetLiveContext) → generate natural language answers
- Chat-only mode (no tools provided)
- Invalid tool selection (validate against available tools)
- Missing or malformed messages
- Tool results without corresponding user messages
- Multi-language support (detect and respond in same language)

**Code Locations:**
- `src/server.ts` — Edge case handling throughout (~200 lines)

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
   - Detect repeated requests, query tool results
   ↓
4. ConversationHelper utilities
   - Validate conversation history
   - Build appropriate context
   - Extract user message
   ↓
5. Route based on request type:
   
   a) Query tool result detected?
      → opencode.sendPrompt() with tool result context
      → Generate natural language answer
      → Return as assistant message
   
   b) Repeated request detected?
      → opencode.generateCompletionMessage()
      → Return confirmation in user's language
   
   c) No tools provided (chat-only mode)?
      → opencode.handleConversation()
      → Return conversational response
   
   d) Normal tool selection flow:
      → opencode.extractToolSelection()
      → Parse and validate tool selection
      → If tool_name === "chat":
         → opencode.handleConversation()
      → Else:
         → ollamaAdapter.convertToolSelectionToOllama()
   ↓
6. Return Ollama-formatted response to client
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
- Flow orchestration (routing to appropriate handlers)
- Error handling and response formatting
- Logging

**Key Functions:**

1. **POST /api/chat Handler** (~400 lines)
   - Main request processing
   - Calls adapters and services
   - Routes to different flows based on request type

2. **Query Tool Result Handling** (~60 lines)
   - Detects tool results like GetLiveContext
   - Generates natural language answers from structured data

3. **Repeated Request Handling** (~65 lines)
   - Detects when user resends same message
   - Generates completion confirmation

4. **Chat-Only Mode** (~45 lines)
   - Handles requests without tools
   - Direct conversation flow

5. **Normal Tool Selection Flow** (~100 lines)
   - Extracts tool selection from LLM
   - Validates and converts to Ollama format

### services/opencode.ts

**Responsibilities:**
- OpenCode SDK wrapper
- Session lifecycle management
- Tool selection prompt engineering
- Conversation handling
- Completion message generation

**Key Methods:**

1. **connect() / close()**
   - Initialize/cleanup OpenCode client
   - Connection management

2. **sendPrompt(systemPrompt, userMessage, options)**
   - Core communication with OpenCode
   - Session creation, prompt sending, response polling
   - Timeout handling and cleanup
   - Returns: `{content, elapsed}`

3. **extractToolSelection(systemContext, conversationHistory, availableTools)**
   - Formats tools into LLM prompt
   - Sends tool selection request
   - Parses JSON response
   - Validates tool selection
   - Returns: JSON string with `{tool_name, arguments}`

4. **handleConversation(conversationHistory, systemContext)**
   - Builds full conversation prompt
   - Sends to LLM for conversational response
   - Returns: Natural language response

5. **generateCompletionMessage(conversationHistory, toolName, toolArgs, systemContext)**
   - Generates completion confirmation in user's language
   - Uses LLM to create natural message
   - Returns: Completion message string

**Prompt Engineering:**

The tool selection prompt is ~70 lines and includes:
- Available tools description
- Parameter schemas
- Priority rules (action → query → chat)
- Examples for clarity
- JSON schema enforcement
- Multi-language support instructions

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

1. **extractMessagesAndTools(request): ExtractedContext**
   - Parses Ollama request body
   - Separates system messages from conversation
   - Extracts tool definitions
   - Detects repeated requests
   - Detects query tool results
   - Returns structured data for processing

2. **convertToolSelectionToOllama(selection, model, processingTime): OllamaChatResponse**
   - Converts internal tool selection to Ollama format
   - Handles both tool calls and chat responses
   - Adds metadata (timing, model info)

3. **convertErrorToOllama(error, model): OllamaChatResponse**
   - Converts errors to Ollama error format
   - Preserves error messages for debugging

**Detection Logic:**

```typescript
// Repeated request detection
const userMessages = history.filter(m => m.role === 'user');
const lastTwo = userMessages.slice(-2);
const isRepeatedRequest = 
  lastTwo.length === 2 && 
  lastTwo[0].content === lastTwo[1].content;

// Query tool result detection  
const hasToolMessage = history.some(m => m.role === 'tool');
const lastToolMessage = history
  .filter(m => m.role === 'tool')
  .pop();
const hasQueryToolResult = 
  hasToolMessage && 
  lastToolMessage?.content.includes(...);
```

## Function Calling Implementation

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

**Step 1: Format tools for LLM**

```typescript
function formatToolsForLLM(tools: OllamaTool[]): string {
  return tools.map((tool, index) => {
    const func = tool.function;
    const params = func.parameters;
    
    return `
${index + 1}. ${func.name}
   Description: ${func.description}
   Parameters:
${formatParameters(params.properties, params.required)}
    `.trim();
  }).join('\n\n');
}
```

**Step 2: Craft tool selection prompt**

The prompt includes:
- System context (from client)
- Recent conversation history
- Available tools (formatted above)
- Current user request
- Strict JSON schema
- Priority rules (action → query → chat)
- Examples

**Step 3: Send to LLM via OpenCode**

```typescript
const response = await this.sendPrompt(
  "You are a tool selection expert. Respond with valid JSON only.",
  fullPrompt,
  { sessionTitle: 'tool-selection', maxWaitMs: 30000 }
);
```

**Step 4: Parse and validate response**

```typescript
// Clean markdown code blocks
const cleaned = response.content
  .trim()
  .replace(/```json\n?/g, '')
  .replace(/```\n?/g, '')
  .trim();

// Parse JSON
const toolSelection = JSON.parse(cleaned);

// Validate against available tools
const isValidTool = availableTools.some(
  t => t.function.name === toolSelection.tool_name
);

if (!isValidTool && toolSelection.tool_name !== "chat") {
  toolSelection.tool_name = "unknown";
}
```

**Step 5: Convert to Ollama format**

```typescript
if (toolSelection.tool_name === "chat") {
  // Conversational response
  return {
    message: {
      role: "assistant",
      content: chatResponse
    }
  };
} else {
  // Tool call
  return {
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{
        function: {
          name: toolSelection.tool_name,
          arguments: toolSelection.arguments
        }
      }]
    }
  };
}
```

### Handling Edge Cases

**Invalid JSON:**
```typescript
try {
  toolSelection = JSON.parse(cleaned);
} catch (err) {
  // Fallback to chat mode
  toolSelection = { tool_name: "chat", arguments: {} };
}
```

**Hallucinated tool names:**
```typescript
const isValidTool = availableTools.some(
  t => t.function.name === toolSelection.tool_name
);

if (!isValidTool) {
  // Return "unknown" to let client handle
  toolSelection.tool_name = "unknown";
}
```

**Ambiguous intent:**
```typescript
// Prompt includes:
// "If user's intent is unclear: return {tool_name: 'unknown'}"
// "When in doubt between action and conversation: prefer 'chat'"
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
    {role: "user", content: "Turn on the light"}  // Repeated request
  ]
}

// 2. Extract and categorize
const {systemContext, conversationHistory} = extractMessagesAndTools(body);

// systemContext: "You are a helpful assistant"
// conversationHistory: [
//   {role: "user", content: "Turn on the light"},
//   {role: "assistant", content: "", tool_calls: [...]},
//   {role: "tool", content: "Light turned on"},
//   {role: "user", content: "Turn on the light"}
// ]

// 3. For tool selection: use recent context (last 10 messages)
const recentContext = ConversationHelper.buildToolSelectionContext(
  conversationHistory,
  10
);

// 4. For conversation: use full history (no limit)
const fullPrompt = ConversationHelper.buildConversationPrompt(
  conversationHistory,
  systemContext
);
```

### Why Separate Contexts?

**Tool Selection (last 10 messages):**
- **Speed** — Less tokens = faster response
- **Focus** — Recent context is most relevant for tool choice
- **Cost** — Fewer tokens = lower API cost

**Conversation (all messages):**
- **Quality** — Full context for better responses
- **Coherence** — Maintain conversation thread
- **Cloud models have large context** — GPT-4o supports 128k tokens

### ConversationHelper Methods

**1. getLastUserMessage()**
```typescript
// Find the most recent user message
const userMessages = history.filter(m => m.role === 'user');
return userMessages[userMessages.length - 1]?.content || '';
```

**2. buildToolSelectionContext(history, maxMessages)**
```typescript
// Build context from recent messages
const recentMessages = history.slice(-maxMessages);
return recentMessages
  .map(m => `${m.role}: ${m.content}`)
  .join('\n');
```

**3. buildConversationPrompt(history, systemContext, options)**
```typescript
// Build full prompt with all history
const conversationText = history
  .map(m => {
    if (m.role === 'tool') {
      return `Tool Result:\n${m.content}`;
    }
    return `${capitalize(m.role)}:\n${m.content}`;
  })
  .join('\n\n');

return `${systemContext}

${conversationText}

Current date/time: ${new Date().toISOString()}`;
```

### Repeated Request Detection

**Pattern:**
```typescript
// User sends same message twice → means tool was executed
// We should confirm completion, not execute again

const userMessages = history.filter(m => m.role === 'user');
const lastTwo = userMessages.slice(-2);
const isRepeatedRequest = 
  lastTwo.length === 2 && 
  lastTwo[0].content === lastTwo[1].content;

if (isRepeatedRequest) {
  // Generate completion message
  const completionMessage = await opencode.generateCompletionMessage(
    conversationHistory,
    toolName,
    toolArgs,
    systemContext
  );
  
  return {
    message: {
      role: "assistant",
      content: completionMessage  // e.g., "客廳的燈已經開啟了"
    }
  };
}
```

## Tool Selection Strategy

### Priority Rules

The prompt enforces this priority order:

**1. ACTION REQUEST (highest priority)**
- User wants to perform an action
- Select the most appropriate action tool
- Extract parameters from user request and context

Examples:
- "Turn on the living room light" → `{tool_name: "SetLight", arguments: {...}}`
- "Set temperature to 72" → `{tool_name: "SetTemperature", arguments: {...}}`

**2. INFORMATION QUERY**
- User asks about status or information
- Look for query-type tools (Get*, Query*, Fetch*, *Status, *Context)
- If query tool exists, use it
- If no query tool exists, use "chat"

Examples:
- "Is the light on?" + GetLiveContext available → `{tool_name: "GetLiveContext", arguments: {}}`
- "What time is it?" + no time tool → `{tool_name: "chat", arguments: {}}`

**3. CONVERSATION (lowest priority)**
- Greetings, thanks, general chat
- Always return `{tool_name: "chat", arguments: {}}`

Examples:
- "Hello" → chat
- "Thank you" → chat
- "Tell me a joke" → chat

### Prompt Engineering Details

**JSON Schema Enforcement:**
```
CRITICAL: Respond with VALID JSON ONLY. No markdown, no explanations, no code blocks.

Response Schema:
{
  "tool_name": "exact tool name from available tools OR 'chat' for conversation",
  "arguments": {
    // parameters as defined in the tool schema (only if tool_name is not 'chat')
  }
}
```

**Parameter Extraction Guidelines:**
```
- Extract parameter values directly from user's request
- Use information from the system context when needed
- Match parameter types exactly as defined in tool schema
- For array types, use array format: ["value1", "value2"]
- Do not include optional parameters if not mentioned by user
```

**Examples in Prompt:**
```
User: "hello"
→ {"tool_name": "chat", "arguments": {}}

User: "is the light on?" (GetLiveContext available)
→ {"tool_name": "GetLiveContext", "arguments": {}}

User: "現在客廳燈是開著的嗎" (GetLiveContext available)
→ {"tool_name": "GetLiveContext", "arguments": {}}
```

### Handling Ambiguity

**Unclear action requests:**
```typescript
toolSelection = {
  tool_name: "unknown",
  arguments: {}
};
// Client sees this and can prompt user for clarification
```

**Information query without query tool:**
```typescript
toolSelection = {
  tool_name: "chat",
  arguments: {}
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
  setTimeout(() => reject(new Error('session.prompt() timeout after 20s')), 20000)
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
function convertErrorToOllama(
  error: Error,
  model: string
): OllamaChatResponse {
  return {
    model,
    created_at: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: `Error: ${error.message}`,
    },
    done: true,
    done_reason: 'error',
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
