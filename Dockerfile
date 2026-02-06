# Multi-stage build for ollama-opencode-adapter
# Single image that can run both OpenCode and Adapter

# Stage 1: Build adapter
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Stage 2: Runtime image
FROM node:22-bookworm-slim AS runtime

# Install system dependencies for OpenCode
RUN apt-get update && apt-get install -y \
    curl \
    ripgrep \
    git \
    ca-certificates \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode CLI (pinned version for stability)
# Note: opencode-ai is the CLI package, @opencode-ai/sdk is the SDK
RUN npm install -g opencode-ai@latest

# Create app directory
WORKDIR /app

# Copy built adapter from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy startup script
COPY scripts/start-all.sh /start-all.sh
RUN chmod +x /start-all.sh

# Create OpenCode data directory for auth and storage
RUN mkdir -p /root/.local/share/opencode

# Expose ports
EXPOSE 3000 7272

# Health check for adapter
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Default command: start both processes (for local testing)
# In K8s, this will be overridden with specific commands
CMD ["/start-all.sh"]
