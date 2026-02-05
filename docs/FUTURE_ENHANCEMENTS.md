# Future Enhancements

## 🔮 Planned Features

### 1. Session Management (Conversation History)

**Priority**: Medium  
**Status**: Not started

Currently, the conversation feature is stateless - each request is independent. Future enhancement could add:

- Multi-turn conversation support
- Context retention across requests
- Session storage (in-memory or Redis)
- Session timeout management

**Use Case Example**:

```
User: "Turn on the light"
Assistant: "Done! Which room?"
User: "Living room"  ← Should remember "light"
```

**Implementation Notes**:

- Add session ID to requests
- Store conversation history in Map or Redis
- Pass history to LLM for context-aware responses
- Clean up expired sessions

**Estimated Effort**: 4-6 hours

---

### 2. Multi-language Error Messages

**Priority**: Low  
**Status**: Not started

Currently, unknown tool error messages are in Japanese only. Could add:

- Language detection for error messages
- Localized error templates
- Fallback to English if language unknown

---

### 3. Weather Integration

**Priority**: Low  
**Status**: Not started

If the client application has weather integration:

- Fetch weather data from client application
- Answer weather queries in conversation
- Provide forecasts

---

### 4. Advanced Device Status Queries

**Priority**: Medium  
**Status**: Not started

Currently, device status queries are handled conversationally. Could add:

- Direct client API calls for real-time status
- More detailed status information
- Historical data queries

---

### 5. API Key Authentication

**Priority**: Low  
**Status**: Not started

Add optional API key authentication to secure the adapter endpoints.

**Features**:

- Optional bearer token authentication
- Configurable via `API_KEY` environment variable
- Protection for public-facing deployments

**Implementation Notes**:

```typescript
// In server.ts
if (config.apiKey) {
  fastify.addHook("preHandler", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${config.apiKey}`) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
```

**Configuration**:

```bash
# .env
API_KEY=your-secret-key-here
```

**Use Case**:

- When adapter is exposed to public internet
- Multi-user scenarios requiring access control
- Integration with external systems

**Estimated Effort**: 2-3 hours

---

## 📝 Notes

Add future enhancement ideas here as they come up during development and usage.
