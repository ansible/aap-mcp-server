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
import { readFileSync, writeFileSync, promises as fs } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";
import { ToolLogger, type LogEntry } from "./logger.js";
import { metricsService } from "./metrics.js";
import {
  renderDashboard,
  renderToolsList,
  renderToolDetails,
  renderCategoriesOverview,
  renderCategoryTools,
  renderLogs,
  renderServicesOverview,
  renderServiceTools,
  renderEndpointsOverview,
  type ToolWithSuccessRate,
  type ToolDetailsData,
  type CategoryWithAccess,
  type CategoriesOverviewData,
  type CategoryToolsData,
  type LogsData,
  type ServicesOverviewData,
  type ServiceToolsData,
  type DashboardData,
  type EndpointsOverviewData,
  type EndpointData,
} from "./views/index.js";
import {
  loadOpenApiSpecs,
  type AAPMcpToolDefinition,
  type ServiceConfig,
} from "./openapi-loader.js";

// Load environment variables
config();

type Category = string[];

interface AapMcpConfig {
  record_api_queries?: boolean;
  "ignore-certificate-errors"?: boolean;
  enable_ui?: boolean;
  enable_metrics?: boolean;
  allow_write_operations?: boolean;
  base_url?: string;
  services?: ServiceConfig[];
  categories: Record<string, string[]>;
}

// Load configuration from file
const loadConfig = (): AapMcpConfig => {
  const configPath = join(process.cwd(), "aap-mcp.yaml");
  const configFile = readFileSync(configPath, "utf8");
  const config = yaml.load(configFile) as AapMcpConfig;

  if (!config.categories) {
    throw new Error("Invalid configuration: missing categories section");
  }

  return config;
};

// Load configuration
const localConfig = loadConfig();
const allCategories: Record<string, Category> = localConfig.categories;

// Configuration constants (with priority: env var > config file > default)
const CONFIG = {
  BASE_URL: process.env.BASE_URL || localConfig.base_url || "https://localhost",
  MCP_PORT: process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000,
  FALLBACK_BEARER_TOKEN: process.env.BEARER_TOKEN_OAUTH2_AUTHENTICATION,
} as const;

// Log entries size limit for /logs endpoint
const logEntriesSizeLimit = 10000;

// Log configuration settings
console.log(`BASE_URL: ${CONFIG.BASE_URL}`);

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
console.log(
  `API query recording: ${recordApiQueries ? "ENABLED" : "DISABLED"}`,
);

const ignoreCertificateErrors = getBooleanConfig(
  "IGNORE_CERTIFICATE_ERRORS",
  localConfig["ignore-certificate-errors"],
);
console.log(
  `Certificate validation: ${ignoreCertificateErrors ? "DISABLED" : "ENABLED"}`,
);

const enableUI = getBooleanConfig("ENABLE_UI", localConfig.enable_ui);
console.log(`Web UI: ${enableUI ? "ENABLED" : "DISABLED"}`);

const allowWriteOperations = getBooleanConfig(
  "ALLOW_WRITE_OPERATIONS",
  localConfig.allow_write_operations,
);
console.log(
  `Write operations (POST/DELETE/PATCH): ${allowWriteOperations ? "ENABLED" : "DISABLED"}`,
);

// Initialize allowed operations list based on configuration
const allowedOperations = allowWriteOperations
  ? ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
  : ["GET", "HEAD", "OPTIONS"];

// Get services configuration
const servicesConfig = localConfig.services || [];
console.log(
  `Services configured: ${servicesConfig.length > 0 ? servicesConfig.map((s) => s.name).join(", ") : "none"}`,
);

// Configure HTTPS certificate validation globally
if (ignoreCertificateErrors) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn(
    "WARNING: HTTPS certificate validation is disabled. This should only be used in development/testing environments.",
  );
}

// TypeScript interfaces

