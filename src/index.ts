#!/usr/bin/env node

import OASNormalize from "oas-normalize";
import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { extractToolsFromApi, getDefaultPageSize } from "./extract-tools.js";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";
import { metricsService } from "./metrics.js";
import {
  loadOpenApiSpecs,
  type AAPMcpToolDefinition,
} from "./openapi-loader.js";
import { AnalyticsService } from "./analytics.js";
import { PseudoIdentityService, type UserInfo } from "./pseudo-identity.js";
import { AapMcpConfig, loadToolsetsFromCfg } from "./config-utils.js";
import {
  buildConfig,
  buildResourceMetadataUrl,
  buildWwwAuthenticateHeader,
  createProtectedResourceRouter,
  determineSupportedScopes,
  getDiscoveryTimeout,
  isOAuth2Enabled,
  probeOidcDiscovery,
  type ProtectedResourceConfig,
  type Rfc6750Error,
} from "./oauth2/protected-resource-metadata.js";

// Load environment variables
config();

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

// Configuration constants (with priority: env var > config file > default)
const CONFIG = {
  BASE_URL: process.env.BASE_URL || localConfig.base_url || "https://localhost",
  MCP_PORT: process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000,
  MCP_SERVER_URL:
    process.env.MCP_SERVER_URL ||
    `http://localhost:${process.env.MCP_PORT || 3000}`,
  ANALYTICS_KEY: (
    process.env.ANALYTICS_KEY ||
    localConfig.analytics_key ||
    ""
  ).trim(),
} as const;

// Initialize analytics service (always instantiated, but only enabled if key provided)
const analyticsService = new AnalyticsService();

// Initialize user identity service for stable pseudonymous telemetry IDs
const userIdentityService = new PseudoIdentityService();

// Helper function to get boolean configuration with environment variable override
const getBooleanConfig = (
  envVar: string,
  configValue: boolean | undefined,
): boolean => {
  return process.env[envVar] !== undefined
    ? process.env[envVar]!.toLowerCase() === "true"
    : (configValue ?? false);
};

const ignoreCertificateErrors = getBooleanConfig(
  "IGNORE_CERTIFICATE_ERRORS",
  localConfig["ignore-certificate-errors"],
);

const allowWriteOperations = getBooleanConfig(
  "ALLOW_WRITE_OPERATIONS",
  localConfig.allow_write_operations,
);

// Initialize allowed operations list based on configuration
const allowedOperations = allowWriteOperations
  ? ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
  : ["GET", "HEAD", "OPTIONS"];

// OAuth 2.1 discovery configuration — set during startup after OIDC probe
let oauth2Config: ProtectedResourceConfig | null = null;

// Get configured default page size
const { value: defaultPageSize, source: defaultPageSizeSource } =
  getDefaultPageSize(localConfig);

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

// Per-request context passed through authInfo.extra
interface RequestContext {
  token: string;
  toolset: string;
  userAgent: string;
  userPseudoId: string;
  userType: string;
  installerPseudoId: string;
}

// Helper functions

const extractBearerToken = (
  authHeader: string | undefined,
): string | undefined => {
  return authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.substring(7)
    : undefined;
};

