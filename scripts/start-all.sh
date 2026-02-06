#!/bin/bash
set -e

echo "🚀 Starting Ollama-OpenCode Adapter..."
echo "=================================="

# Start OpenCode in background
echo "📡 Starting OpenCode server on port 7272..."
opencode serve --port 7272 --hostname 0.0.0.0 &
OPENCODE_PID=$!
echo "✅ OpenCode started (PID: $OPENCODE_PID)"

# Wait for OpenCode to be ready
echo "⏳ Waiting for OpenCode to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:7272/health > /dev/null 2>&1; then
        echo "✅ OpenCode is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ OpenCode failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

# Start Adapter in foreground
echo "🔌 Starting Adapter on port 3000..."
cd /app
exec node dist/index.js