interface SessionData {
  [sessionId: string]: {
    token: string;
    is_superuser: boolean;
    is_platform_auditor: boolean;
  };
}

// Helper functions
const extractBearerToken = (
  authHeader: string | undefined,
): string | undefined => {
  return authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.substring(7)
    : undefined;
};

const getBearerTokenForSession = (sessionId: string | undefined): string => {
  let bearerToken = CONFIG.FALLBACK_BEARER_TOKEN;
  if (sessionId && sessionData[sessionId]) {
    bearerToken = sessionData[sessionId].token;
    console.log(
      `Using session-specific Bearer token for session: ${sessionId}`,
    );
  } else {
    console.log("Using fallback Bearer token from environment variable");
  }

  if (!bearerToken) {
    throw new Error(
      "No Bearer token available. Please provide an Authorization header or set BEARER_TOKEN_OAUTH2_AUTHENTICATION environment variable.",
    );
  }

  return bearerToken;
};

// Validate authorization token and extract user permissions
const validateTokenAndGetPermissions = async (
  bearerToken: string,
): Promise<{ is_superuser: boolean; is_platform_auditor: boolean }> => {
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

    const data = (await response.json()) as any;

    if (
      !data.results ||
      !Array.isArray(data.results) ||
      data.results.length === 0
    ) {
      throw new Error("Invalid response format from /api/gateway/v1/me/");
    }

    const userInfo = data.results[0] as any;
    return {
      is_superuser: userInfo.is_superuser || false,
      is_platform_auditor: userInfo.is_platform_auditor || false,
    };
  } catch (error) {
    console.error("Token validation failed:", error);
    throw new Error(
      `Token validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const storeSessionData = (
  sessionId: string,
  token: string,
  permissions: { is_superuser: boolean; is_platform_auditor: boolean },
): void => {
  sessionData[sessionId] = {
    token,
    is_superuser: permissions.is_superuser,
    is_platform_auditor: permissions.is_platform_auditor,
  };
  console.log(
    `Stored session data for ${sessionId}: superuser=${permissions.is_superuser}, auditor=${permissions.is_platform_auditor}`,
  );
};

// Determine user category based on category name
const getUserCategory = (category?: string): Category => {
  // category is the only way to set the category
  if (category) {
    const categoryName = category.toLowerCase();
    if (allCategories[categoryName]) {
      return allCategories[categoryName];
    } else {
      console.warn(`Unknown category: ${category}, returning empty category`);
      return [];
    }
  }

  // If no category is provided, return empty category (no tools available)
  return [];
};

// Filter tools based on category
const filterToolsByCategory = (
  tools: AAPMcpToolDefinition[],
  category: Category,
): AAPMcpToolDefinition[] => {
  return tools.filter((tool) => category.includes(tool.name));
};

// Find which category a tool belongs to (returns first match or "uncategorized")
const getCategoryForTool = (toolName: string): string => {
  for (const [categoryName, categoryTools] of Object.entries(allCategories)) {
    if (categoryTools.includes(toolName)) {
      return categoryName;
    }
  }
  return "uncategorized";
};

// Generate dynamic color for category based on name
const getCategoryColor = (categoryName: string): string => {
  const colors = [
    "#6c757d",
    "#28a745",
    "#dc3545",
    "#17a2b8",
    "#007acc",
    "#ff9800",
    "#9c27b0",
    "#4caf50",
  ];
  const hash = categoryName
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

// Generate tools from OpenAPI specs
const generateTools = async (): Promise<AAPMcpToolDefinition[]> => {
  const openApiSpecs = await loadOpenApiSpecs(servicesConfig, CONFIG.BASE_URL);
  let rawToolList: AAPMcpToolDefinition[] = [];

  for (const spec of openApiSpecs) {
    console.log(`Loading ${spec.service}`);
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
        const originDescription = tool.description;
        const result = spec.reformatFunc(tool);
        if (result !== false) {
          result.originalDescription = originDescription;
        }
        return result !== false;
      });
      rawToolList = rawToolList.concat(filteredTools);
    } catch (error) {
      console.error("Error generating tools from OpenAPI spec:", error);
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
      `Tool list saved to tool_list.csv (${toolsWithSize.length} tools)`,
    );
  }

  return toolsWithSize;
};

let allTools: AAPMcpToolDefinition[] = [];

// Initialize logger only if recording is enabled
const toolLogger = recordApiQueries ? new ToolLogger() : null;

// Helper function to read log entries for a tool
const getToolLogEntries = async (toolName: string): Promise<LogEntry[]> => {
  const logFile = join(process.cwd(), "logs", `${toolName}.jsonl`);
  try {
    const content = readFileSync(logFile, "utf8");
    const lines = content
      .trim()
      .split("\n")
      .filter((line) => line);
    return lines.map((line) => JSON.parse(line) as LogEntry);
  } catch (_error) {
    // Log file doesn't exist or can't be read
    return [];
  }
};

// Helper function to read all log entries across all tools
const getAllLogEntries = async (): Promise<
  (LogEntry & { toolName: string })[]
> => {
  const logsDir = join(process.cwd(), "logs");
  const allEntries: (LogEntry & { toolName: string })[] = [];

  try {
    const files = await fs.readdir(logsDir);
    const jsonlFiles = files.filter((file) => file.endsWith(".jsonl"));

    for (const file of jsonlFiles) {
      const toolName = file.replace(".jsonl", "");
      const entries = await getToolLogEntries(toolName);

      // Add toolName to each entry
      const entriesWithToolName = entries.map((entry) => ({
        ...entry,
        toolName,
      }));

      allEntries.push(...entriesWithToolName);
    }

    // Sort by timestamp, most recent first
    allEntries.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return allEntries;
  } catch (error) {
    console.error("Error reading log files:", error);
    return [];
  }
};

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
  const _startTime = Date.now();

  // Get category override from transport if available
  const transport = sessionId ? transports[sessionId] : null;
  const categoryOverride = transport
    ? (transport as any).categoryOverride
    : undefined;

  // Determine user category based on category override
  const category = getUserCategory(categoryOverride);

  // Filter tools based on category
  const filteredTools = filterToolsByCategory(allTools, category);

  // Determine category type by comparing with known categories
  let categoryType = "unknown";
  for (const [name, tools] of Object.entries(allCategories)) {
    if (category === tools) {
      categoryType = name;
      break;
    }
  }

  const overrideInfo = categoryOverride
    ? ` (override: ${categoryOverride})`
    : "";
  console.log(
    `Returning ${filteredTools.length} tools for ${categoryType} category${overrideInfo} (session: ${sessionId || "none"})`,
  );

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

  // Find the matching tool
  const tool = allTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Get category for this tool
  const toolCategory = getCategoryForTool(tool.name);

  // Get the session ID from the transport context
  const sessionId = extra?.sessionId;

  // Get user-agent from transport (if available)
  let userAgent = "unknown";
  if (sessionId && transports[sessionId]) {
    const transport = transports[sessionId] as any;
    userAgent = transport.userAgent || "unknown";
  }

  // Get the Bearer token for this session
  const bearerToken = getBearerTokenForSession(sessionId);

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
    console.log(`[category:${toolCategory}] ${tool.name} → ${tool.method.toUpperCase()} ${fullUrl}`);
    response = await fetch(fullUrl, requestOptions);

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      result = await response.json();
    } else {
      result = await response.text();
    }

    // Log the tool access (only if recording is enabled)
    if (recordApiQueries && toolLogger) {
      // Add category information to the tool for metrics
      const toolWithCategory = {
        ...tool,
        category: toolCategory,
      };
      await toolLogger.logToolAccess(
        toolWithCategory,
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
    // Log the failed tool access (only if recording is enabled)
    if (recordApiQueries && toolLogger) {
      // Add category information to the tool for metrics
      const toolWithCategory = {
        ...tool,
        category: toolCategory,
      };
      await toolLogger.logToolAccess(
        toolWithCategory,
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

// Global state management
const transports: Record<string, StreamableHTTPServerTransport> = {};
const sessionData: SessionData = {};

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
  categoryOverride?: string,
) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const authHeader = req.headers["authorization"] as string;

  if (sessionId) {
    console.log(`Received MCP request for session: ${sessionId}`);
  } else {
    console.log("Request body:", req.body);
  }

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: async (sessionId: string) => {
          console.log(
            `Session initialized with ID: ${sessionId}${categoryOverride ? ` with category override: ${categoryOverride}` : ""}`,
          );
          transports[sessionId] = transport;

          // Store category override and user-agent in transport for later access
          (transport as any).categoryOverride = categoryOverride;
          (transport as any).userAgent = req.headers["user-agent"] || "unknown";

          // Extract and validate the bearer token
          const token = extractBearerToken(authHeader);
          if (token) {
            try {
              // Validate token and get user permissions
              const permissions = await validateTokenAndGetPermissions(token);

              // Store both token and permissions in session data
              storeSessionData(sessionId, token, permissions);
            } catch (error) {
              console.error(
                `Failed to validate token for session ${sessionId}:`,
                error,
              );
              // Token validation failed, we cannot create the session without valid token
              throw error;
            }
          } else {
            console.warn(`No bearer token provided for session ${sessionId}`);
          }
        },
      });

      // Set up onclose handler to clean up transport when closed
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.log(
            `Transport closed for session ${sid}, removing from transports map`,
          );
          delete transports[sid];
          // Clean up session data
          if (sessionData[sid]) {
            delete sessionData[sid];
            console.log(`Removed session data for session: ${sid}`);
          }
        }
      };

      // Connect the transport to the MCP server BEFORE handling the request
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
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
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
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
  _categoryOverride?: string,
) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const _authHeader = req.headers["authorization"] as string;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  // Note: Token updates are not supported in GET requests - tokens are validated only during session initialization

  const lastEventId = req.headers["last-event-id"];
  if (lastEventId) {
    console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
  } else {
    console.log(`Establishing a new stream for session ${sessionId}`);
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

// MCP DELETE endpoint for session termination
const mcpDeleteHandler = async (
  req: express.Request,
  res: express.Response,
  _categoryOverride?: string,
) => {
  const sessionId = req.headers["mcp-session-id"] as string;

  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  console.log(`Received session termination request for session ${sessionId}`);

  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);

    // Clean up session data when session is terminated
    if (sessionData[sessionId]) {
      delete sessionData[sessionId];
      console.log(`Removed session data for terminated session: ${sessionId}`);
    }
  } catch (error) {
    console.error("Error handling session termination:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
};

// Web UI routes (only enabled if enable_ui is true)
if (enableUI) {
  // Tool list HTML endpoint
  app.get("/tools", async (req, res) => {
    try {
      // Calculate success rates for all tools
      const toolsWithSuccessRates: ToolWithSuccessRate[] = await Promise.all(
        allTools.map(async (tool) => {
          const logEntries = await getToolLogEntries(tool.name);
          let successRate = "N/A";

          if (logEntries.length > 0) {
            const successCount = logEntries.filter(
              (entry) => entry.return_code >= 200 && entry.return_code < 300,
            ).length;
            const successPercentage = (successCount / logEntries.length) * 100;
            successRate = `${successPercentage.toFixed(1)}%`;
          }

          return {
            ...tool,
            successRate,
            logCount: logEntries.length,
          };
        }),
      );

      // Use the view function to render the HTML
      const htmlContent = renderToolsList({ tools: toolsWithSuccessRates });

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating HTML tool list:", error);
      res.status(500).json({
        error: "Failed to generate tool list HTML",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Individual tool details endpoint
  app.get("/tools/:name", async (req, res) => {
    try {
      const toolName = req.params.name;

      // Find the tool
      const tool = allTools.find((t) => t.name === toolName);
      if (!tool) {
        return res.status(404).json({
          error: "Tool not found",
          message: `Tool '${toolName}' does not exist`,
        });
      }

      // Get log entries for this tool
      const logEntries = await getToolLogEntries(toolName);
      const last10Calls = logEntries.slice(-10).reverse(); // Get last 10, most recent first

      // Calculate error code summary
      const errorCodeSummary = logEntries.reduce(
        (acc, entry) => {
          const code = entry.return_code;
          acc[code] = (acc[code] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>,
      );

      // Calculate success vs error statistics for pie chart
      const chartData = logEntries.reduce(
        (acc, entry) => {
          const code = entry.return_code;
          if (code >= 200 && code < 300) {
            acc.success += 1;
          } else {
            acc.error += 1;
          }
          return acc;
        },
        { success: 0, error: 0 },
      );

      // Check which categories have access to this tool
      const categoriesWithAccess: CategoryWithAccess[] = [];
      for (const [categoryName, categoryTools] of Object.entries(
        allCategories,
      )) {
        if (categoryTools.includes(toolName)) {
          categoriesWithAccess.push({
            name: categoryName,
            displayName:
              categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
            color: getCategoryColor(categoryName),
          });
        }
      }

      // Prepare data for the view
      const toolDetailsData: ToolDetailsData = {
        tool,
        logEntries,
        last10Calls,
        errorCodeSummary,
        chartData,
        categoriesWithAccess,
      };

      // Use the view function to render the HTML
      const htmlContent = renderToolDetails(toolDetailsData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating tool details:", error);
      res.status(500).json({
        error: "Failed to generate tool details",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Tool list CSV endpoint
  app.get("/export/tools/csv", (req, res) => {
    try {
      // Generate CSV content
      const csvHeader =
        "Tool name,size (characters),description,path template,service\n";
      const csvRows = allTools
        .map(
          (tool) =>
            `${tool.name},${tool.size},"${tool.description?.replace(/"/g, '""') || ""}",${tool.pathTemplate},${tool.service || "unknown"}`,
        )
        .join("\n");
      const csvContent = csvHeader + csvRows;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="tool_list.csv"',
      );
      res.send(csvContent);
    } catch (error) {
      console.error("Error generating CSV tool list:", error);
      res.status(500).json({
        error: "Failed to generate tool list CSV",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Category overview endpoint
  app.get("/category", (req, res) => {
    try {
      // Calculate stats for each category
      const categories = Object.entries(allCategories).map(
        ([categoryName, categoryTools]) => ({
          name: categoryName,
          displayName:
            categoryName.charAt(0).toUpperCase() + categoryName.slice(1),
          description: `${categoryName.charAt(0).toUpperCase() + categoryName.slice(1)} category with specific tool access`,
          tools: filterToolsByCategory(allTools, categoryTools),
          color: getCategoryColor(categoryName),
          toolCount: 0, // Will be calculated below
          totalSize: 0, // Will be calculated below
        }),
      );

      // Calculate sizes and add to category data
      const categoryStats = categories.map((category) => ({
        ...category,
        toolCount: category.tools.length,
        totalSize: category.tools.reduce(
          (sum, tool) => sum + (tool.size || 0),
          0,
        ),
      }));

      // Prepare data for the view
      const categoriesOverviewData: CategoriesOverviewData = {
        categories: categoryStats,
        allTools,
      };

      // Use the view function to render the HTML
      const htmlContent = renderCategoriesOverview(categoriesOverviewData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating category overview:", error);
      res.status(500).json({
        error: "Failed to generate category overview",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Category tools endpoint
  app.get("/category/:name", (req, res) => {
    try {
      const categoryName = req.params.name.toLowerCase();

      // Get the category based on the name
      const category = allCategories[categoryName];
      if (!category) {
        const availableCategories = Object.keys(allCategories).join(", ");
        return res.status(404).json({
          error: "Category not found",
          message: `Category '${req.params.name}' does not exist. Available categories: ${availableCategories}`,
        });
      }

      const displayName =
        categoryName.charAt(0).toUpperCase() + categoryName.slice(1);

      // Filter tools based on category
      const filteredTools = filterToolsByCategory(allTools, category);

      // Calculate total size
      const totalSize = filteredTools.reduce(
        (sum, tool) => sum + (tool.size || 0),
        0,
      );

      // Prepare data for the view
      const categoryToolsData: CategoryToolsData = {
        categoryName,
        displayName,
        filteredTools,
        totalSize,
        allCategories,
      };

      // Use the view function to render the HTML
      const htmlContent = renderCategoryTools(categoryToolsData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating category tool list:", error);
      res.status(500).json({
        error: "Failed to generate category tool list",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Logs overview endpoint
  app.get("/logs", async (req, res) => {
    try {
      if (!recordApiQueries) {
        return res.status(404).json({
          error: "Logging disabled",
          message:
            "API query recording is disabled. Enable it in aap-mcp.yaml to view logs.",
        });
      }

      // Get all log entries
      const allEntries = await getAllLogEntries();
      let lastEntries = allEntries.slice(0, logEntriesSizeLimit);

      // Apply status code filter if provided
      const statusCodeFilter = req.query.status_code as string;
      if (statusCodeFilter) {
        const filterCode = parseInt(statusCodeFilter, 10);
        if (!isNaN(filterCode)) {
          lastEntries = lastEntries.filter(
            (entry) => entry.return_code === filterCode,
          );
        }
      }

      // Apply tool filter if provided
      const toolFilter = req.query.tool as string;
      if (toolFilter) {
        lastEntries = lastEntries.filter(
          (entry) => entry.toolName === toolFilter,
        );
      }

      // Apply user-agent filter if provided
      const userAgentFilter = req.query.user_agent as string;
      if (userAgentFilter) {
        lastEntries = lastEntries.filter((entry) => {
          const entryUserAgent = entry.payload?.userAgent || "unknown";
          return entryUserAgent
            .toLowerCase()
            .includes(userAgentFilter.toLowerCase());
        });
      }

      const totalRequests = allEntries.length;
      const statusCodeSummary = lastEntries.reduce(
        (acc, entry) => {
          const code = entry.return_code;
          acc[code] = (acc[code] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>,
      );

      const toolSummary = lastEntries.reduce(
        (acc, entry) => {
          acc[entry.toolName] = (acc[entry.toolName] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const userAgentSummary = lastEntries.reduce(
        (acc, entry) => {
          const userAgent = entry.payload?.userAgent || "unknown";
          acc[userAgent] = (acc[userAgent] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      // Transform log entries to match the view interface
      const transformedEntries = lastEntries.map((entry) => ({
        timestamp: entry.timestamp,
        toolName: entry.toolName,
        return_code: entry.return_code,
        endpoint: entry.endpoint,
        payload: entry.payload,
        userAgent: entry.payload?.userAgent || "unknown",
      }));

      // Prepare data for the view
      const logsData: LogsData = {
        lastEntries: transformedEntries,
        totalRequests,
        statusCodeFilter,
        toolFilter,
        userAgentFilter,
        statusCodeSummary,
        toolSummary,
        userAgentSummary,
        logEntriesSizeLimit,
      };

      // Use the view function to render the HTML
      const htmlContent = renderLogs(logsData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating logs overview:", error);
      res.status(500).json({
        error: "Failed to generate logs overview",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Services overview endpoint
  app.get("/services", (req, res) => {
    try {
      // Group tools by service
      const serviceGroups = allTools.reduce(
        (acc, tool) => {
          const service = tool.service || "unknown";
          if (!acc[service]) {
            acc[service] = [];
          }
          acc[service].push(tool);
          return acc;
        },
        {} as Record<string, AAPMcpToolDefinition[]>,
      );

      // Prepare service data for the view
      const services = Object.entries(serviceGroups).map(
        ([serviceName, tools]) => ({
          name: serviceName,
          displayName:
            serviceName.charAt(0).toUpperCase() + serviceName.slice(1),
          toolCount: tools.length,
          totalSize: tools.reduce((sum, tool) => sum + (tool.size || 0), 0),
          logCount: tools.reduce(
            (sum, tool) => sum + (tool.logs?.length || 0),
            0,
          ),
          description: `${serviceName.charAt(0).toUpperCase() + serviceName.slice(1)} service providing ${tools.length} tools for automation and management tasks.`,
        }),
      );

      // Prepare data for the view
      const servicesOverviewData: ServicesOverviewData = {
        services,
        allTools,
      };

      // Use the view function to render the HTML
      const htmlContent = renderServicesOverview(servicesOverviewData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating services overview:", error);
      res.status(500).json({
        error: "Failed to generate services overview",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/services/:name", (req, res) => {
    try {
      const serviceName = req.params.name.toLowerCase();

      // Filter tools by service
      const serviceTools = allTools.filter(
        (tool) => (tool.service || "unknown") === serviceName,
      );

      if (serviceTools.length === 0) {
        return res.status(404).json({
          error: "Service not found",
          message: `Service '${req.params.name}' does not exist or has no tools`,
        });
      }

      const displayName =
        serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
      const totalSize = serviceTools.reduce(
        (sum, tool) => sum + (tool.size || 0),
        0,
      );
      const methods = [...new Set(serviceTools.map((tool) => tool.method))];

      // Prepare data for the view
      const serviceToolsData: ServiceToolsData = {
        serviceName,
        displayName,
        serviceTools,
        totalSize,
        methods,
      };

      // Use the view function to render the HTML
      const htmlContent = renderServiceTools(serviceToolsData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating service tools list:", error);
      res.status(500).json({
        error: "Failed to generate service tools list",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // API endpoints overview
  app.get("/endpoints", (req, res) => {
    try {
      // Get category filter from query parameter
      const categoryFilter = req.query.category as string | undefined;

      // Filter tools by category if specified
      let toolsToDisplay = allTools;
      if (categoryFilter && allCategories[categoryFilter]) {
        toolsToDisplay = filterToolsByCategory(
          allTools,
          allCategories[categoryFilter],
        );
      }

      // Helper function to find categories for a tool
      const getCategoriesForTool = (toolName: string): string[] => {
        const categories: string[] = [];
        for (const [categoryName, categoryTools] of Object.entries(
          allCategories,
        )) {
          if (categoryTools.includes(toolName)) {
            categories.push(categoryName);
          }
        }
        return categories;
      };

      // Group endpoints by service
      const endpointsByService = toolsToDisplay.reduce(
        (acc, tool) => {
          const service = tool.service || "unknown";
          if (!acc[service]) {
            acc[service] = [];
          }

          const categories = getCategoriesForTool(tool.name);

          acc[service].push({
            path: tool.pathTemplate,
            method: tool.method.toUpperCase(),
            name: tool.name,
            description: tool.description,
            toolName: tool.name,
            categories,
            logs: tool.logs || [],
          });

          return acc;
        },
        {} as Record<string, EndpointData[]>,
      );

      // Sort endpoints within each service by path
      Object.keys(endpointsByService).forEach((service) => {
        endpointsByService[service].sort((a, b) =>
          a.path.localeCompare(b.path),
        );
      });

      // Prepare data for the view
      const endpointsOverviewData: EndpointsOverviewData = {
        allTools: toolsToDisplay,
        endpointsByService,
        allCategories,
        selectedCategory: categoryFilter,
      };

      // Use the view function to render the HTML
      const htmlContent = renderEndpointsOverview(endpointsOverviewData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating endpoints overview:", error);
      res.status(500).json({
        error: "Failed to generate endpoints overview",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Root endpoint - dashboard
  app.get("/", async (req, res) => {
    try {
      // Prepare data for the dashboard view
      const dashboardData: DashboardData = {
        allTools,
        allCategories,
        recordApiQueries,
        allowWriteOperations,
      };

      // Use the view function to render the HTML
      const htmlContent = renderDashboard(dashboardData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating dashboard:", error);
      res.status(500).json({
        error: "Failed to generate dashboard",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
} // End of enableUI conditional block

// Set up routes
app.post("/mcp", (req, res) => mcpPostHandler(req, res));
app.get("/mcp", (req, res) => mcpGetHandler(req, res));
app.delete("/mcp", (req, res) => mcpDeleteHandler(req, res));

app.post("/:category/mcp", (req, res) => {
  const category = req.params.category;
  console.log(`Category-specific POST request for category: ${category}`);
  return mcpPostHandler(req, res, category);
});

app.get("/:category/mcp", (req, res) => {
  const category = req.params.category;
  console.log(`Category-specific GET request for category: ${category}`);
  return mcpGetHandler(req, res, category);
});

app.delete("/:category/mcp", (req, res) => {
  const category = req.params.category;
  console.log(`Category-specific DELETE request for category: ${category}`);
  return mcpDeleteHandler(req, res, category);
});

app.post("/mcp/:category", (req, res) => {
  const category = req.params.category;
  console.log(`Category-specific POST request for category: ${category}`);
  return mcpPostHandler(req, res, category);
});

app.get("/mcp/:category", (req, res) => {
  const category = req.params.category;
  console.log(`Category-specific GET request for category: ${category}`);
  return mcpGetHandler(req, res, category);
});

app.delete("/mcp/:category", (req, res) => {
  const category = req.params.category;
  console.log(`Category-specific DELETE request for category: ${category}`);
  return mcpDeleteHandler(req, res, category);
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
      console.error("Error generating metrics:", error);
      res.status(500).send("Error generating metrics");
    }
  });
  console.log(`Prometheus metrics: ENABLED`);
} else {
  console.log(`Prometheus metrics: DISABLED`);
}

async function main(): Promise<void> {
  // Initialize tools before starting server
  console.log("Loading OpenAPI specifications and generating tools...");
  allTools = await generateTools();
  allTools.forEach((tool) => {
    if (tool.deprecated)
      tool.logs.push({ severity: "INFO", msg: "endpoint is deprecated" });
    if (tool.name.length > 64) {
      tool.logs.push({ severity: "ERR", msg: "tool name is too long (64)" });
    } else if (tool.name.length > 40) {
      tool.logs.push({ severity: "WARN", msg: "tool name is too long (40)" });
    }
  });

  console.log(`Successfully loaded ${allTools.length} tools`);
  const PORT = process.env.MCP_PORT || 3000;

  app.listen(PORT, () => {
    console.log(`AAP MCP Server running on port ${PORT}`);
    console.log(`Web UI available at: http://localhost:${PORT}`);
    console.log(`MCP endpoint available at: http://localhost:${PORT}/mcp`);
    if (enableMetrics) {
      console.log(
        `Metrics endpoint available at: http://localhost:${PORT}/metrics`,
      );
    }
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down server...");

  // Close all active transports
  for (const sessionId in transports) {
    try {
      console.log(`Closing transport for session ${sessionId}`);
      await transports[sessionId].close();
      delete transports[sessionId];
      // Clean up session data
      if (sessionData[sessionId]) {
        delete sessionData[sessionId];
      }
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }

  console.log("Server shutdown complete");
  process.exit(0);
});

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
