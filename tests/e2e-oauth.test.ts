import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MOCK_AAP_PORT = 18084;
const MCP_SERVER_PORT = 13004;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;
const BEARER_TOKEN = "oauth-test-bearer-token";

const mockUserData = {
  id: 1,
  username: "oauth-test-user",
  email: "test@redhat.com",
  summary_fields: {
    resource: { ansible_id: "550e8400-e29b-41d4-a716-446655440001" },
  },
};

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

      if (pathname === "/o/.well-known/openid-configuration") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            issuer: `http://localhost:${MOCK_AAP_PORT}/o`,
            authorization_endpoint: `http://localhost:${MOCK_AAP_PORT}/o/authorize/`,
            token_endpoint: `http://localhost:${MOCK_AAP_PORT}/o/token/`,
            userinfo_endpoint: `http://localhost:${MOCK_AAP_PORT}/o/userinfo/`,
            jwks_uri: `http://localhost:${MOCK_AAP_PORT}/o/.well-known/jwks.json`,
            scopes_supported: ["read", "write", "openid"],
            response_types_supported: ["code"],
          }),
        );
        return;
      }

      if (pathname === "/api/gateway/v1/me/") {
        const authHeader = req.headers["authorization"];
        if (
          !authHeader ||
          !authHeader.startsWith("Bearer ") ||
          authHeader.substring(7) !== BEARER_TOKEN
        ) {
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

describe("End-to-End: OAuth 2.1 Discovery (RFC 9728)", () => {
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
    process.env.TELEMETRY_HMAC_KEY = "oauth-test-hmac-key";
    process.env.INSTALLER_ID = "oauth-test-installer-uuid";

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

  // --- Protected Resource Metadata endpoints ---

  describe("Protected Resource Metadata", () => {
    it("should serve root metadata pointing to AAP Gateway", async () => {
      const response = await fetch(
        `${MCP_BASE_URL}/.well-known/oauth-protected-resource`,
      );
      expect(response.status).toBe(200);

      const body: any = await response.json();
      expect(body.resource).toBe(`http://localhost:${MCP_SERVER_PORT}/`);
      expect(body.authorization_servers).toEqual([
        `http://localhost:${MOCK_AAP_PORT}/o`,
      ]);
      expect(body.scopes_supported).toContain("read");
      expect(body.bearer_methods_supported).toEqual(["header"]);
      expect(body.resource_name).toBe("Ansible MCP Server");
    });

    it("should return Cache-Control: no-store", async () => {
      const response = await fetch(
        `${MCP_BASE_URL}/.well-known/oauth-protected-resource`,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("should return application/json content type", async () => {
      const response = await fetch(
        `${MCP_BASE_URL}/.well-known/oauth-protected-resource`,
      );
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
    });

    it("should serve path-specific metadata for /mcp", async () => {
      const response = await fetch(
        `${MCP_BASE_URL}/.well-known/oauth-protected-resource/mcp`,
      );
      const body: any = await response.json();

      expect(response.status).toBe(200);
      expect(body.resource).toBe(`http://localhost:${MCP_SERVER_PORT}/mcp`);
    });

    it("should serve path-specific metadata for toolset paths", async () => {
      const response = await fetch(
        `${MCP_BASE_URL}/.well-known/oauth-protected-resource/mcp/job_management`,
      );
      const body: any = await response.json();

      expect(response.status).toBe(200);
      expect(body.resource).toBe(
        `http://localhost:${MCP_SERVER_PORT}/mcp/job_management`,
      );
    });
  });

  // --- WWW-Authenticate headers ---

  describe("WWW-Authenticate headers on 401", () => {
    it("should include resource_metadata on 401 without token (early auth)", async () => {
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

      const wwwAuth = response.headers.get("www-authenticate");
      expect(wwwAuth).not.toBeNull();
      expect(wwwAuth).toContain("resource_metadata=");
      expect(wwwAuth).toContain('scope="read"');
      expect(wwwAuth).not.toContain("error=");
    });

    it("should include error=invalid_token on 401 with bad token", async () => {
      const response = await fetch(`${MCP_BASE_URL}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: "Bearer bad-token-xyz",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });
      expect(response.status).toBe(401);

      const wwwAuth = response.headers.get("www-authenticate");
      expect(wwwAuth).not.toBeNull();
      expect(wwwAuth).toContain('error="invalid_token"');
      expect(wwwAuth).toContain("resource_metadata=");
    });
  });
});
