#!/bin/bash

# Run MCP server with mock AAP for testing
#
# This script starts both the mock AAP server and the MCP server
# with the correct configuration for testing without a real AAP instance.

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

MOCK_AAP_PORT=${MOCK_AAP_PORT:-8080}
MCP_PORT=${MCP_PORT:-3000}

echo -e "${GREEN}Starting test environment...${NC}"

# Cleanup function
cleanup() {
  echo -e "\n${YELLOW}Shutting down servers...${NC}"
  if [ ! -z "$MOCK_AAP_PID" ]; then
    kill $MOCK_AAP_PID 2>/dev/null || true
    echo "Stopped mock AAP server (PID: $MOCK_AAP_PID)"
  fi
  if [ ! -z "$MCP_PID" ]; then
    kill $MCP_PID 2>/dev/null || true
    echo "Stopped MCP server (PID: $MCP_PID)"
  fi
  echo -e "${GREEN}Cleanup complete${NC}"
}

# Set up trap to cleanup on exit
trap cleanup EXIT INT TERM

# Start mock AAP server
echo -e "${GREEN}Starting mock AAP server on port ${MOCK_AAP_PORT}...${NC}"
MOCK_AAP_PORT=$MOCK_AAP_PORT npx tsx scripts/mock-aap-server.ts &
MOCK_AAP_PID=$!
echo "Mock AAP server started (PID: $MOCK_AAP_PID)"

# Wait for mock AAP to be ready
echo "Waiting for mock AAP server to be ready..."
for i in {1..10}; do
  if curl -s http://localhost:$MOCK_AAP_PORT/health > /dev/null 2>&1; then
    echo -e "${GREEN}Mock AAP server is ready!${NC}"
    break
  fi
  if [ $i -eq 10 ]; then
    echo -e "${RED}Mock AAP server failed to start${NC}"
    exit 1
  fi
  sleep 1
done

# Start MCP server with mock AAP base URL
echo -e "\n${GREEN}Starting MCP server on port ${MCP_PORT}...${NC}"
BASE_URL=http://localhost:$MOCK_AAP_PORT \
BEARER_TOKEN_OAUTH2_AUTHENTICATION=test-token \
PORT=$MCP_PORT \
npm start &
MCP_PID=$!
echo "MCP server started (PID: $MCP_PID)"

# Wait for MCP server to be ready
echo "Waiting for MCP server to be ready..."
for i in {1..30}; do
  if curl -s http://localhost:$MCP_PORT/api/v1/health > /dev/null 2>&1; then
    echo -e "${GREEN}MCP server is ready!${NC}"
    break
  fi
  if [ $i -eq 30 ]; then
    echo -e "${RED}MCP server failed to start${NC}"
    exit 1
  fi
  sleep 1
done

echo -e "\n${GREEN}✓ Both servers are running${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Mock AAP:  http://localhost:$MOCK_AAP_PORT"
echo "  MCP Server: http://localhost:$MCP_PORT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "\nPress Ctrl+C to stop both servers\n"

# Keep script running and wait for processes
wait $MCP_PID $MOCK_AAP_PID
