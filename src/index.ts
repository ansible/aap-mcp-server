#!/usr/bin/env node

import OASNormalize from "oas-normalize";
import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { extractToolsFromApi } from "./extract-tools.js";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";
import { ToolLogger } from "./logger.js";
import { metricsService } from "./metrics.js";
// View imports are now handled by the routes module
import { configureWebUIRoutes } from "./views/routes.js";
import {
  loadOpenApiSpecs,
  type AAPMcpToolDefinition,
  type ServiceConfig,
} from "./openapi-loader.js";
import { SessionManager } from "./session.js";

// Load environment variables
config();

type Toolset = string[];

interface AapMcpConfig {
  record_api_queries?: boolean;
  "ignore-certificate-errors"?: boolean;
  enable_ui?: boolean;
  enable_metrics?: boolean;
  allow_write_operations?: boolean;
  base_url?: string;
  session_timeout?: number;
  services?: ServiceConfig[];
  toolsets: Record<string, string[]>;
}

// Load configuration from file
const loadConfig = (): AapMcpConfig => {
  const configPath = join(process.cwd(), "aap-mcp.yaml");
  const configFile = readFileSync(configPath, "utf8");
  const config = yaml.load(configFile) as AapMcpConfig;

  if (!config.toolsets) {
    throw new Error("Invalid configuration: missing toolsets section");
  }

  return config;
};

// Load configuration
const localConfig = loadConfig();
const allToolsets: Record<string, Toolset> = localConfig.toolsets;

// Configuration constants (with priority: env var > config file > default)
const CONFIG = {
  BASE_URL: process.env.BASE_URL || localConfig.base_url || "https://localhost",
  MCP_PORT: process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000,
  SESSION_TIMEOUT: process.env.SESSION_TIMEOUT
    ? parseInt(process.env.SESSION_TIMEOUT, 10)
    : localConfig.session_timeout || 120, // Default to 120 seconds (2 minutes)
} as const;

// Log entries size limit for /logs endpoint
const logEntriesSizeLimit = 10000;

// Helper function to get boolean configuration with environment variable override
const getBooleanConfig = (
  envVar: string,
  configValue: boolean | undefined,
): boolean => {
  return process.env[envVar] !== undefined
    ? process.env[envVar]!.toLowerCase() === "true"
    : (configValue ?? false);
};

// Get configuration settings (priority: env var > config file > default)
const recordApiQueries = getBooleanConfig(
  "RECORD_API_QUERIES",
  localConfig.record_api_queries,
);

const ignoreCertificateErrors = getBooleanConfig(
  "IGNORE_CERTIFICATE_ERRORS",
  localConfig["ignore-certificate-errors"],
);

const enableUI = getBooleanConfig("ENABLE_UI", localConfig.enable_ui);

const allowWriteOperations = getBooleanConfig(
  "ALLOW_WRITE_OPERATIONS",
  localConfig.allow_write_operations,
);

// Initialize allowed operations list based on configuration
const allowedOperations = allowWriteOperations
  ? ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
  : ["GET", "HEAD", "OPTIONS"];

// Get services configuration
const servicesConfig = localConfig.services || [];

// Helper function to get timestamps
const getTimestamp = (): string => {
  return new Date().toISOString().split(".")[0] + "Z";
};

// Configure HTTPS certificate validation globally
if (ignoreCertificateErrors) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn(
    `${getTimestamp()} WARNING: HTTPS certificate validation is disabled. This should only be used in development/testing environments.`,
  );
}

// TypeScript interfaces

// Helper functions
const extractBearerToken = (
  authHeader: string | undefined,
): string | undefined => {
  return authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.substring(7)
    : undefined;
};

// Validate authorization token
const validateToken = async (bearerToken: string): Promise<void> => {
  try {
    const response = await fetch(`${CONFIG.BASE_URL}/api/gateway/v1/me/`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Authentication failed: ${response.status} ${response.statusText}`,
      );
    }

    // Token is valid, no need to extract user data
  } catch (error) {
    console.error(`${getTimestamp()} Token validation failed:`, error);
    throw new Error(
      `Token validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const storeSessionData = (
  sessionId: string,
  token: string,
  userAgent: string,
  toolset: string,
  transport: StreamableHTTPServerTransport,
): void => {
  sessionManager.store(sessionId, token, userAgent, toolset, transport);
};

const deleteSessionData = (sessionId: string): void => {
  sessionManager.delete(sessionId);
};

// Determine user toolset based on toolset name
const getUserToolset = (toolset?: string): Toolset => {
  // If toolset is provided, try to find it
  if (toolset) {
    const toolsetName = toolset.toLowerCase();
    if (allToolsets[toolsetName]) {
      return allToolsets[toolsetName];
    } else {
      console.warn(
        `${getTimestamp()} Unknown toolset: ${toolset}, defaulting to 'all' toolset`,
      );
    }
  }

  // Default to "all" toolset if no toolset provided or toolset not found
  if (allToolsets["all"]) {
    return allToolsets["all"];
  }

  // If "all" toolset doesn't exist, return all available tools
  console.warn(`${getTimestamp()} No 'all' toolset found, returning all tools`);
  return allTools.map((tool) => tool.name);
};

// Filter tools based on toolset
const filterToolsByToolset = (
  tools: AAPMcpToolDefinition[],
  toolset: Toolset,
): AAPMcpToolDefinition[] => {
  return tools.filter((tool) => toolset.includes(tool.name));
};

// Find which toolset a tool belongs to (returns first match or "uncategorized")
const getToolsetForTool = (toolName: string): string => {
  for (const [toolsetName, toolsetTools] of Object.entries(allToolsets)) {
    if (toolsetTools.includes(toolName)) {
      return toolsetName;
    }
  }
  return "uncategorized";
};

// Generate tools from OpenAPI specs
const generateTools = async (): Promise<AAPMcpToolDefinition[]> => {
  const openApiSpecs = await loadOpenApiSpecs(servicesConfig, CONFIG.BASE_URL);
  let rawToolList: AAPMcpToolDefinition[] = [];

  for (const spec of openApiSpecs) {
    console.log(`${getTimestamp()}   Loading ${spec.service}...`);
    let oas = new OASNormalize(spec.spec);
    const derefedDocument = await oas.deref();
    oas = new OASNormalize(derefedDocument);

    const mspecification = await oas.convert();
    // Convert to bundled version for consistency
    const bundledSpec = await new OASNormalize(mspecification).bundle();

    try {
      const tools = extractToolsFromApi(
        bundledSpec as any,
      ) as AAPMcpToolDefinition[];
      const filteredTools = tools.filter((tool) => {
        tool.service = spec.service; // Add service information to each tool
        tool.logs = tool.logs || []; // Ensure logs array is initialized
        // Filter out operations not in allowedOperations list
        if (!allowedOperations.includes(tool.method.toUpperCase())) {
          tool.logs.push({
            severity: "INFO",
            msg: "operation disabled by configuration",
          });
          return false;
        }
        return spec.reformatFunc(tool);
      });
      rawToolList = rawToolList.concat(filteredTools);
    } catch (error) {
      console.error(
        `${getTimestamp()} Error generating tools from OpenAPI spec:`,
        error,
      );
    }
  }

  // Calculate size for each tool and sort by size
  const toolsWithSize: AAPMcpToolDefinition[] = rawToolList.map((tool) => {
    const toolSize = JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }).length;
    return {
      ...tool,
      size: toolSize,
    };
  });

  // Sort by size in descending order
  toolsWithSize.sort((a, b) => b.size - a.size);

  // Generate CSV content
  const csvHeader =
    "Tool name,size (characters),description,path template,service\n";
  const csvRows = toolsWithSize
    .map(
      (tool) =>
        `${tool.name},${tool.size},"${tool.description}",${tool.pathTemplate},${tool.service || "unknown"}`,
    )
    .join("\n");
  const csvContent = csvHeader + csvRows;

  // Write the tools list in the local environment
  if (process.env.NODE_ENV === "development") {
    writeFileSync("tool_list.csv", csvContent, "utf8");
    console.log(
      `${getTimestamp()} Tool list saved to tool_list.csv (${toolsWithSize.length} tools)`,
    );
  }

  return toolsWithSize;
};

// Initialize logger only if recording is enabled
const toolLogger = recordApiQueries ? new ToolLogger() : null;

// Factory function to create a new Server instance with request handlers
// Each transport gets its own Server instance to prevent session routing conflicts
const createMcpServer = (): Server => {
  const server = new Server(
    {
      name: "aap",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    // Get the session ID from the transport context
    const sessionId = extra?.sessionId;

    // Get toolset from session data
    let toolsetOverride: string | undefined;
    if (sessionId && sessionManager.has(sessionId)) {
      toolsetOverride = sessionManager.getToolset(sessionId);
    }

    // Determine user toolset based on toolset from session
    const toolset = getUserToolset(toolsetOverride);

    // Filter tools based on toolset
    const filteredTools = filterToolsByToolset(allTools, toolset);

    return {
      tools: filteredTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;
    const _startTime = Date.now();
    const sessionId = extra?.sessionId;

    if (!sessionId || !sessionManager.has(sessionId)) {
      throw new Error("Invalid or missing session ID");
    }

    // Generate correlation ID for this request
    const correlationId = randomUUID().substring(0, 8);

    // Find the matching tool
    const tool = allTools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // Get toolset for this tool
    const toolToolset = getToolsetForTool(tool.name);

    // Get user-agent from session data (if available)
    let userAgent = "unknown";
    if (sessionId && sessionManager.has(sessionId)) {
      userAgent = sessionManager.getUserAgent(sessionId) || "unknown";
    }

    // Get the Bearer token for this session
    const bearerToken = sessionManager.getToken(sessionId)!;

    // Execute the tool by making HTTP request
    let result: any;
    let response: Response | undefined;
    let fullUrl: string = `${CONFIG.BASE_URL}${tool.pathTemplate}`;
    let requestOptions: RequestInit | undefined;

    try {
      // Build URL from path template and parameters
      let url = tool.pathTemplate;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
      };

      for (const param of tool.parameters || []) {
        if (param.in === "path" && args[param.name]) {
          url = url.replace(`{${param.name}}`, String(args[param.name]));
        }
      }

      // Add query parameters
      const queryParams = new URLSearchParams();
      for (const param of tool.parameters || []) {
        if (param.in === "query" && args[param.name] !== undefined) {
          queryParams.append(param.name, String(args[param.name]));
        }
      }
      if (queryParams.toString()) {
        url += "?" + queryParams.toString();
      }

      // Prepare request options
      requestOptions = {
        method: tool.method.toUpperCase(),
        headers,
      };

      // Add request body for POST, PUT, PATCH
      if (
        ["POST", "PUT", "PATCH"].includes(tool.method.toUpperCase()) &&
        args.requestBody
      ) {
        headers["Content-Type"] = "application/json";
        requestOptions.body = JSON.stringify(args.requestBody);
      }

      // Make HTTP request
      fullUrl = `${CONFIG.BASE_URL}${url}`;
      console.log(
        `${getTimestamp()} [req:${correlationId}|toolset:${toolToolset}] ${tool.name} → ${tool.method.toUpperCase()} ${fullUrl}`,
      );
      response = await fetch(fullUrl, requestOptions);

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        result = await response.json();
      } else {
        result = await response.text();
      }

      // Log response with timing
      const duration = ((Date.now() - _startTime) / 1000).toFixed(2);
      console.log(
        `${getTimestamp()} [req:${correlationId}|toolset:${toolToolset}] ${tool.name} → ${response.status} ${response.statusText} (${duration}s)`,
      );

      // Log the tool access (only if recording is enabled)
      if (recordApiQueries && toolLogger) {
        // Add toolset information to the tool for metrics
        const toolWithToolset = {
          ...tool,
          toolset: toolToolset,
        };
        await toolLogger.logToolAccess(
          toolWithToolset,
          fullUrl,
          {
            method: tool.method.toUpperCase(),
            userAgent: userAgent,
          },
          result,
          response.status,
          _startTime,
        );
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // Log the error with timing
      const duration = ((Date.now() - _startTime) / 1000).toFixed(2);
      const statusInfo = response
        ? `${response.status} ${response.statusText}`
        : "No Response";
      console.error(
        `${getTimestamp()} [req:${correlationId}|toolset:${toolToolset}] ${tool.name} → ${statusInfo} (${duration}s) - ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Log the failed tool access (only if recording is enabled)
      if (recordApiQueries && toolLogger) {
        // Add toolset information to the tool for metrics
        const toolWithToolset = {
          ...tool,
          toolset: toolToolset,
        };
        await toolLogger.logToolAccess(
          toolWithToolset,
          fullUrl,
          {
            method: tool.method.toUpperCase(),
            userAgent: userAgent,
          },
          { error: error instanceof Error ? error.message : String(error) },
          response?.status || 0,
          _startTime,
        );
      }

      throw new Error(
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  return server;
};

// Global state management
const servers: Record<string, Server> = {};
const sessionManager = new SessionManager(CONFIG.SESSION_TIMEOUT);

const app = express();

app.use(express.json());

// Allow CORS for all domains, expose the Mcp-Session-Id header
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);

// MCP POST endpoint handler
const mcpPostHandler = async (
  req: express.Request,
  res: express.Response,
  toolsetOverride?: string,
) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const authHeader = req.headers["authorization"] as string;

  if (sessionId) {
    console.log(`${getTimestamp()} Received MCP request`);
  } else {
    console.log(`${getTimestamp()} Request body:`, req.body);
  }

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && sessionManager.has(sessionId)) {
      // Reuse existing transport
      transport = sessionManager.getTransport(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: async (sessionId: string) => {
          try {
            // Extract and validate the bearer token
            const token = extractBearerToken(authHeader);
            if (token) {
              try {
                // Validate token (no permissions extraction)
                await validateToken(token);

                // Store session data with userAgent, toolset, and transport
                const userAgent = req.headers["user-agent"] || "unknown";
                const toolset = toolsetOverride || "all";
                storeSessionData(
                  sessionId,
                  token,
                  userAgent,
                  toolset,
                  transport,
                );
              } catch (error) {
                console.error(
                  `${getTimestamp()} Failed to validate token:`,
                  error,
                );
                // Token validation failed, we cannot create the session without valid token
                throw error;
              }
            } else {
              console.warn(`${getTimestamp()} No bearer token provided`);
            }
          } catch (error) {
            console.error(
              `${getTimestamp()} Session init callback failed:`,
              error,
            );
            throw error;
          }
        },
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessionManager.has(sid)) {
          console.log(
            `${getTimestamp()} Transport closed, removing from session data and servers map`,
          );
          // Clean up server instance
          if (servers[sid]) {
            delete servers[sid];
            console.log(`${getTimestamp()} Removed server instance`);
          }
          // Clean up session data (this includes the transport)
          sessionManager.delete(sid);
          console.log(`${getTimestamp()} Removed session data`);
        }
      };

      // Create a new Server instance for this transport
      // Each transport needs its own Server to prevent session routing conflicts
      const server = createMcpServer();

      // Connect the transport to the MCP server BEFORE handling the request
      try {
        await server.connect(transport);

        // Store the server instance for this session
        const sid = transport.sessionId;
        if (sid) {
          servers[sid] = server;
        }

        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error(
          `${getTimestamp()} Failed during server.connect() or handleRequest():`,
          error,
        );
        throw error;
      }
      return;
    } else {
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    // Handle the request with existing transport
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(`${getTimestamp()} Error handling MCP request:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
          data: error instanceof Error ? error.message : String(error),
        },
        id: null,
      });
    }
  }
};

