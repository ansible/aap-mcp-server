import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Use unique ports to avoid conflicts with other test suites
const MOCK_AAP_PORT = 18083;
const MCP_SERVER_PORT = 13003;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;
const VALID_TOKEN = "origin-test-token";

// The gateway origin the installer would populate. Configured with a trailing
// slash on purpose to prove the middleware normalizes allowlist entries.
const ALLOWED_ORIGIN = "https://gateway.example.com";

let mockAapServer: Server;

/**
 * Minimal mock AAP server: 200 for the valid token, 401 otherwise.
 */
const startMockAapServer = (): Promise<Server> => {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const parsedUrl = new URL(req.url || "", `http://${req.headers.host}`);
      const pathname = parsedUrl.pathname;

      if (pathname === "/api/gateway/v1/me/") {
        const authHeader = req.headers["authorization"];
        if (authHeader === `Bearer ${VALID_TOKEN}`) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              results: [
                {
                  id: 1,
                  username: "origin-test-user",
                  email: "test@example.com",
                  is_superuser: true,
                  is_platform_auditor: false,
                  summary_fields: { resource: { ansible_id: "origin-uuid" } },
                },
              ],
            }),
          );
          return;
        }
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Authentication failed." }));
        return;
      }

      if (pathname.includes("schema") || pathname.includes("openapi")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            openapi: "3.0.0",
            info: { title: "Mock AAP API", version: "1.0.0" },
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
};

const postInitialize = (origin?: string, token?: string) =>
  fetch(`${MCP_BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(origin ? { Origin: origin } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "origin-test", version: "1.0.0" },
      },
    }),
  });

describe("Origin Validation (DNS rebinding protection, E2E)", () => {
  beforeAll(async () => {
    const configPath = join(process.cwd(), "aap-mcp.yaml");
    const samplePath = join(process.cwd(), "aap-mcp.sample.yaml");
    if (!existsSync(configPath) && existsSync(samplePath)) {
      copyFileSync(samplePath, configPath);
    }

    mockAapServer = await startMockAapServer();

    process.env.BASE_URL = `http://localhost:${MOCK_AAP_PORT}`;
    process.env.MCP_PORT = String(MCP_SERVER_PORT);
    process.env.SESSION_TIMEOUT = "30";
    process.env.ANALYTICS_KEY = "";
    process.env.ENABLE_METRICS = "false";
    // Configure the allowlist with a trailing slash to exercise normalization.
    process.env.ALLOWED_ORIGINS = `${ALLOWED_ORIGIN}/`;

    await import("../../src/index.js");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }, 30000);

  afterAll(async () => {
    if (mockAapServer) {
      await new Promise<void>((resolve) => {
        mockAapServer.close(() => resolve());
      });
    }
  }, 10000);

  it("rejects a disallowed browser Origin with 403 before auth", async () => {
    // Even with a valid token, a disallowed Origin is rejected first.
    const response = await postInitialize("https://evil.example.com", VALID_TOKEN);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      error: { message: expect.stringContaining("Origin") },
      id: null,
    });
  }, 15000);

  it("sends the literal Origin: null to 403 (sandboxed/file contexts)", async () => {
    const response = await postInitialize("null", VALID_TOKEN);
    expect(response.status).toBe(403);
  }, 15000);

  it("allows a request with no Origin header (non-browser client)", async () => {
    // No Origin => passes Origin validation; then fails auth (401), proving it
    // was NOT rejected by the Origin middleware (which would be 403).
    const response = await postInitialize(undefined, undefined);
    expect(response.status).toBe(401);
  }, 15000);

  it("allows localhost origins regardless of the allowlist", async () => {
    const response = await postInitialize("http://localhost:5173", undefined);
    expect(response.status).toBe(401); // passed Origin check, then no token
  }, 15000);

  it("allows a configured allowlist origin (normalized)", async () => {
    // Configured as ".../" but the browser sends the bare origin; both normalize.
    const response = await postInitialize(ALLOWED_ORIGIN, undefined);
    expect(response.status).toBe(401); // passed Origin check, then no token
  }, 15000);

  it("accepts a configured origin with a valid token (full pass-through)", async () => {
    const response = await postInitialize(ALLOWED_ORIGIN, VALID_TOKEN);
    expect(response.status).toBe(200);
  }, 15000);
});
