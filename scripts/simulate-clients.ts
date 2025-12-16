#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync } from "fs";
import { load as yamlLoad } from "js-yaml";

// Configuration
const BASE_URL = "http://localhost:3000";
const CONFIG_FILE = "aap-mcp.yaml";

// Command line arguments parsing
const args = process.argv.slice(2);
const getArgValue = (argName, defaultValue) => {
  const index = args.findIndex((arg) => arg === argName);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
};

// Show help if requested
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: node simulate-clients.js [options]

Options:
  --num-clients <number>          Number of clients to simulate (default: 20)
  --request-interval <ms>         Interval between requests in milliseconds (default: 3000)
  --duration <seconds>            Duration to run simulation in seconds (default: 120)
  --token <string>                Bearer token for authentication
  --help, -h                      Show this help message

Examples:
  node simulate-clients.js --num-clients 50
  node simulate-clients.js --request-interval 5000
  node simulate-clients.js --duration 300 --num-clients 20
`);
  process.exit(0);
}

const NUM_CLIENTS = parseInt(getArgValue("--num-clients", "20"), 10);
const DURATION_SECONDS = parseInt(getArgValue("--duration", "120"), 10);
const BEARER_TOKEN = getArgValue("--token", "random-string");

// Metrics configuration
const METRICS_INTERVAL = 10000; // Fetch metrics every 30 seconds
const METRICS_URL = `${BASE_URL}/metrics`;

// Load toolsets from YAML config
let serverUrls = [];
let toolsets = [];
const errorsFound: string[] = [];

// Give a bit of time to the mcp-server to start
await delay(4000);

try {
  const configContent = readFileSync(CONFIG_FILE, "utf8");
  const config = yamlLoad(configContent);

  if (config.toolsets) {
    toolsets = Object.keys(config.toolsets);
    serverUrls = toolsets.map((toolset) => ({
      toolset: toolset,
      url: `${BASE_URL}/mcp/${toolset}`,
    }));
    console.log(
      `📂 Loaded ${toolsets.length} toolsets: ${toolsets.join(", ")}`,
    );
  } else if (config.categories) {
    // Fallback to old categories format
    toolsets = Object.keys(config.categories);
    serverUrls = toolsets.map((toolset) => ({
      toolset: toolset,
      url: `${BASE_URL}/mcp/${toolset}`,
    }));
    console.log(
      `📂 Loaded ${toolsets.length} toolsets (from categories): ${toolsets.join(", ")}`,
    );
  } else {
    throw new Error("No toolsets found in config file");
  }
} catch (error) {
  console.error("❌ Failed to load toolsets from config file:", error.message);
  console.log("📋 Using fallback toolsets");
  toolsets = ["all", "job_management", "inventory_management"];
  serverUrls = toolsets.map((toolset) => ({
    toolset: toolset,
    url: `${BASE_URL}/mcp/${toolset}`,
  }));
}

// Client state tracking
const clients = new Map();
let nextClientId = 1; // Counter for assigning unique client IDs

const randomKillStats = {
  totalTerminated: 0,
  terminatedThisMinute: 0,
  lastRandomKillTime: null,
};

const connectionCreationStats = {
  totalCreated: 0,
  createdThisInterval: 0,
  lastCreationTime: null,
};

class MCPClientSimulator {
  constructor(id, serverUrl, toolset) {
    this.id = id;
    this.serverUrl = serverUrl;
    this.toolset = toolset;
    this.userAgent = `MCP-Test-Client/${id}`;
    this.isActive = false;
    this.client = null;
    this.transport = null;
    this.interval = null;
    this.wasTerminatedAbruptly = false;
    this.randomKillCount = 0;
    this.tools = [];
  }

  async initialize() {
    try {
      console.log(
        `[Client ${this.id}] Initializing with toolset: ${this.toolset}`,
      );

      // Create HTTP transport with authentication and user agent
      // Note: StreamableHTTPClientTransport has limited header support
      // Authorization headers may not be transmitted properly
      this.transport = new StreamableHTTPClientTransport(this.serverUrl, {
        requestInit: {
          headers: {
            Authorization: `Bearer ${BEARER_TOKEN}`,
            "User-Agent": this.userAgent,
            "mcp-protocol-version": "2025-06-18",
            "accept-language": "*",
          },
        },
      });

      // Create MCP client
      this.client = new Client(
        {
          name: `test-client-${this.id}`,
          version: "1.0.0",
        },
        {
          capabilities: {
            tools: {},
          },
          protocolVersion: "2025-06-18",
        },
      );

      // Connect to server
      await this.client.connect(this.transport);

      console.log(`[Client ${this.id}] Connected successfully`);
      this.isActive = true;
      return true;
    } catch (error) {
      errorsFound.push(error.message);
      console.error(
        `[Client ${this.id}] Initialization failed:`,
        error.message,
      );
      await this.cleanup();
      return false;
    }
  }

  async listTools() {
    if (!this.isActive || !this.client) {
      return false;
    }

    try {
      // Use SDK's built-in listTools method
      const response = await this.client.listTools();

      const toolCount = response.tools?.length || 0;
      if (toolCount > 0) {
        this.tools = response.tools;
      }
      console.log(
        `[Client ${this.id}] Listed ${toolCount} tools (toolset: ${this.toolset})`,
      );
      return true;
    } catch (error) {
      console.error(`[Client ${this.id}] tools/list failed:`, error.message);

      // Handle connection errors by marking client as inactive
      if (
        error.message.includes("connection") ||
        error.message.includes("session") ||
        error.message.includes("transport")
      ) {
        console.log(`[Client ${this.id}] Connection lost, marking inactive`);
        this.isActive = false;
        await this.cleanup();
        errorsFound.push(error.message);
      }
      return false;
    }
  }

  async callTool() {
    if (!this.isActive || !this.client) {
      console.error(`[Client ${this.id}] Not connected, skipping callTool`);
      return false;
    }
    if (this.tools.length === 0) {
      console.error(
        `[Client ${this.id}] Not tools available, skipping callTool`,
      );
      return false;
    }
    const toolsWithNoRequiredParameters = this.tools.filter(
      (tool) =>
        !tool.inputSchema.required || tool.inputSchema.required.length === 0,
    );

    if (toolsWithNoRequiredParameters.length === 0) {
      console.error(
        `[Client ${this.id}] Empty list of tools with no required parameters, skipping callTool`,
      );
      return false;
    }

    const tool = toolsWithNoRequiredParameters[0];
    const params = {
      name: tool.name,
    };
    await this.client
      .callTool(params)
      .catch((e) =>
        console.log(
          `Unexpected tool answer when calling tool ${tool.name}: ${e}`,
        ),
      );
  }

  async cleanup() {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }
    } catch (error) {
      console.error(`[Client ${this.id}] Cleanup error:`, error.message);
    }
    this.isActive = false;
  }

  async disconnect() {
    if (!this.isActive) {
      return;
    }

    try {
      await this.cleanup();
      console.log(`[Client ${this.id}] Disconnected`);
    } catch (error) {
      console.error(`[Client ${this.id}] Disconnect failed:`, error.message);
    }
  }

  // Abrupt disconnection without proper cleanup - simulates network failure or client crash
  abruptDisconnect() {
    console.log(
      `🔥 [Client ${this.id}] ABRUPT DISCONNECTION - Simulating client crash/network failure`,
    );

    // Mark as abruptly terminated
    this.wasTerminatedAbruptly = true;
    this.randomKillCount++;
    this.isActive = false;

    // Clear interval to stop periodic requests
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Do NOT call cleanup() - this simulates an abrupt disconnection
    // The server should detect the broken connection via session timeout
    this.client = null;
    this.transport = null;

    // Update global stats
    randomKillStats.totalTerminated++;
    randomKillStats.terminatedThisMinute++;

    console.log(
      `💀 [Client ${this.id}] Session abandoned (randomKill #${this.randomKillCount}). Server should clean up via timeout.`,
    );
  }

  startPeriodicRequests() {
    const interval = setInterval(
      async () => {
        if (!this.isActive) {
          return;
        }

        if (this.tools.length === 0) {
          await this.listTools();
        } else {
          await this.callTool();
        }
      },
      Math.floor(Math.random() * 10000),
    );

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

// Shared function to create and initialize a client
async function createClient() {
  const clientId = nextClientId++;

  // Always use random server selection
  const serverUrlIndex = Math.floor(Math.random() * serverUrls.length);
  const selectedServer = serverUrls[serverUrlIndex];

  // Create new client
  const client = new MCPClientSimulator(
    clientId,
    selectedServer.url,
    selectedServer.toolset,
  );

  clients.set(clientId, client);

  // Always update creation stats
  connectionCreationStats.totalCreated++;
  connectionCreationStats.createdThisInterval++;
  connectionCreationStats.lastCreationTime = new Date();

  console.log(
    `🆕 [Client ${clientId}] Creating new connection for toolset: ${selectedServer.toolset}`,
  );

  // Initialize client
  const initializeClient = async () => {
    try {
      const success = await client.initialize();
      if (success) {
        // Always start periodic requests
        client.startPeriodicRequests();
        console.log(
          `✅ [Client ${clientId}] Successfully connected and started`,
        );
        return true;
      } else {
        console.log(`❌ [Client ${clientId}] Failed to initialize`);
        return false;
      }
    } catch (error) {
      console.error(
        `💥 [Client ${clientId}] Initialization error:`,
        error.message,
      );
      return false;
    }
  };

  // Always use asynchronous initialization
  await initializeClient();
}

// Parse Prometheus format metrics
function parsePrometheusMetrics(text) {
  const metrics = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments that are not metadata
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Parse metric lines
    const lineFields = trimmed.split(" ");
    if (lineFields.length > 1) {
      metrics.push({
        name: lineFields[0],
        value: lineFields[1],
      });
    }
  }

  return metrics;
}

