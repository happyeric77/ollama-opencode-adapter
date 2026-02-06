#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="ollama-opencode-adapter"
VERSION="${1:-local}"
PLATFORM="linux/arm64"

echo -e "${BLUE}🐳 Building ollama-opencode-adapter Docker image${NC}"
echo "=================================="
echo "Version:  $VERSION"
echo "Platform: $PLATFORM"
echo "Image:    $IMAGE_NAME"
echo ""

# Check if docker buildx is available
if ! docker buildx version > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker buildx not found. Please install it first.${NC}"
    exit 1
fi

# Build image
echo -e "${YELLOW}📦 Building image...${NC}"
docker buildx build \
    --platform "$PLATFORM" \
    --tag "$IMAGE_NAME:$VERSION" \
    --load \
    .

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Build completed successfully!${NC}"
    echo ""
    echo "Image created:"
    echo "  • $IMAGE_NAME:$VERSION"
    echo ""
    echo "Next steps:"
    echo "  1. Start service:  ${BLUE}docker-compose up -d${NC}"
    echo "  2. View logs:      ${BLUE}docker-compose logs -f${NC}"
    echo "  3. Run tests:      ${BLUE}./scripts/docker-test.sh${NC}"
else
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi
