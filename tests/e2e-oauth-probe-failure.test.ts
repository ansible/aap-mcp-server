import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MOCK_AAP_PORT = 18086;
const MCP_SERVER_PORT = 13006;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;

let mockAapServer: Server;

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

      // OIDC Discovery returns 404 — simulates Gateway without OIDC support
      if (pathname === "/o/.well-known/openid-configuration") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      if (pathname === "/api/gateway/v1/me/") {
        const authHeader = req.headers["authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "Authentication required." }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              {
                id: 1,
                username: "probe-fail-user",
                email: "test@redhat.com",
                summary_fields: {
                  resource: {
                    ansible_id: "550e8400-0000-0000-0000-000000000003",
                  },
                },
              },
            ],
          }),
        );
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
};

describe("End-to-End: OAuth probe failure graceful degradation", () => {
  beforeAll(async () => {
    const configPath = join(process.cwd(), "aap-mcp.yaml");
    const samplePath = join(process.cwd(), "aap-mcp.sample.yaml");
    if (!existsSync(configPath) && existsSync(samplePath)) {
      copyFileSync(samplePath, configPath);
    }

    mockAapServer = await startMockAapServer();

    process.env.BASE_URL = `http://localhost:${MOCK_AAP_PORT}`;
    process.env.MCP_PORT = String(MCP_SERVER_PORT);
    process.env.OAUTH2_ENABLED = "true";
    process.env.MCP_SERVER_URL = `http://localhost:${MCP_SERVER_PORT}`;
    process.env.TELEMETRY_HMAC_KEY = "probe-fail-hmac-key";
    process.env.INSTALLER_ID = "probe-fail-installer-uuid";

    await import("../src/index.js");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 30000);

  afterAll(async () => {
    if (mockAapServer) {
      await new Promise<void>((resolve) => {
        mockAapServer.close(() => resolve());
      });
    }
  }, 10000);

  it("should not serve PRM when OIDC probe fails", async () => {
    const response = await fetch(
      `${MCP_BASE_URL}/.well-known/oauth-protected-resource`,
    );
    expect(response.status).toBe(404);
  });

  it("should not include WWW-Authenticate on 401 when probe failed", async () => {
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
    expect(response.headers.get("www-authenticate")).toBeNull();
  });
});