// Validate authorization token
const validateToken = async (bearerToken: string): Promise<UserInfo> => {
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

    // Extract user data for stable telemetry identifiers
    try {
      const data: any = await response.json();
      const user = data.results?.[0];
      return {
        ansibleId: user?.summary_fields?.resource?.ansible_id,
        email: user?.email,
      };
    } catch {
      return {};
    }
  } catch (error) {
    console.error(`${getTimestamp()} Token validation failed:`, error);
    throw new Error(
      `Token validation failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
};

// Determine user toolset based on toolset name
const getToolsByToolset = (toolset: string): AAPMcpToolDefinition[] => {
  return allToolsets[toolset];
};

// Find which toolset a tool belongs to (returns first match or "uncategorized")
const getToolsetForTool = (toolName: string): string => {
  for (const [toolsetName, toolsetTools] of Object.entries(allToolsets)) {
    if (toolsetTools.map((t) => t.name).includes(toolName)) {
      return toolsetName;
    }
  }

  throw new Error("Invalid tool name");
};

// Generate tools from OpenAPI specs
const generateTools = async (): Promise<AAPMcpToolDefinition[]> => {
  const openApiSpecs = await loadOpenApiSpecs(servicesConfig, CONFIG.BASE_URL);
  let rawToolList: AAPMcpToolDefinition[] = [];

  for (const spec of openApiSpecs) {
    if (!spec.service) throw new Error("service key should not be undefined");
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
        true,
        defaultPageSize,
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

  rawToolList.map((e) => (e.fullName = `${e.service}.${e.name}`));

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

// Helper to extract RequestContext from the extra.authInfo provided by the SDK
const getRequestContext = (extra: any): RequestContext => {
  const ctx = extra?.authInfo?.extra as RequestContext | undefined;
  if (!ctx) {
    throw new Error("Missing request context");
  }
  return ctx;
};

const TOOLSET_DESCRIPTIONS: Record<string, string> = {
  job_management:
    "Launch, monitor, and manage jobs, job templates, workflows, and schedules",
  inventory_management:
    "Manage inventories, hosts, groups, and inventory sources",
  system_monitoring:
    "Monitor instances, instance groups, and system health",
  user_management:
    "Manage users, teams, organizations, and role-based access",
  security_compliance:
    "Manage credentials, credential types, and audit activity streams",
  platform_configuration:
    "Configure platform settings, execution environments, and notifications",
  content_discovery:
    "Search Ansible collections, execution environments, and AI-assisted content",
};

const DISCOVER_TOOLS = [
  {
    name: "discover",
    description:
      "Discover available tools. Without a toolset_name, returns all toolsets with descriptions. With a toolset_name, returns that toolset's full tool definitions including input schemas.",
    inputSchema: {
      type: "object" as const,
      properties: {
        toolset_name: {
          type: "string",
          description:
            "Optional: name of a specific toolset to get full tool definitions for. Omit to list all available toolsets.",
        },
      },
      required: [],
    },
  },
  {
    name: "call_tool",
    description: "Execute a tool from a specific toolset",
    inputSchema: {
      type: "object" as const,
      properties: {
        toolset_name: {
          type: "string",
          description: "Name of the toolset containing the tool",
        },
        tool_name: {
          type: "string",
          description: "Name of the tool to call",
        },
        arguments: {
          type: "object",
          description: "Arguments to pass to the tool",
        },
      },
      required: ["toolset_name", "tool_name", "arguments"],
    },
  },
];

const proxyToolCall = async (
  tool: AAPMcpToolDefinition,
  args: Record<string, unknown>,
  ctx: RequestContext,
): Promise<{ content: Array<{ type: string; text: string }> }> => {
  const _startTime = Date.now();
  const toolToolset = getToolsetForTool(tool.name);

  let result: any;
  let response: Response | undefined;

  try {
    let url = tool.pathTemplate;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/json",
    };

    for (const param of tool.parameters || []) {
      if (param.in === "path" && args[param.name]) {
        url = url.replace(`{${param.name}}`, String(args[param.name]));
      }
    }

    const queryParams = new URLSearchParams();
    for (const param of tool.parameters || []) {
      if (param.in === "query" && args[param.name] !== undefined) {
        queryParams.append(param.name, String(args[param.name]));
      }
    }
    if (queryParams.toString()) {
      url += "?" + queryParams.toString();
    }

    const requestOptions: RequestInit = {
      method: tool.method.toUpperCase(),
      headers,
    };

    if (
      ["POST", "PUT", "PATCH"].includes(tool.method.toUpperCase()) &&
      args.requestBody
    ) {
      headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(args.requestBody);
    }

    const fullUrl = `${CONFIG.BASE_URL}${url}`;
    response = await fetch(fullUrl, requestOptions);

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      result = await response.json();
    } else {
      result = await response.text();
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
    throw new Error(
      `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    const executionTimeMs = Date.now() - _startTime;
    const parameterLength = JSON.stringify(args).length;

    console.log(
      `${getTimestamp()} [toolset:${toolToolset}] ${tool.name} → ${response && response.status} ${response && response.statusText} (${executionTimeMs}ms)`,
    );

    analyticsService.trackMcpToolCalled(
      tool.name,
      toolToolset,
      ctx.userAgent,
      parameterLength,
      response ? response.status : 0,
      executionTimeMs,
      ctx.userPseudoId,
      ctx.userType,
      ctx.installerPseudoId,
    );
    metricsService.recordToolExecution(
      tool.name,
      response ? response.status : 0,
      executionTimeMs,
    );
    if (!response || !response.ok) {
      metricsService.recordToolError(
        tool.name,
        response ? response.status : 0,
      );
    }
  }
};

