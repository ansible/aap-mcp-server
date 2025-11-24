#!/usr/bin/env tsx

/**
 * Initialize MCP Session
 *
 * NOTE: This script is not used by the RapiDAST workflow.
 * It's kept for manual testing and utility purposes.
 *
 * The RapiDAST workflow uses scripts/generate-mcp-har.ts instead,
 * which handles session initialization internally while generating the HAR file.
 *
 * This script:
 * 1. Sends an MCP initialization request to the MCP server
 * 2. Extracts the Mcp-Session-Id from the response header
 * 3. Outputs the session ID to stdout
 *
 * Usage:
 *   tsx scripts/init-mcp-session.ts [mcp-url] [bearer-token]
 *
 * Example:
 *   tsx scripts/init-mcp-session.ts http://localhost:3000/mcp test-token
 *
 * Environment Variables:
 *   MCP_URL - MCP server URL (default: http://localhost:3000/mcp)
 *   BEARER_TOKEN - Bearer token for authentication (default: test-token)
 */

import http from "node:http";
import https from "node:https";

// Get configuration from args or environment
const MCP_URL =
  process.argv[2] || process.env.MCP_URL || "http://localhost:3000/mcp";
const BEARER_TOKEN =
  process.argv[3] || process.env.BEARER_TOKEN || "test-token";

// MCP initialization request payload
const initRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "ZAP-Security-Scanner",
      version: "1.0.0",
    },
  },
});

/**
 * Send MCP initialization request
 */
function initializeMcpSession(): void {
  const url = new URL(MCP_URL);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;

  const options: http.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BEARER_TOKEN}`,
      Accept: "application/json, text/event-stream",
      "Content-Length": Buffer.byteLength(initRequest),
    },
  };

  console.error(`Initializing MCP session at ${MCP_URL}...`);

  const req = client.request(options, (res) => {
    let data = "";

    res.on("data", (chunk) => {
      data += chunk;
    });

    res.on("end", () => {
      const sessionId = res.headers["mcp-session-id"];

      if (res.statusCode === 200 && sessionId) {
        console.error(`✓ Successfully obtained MCP session ID: ${sessionId}`);
        console.error(`Response status: ${res.statusCode}`);

        // Output just the session ID to stdout (for capture in workflow)
        console.log(sessionId);
        process.exit(0);
      } else {
        console.error(`✗ Failed to obtain MCP session ID`);
        console.error(`Response status: ${res.statusCode}`);
        console.error(`Response headers:`, res.headers);
        console.error(`Response body:`, data);
        process.exit(1);
      }
    });
  });

  req.on("error", (error) => {
    console.error(`✗ Request failed:`, error.message);
    process.exit(1);
  });

  // Send the request
  req.write(initRequest);
  req.end();
}

// Run the initialization
initializeMcpSession();
