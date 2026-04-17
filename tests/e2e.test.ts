import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Use unique ports to avoid conflicts with other running instances
const MOCK_AAP_PORT = 18080;
const MCP_SERVER_PORT = 13000;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;
const BEARER_TOKEN = "test-bearer-token";

// Mock user data matching the /me/ endpoint response
const mockUserData = {
  id: 1,
  username: "test-user",
  email: "test@redhat.com",
  is_superuser: true,
  is_platform_auditor: false,
  first_name: "Test",
  last_name: "User",
  summary_fields: {
    resource: {
      ansible_id: "550e8400-e29b-41d4-a716-446655440000",
    },
  },
};

let mockAapServer: Server;

/**
 * Create an MCP client connected to a specific toolset.
 */
const createMcpClient = (toolset: string, token?: string) => {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${MCP_BASE_URL}/mcp/${toolset}`),
    {
      requestInit: {
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
          "User-Agent": "E2E-Test-Client/1.0",
          "mcp-protocol-version": "2025-06-18",
        },
      },
    },
  );

  const client = new Client(
    { name: "e2e-test-client", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      protocolVersion: "2025-06-18",
    },
  );

  return { client, transport };
};

/**
 * Start a minimal mock AAP server.
 */
const startMockAapServer = (): Promise<Server> => {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const parsedUrl = parseUrl(req.url || "", true);
      const pathname = parsedUrl.pathname || "";

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS",
      );
      res.setHeader("Access-Control-Allow-Headers", "*");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === "/api/gateway/v1/me/") {
        // Check for valid bearer token
        const authHeader = req.headers["authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              detail: "Authentication credentials were not provided.",
            }),
          );
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

      // Generic API endpoints — return mock data for tool calls
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
};

describe("End-to-End: MCP Server", () => {
  beforeAll(async () => {
    // Ensure aap-mcp.yaml exists (copy from sample if missing, e.g. in CI)
    const configPath = join(process.cwd(), "aap-mcp.yaml");
    const samplePath = join(process.cwd(), "aap-mcp.sample.yaml");
    if (!existsSync(configPath) && existsSync(samplePath)) {
      copyFileSync(samplePath, configPath);
    }

    // Start mock AAP server first
    mockAapServer = await startMockAapServer();

    // Set env vars BEFORE importing index.ts so it picks them up
    process.env.BASE_URL = `http://localhost:${MOCK_AAP_PORT}`;
    process.env.MCP_PORT = String(MCP_SERVER_PORT);
    process.env.ANALYTICS_KEY = "test-segment-key";
    process.env.TELEMETRY_HMAC_KEY = "test-hmac-key-for-e2e";
    process.env.INSTALLER_ID = "e2e-test-installer-uuid";
    process.env.INTERNAL_EMAIL_DOMAINS = "redhat.com,ibm.com,ansible.com";
    process.env.SESSION_TIMEOUT = "30";
    process.env.ENABLE_METRICS = "true";

    // Import index.ts in-process — Vitest's V8 coverage instruments all code
    await import("../src/index.js");

    // Give the server a moment to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 30000);

  afterAll(async () => {
    if (mockAapServer) {
      await new Promise<void>((resolve) => {
        mockAapServer.close(() => resolve());
      });
    }
  }, 10000);

  // --- Health & Metrics ---

  describe("Health and Metrics", () => {
    it("should return healthy status", async () => {
      const response = await fetch(`${MCP_BASE_URL}/api/v1/health`);
      expect(response.ok).toBe(true);

      const data: any = await response.json();
      expect(data.status).toBe("ok");
    });

    it("should return metrics when enabled", async () => {
      const response = await fetch(`${MCP_BASE_URL}/metrics`);
      expect(response.ok).toBe(true);

      const text = await response.text();
      expect(text).toContain("mcp_");
    });
  });

  // --- GET handler ---

  describe("GET handler", () => {
    it("should reject GET requests on /mcp", async () => {
      const response = await fetch(`${MCP_BASE_URL}/mcp`);
      expect(response.status).toBe(404);
    });

    it("should return 404 for GET on /mcp/toolset without session", async () => {
      const response = await fetch(`${MCP_BASE_URL}/mcp/job_management`);
      expect(response.status).toBe(404);
    });

    it("should return 404 for GET with invalid session ID", async () => {
      const response = await fetch(`${MCP_BASE_URL}/mcp/job_management`, {
        headers: { "mcp-session-id": "non-existent-session" },
      });
      expect(response.status).toBe(404);
    });
  });

  // --- POST handler - invalid requests ---

  describe("POST handler - invalid requests", () => {
    it("should return 401 for POST without auth token", async () => {
      const response = await fetch(`${MCP_BASE_URL}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "mcp-session-id": "non-existent-session",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });
      expect(response.status).toBe(401);
    });

    it("should return 401 for POST without auth token and no session ID", async () => {
      const response = await fetch(`${MCP_BASE_URL}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });
      expect(response.status).toBe(401);
    });
  });

  // --- DELETE handler ---

  describe("DELETE handler", () => {
    it("should return 404 for DELETE without session", async () => {
      const response = await fetch(`${MCP_BASE_URL}/mcp`, {
        method: "DELETE",
      });
      expect(response.status).toBe(404);
    });

    it("should return 404 for DELETE with invalid session ID", async () => {
      const response = await fetch(`${MCP_BASE_URL}/mcp`, {
        method: "DELETE",
        headers: { "mcp-session-id": "non-existent-session" },
      });
      expect(response.status).toBe(404);
    });

    it("should return 404 for toolset-specific DELETE without session", async () => {
      const response = await fetch(`${MCP_BASE_URL}/mcp/job_management`, {
        method: "DELETE",
      });
      expect(response.status).toBe(404);
    });
  });

  // --- MCP Protocol Flow ---

  describe("MCP Protocol - full flow", () => {
    it("should connect, list tools, call a tool, and disconnect", async () => {
      const { client, transport } = createMcpClient(
        "job_management",
        BEARER_TOKEN,
      );

      // Connect — exercises validateToken, extractBearerToken, storeSessionData
      await client.connect(transport);

      // List tools — exercises ListToolsRequestSchema handler
      const toolsResponse = await client.listTools();
      expect(toolsResponse.tools).toBeDefined();
      expect(Array.isArray(toolsResponse.tools)).toBe(true);

      // Call a tool — exercises CallToolRequestSchema handler
      if (toolsResponse.tools.length > 0) {
        const toolsWithNoParams = toolsResponse.tools.filter(
          (t) => !t.inputSchema.required || t.inputSchema.required.length === 0,
        );

        if (toolsWithNoParams.length > 0) {
          const tool = toolsWithNoParams[0];
          const result = await client.callTool({ name: tool.name });
          expect(result).toBeDefined();
          expect(result.content).toBeDefined();
        }
      }

      // Disconnect — exercises cleanup
      await client.close();
      await transport.close();
    }, 15000);

    it("should reject requests without authentication", async () => {
      const { client, transport } = createMcpClient("job_management");

      await expect(client.connect(transport)).rejects.toThrow();
    }, 10000);

    it("should connect via /mcp (all toolsets)", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${MCP_BASE_URL}/mcp`),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${BEARER_TOKEN}`,
              "User-Agent": "E2E-Test-Client/1.0",
              "mcp-protocol-version": "2025-06-18",
            },
          },
        },
      );

      const client = new Client(
        { name: "e2e-all-toolsets", version: "1.0.0" },
        {
          capabilities: { tools: {} },
          protocolVersion: "2025-06-18",
        },
      );

      await client.connect(transport);

      const toolsResponse = await client.listTools();
      expect(toolsResponse.tools).toBeDefined();

      await client.close();
      await transport.close();
    }, 15000);

    it("should handle multiple concurrent sessions", async () => {
      const { client: client1, transport: transport1 } = createMcpClient(
        "job_management",
        BEARER_TOKEN,
      );
      const { client: client2, transport: transport2 } = createMcpClient(
        "job_management",
        BEARER_TOKEN,
      );

      await client1.connect(transport1);
      await client2.connect(transport2);

      const [tools1, tools2] = await Promise.all([
        client1.listTools(),
        client2.listTools(),
      ]);

      expect(tools1.tools).toBeDefined();
      expect(tools2.tools).toBeDefined();

      await Promise.all([
        client1.close().then(() => transport1.close()),
        client2.close().then(() => transport2.close()),
      ]);
    }, 15000);
  });

  // --- Toolset-specific routes ---

  describe("Toolset-specific routes", () => {
    it("should connect via /:toolset/mcp path format", async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${MCP_BASE_URL}/job_management/mcp`),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${BEARER_TOKEN}`,
              "User-Agent": "E2E-Test-Client/1.0",
              "mcp-protocol-version": "2025-06-18",
            },
          },
        },
      );

      const client = new Client(
        { name: "e2e-alt-route", version: "1.0.0" },
        {
          capabilities: { tools: {} },
          protocolVersion: "2025-06-18",
        },
      );

      await client.connect(transport);

      const toolsResponse = await client.listTools();
      expect(toolsResponse.tools).toBeDefined();

      await client.close();
      await transport.close();
    }, 15000);
  });

  // --- Additional route coverage ---

  describe("Additional routes", () => {
    it("should return response on root /", async () => {
      const response = await fetch(`${MCP_BASE_URL}/`);
      expect(response.ok).toBe(true);
    });

    it("should reject DELETE on /mcp/:toolset with invalid session", async () => {
      const response = await fetch(`${MCP_BASE_URL}/job_management/mcp`, {
        method: "DELETE",
        headers: { "mcp-session-id": "bad-session" },
      });
      expect(response.status).toBe(404);
    });

    it("should return 401 for POST on /:toolset/mcp without auth token", async () => {
      const response = await fetch(`${MCP_BASE_URL}/job_management/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });
      expect(response.status).toBe(401);
    });
  });
});