const handleDiscoverTool = async (
  name: string,
  args: Record<string, unknown>,
  ctx: RequestContext,
): Promise<{ content: Array<{ type: string; text: string }> }> => {
  switch (name) {
    case "discover": {
      const toolsetName = args.toolset_name as string | undefined;

      if (!toolsetName) {
        const toolsets = Object.entries(allToolsets)
          .filter(([n]) => n !== "all" && n !== "discover")
          .map(([n, tools]) => ({
            name: n,
            description: TOOLSET_DESCRIPTIONS[n] ?? "",
            endpoint: `/mcp/${n}`,
            tool_count: tools.length,
          }));
        return {
          content: [{ type: "text", text: JSON.stringify(toolsets, null, 2) }],
        };
      }

      const toolsetTools = allToolsets[toolsetName];
      if (!toolsetTools || toolsetName === "all" || toolsetName === "discover") {
        throw new Error(`Unknown toolset: ${toolsetName}`);
      }
      const tools = toolsetTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(tools, null, 2) }],
      };
    }
    case "call_tool": {
      const toolsetName = args.toolset_name as string;
      const toolName = args.tool_name as string;
      const toolArgs = (args.arguments as Record<string, unknown>) || {};

      const toolsetTools = allToolsets[toolsetName];
      if (!toolsetTools || toolsetName === "all" || toolsetName === "discover") {
        throw new Error(`Unknown toolset: ${toolsetName}`);
      }

      const tool = toolsetTools.find((t) => t.name === toolName);
      if (!tool) {
        throw new Error(
          `Unknown tool: ${toolName} in toolset ${toolsetName}`,
        );
      }

      return proxyToolCall(tool, toolArgs, ctx);
    }
    default:
      throw new Error(`Unknown discover tool: ${name}`);
  }
};

// Factory function to create a new Server instance with request handlers
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
    const ctx = getRequestContext(extra);

    if (ctx.toolset === "discover") {
      return { tools: DISCOVER_TOOLS };
    }

    const availableTools = getToolsByToolset(ctx.toolset);

    return {
      tools: availableTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;
    const ctx = getRequestContext(extra);

    if (ctx.toolset === "discover") {
      return handleDiscoverTool(name, args, ctx);
    }

    const availableTools = getToolsByToolset(ctx.toolset);
    const tool = availableTools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return proxyToolCall(tool, args, ctx);
  });

  return server;
};

const app = express();

// Security: Check authorization BEFORE parsing request body
// This prevents unauthenticated DoS via resource exhaustion (AAP-70224)
app.use((req, res, next) => {
  // lgtm[js/missing-rate-limiting] rate limiting handled at infrastructure level
  // Only apply to POST requests to MCP endpoints
  if (req.method === "POST" && req.path.includes("/mcp")) {
    const sessionId = req.headers["mcp-session-id"];
    const authHeader =
      req.headers["authorization"] || req.headers["x-authorization"];

    // Reject requests without session ID or Authorization header immediately
    // This prevents expensive JSON parsing and session creation for unauthenticated requests
    if (!sessionId && !authHeader) {
      applyWwwAuthenticate(res, req.path);
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Unauthorized: Bearer token or session ID required",
        },
        id: null,
      });
      return;
    }
  }

  next();
});

app.use(express.json());

app.use(
  cors({
    origin: "*",
  }),
);

// Authenticate the request and build the per-request context
const authenticateRequest = async (
  req: express.Request,
  toolset: string,
): Promise<
  | { ok: true; ctx: RequestContext }
  | { ok: false; reason: "no-token" }
  | { ok: false; reason: "invalid-token" }
