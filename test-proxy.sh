#!/bin/bash
# Test script for ha-ai proxy

echo "Testing ha-ai proxy..."
echo ""

# Test 1: Health check
echo "1. Testing /health endpoint..."
curl -s http://localhost:3000/health | jq .
echo ""

# Test 2: Turn on command
echo "2. Testing turn_on intent..."
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "Available Devices:\n```csv\nentity_id,name,aliases,domain\nlight.living_room,Living Room Light,\"\",light\n```"},
      {"role": "user", "content": "turn on living room light"}
    ],
    "stream": false
  }' | jq '.message'
echo ""

# Test 3: Unknown intent (chat message)
echo "3. Testing unknown intent (hello)..."
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "Available Devices:\n```csv\nentity_id,name,aliases,domain\nlight.living_room,Living Room Light,\"\",light\n```"},
      {"role": "user", "content": "hello"}
    ],
    "stream": false
  }' | jq '.message'
echo ""

echo "All tests completed!"
