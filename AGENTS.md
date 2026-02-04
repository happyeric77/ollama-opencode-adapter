# Agent Guidelines for ollama-opencode-adapter

## Build, Lint, Test Commands
- **Build**: `npm run build` (compiles TypeScript to `dist/`)
- **Dev**: `npm run dev` (watch mode with auto-reload)
- **Test**: `npm test` (runs vitest in watch mode)
- **Test once**: `npm run test:run` (single run, all tests)
- **Single test**: `npx vitest run tests/unit/conversationHelper.test.ts` (or any test file path)
- **No linting** configured - TypeScript strict mode handles type safety

## Code Style Guidelines

### Module System & Imports
- ES modules only (`"type": "module"` in package.json)
- Use `.js` extension in imports: `import { X } from './file.js'` (even for `.ts` files)
- Group imports: external packages first, then internal modules with types imported via `import type`

### TypeScript Configuration
- Strict mode enabled with additional strict options: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- Always use explicit types for function parameters and return values
- Use `interface` for objects, `type` for unions/intersections
- Prefer `Record<string, any>` over index signatures for flexible objects

### Naming Conventions
- Files: camelCase for code (`ollamaAdapter.ts`), UPPERCASE for docs (`AGENTS.md`)
- Classes: PascalCase with static methods only (e.g., `ConversationHelper`)
- Functions: camelCase, descriptive verb-noun combinations (e.g., `extractMessagesAndTools`)
- Types/Interfaces: PascalCase with descriptive names (e.g., `OllamaChatRequest`)
- Constants: SCREAMING_SNAKE_CASE (e.g., `PACKAGE_VERSION`)

### Documentation
- JSDoc comments for all public functions and classes with `@param`, `@returns`, `@example` tags
- Inline comments for complex logic explaining "why", not "what"
- Keep files focused: types in `/types`, services in `/services`, adapters in `/adapters`

### Error Handling
- Use explicit error types and meaningful error messages
- Always validate user input and return proper HTTP status codes
- Log errors with context using fastify logger (info, warn, error levels)
- Convert errors to appropriate response format (e.g., `convertErrorToOllama`)

### Testing
- Tests in `/tests/{unit,integration}` mirroring `/src` structure
- Use vitest with globals enabled (no need to import `describe`, `it`, `expect`)
- Test fixtures at top of test files for reusability
- Descriptive test names: `'should return X when Y'` format