// MCP GET endpoint for streaming data
const mcpGetHandler = async (
  req: express.Request,
  res: express.Response,
  _toolsetOverride?: string,
) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const _authHeader = req.headers["authorization"] as string;

  if (!sessionId || !sessionManager.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  // Note: Token updates are not supported in GET requests - tokens are validated only during session initialization

  const lastEventId = req.headers["last-event-id"];
  if (lastEventId) {
    console.log(
      `${getTimestamp()} Client reconnecting with Last-Event-ID: ${lastEventId}`,
    );
  } else {
    console.log(`${getTimestamp()} Establishing new SSE stream`);
  }

  const transport = sessionManager.getTransport(sessionId)!;
  await transport.handleRequest(req, res);
};

// MCP DELETE endpoint for session termination
const mcpDeleteHandler = async (
  req: express.Request,
  res: express.Response,
  _toolsetOverride?: string,
) => {
  const sessionId = req.headers["mcp-session-id"] as string;

  if (!sessionId || !sessionManager.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  console.log(`${getTimestamp()} Received session termination request`);

  try {
    const transport = sessionManager.getTransport(sessionId)!;
    await transport.handleRequest(req, res);

    deleteSessionData(sessionId);
  } catch (error) {
    console.error(
      `${getTimestamp()} Error handling session termination:`,
      error,
    );
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
};

const allTools: AAPMcpToolDefinition[] = await generateTools();

// Web UI routes (only enabled if enable_ui is true)
if (enableUI) {
  // Configure web UI routes from separate module
  configureWebUIRoutes(
    app,
    allTools,
    allToolsets,
    recordApiQueries,
    allowWriteOperations,
    logEntriesSizeLimit,
  );
}

// Set up routes
app.post("/mcp", (req, res) => mcpPostHandler(req, res));
app.get("/mcp", (req, res) => mcpGetHandler(req, res));
app.delete("/mcp", (req, res) => mcpDeleteHandler(req, res));

app.post("/:toolset/mcp", (req, res) => {
  const toolset = req.params.toolset;
  console.log(
    `${getTimestamp()} Toolset-specific POST request for toolset: ${toolset}`,
  );
  return mcpPostHandler(req, res, toolset);
});

app.get("/:toolset/mcp", (req, res) => {
  const toolset = req.params.toolset;
  console.log(
    `${getTimestamp()} Toolset-specific GET request for toolset: ${toolset}`,
  );
  return mcpGetHandler(req, res, toolset);
});

app.delete("/:toolset/mcp", (req, res) => {
  const toolset = req.params.toolset;
  console.log(
    `${getTimestamp()} Toolset-specific DELETE request for toolset: ${toolset}`,
  );
  return mcpDeleteHandler(req, res, toolset);
});

app.post("/mcp/:toolset", (req, res) => {
  const toolset = req.params.toolset;
  console.log(
    `${getTimestamp()} Toolset-specific POST request for toolset: ${toolset}`,
  );
  return mcpPostHandler(req, res, toolset);
});

app.get("/mcp/:toolset", (req, res) => {
  const toolset = req.params.toolset;
  console.log(
    `${getTimestamp()} Toolset-specific GET request for toolset: ${toolset}`,
  );
  return mcpGetHandler(req, res, toolset);
});

app.delete("/mcp/:toolset", (req, res) => {
  const toolset = req.params.toolset;
  console.log(
    `${getTimestamp()} Toolset-specific DELETE request for toolset: ${toolset}`,
  );
  return mcpDeleteHandler(req, res, toolset);
});

// Health check endpoint (always enabled)
app.get("/api/v1/health", (req, res) => {
  res.json({ status: "ok" });
});

// Prometheus metrics endpoint (conditional based on config)
const enableMetrics = getBooleanConfig(
  "ENABLE_METRICS",
  localConfig.enable_metrics,
);
if (enableMetrics) {
  app.get("/metrics", async (req, res) => {
    try {
      res.set("Content-Type", metricsService.getContentType());
      const metrics = await metricsService.getMetrics();
      res.send(metrics);
    } catch (error) {
      console.error(`${getTimestamp()} Error generating metrics:`, error);
      res.status(500).send("Error generating metrics");
    }
  });
}

async function main(): Promise<void> {
  // Print startup banner
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("           AAP MCP Server Starting");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log("Configuration:");
  console.log(`  Base URL: ${CONFIG.BASE_URL}`);
  console.log(
    `  Services: ${servicesConfig.length > 0 ? servicesConfig.map((s) => s.name).join(", ") : "none"}`,
  );
  console.log(`  Toolsets: ${Object.keys(allToolsets).length} enabled`);
  console.log(
    `  Write operations: ${allowWriteOperations ? "ENABLED" : "DISABLED"}`,
  );
  console.log(`  API recording: ${recordApiQueries ? "ENABLED" : "DISABLED"}`);
  console.log(
    `  Certificate validation: ${ignoreCertificateErrors ? "DISABLED" : "ENABLED"}`,
  );
  console.log(`  Web UI: ${enableUI ? "ENABLED" : "DISABLED"}`);
  console.log(`  Metrics: ${enableMetrics ? "ENABLED" : "DISABLED"}`);
  console.log("");
  console.log("───────────────────────────────────────────────────────────");

  // Initialize tools before starting server
  console.log("Loading OpenAPI specifications...");
  allTools.forEach((tool) => {
    if (tool.deprecated)
      tool.logs.push({ severity: "INFO", msg: "endpoint is deprecated" });
    if (tool.name.length > 64) {
      tool.logs.push({ severity: "ERR", msg: "tool name is too long (64)" });
    } else if (tool.name.length > 40) {
      tool.logs.push({ severity: "WARN", msg: "tool name is too long (40)" });
    }
  });

  // Count tools by service
  const toolsByService: Record<string, number> = {};
  allTools.forEach((tool) => {
    const service = tool.service || "unknown";
    toolsByService[service] = (toolsByService[service] || 0) + 1;
  });

  console.log("");
  for (const [service, count] of Object.entries(toolsByService)) {
    console.log(`  ✓ ${service}: ${count} tools`);
  }
  console.log("");
  console.log(`Total tools loaded: ${allTools.length}`);
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");

  const PORT = process.env.MCP_PORT || 3000;

  app.listen(PORT, () => {
    console.log(`Server ready on port ${PORT}`);
    console.log("");
    console.log("Available endpoints:");
    console.log(`  • MCP endpoint: http://localhost:${PORT}/mcp`);
    if (enableUI) {
      console.log(`  • Web UI: http://localhost:${PORT}`);
    }
    if (enableMetrics) {
      console.log(`  • Metrics: http://localhost:${PORT}/metrics`);
    }
    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log(`${getTimestamp()} Shutting down server...`);

  // Close all active sessions and transports
  for (const sessionId of sessionManager.getAllSessionIds()) {
    try {
      console.log(`${getTimestamp()} Closing transport during shutdown`);
      const transport = sessionManager.getTransport(sessionId);
      if (transport) {
        await transport.close();
      }
      // Clean up server instance
      if (servers[sessionId]) {
        delete servers[sessionId];
      }
      // Clean up session data (includes transport)
      sessionManager.delete(sessionId);
    } catch (error) {
      console.error(`${getTimestamp()} Error closing transport:`, error);
    }
  }

  await sessionManager.closeAllSessions();
  console.log(`${getTimestamp()} Server shutdown complete`);
  process.exit(0);
});

main().catch((error) => {
  console.error(`${getTimestamp()} Server error:`, error);
  process.exit(1);
});
