#!/usr/bin/env node

import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { load as yamlLoad } from "js-yaml";

// Configuration
const BASE_URL = "http://localhost:3000";
const CONFIG_FILE = "aap-mcp.yaml";
const NUM_CLIENTS = 100;
const REQUEST_INTERVAL = 3000; // 30 seconds
const BEARER_TOKEN = ""; // Replace with actual token

// Load categories from YAML config
let serverUrls = [];
let categories = [];

try {
  const configContent = readFileSync(CONFIG_FILE, "utf8");
  const config = yamlLoad(configContent);

  if (config.categories) {
    categories = Object.keys(config.categories);
    serverUrls = categories.map((category) => ({
      category,
      url: `${BASE_URL}/mcp/${category}`,
    }));
    console.log(
      `📂 Loaded ${categories.length} categories: ${categories.join(", ")}`,
    );
  } else {
    throw new Error("No categories found in config file");
  }
} catch (error) {
  console.error(
    "❌ Failed to load categories from config file:",
    error.message,
  );
  console.log("📋 Using fallback categories");
  categories = ["all", "job_management", "inventory_management"];
  serverUrls = categories.map((category) => ({
    category,
    url: `${BASE_URL}/mcp/${category}`,
  }));
}

// Client state tracking
const clients = new Map();

class MCPClient {
  constructor(id, serverUrl, category) {
    this.id = id;
    this.sessionId = null;
    this.serverUrl = serverUrl;
    this.category = category;
    this.userAgent = `MCP-Test-Client/${id}`;
    this.isActive = false;
  }

  // Parse Server-Sent Events (SSE) response
  async parseSseResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6); // Remove 'data: ' prefix
            if (data.trim() === "[DONE]") {
              return result;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.jsonrpc) {
                result = parsed;
                // For now, we'll take the first complete JSON-RPC response
                return result;
              }
            } catch (e) {
              // Ignore malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return result;
  }

  async initialize() {
    try {
      console.log(
        `[Client ${this.id}] Initializing with category: ${this.category}`,
      );

      const initRequest = {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {},
          },
          clientInfo: {
            name: `test-client-${this.id}`,
            version: "1.0.0",
          },
        },
      };

      const response = await fetch(this.serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BEARER_TOKEN}`,
          "User-Agent": this.userAgent,
          Accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          "accept-language": "*",
        },
        body: JSON.stringify(initRequest),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Extract session ID from response headers
      this.sessionId = response.headers.get("mcp-session-id");

      if (!this.sessionId) {
        throw new Error("No session ID received from server");
      }

      // Handle SSE response for initialization
      const initResult = await this.parseSseResponse(response);

      if (initResult && initResult.error) {
        throw new Error(`MCP Error: ${initResult.error.message}`);
      }

      console.log(
        `[Client ${this.id}] Initialized with session ID: ${this.sessionId}`,
      );
      this.isActive = true;
      return true;
    } catch (error) {
      console.error(
        `[Client ${this.id}] Initialization failed:`,
        error.message,
      );
      return false;
    }
  }

  async listTools() {
    if (!this.isActive || !this.sessionId) {
      console.error(`[Client ${this.id}] Not initialized, skipping tools/list`);
      return false;
    }

    try {
      const listRequest = {
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "tools/list",
        params: {},
      };

      const response = await fetch(this.serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BEARER_TOKEN}`,
          "User-Agent": this.userAgent,
          "mcp-session-id": this.sessionId,
          Accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          "accept-language": "*",
        },
        body: JSON.stringify(listRequest),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Handle SSE response for tools/list
      const result = await this.parseSseResponse(response);

      if (!result) {
        throw new Error("No response received from server");
      }

      if (result.error) {
        throw new Error(`MCP Error: ${result.error.message}`);
      }

      const toolCount = result.result?.tools?.length || 0;
      console.log(
        `[Client ${this.id}] Listed ${toolCount} tools (category: ${this.category})`,
      );
      return true;
    } catch (error) {
      console.error(`[Client ${this.id}] tools/list failed:`, error.message);
      // Mark as inactive if session is invalid
      if (error.message.includes("session not initialized")) {
        this.isActive = false;
      }
      return false;
    }
  }

  async disconnect() {
    if (!this.isActive || !this.sessionId) {
      return;
    }

    try {
      await fetch(this.serverUrl, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          "User-Agent": this.userAgent,
          "mcp-session-id": this.sessionId,
        },
      });

      console.log(`[Client ${this.id}] Disconnected`);
    } catch (error) {
      console.error(`[Client ${this.id}] Disconnect failed:`, error.message);
    }

    this.isActive = false;
    this.sessionId = null;
  }

  startPeriodicRequests() {
    const interval = setInterval(async () => {
      if (!this.isActive) {
        console.log(`[Client ${this.id}] Attempting to reconnect...`);
        const success = await this.initialize();
        if (!success) {
          return;
        }
      }

      await this.listTools();
    }, REQUEST_INTERVAL);

    // Store interval for cleanup
    this.interval = interval;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.disconnect();
  }
}