// Fetch and parse server metrics
async function fetchServerMetrics() {
  try {
    const response = await fetch(METRICS_URL, {
      method: "GET",
      headers: {
        Accept: "text/plain",
        "User-Agent": "MCP-Simulation-Client/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    const rawMetrics = parsePrometheusMetrics(text);

    // Extract relevant metrics for our dashboard
    const serverMetrics = {
      heapSizeUsedBytes: 0,
      mcpSessionsActiveTotal: 0,
      mcpSessionsTimeoutTotal: 0,
      timestamp: new Date(),
    };

    // Map Prometheus metrics to our structure
    for (const metric of rawMetrics) {
      switch (metric.name) {
        case "nodejs_heap_size_used_bytes":
          serverMetrics.heapSizeUsedBytes = metric.value;
          break;
        case "mcp_sessions_active_total":
          serverMetrics.mcpSessionsActiveTotal = metric.value;
          break;
        case "mcp_sessions_timeout_total":
          serverMetrics.mcpSessionsTimeoutTotal = metric.value;
          break;
      }
    }

    return { success: true, metrics: serverMetrics, rawMetrics };
  } catch (error) {
    console.error(`❌ Failed to fetch server metrics: ${error.message}`);
    errorsFound.push(error.message);
    return { success: false, error: error.message };
  }
}

// Format metrics for display
function formatMetrics(metrics) {
  return [
    `📊 Server Metrics (${metrics.timestamp.toLocaleTimeString()}):`,
    `   🔗 Memory: ${(metrics.heapSizeUsedBytes / 1000000).toFixed(1)}MB`,
    `   🎫 MCP Sessions: ${metrics.mcpSessionsActiveTotal} active, ${metrics.mcpSessionsTimeoutTotal} timeouts`,
  ].join("\n");
}

function getStats() {
  const activeClients = Array.from(clients.values()).filter(
    (c) => c.isActive,
  ).length;
  const totalClients = clients.size;
  const terminatedClients = Array.from(clients.values()).filter(
    (c) => c.wasTerminatedAbruptly && !c.isActive,
  ).length;

  return {
    active: activeClients,
    total: totalClients,
    terminated: terminatedClients,
    totalRandomKills: randomKillStats.totalTerminated,
    totalCreated: connectionCreationStats.totalCreated,
  };
}

// Periodically terminate a percentage of active clients abruptly
function startConnectionRandomKill() {
  setInterval(
    () => {
      const activeClients = Array.from(clients.values()).filter(
        (c) => c.isActive,
      );

      if (activeClients.length === 0) {
        return;
      }

      // Calculate how many clients to terminate (25% of active clients)

      // Randomly select clients to terminate
      const shuffled = activeClients.sort(() => 0.5 - Math.random());
      const clientsToTerminate = shuffled.slice(
        0,
        Math.floor(Math.random() * 10),
      );

      console.log(
        `\n🎯 RANDOMKILL EVENT: Abruptly disconnecting ${clientsToTerminate.length}/${activeClients.length} active clients`,
      );

      // Reset this minute's counter
      randomKillStats.terminatedThisMinute = 0;

      // Terminate selected clients
      clientsToTerminate.forEach((client) => {
        client.abruptDisconnect();
      });

      console.log(
        `💥 ${clientsToTerminate.length} clients terminated abruptly. Server should detect and clean up sessions via timeout.\n`,
      );
    },
    Math.floor(Math.random() * 10000),
  );
}

// Periodically create new connections to test dynamic scaling
function startConnectionCreation() {
  setInterval(
    () => {
      if (clients.size === 0) {
        return;
      }
      // Create 1-3 new connections each cycle (every 120 seconds by default)
      const numToCreate = Math.floor(Math.random() * 3) + 1;

      console.log(
        `\n🌟 CONNECTION CREATION EVENT: Creating ${numToCreate} new connections`,
      );

      // Reset this interval's counter
      connectionCreationStats.createdThisInterval = 0;

      for (let i = 0; i < numToCreate; i++) {
        // Create client using shared function
        createClient();
      }

      console.log(
        `🌟 ${numToCreate} new connections created. Total created: ${connectionCreationStats.totalCreated}\n`,
      );
    },
    Math.floor(Math.random() * 10000),
  );
}

// Main simulation logic
async function startSimulation() {
  console.log(`🚀 Starting MCP client simulation with ${NUM_CLIENTS} clients`);
  console.log(`📡 Base URL: ${BASE_URL}`);
  console.log(`🔗 Server URLs: ${serverUrls.map((s) => s.url).join(", ")}`);
  console.log(
    `⏰ Duration: ${DURATION_SECONDS}s (${Math.floor(DURATION_SECONDS / 60)}m ${DURATION_SECONDS % 60}s)`,
  );
  console.log(`🔑 Bearer token: ${BEARER_TOKEN.substring(0, 10)}...`);
  console.log(`🔧 Using MCP SDK Client for communication`);
  console.log("─".repeat(60));

  // Create and initialize clients with staggered startup
  while (nextClientId <= NUM_CLIENTS) {
    // Create client using shared function
    createClient();

    await delay(100);
  }

  // Start metrics fetching if enabled
  let latestMetrics = null;
  let metricsInterval = null;

  metricsInterval = setInterval(async () => {
    const result = await fetchServerMetrics();
    if (result.success) {
      latestMetrics = result.metrics;
      console.log("\n" + formatMetrics(latestMetrics));
    }
  }, METRICS_INTERVAL);

  // Log periodic stats
  const statsInterval = setInterval(() => {
    const stats = getStats();

    // Count clients per toolset
    const toolsetStats = new Map();
    Array.from(clients.values()).forEach((client) => {
      if (client.isActive) {
        toolsetStats.set(
          client.toolset,
          (toolsetStats.get(client.toolset) || 0) + 1,
        );
      }
    });

    const toolsetStatsStr = Array.from(toolsetStats.entries())
      .map(([toolset, count]) => `${toolset}: ${count}`)
      .join(", ");

    // Enhanced stats with server metrics correlation
    let metricsCorrelation = "";
    if (latestMetrics) {
      const serverSessions = latestMetrics.activeSessions;
      const clientSessions = stats.active;
      const sessionDiff = Math.abs(serverSessions - clientSessions);

      if (sessionDiff > 0) {
        metricsCorrelation = ` | Server sees ${serverSessions} sessions (±${sessionDiff})`;
      } else {
        metricsCorrelation = ` | Server sessions: ✅ ${serverSessions}`;
      }
    }

    console.log(
      `📊 Active: ${stats.active}/${stats.total} | Terminated: ${stats.terminated} (kills: ${stats.totalRandomKills}) | Created: ${stats.totalCreated} | Toolsets: ${toolsetStatsStr}${metricsCorrelation} | ${new Date().toLocaleTimeString()}`,
    );
  }, 10000); // Every 10 seconds

  // Set up duration timeout for automatic shutdown
  const durationTimeout = setTimeout(async () => {
    console.log(
      `\n⏰ Duration limit (${DURATION_SECONDS}s) reached. Shutting down simulation...`,
    );
    clearInterval(statsInterval);
    if (metricsInterval) {
      clearInterval(metricsInterval);
    }

    // Stop all clients
    const disconnectPromises = Array.from(clients.values()).map((client) => {
      client.abruptDisconnect();
    });

    clients.clear();
    await Promise.allSettled(disconnectPromises);

    console.log(
      "\n📊 Test is done, waiting 60s to be sure all the sessions are properly closed before collecting the final metrics.",
    );
    await delay(60000);

    // Final metrics fetch
    console.log("\n📊 Final server metrics:");
    const finalMetrics = await fetchServerMetrics();
    if (
      finalMetrics.metrics &&
      finalMetrics.metrics.mcpSessionsActiveTotal > 0
    ) {
      errorsFound.push(
        `Some remaining sessions were found after the end of the test ${finalMetrics.metrics.mcpSessionsActiveTotal}`,
      );
    }
    if (finalMetrics.success) {
      console.log(formatMetrics(finalMetrics.metrics));
    }
    if (errorsFound.length > 0) {
      console.log("Error founds during the run!", errorsFound);
      process.exit(1);
    }
    console.log("🏁 Simulation completed successfully");
    process.exit(0);
  }, DURATION_SECONDS * 1000);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down simulation...");
    clearInterval(statsInterval);
    if (metricsInterval) {
      clearInterval(metricsInterval);
    }
    clearTimeout(durationTimeout);

    // Stop all clients
    const disconnectPromises = Array.from(clients.values()).map((client) => {
      client.stop();
    });

    await Promise.allSettled(disconnectPromises);

    console.log("✅ All clients disconnected");
    if (errorsFound.length > 0) {
      console.log("Error founds during the run!", errorsFound);
      process.exit(1);
    }
    process.exit(0);
  });

  // Start the abrupt connection randomKill process
  console.log(`🎯 Starting abrupt connection randomKill...`);
  startConnectionRandomKill();

  // Start the connection creation process
  console.log(`🌟 Starting connection creation system...`);
  startConnectionCreation();

  console.log("✅ Simulation started! Press Ctrl+C to stop manually");
  console.log("📊 Stats will be logged every 10 seconds");
  console.log("💀 Abrupt randomKills will begin after 1 minute");
  console.log("🌟 New connections will be created every 2 minutes");
  console.log(
    `⏰ Simulation will auto-stop after ${DURATION_SECONDS}s (${Math.floor(DURATION_SECONDS / 60)}m ${DURATION_SECONDS % 60}s)`,
  );
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
