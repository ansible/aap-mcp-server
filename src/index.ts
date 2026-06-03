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
import { createOAuth2Provider, type OAuth2Setup } from "./oauth2-provider.js";
import { errors as joseErrors } from "jose";
import rateLimit from "express-rate-limit";

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
  ANALYTICS_KEY: (
    process.env.ANALYTICS_KEY ||
    localConfig.analytics_key ||
    ""
  ).trim(),
  OAUTH2_CLIENT_ID: (process.env.OAUTH2_CLIENT_ID || "").trim(),
  OAUTH2_CLIENT_SECRET: (process.env.OAUTH2_CLIENT_SECRET || "").trim(),
  MCP_SERVER_URL: (process.env.MCP_SERVER_URL || "").trim(),
  OAUTH2_ALLOWED_REDIRECT_HOSTS: (
    process.env.OAUTH2_ALLOWED_REDIRECT_HOSTS || "localhost,127.0.0.1,[::1]"
  )
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
  OAUTH2_RATE_LIMIT: process.env.OAUTH2_RATE_LIMIT
    ? parseInt(process.env.OAUTH2_RATE_LIMIT, 10)
    : 100,
} as const;

const oauth2Enabled = !!(
  CONFIG.OAUTH2_CLIENT_ID && CONFIG.OAUTH2_CLIENT_SECRET
);
let oauth2Setup: OAuth2Setup | undefined;

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

const oauth2Scope = allowWriteOperations ? "read write" : "read";

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

const extractTokenFromRequest = (req: express.Request): string | undefined => {
  const authHeader = (req.headers["authorization"] ||
    req.headers["x-authorization"]) as string;
  return extractBearerToken(authHeader);
};

const buildRequestContext = (
  token: string,
  toolset: string,
  userInfo: UserInfo,
  userAgent: string,
): RequestContext => {
  const identity = userIdentityService.deriveIdentity(userInfo);
  return {
    token,
    toolset,
    userAgent,
    userPseudoId: identity.userPseudoId,
    userType: identity.userType,
    installerPseudoId: identity.installerPseudoId,
  };
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
    const _startTime = Date.now();
    const ctx = getRequestContext(extra);

    // Get user's toolset to ensure they have access to this tool
    const availableTools = getToolsByToolset(ctx.toolset);

    // Find the matching tool by external name (without service prefix)
    const tool = availableTools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // Get toolset for this tool
    const toolToolset = getToolsetForTool(tool.name);

    // Execute the tool by making HTTP request
    let result: any;
    let response: Response | undefined;
    let fullUrl: string;
    let requestOptions: RequestInit | undefined;

    try {
      // Build URL from path template and parameters
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
  });

  return server;
};

const app = express();

// Security: Check authorization BEFORE parsing request body
// This prevents unauthenticated DoS via resource exhaustion (AAP-70224)
app.use((req, res, next) => {
  // Only apply to POST requests to MCP endpoints
  if (req.method === "POST" && req.path.includes("/mcp")) {
    const sessionId = req.headers["mcp-session-id"];
    const authHeader =
      req.headers["authorization"] || req.headers["x-authorization"];

    // Reject requests without session ID or Authorization header immediately
    // This prevents expensive JSON parsing and session creation for unauthenticated requests
    if (!sessionId && !authHeader) {
      if (oauth2Setup) {
        const metadataUrl = oauth2Setup.getResourceMetadataUrl(req.path);
        res
          .status(401)
          .set(
            "WWW-Authenticate",
            `Bearer resource_metadata="${metadataUrl}", scope="${oauth2Scope}"`,
          )
          .json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Unauthorized: Bearer token required",
            },
            id: null,
          });
      } else {
        res.status(401).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Unauthorized: Bearer token or session ID required",
          },
          id: null,
        });
      }
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

// Authenticate via legacy token validation against AAP /me/
const authenticateRequest = async (
  req: express.Request,
  toolset: string,
): Promise<
  | { ok: true; ctx: RequestContext }
  | { ok: false; reason: "no-token" }
  | { ok: false; reason: "invalid-token" }
> => {
  const token = extractTokenFromRequest(req);
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

  const userAgent = (req.headers["user-agent"] as string) || "unknown";
  return {
    ok: true,
    ctx: buildRequestContext(token, toolset, userInfo, userAgent),
  };
};

// Try to authenticate via JWT (OAuth2) first, then fall back to legacy token validation
const authenticateRequestWithOAuth2 = async (
  req: express.Request,
  toolset: string,
): Promise<
  | { ok: true; ctx: RequestContext }
  | { ok: false; reason: "no-token" }
  | { ok: false; reason: "invalid-token" }
