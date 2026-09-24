import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Modern-era (2026-07-28) protocol opt-in coverage (AAP-90951).
//
// The server migrated to the createMcpHandler entry with legacy:'stateless', so
// it serves BOTH eras from the same endpoints. Legacy (2025-era) behavior is
// covered by tests/e2e.test.ts (which speaks 2025-06-18 via the SDK client).
// This file drives raw modern-era requests over fetch and asserts the fields the
// SDK auto-injects once the client opts in with a 2026-07-28 per-request
// envelope: resultType, io.modelcontextprotocol/serverInfo in _meta, the
// tools/list cache hints we configured, and the auto-answered server/discover.
//
// A request is classified "modern" when its params._meta carries the reserved
// protocol-version key with a value >= 2026-07-28 plus the required
// clientCapabilities key (the "envelope claim"). Legacy clients send an
// initialize handshake instead and never see these fields.

// Unique ports to avoid clashing with e2e.test.ts (13000/18080) or a dev server.
const MOCK_AAP_PORT = 18280;
const MCP_SERVER_PORT = 13200;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;
const BEARER_TOKEN = "test-bearer-token";

const MODERN_VERSION = "2026-07-28";
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_META_KEY =
  "io.modelcontextprotocol/clientCapabilities";
const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";
const SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";

const mockUserData = {
  id: 1,
  username: "test-user",
  email: "test@redhat.com",
  is_superuser: true,
  summary_fields: {
    resource: { ansible_id: "550e8400-e29b-41d4-a716-446655440000" },
  },
};

let mockAapServer: Server;

/**
 * Build the per-request `_meta` envelope that opts a request into the modern
 * (2026-07-28) protocol revision. protocolVersion + clientCapabilities are the
 * required keys; clientInfo is optional but realistic.
 */
const modernEnvelope = (overrides: Record<string, unknown> = {}) => ({
  [PROTOCOL_VERSION_META_KEY]: MODERN_VERSION,
  [CLIENT_CAPABILITIES_META_KEY]: {},
  [CLIENT_INFO_META_KEY]: { name: "modern-e2e-client", version: "1.0.0" },
  ...overrides,
});

// Methods whose body param the modern era mirrors into the Mcp-Name header.
const MCP_NAME_HEADER_SOURCE: Record<string, string> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

/**
 * POST a JSON-RPC message as a modern request. The modern era requires the
 * standard per-request headers alongside the body: Mcp-Protocol-Version, an
 * Mcp-Method matching the body method, and (for name-bearing methods like
 * tools/call) an Mcp-Name matching params.name. Plain tool names round-trip in
 * the header as-is; only non-ASCII values need the Base64 sentinel form.
 * Callers can override headers/params for negative tests.
 */