> => {
  const authHeader = (req.headers["authorization"] ||
    req.headers["x-authorization"]) as string;
  const token = extractBearerToken(authHeader);
  if (!token) {
    return { ok: false, reason: "no-token" };
  }

  let userInfo: UserInfo;
  try {
    userInfo = await validateToken(token);
  } catch (error) {
    console.error(`${getTimestamp()} Token validation failed:`, error);
    return { ok: false, reason: "invalid-token" };
  }

  const identity = userIdentityService.deriveIdentity(userInfo);
  const userAgent = (req.headers["user-agent"] as string) || "unknown";

  return {
    ok: true,
    ctx: {
      token,
      toolset,
      userAgent,
      userPseudoId: identity.userPseudoId,
      userType: identity.userType,
      installerPseudoId: identity.installerPseudoId,
    },
  };
};

const applyWwwAuthenticate = (
  res: express.Response,
  requestPath: string,
  error?: Rfc6750Error,
): void => {
  if (!oauth2Config) return;
  const metadataUrl = buildResourceMetadataUrl(
    oauth2Config.serverUrl,
    requestPath,
  );
  const scopes = determineSupportedScopes(oauth2Config.writeOperationsEnabled);
  res.set(
    "WWW-Authenticate",
    buildWwwAuthenticateHeader(metadataUrl, scopes, error),
  );
};

// MCP POST endpoint handler - stateless, no sessions
const mcpPostHandler = async (
  req: express.Request,
  res: express.Response,
  toolset: string = "all",
) => {
  console.log(`${getTimestamp()} Received MCP request`);

  try {
    // Authenticate every request
    const authResult = await authenticateRequest(req, toolset);
    if (!authResult.ok) {
      const isInvalidToken = authResult.reason === "invalid-token";
      applyWwwAuthenticate(
        res,
        req.path,
        isInvalidToken ? "invalid_token" : undefined,
      );
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: isInvalidToken
            ? "Unauthorized: Invalid or expired token"
            : "Unauthorized: Bearer token required",
        },
        id: isInvalidToken ? (req.body as any)?.id || null : null,
      });
      return;
    }

    const ctx = authResult.ctx;

    // Create a fresh stateless transport for each request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const server = createMcpServer();
    await server.connect(transport);

    // The SDK reads authInfo from req.auth
    (req as any).auth = {
      token: ctx.token,
      clientId: "aap-mcp",
      scopes: [],
      extra: ctx as unknown as Record<string, unknown>,
    };

    await transport.handleRequest(req, res, req.body);

    // Clean up after request
    await transport.close();
    await server.close();
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

const allTools: AAPMcpToolDefinition[] = await generateTools();
const allToolsets = loadToolsetsFromCfg(allTools, localConfig);
allToolsets["discover"] = [];

// Set up routes - POST only, no GET/DELETE (no sessions to stream or terminate)
app.post("/mcp", (req, res) => mcpPostHandler(req, res));

app.post("/:toolset/mcp", (req, res) => {
  const toolset = req.params.toolset;
  console.log(
    `${getTimestamp()} Toolset-specific POST request for toolset: ${toolset}`,
  );
  return mcpPostHandler(req, res, toolset);
});

app.post("/mcp/:toolset", (req, res) => {
  const toolset = req.params.toolset;
  console.log(
    `${getTimestamp()} Toolset-specific POST request for toolset: ${toolset}`,
  );
  return mcpPostHandler(req, res, toolset);
});