> => {
  const token = extractTokenFromRequest(req);
  if (!token) {
    return { ok: false, reason: "no-token" };
  }

  // Try JWT verification first (fast, local) when OAuth2 is configured
  // Only attempt if the token looks like a JWT (three dot-separated segments)
  if (oauth2Setup && token.split(".").length === 3) {
    try {
      const authInfo = await oauth2Setup.verifyAccessToken(token);
      const jwtExtra = authInfo.extra || {};
      const userInfo: UserInfo = {
        ansibleId: jwtExtra.sub as string,
        email: jwtExtra.email as string,
      };
      const userAgent = (req.headers["user-agent"] as string) || "unknown";
      return {
        ok: true,
        ctx: buildRequestContext(token, toolset, userInfo, userAgent),
      };
    } catch (jwtError) {
      // Audience, issuer, or signature failures are security-relevant —
      // reject immediately without falling back to legacy validation.
      if (
        jwtError instanceof joseErrors.JWTClaimValidationFailed ||
        jwtError instanceof joseErrors.JWTExpired ||
        jwtError instanceof joseErrors.JWSSignatureVerificationFailed
      ) {
        console.debug(
          `${getTimestamp()} JWT rejected (no fallback): %s`,
          jwtError instanceof Error ? jwtError.message : jwtError,
        );
        return { ok: false, reason: "invalid-token" };
      }
      // Structural errors (not actually a JWT) — fall back to legacy
      console.debug(
        `${getTimestamp()} JWT verification failed, falling back to legacy auth: %s`,
        jwtError instanceof Error ? jwtError.message : jwtError,
      );
    }
  }

  // Legacy path: validate opaque token against AAP /me/
  return authenticateRequest(req, toolset);
};

// MCP POST endpoint handler - stateless, no sessions
const mcpPostHandler = async (
  req: express.Request,
  res: express.Response,
  toolset: string = "all",
) => {
  console.log(`${getTimestamp()} Received MCP request`);

  try {
    // Authenticate every request (JWT first if OAuth2 enabled, then legacy)
    const authResult = await authenticateRequestWithOAuth2(req, toolset);
    if (!authResult.ok) {
      const isInvalidToken = authResult.reason === "invalid-token";
      if (oauth2Setup) {
        const metadataUrl = oauth2Setup.getResourceMetadataUrl(req.path);
        const wwwAuth = isInvalidToken
          ? `Bearer error="invalid_token", resource_metadata="${metadataUrl}", scope="${oauth2Scope}"`
          : `Bearer resource_metadata="${metadataUrl}", scope="${oauth2Scope}"`;
        res
          .status(401)
          .set("WWW-Authenticate", wwwAuth)
          .json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: isInvalidToken
                ? "Unauthorized: Invalid or expired token"
                : "Unauthorized: Bearer token required",
            },
            id: isInvalidToken ? (req.body as any)?.id || null : null,
          });
      } else {
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
      }
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

// OAuth2 auth router placeholder — mounted here (before MCP routes) so
// /authorize, /token, /register, /.well-known/* are matched first.
// The actual router is attached in main() after OIDC discovery completes.
const oauthRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: CONFIG.OAUTH2_RATE_LIMIT,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  skip: (req) =>
    !req.path.startsWith("/.well-known/oauth") &&
    ![
      "/register",
      "/authorize",
      "/token",
      "/revoke",
      "/oauth/callback",
    ].includes(req.path),
});
let oauthRouterSlot: express.RequestHandler | undefined;
app.use((req, res, next) => {
  if (oauthRouterSlot) {
    return oauthRateLimiter(req, res, () => oauthRouterSlot!(req, res, next));
  }
  next();
});
// Catch errors from the OAuth2 router that would otherwise return a bare 500
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const safePath = req.path.replace(/[^\w/.-]/g, "_");
    console.error(
      "%s [OAuth2 error] %s %s: %s",
      getTimestamp(),
      req.method,
      safePath,
      err.message,
    );
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

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
    .filter((name) => name !== "all")
    .map((toolset) => `/mcp/${toolset}`);
  const banner = `This is a MCP server, you can access it with a MCP client through the following end-points:
    - ${endpoints.join("\r\n    - ")}
  or just /mcp if you want to get access to all the tools at the same time.`;
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
  // Initialize OAuth2 provider if configured
  if (oauth2Enabled) {
    const serverUrl =
      CONFIG.MCP_SERVER_URL || `http://localhost:${CONFIG.MCP_PORT}`;
    try {
      oauth2Setup = await createOAuth2Provider({
        clientId: CONFIG.OAUTH2_CLIENT_ID,
        clientSecret: CONFIG.OAUTH2_CLIENT_SECRET,
        baseUrl: CONFIG.BASE_URL,
        serverUrl,
        allowedRedirectHosts: CONFIG.OAUTH2_ALLOWED_REDIRECT_HOSTS,
      });
      oauthRouterSlot = oauth2Setup.authRouter;
    } catch (error) {
      console.error(`${getTimestamp()} OAuth2 initialization failed:`, error);
      console.error(`${getTimestamp()} Falling back to legacy auth only`);
    }
  }

  // Print startup banner
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("           AAP MCP Server Starting (Stateless)");
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
  console.log(
    `  Certificate validation: ${ignoreCertificateErrors ? "DISABLED" : "ENABLED"}`,
  );
  console.log(`  Metrics: ${enableMetrics ? "ENABLED" : "DISABLED"}`);
  console.log(`  OAuth2: ${oauth2Setup ? "ENABLED" : "DISABLED"}`);
  if (oauth2Setup) {
    console.log(
      `  OAuth2 rate limit: ${CONFIG.OAUTH2_RATE_LIMIT} req/min per IP`,
    );
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
