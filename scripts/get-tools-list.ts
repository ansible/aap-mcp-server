#!/usr/bin/env tsx

import http from "node:http";

const BASE_URL = "http://localhost:3000";
const BEARER_TOKEN = "test-token";

interface JsonRpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface Tool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

// Initialize session first
function initSession(): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestBody: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    };

    const requestBodyString = JSON.stringify(requestBody);

    const options: http.RequestOptions = {
      hostname: "localhost",
      port: 3000,
      path: "/mcp/developer_testing",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "Content-Length": Buffer.byteLength(requestBodyString),
      },
    };

    const req = http.request(options, (res) => {
      const sessionId = res.headers["mcp-session-id"] as string;
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve(sessionId));
    });

    req.on("error", reject);
    req.write(requestBodyString);
    req.end();
  });
}

// Get tools list
function getTools(sessionId: string): Promise<Tool[]> {
  return new Promise((resolve, reject) => {
    const requestBody: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };

    const requestBodyString = JSON.stringify(requestBody);

    const options: http.RequestOptions = {
      hostname: "localhost",
      port: 3000,
      path: "/mcp/developer_testing",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BEARER_TOKEN}`,
        "Mcp-Session-Id": sessionId,
        "Content-Length": Buffer.byteLength(requestBodyString),
      },
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        // Parse SSE format
        const lines = body.split("\n");
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (dataLine) {
          const json = JSON.parse(dataLine.substring(6));
          resolve(json.tools || json.result?.tools || []);
        } else {
          resolve([]);
        }
      });
    });

    req.on("error", reject);
    req.write(requestBodyString);
    req.end();
  });
}

async function main(): Promise<void> {
  try {
    const sessionId = await initSession();
    console.log(`Session ID: ${sessionId}\n`);

    const tools = await getTools(sessionId);
    console.log(`Total tools: ${tools.length}\n`);
    console.log("Tool names:");
    tools.forEach((tool, i) => {
      console.log(`${i + 1}. ${tool.name}`);
    });
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

main();