// Health check endpoint (always enabled)
app.get("/api/v1/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => {
  const endpoints = Object.keys(allToolsets)
    .filter((name) => name !== "all" && name !== "discover")
    .map((toolset) => `/mcp/${toolset}`);
  const banner = `This is a MCP server, you can access it with a MCP client through the following end-points:
    - ${endpoints.join("\r\n    - ")}
  or just /mcp if you want to get access to all the tools at the same time.

  Connect to /mcp/discover to browse available toolsets before loading tools.`;
  res.set("Content-Type", "text/plain");
  res.status(200).send(banner);
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
  console.log("           AAP MCP Server Starting (Stateless)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log("Configuration:");
  console.log(`  Base URL: ${CONFIG.BASE_URL}`);
  console.log(`  MCP Server URL: ${CONFIG.MCP_SERVER_URL}`);
  console.log(
    `  Services: ${servicesConfig.length > 0 ? servicesConfig.map((s) => s.name).join(", ") : "none"}`,
  );
  console.log(`  Toolsets: ${Object.keys(allToolsets).length} enabled`);
  console.log(
    `  Write operations: ${allowWriteOperations ? "ENABLED" : "DISABLED"}`,
  );
  console.log(
    `  Certificate validation: ${ignoreCertificateErrors ? "DISABLED" : "ENABLED"}`,
  );
  console.log(`  Metrics: ${enableMetrics ? "ENABLED" : "DISABLED"}`);

  console.log(
    `  OAuth 2.1 discovery: ${isOAuth2Enabled() ? "CONFIGURED" : "DISABLED"}`,
  );

  if (isOAuth2Enabled()) {
    const discoveryTimeout = getDiscoveryTimeout();
    console.log(`  Discovery timeout: ${discoveryTimeout}s`);
    console.log("");
    console.log("Probing OIDC Discovery...");

    const probeResult = await probeOidcDiscovery(
      CONFIG.BASE_URL,
      discoveryTimeout,
    );

    if (probeResult.ok) {
      oauth2Config = buildConfig(
        CONFIG.BASE_URL,
        CONFIG.MCP_SERVER_URL,
        allowWriteOperations,
      );
      const toolsetNames = Object.keys(allToolsets).filter(
        (name) => name !== "all" && name !== "discover",
      );
      app.use(createProtectedResourceRouter(oauth2Config, toolsetNames));
      console.log(`  OAuth 2.1 discovery: ENABLED`);
      console.log(
        `  Authorization server: ${oauth2Config.authorizationServerUrl}`,
      );
      console.log(`  MCP Server URL: ${CONFIG.MCP_SERVER_URL}`);
      console.log("  OIDC Discovery: OK");
    } else {
      console.log(`  OAuth 2.1 discovery: DISABLED`);
      console.warn(
        `  WARNING: OAuth 2.1 discovery failed — ${probeResult.reason}`,
      );
      console.warn(
        "  Protected Resource Metadata and WWW-Authenticate headers will not be served.",
      );
    }
  }

  console.log(
    `  Default page_size: ${defaultPageSize} (from ${defaultPageSizeSource})`,
  );
  if (defaultPageSizeSource === "hard-coded default") {
    console.log(
      `  NOTE: Default page_size changed to ${defaultPageSize} (was 25). Set DEFAULT_PAGE_SIZE=25 to restore previous behavior.`,
    );
  }
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
  for (const [toolsetName, toolsetTools] of Object.entries(allToolsets)) {
    console.log(`  ${toolsetName}: ${toolsetTools.length}`);
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");

  const PORT = process.env.MCP_PORT || 3000;

  app.listen(PORT, () => {
    console.log(`Server ready on port ${PORT}`);
    console.log("");
    console.log("Available endpoints:");
    console.log(`  • MCP endpoint: http://localhost:${PORT}/mcp`);
    if (enableMetrics) {
      console.log(`  • Metrics: http://localhost:${PORT}/metrics`);
      metricsService.setActiveTools(allToolsets["all"].length);
    }
    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");

    // Initialize analytics with periodic status reporting (only if key provided)
    if (CONFIG.ANALYTICS_KEY) {
      const serverVersion = process.env.npm_package_version || "1.0.0";
      const containerVersion = process.env.CONTAINER_VERSION || "unknown";
      const readOnlyMode = !allowWriteOperations;

      analyticsService.initialize(
        CONFIG.ANALYTICS_KEY,
        () => 0, // No active sessions in stateless mode
        serverVersion,
        containerVersion,
        readOnlyMode,
      );
    }
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log(`${getTimestamp()} Shutting down server...`);
  await analyticsService.shutdown();
  console.log(`${getTimestamp()} Server shutdown complete`);
  process.exit(0);
});

main().catch((error) => {
  console.error(`${getTimestamp()} Server error:`, error);
  process.exit(1);
});