// Utility functions
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStats() {
  const activeClients = Array.from(clients.values()).filter(
    (c) => c.isActive,
  ).length;
  const totalClients = clients.size;
  return { active: activeClients, total: totalClients };
}

// Main simulation logic
async function startSimulation() {
  console.log(`🚀 Starting MCP client simulation with ${NUM_CLIENTS} clients`);
  console.log(`📡 Base URL: ${BASE_URL}`);
  console.log(`🔗 Server URLs: ${serverUrls.map((s) => s.url).join(", ")}`);
  console.log(`⏱️  Request interval: ${REQUEST_INTERVAL}ms`);
  console.log(`🔑 Bearer token: ${BEARER_TOKEN.substring(0, 10)}...`);
  console.log("─".repeat(60));

  // Create and initialize clients with staggered startup
  for (let i = 1; i <= NUM_CLIENTS; i++) {
    // Distribute clients across different server URLs
    const serverUrlIndex = (i - 1) % serverUrls.length;
    const selectedServer = serverUrls[serverUrlIndex];

    const client = new MCPClient(
      i,
      selectedServer.url,
      selectedServer.category,
    );
    clients.set(i, client);

    // Initialize client
    const success = await client.initialize();

    if (success) {
      // Start periodic requests
      client.startPeriodicRequests();
    }

    // Stagger client startup to avoid overwhelming the server
    if (i < NUM_CLIENTS) {
      await delay(100); // 100ms delay between client startups
    }
  }

  // Log periodic stats
  const statsInterval = setInterval(() => {
    const stats = getStats();

    // Count clients per category
    const categoryStats = new Map();
    Array.from(clients.values()).forEach((client) => {
      if (client.isActive) {
        categoryStats.set(
          client.category,
          (categoryStats.get(client.category) || 0) + 1,
        );
      }
    });

    const categoryStatsStr = Array.from(categoryStats.entries())
      .map(([category, count]) => `${category}: ${count}`)
      .join(", ");

    console.log(
      `📊 Active clients: ${stats.active}/${stats.total} | Categories: ${categoryStatsStr} | ${new Date().toLocaleTimeString()}`,
    );
  }, 10000); // Every 10 seconds

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down simulation...");
    clearInterval(statsInterval);

    // Stop all clients
    const disconnectPromises = Array.from(clients.values()).map((client) => {
      client.stop();
    });

    await Promise.allSettled(disconnectPromises);
    console.log("✅ All clients disconnected");
    process.exit(0);
  });

  console.log("✅ Simulation started! Press Ctrl+C to stop");
  console.log("📊 Stats will be logged every 10 seconds");
}

// Error handling
process.on("unhandledRejection", (error) => {
  console.error("🚨 Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("🚨 Uncaught exception:", error);
  process.exit(1);
});

// Start the simulation
startSimulation().catch((error) => {
  console.error("🚨 Failed to start simulation:", error);
  process.exit(1);
});