const postModern = (
  path: string,
  message: Record<string, unknown>,
  {
    token = BEARER_TOKEN,
    headers = {},
  }: { token?: string | null; headers?: Record<string, string> } = {},
) => {
  const method = message.method as string;
  const params = (message.params ?? {}) as Record<string, unknown>;
  const autoHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "mcp-protocol-version": MODERN_VERSION,
    "mcp-method": method,
  };
  const nameSource = MCP_NAME_HEADER_SOURCE[method];
  if (nameSource && typeof params[nameSource] === "string") {
    autoHeaders["mcp-name"] = params[nameSource] as string;
  }

  return fetch(`${MCP_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...autoHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(message),
  });
};

/**
 * Read a JSON-RPC response whether the server answered as plain application/json
 * (the modern single-response default) or as an SSE stream. Returns the parsed
 * JSON-RPC message.
 */
const readResult = async (response: Response): Promise<any> => {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    // Grab the first `data:` payload from the SSE frame.
    const dataLine = text
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!dataLine) throw new Error(`No SSE data frame in response: ${text}`);
    return JSON.parse(dataLine.slice("data:".length).trim());
  }
  return JSON.parse(text);
};

const startMockAapServer = (): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const pathname = parseUrl(req.url || "", true).pathname || "";
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === "/api/gateway/v1/me/") {
        const authHeader = req.headers["authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "no creds" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: [mockUserData] }));
        return;
      }

      if (pathname.includes("schema") || pathname.includes("openapi")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            openapi: "3.0.0",
            info: { title: "Mock API", version: "1.0.0" },
            paths: {},
          }),
        );
        return;
      }

      if (pathname.startsWith("/api/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ count: 0, results: [] }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
    server.listen(MOCK_AAP_PORT, () => resolve(server));
  });

describe("End-to-End: Modern protocol (2026-07-28)", () => {
  beforeAll(async () => {
    const configPath = join(process.cwd(), "aap-mcp.yaml");
    const samplePath = join(process.cwd(), "aap-mcp.sample.yaml");
    if (!existsSync(configPath) && existsSync(samplePath)) {
      copyFileSync(samplePath, configPath);
    }

    mockAapServer = await startMockAapServer();

    process.env.BASE_URL = `http://localhost:${MOCK_AAP_PORT}`;
    process.env.MCP_PORT = String(MCP_SERVER_PORT);
    process.env.ANALYTICS_KEY = "test-segment-key";
    process.env.TELEMETRY_HMAC_KEY = "test-hmac-key-for-modern-e2e";
    process.env.INSTALLER_ID = "modern-e2e-installer-uuid";
    process.env.INTERNAL_EMAIL_DOMAINS = "redhat.com";
    process.env.ENABLE_METRICS = "true";

    await import("../src/index.js");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 30000);

  afterAll(async () => {
    if (mockAapServer) {
      await new Promise<void>((resolve) => mockAapServer.close(() => resolve()));
    }
  }, 10000);

  // --- Auto-injected result fields (resultType / serverInfo) ---

  describe("tools/list result envelope", () => {
    it("stamps resultType 'complete' on the result", async () => {
      const response = await postModern("/mcp/job_management", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { _meta: modernEnvelope() },
      });

      expect(response.status).toBe(200);
      const message = await readResult(response);
      expect(message.error).toBeUndefined();
      expect(message.result).toBeDefined();
      // 2026-07-28 §ResultType: every modern result MUST carry resultType.
      expect(message.result.resultType).toBe("complete");
      expect(Array.isArray(message.result.tools)).toBe(true);
    });

    it("injects io.modelcontextprotocol/serverInfo into result._meta", async () => {
      const response = await postModern("/mcp/job_management", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: modernEnvelope() },
      });

      const message = await readResult(response);
      // Spec PR #3002: servers SHOULD include serverInfo on every result.
      // Sourced from the McpServer constructor's serverInfo.
      expect(message.result._meta?.[SERVER_INFO_META_KEY]).toEqual({
        name: "aap",
        version: "0.1.0",
      });
    });

    it("fills the configured tools/list cache hints", async () => {
      const response = await postModern("/mcp/job_management", {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: { _meta: modernEnvelope() },
      });

      const message = await readResult(response);
      // cacheHints: { "tools/list": { ttlMs: 300_000, cacheScope: "public" } }
      expect(message.result.ttlMs).toBe(300_000);
      expect(message.result.cacheScope).toBe("public");
    });
  });

  // --- Auto-answered server/discover (MUST) ---

  describe("server/discover", () => {
    it("is auto-answered by the SDK with no handler from us", async () => {
      const response = await postModern("/mcp/job_management", {
        jsonrpc: "2.0",
        id: 4,
        method: "server/discover",
        params: { _meta: modernEnvelope() },
      });

      expect(response.status).toBe(200);
      const message = await readResult(response);
      expect(message.error).toBeUndefined();
      expect(message.result).toBeDefined();
      expect(message.result.resultType).toBe("complete");
      // server/discover is a cacheable method, so it also carries cache fields.
      expect(message.result.ttlMs).toBeDefined();
      expect(message.result.cacheScope).toBeDefined();
    });
  });

  // --- Modern tools/call round-trip ---

  describe("tools/call", () => {
    it("executes a tool and returns a complete result", async () => {
      const listResponse = await postModern("/mcp/job_management", {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/list",
        params: { _meta: modernEnvelope() },
      });
      const listMessage = await readResult(listResponse);
      const noParamTool = listMessage.result.tools.find(
        (t: any) =>
          !t.inputSchema?.required || t.inputSchema.required.length === 0,
      );
      expect(noParamTool).toBeDefined();

      const callResponse = await postModern("/mcp/job_management", {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: noParamTool.name, arguments: {}, _meta: modernEnvelope() },
      });

      expect(callResponse.status).toBe(200);
      const callMessage = await readResult(callResponse);
      expect(callMessage.error).toBeUndefined();
      expect(callMessage.result.resultType).toBe("complete");
      expect(Array.isArray(callMessage.result.content)).toBe(true);
    });
  });

  // --- Envelope validation (SEP-2243) ---

  describe("envelope validation", () => {
    it("rejects a modern header without the per-request envelope claim", async () => {
      // Modern MCP-Protocol-Version header but no params._meta claim: the SDK
      // returns InvalidParams (-32602) rather than silently serving it.
      const response = await postModern("/mcp/job_management", {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/list",
        params: {},
      });

      expect(response.status).toBe(400);
      const message = await readResult(response);
      expect(message.error).toBeDefined();
      expect(message.error.code).toBe(-32602);
    });

    it("rejects a header/body protocol-version mismatch", async () => {
      const response = await postModern(
        "/mcp/job_management",
        {
          jsonrpc: "2.0",
          id: 8,
          method: "tools/list",
          params: { _meta: modernEnvelope() },
        },
        { headers: { "mcp-protocol-version": "2025-06-18" } },
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      const message = await readResult(response);
      expect(message.error).toBeDefined();
    });
  });

  // --- Auth still enforced on the modern path ---

  describe("authentication", () => {
    it("returns 401 for a modern request without a bearer token", async () => {
      const response = await postModern(
        "/mcp/job_management",
        {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/list",
          params: { _meta: modernEnvelope() },
        },
        { token: null },
      );

      expect(response.status).toBe(401);
    });
  });
});
