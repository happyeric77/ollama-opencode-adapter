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

If Home Assistant has weather integration:

- Fetch weather data from HA
- Answer weather queries in conversation
- Provide forecasts

---

### 4. Advanced Device Status Queries
**Priority**: Medium  
**Status**: Not started

Currently, device status queries are handled conversationally. Could add:

- Direct HA API calls for real-time status
- More detailed status information
- Historical data queries

---

## 📝 Notes

Add future enhancement ideas here as they come up during development and usage.
