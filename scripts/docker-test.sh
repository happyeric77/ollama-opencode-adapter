#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧪 Testing ollama-opencode-adapter${NC}"
echo "=================================="
echo ""

# Check if container is running
if ! docker ps | grep -q ollama-adapter; then
    echo -e "${YELLOW}Container not running. Starting...${NC}"
    docker-compose up -d
fi

# Wait for health check
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
for i in {1..30}; do
    if docker-compose ps | grep -q "healthy"; then
        echo -e "${GREEN}✅ Container is healthy${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Container failed to become healthy${NC}"
        docker-compose logs
        exit 1
    fi
    sleep 2
done

# Test adapter health
echo ""
echo -e "${YELLOW}Testing adapter health endpoint...${NC}"
HEALTH_RESPONSE=$(curl -s http://localhost:3000/health 2>&1)

if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✅ Adapter is healthy${NC}"
    echo "$HEALTH_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_RESPONSE"
else
    echo -e "${RED}❌ Adapter health check failed${NC}"
    echo "Response: $HEALTH_RESPONSE"
    docker-compose logs
    exit 1
fi

# Test OpenCode
echo ""
echo -e "${YELLOW}Testing OpenCode connectivity...${NC}"
if docker-compose exec -T ollama-adapter curl -s http://localhost:7272/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ OpenCode is accessible${NC}"
else
    echo -e "${RED}❌ OpenCode is not accessible${NC}"
    docker-compose logs
    exit 1
fi

echo ""
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "Next steps:"
echo "  1. Configure OpenCode auth:"
echo "     ${BLUE}docker-compose exec ollama-adapter opencode auth login${NC}"
echo ""
echo "  2. Verify models:"
echo "     ${BLUE}docker-compose exec ollama-adapter opencode models github-copilot${NC}"
echo ""
echo "  3. Test chat API:"
echo "     ${BLUE}curl -X POST http://localhost:3000/api/chat \\${NC}"
echo "     ${BLUE}  -H 'Content-Type: application/json' \\${NC}"
echo "     ${BLUE}  -d '{\"model\":\"gpt-4o\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"stream\":false}'${NC}"
echo ""
echo "  4. View logs:"
echo "     ${BLUE}docker-compose logs -f${NC}"
echo ""
echo "  5. Stop containers:"
echo "     ${BLUE}docker-compose down${NC}"
