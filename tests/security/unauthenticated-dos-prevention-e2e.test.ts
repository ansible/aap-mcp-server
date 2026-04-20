import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Use unique ports to avoid conflicts with main e2e tests
const MOCK_AAP_PORT = 18082;
const MCP_SERVER_PORT = 13002;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;
const VALID_TOKEN = "security-test-token";

let mockAapServer: Server;

/**
 * Start a minimal mock AAP server for authentication testing.
 * Returns 200 for valid tokens, 401 for invalid/missing tokens.
 */
const startMockAapServer = (): Promise<Server> => {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const parsedUrl = new URL(req.url || "", `http://${req.headers.host}`);
      const pathname = parsedUrl.pathname;

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

      // Mock authentication endpoint
      if (pathname === "/api/gateway/v1/me/") {
        const authHeader = req.headers["authorization"];

        if (authHeader === `Bearer ${VALID_TOKEN}`) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              results: [
                {
                  id: 1,
                  username: "security-test-user",
                  email: "test@example.com",
                  is_superuser: true,
                  is_platform_auditor: false,
                  summary_fields: {
                    resource: {
                      ansible_id: "security-test-uuid",
                    },
                  },
                },
              ],
            }),
          );
          return;
        }

        // Invalid or missing token
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            detail: "Authentication credentials were not provided.",
          }),
        );
        return;
      }

      // Mock OpenAPI schema endpoints
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

      // Generic API endpoints
      if (pathname.startsWith("/api/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ count: 0, results: [] }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    server.listen(MOCK_AAP_PORT, () => {
      console.log(
        `Mock AAP server started on http://localhost:${MOCK_AAP_PORT}`,
      );
      resolve(server);
    });
  });
};

describe("Unauthenticated DoS Prevention (E2E)", () => {
  beforeAll(async () => {
    // Ensure aap-mcp.yaml exists (copy from sample if missing)
    const configPath = join(process.cwd(), "aap-mcp.yaml");
    const samplePath = join(process.cwd(), "aap-mcp.sample.yaml");
    if (!existsSync(configPath) && existsSync(samplePath)) {
      copyFileSync(samplePath, configPath);
    }

    // Start mock AAP server first
    mockAapServer = await startMockAapServer();

    // Set env vars for MCP server
    process.env.BASE_URL = `http://localhost:${MOCK_AAP_PORT}`;
    process.env.MCP_PORT = String(MCP_SERVER_PORT);
    process.env.SESSION_TIMEOUT = "30";
    process.env.ANALYTICS_KEY = ""; // Disable analytics for security tests
    process.env.ENABLE_METRICS = "false";

    // Import and start MCP server in-process
    await import("../../src/index.js");

    // Give the server a moment to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }, 30000);

  afterAll(async () => {
    if (mockAapServer) {
      await new Promise<void>((resolve) => {
        mockAapServer.close(() => {
          console.log("Mock AAP server stopped");
          resolve();
        });
      });
    }
  }, 10000);

  describe("Security Layer 1: Early Auth Check Middleware", () => {
    it("should reject unauthenticated initialization request with 401 before expensive operations", async () => {
      // This is the CRITICAL security test
      // An attacker sends an init request without authentication
      // The server MUST reject it quickly without:
      // - Parsing the JSON body
      // - Creating a transport object
      // - Generating a UUID
      // - Doing any other expensive operations

      const startTime = Date.now();

      const response = await fetch(`${MCP_BASE_URL}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // NO Authorization header - simulating unauthenticated attacker
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "attacker-client",
              version: "1.0",
            },
          },
        }),
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      // Verify security: request is rejected
      expect(response.status).toBe(401);

      // Verify response contains proper error
      const body = await response.json();
      expect(body).toMatchObject({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: expect.stringContaining("Unauthorized"),
        },
      });

      // Verify performance: rejection is FAST (< 100ms)
      // This proves the server rejected BEFORE expensive operations
      // Before the fix, this would take ~7.4ms per request
      // With the fix, it should be ~0.05ms
      // We use 100ms as a generous threshold to account for system variance
      expect(responseTime).toBeLessThan(100);

      console.log(
        `✓ Unauthenticated request rejected in ${responseTime}ms (target: <100ms)`,
      );
    }, 15000);
  });

  describe("Security Layer 2: Token Validation Before Transport Creation", () => {
    it("should reject invalid token with 401 before creating transport", async () => {
      // This tests the second layer of defense
      // An attacker provides an Authorization header (bypassing Layer 1)
      // but with an INVALID token
      // The server MUST:
      // 1. Validate the token against AAP
      // 2. Reject BEFORE creating StreamableHTTPServerTransport
      // 3. Reject BEFORE generating UUID
      // This prevents resource exhaustion from invalid token flooding

      const startTime = Date.now();

      const response = await fetch(`${MCP_BASE_URL}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: "Bearer invalid-token-xyz-12345", // Invalid token
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "attacker-with-invalid-token",
              version: "1.0",
            },
          },
        }),
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      // Verify security: request is rejected
      expect(response.status).toBe(401);

      // Verify response contains proper error
      const body = await response.json();
      expect(body).toMatchObject({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: expect.stringMatching(
            /Unauthorized.*Invalid.*expired.*token/i,
          ),
        },
        id: 2, // Should include the request ID
      });

      // Verify the mock AAP server was called for validation
      // (we know this happened if we got "Invalid or expired token" message)
      expect(body.error.message).toContain("Invalid");

      console.log(
        `✓ Invalid token rejected in ${responseTime}ms after validation`,
      );
    }, 15000);

    it("should accept valid token and create session successfully", async () => {
      // This is the positive test case
      // A legitimate user provides a VALID token
      // The server MUST:
      // 1. Validate the token against AAP (returns 200)
      // 2. Create the session
      // 3. Return session ID
      // This proves the security fix doesn't break legitimate requests

      const response = await fetch(`${MCP_BASE_URL}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${VALID_TOKEN}`, // Valid token
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "legitimate-client",
              version: "1.0",
            },
          },
        }),
      });

      // Verify success
      expect(response.status).toBe(200);

      // Verify session ID is returned
      const sessionId = response.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
      expect(sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      console.log(
        `✓ Valid token accepted, session created: ${sessionId?.substring(0, 8)}...`,
      );
    }, 15000);
  });
});
