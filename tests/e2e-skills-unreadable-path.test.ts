import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A skills_path the loader cannot enumerate throws, unlike a bad skill inside
// a readable root, which only warns. The trigger is a build regression, so the
// server must come up without skills rather than not at all.

const MOCK_AAP_PORT = 18381;
const MCP_SERVER_PORT = 13301;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;
const BEARER_TOKEN = "test-bearer-token";

const MODERN_VERSION = "2026-07-28";
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_META_KEY =
  "io.modelcontextprotocol/clientCapabilities";

const MISSING_SKILLS_PATH = join(tmpdir(), "e2e-skills-does-not-exist-12345");

let mockAapServer: Server;
let createdConfig = false;

let nextId = 1;

const call = async (
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> => {
  const response = await fetch(`${MCP_BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${BEARER_TOKEN}`,
      "mcp-protocol-version": MODERN_VERSION,
      "mcp-method": method,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params: {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
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

      if (pathname === "/api/gateway/v1/me/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              {
                id: 1,
                username: "test-user",
                email: "test@redhat.com",
                is_superuser: true,
                summary_fields: {
                  resource: {
                    ansible_id: "550e8400-e29b-41d4-a716-446655440000",
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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ count: 0, results: [] }));
    });
    server.listen(MOCK_AAP_PORT, () => resolve(server));
  });

describe("End-to-End: an unreadable skills_path", () => {
  beforeAll(async () => {
    expect(existsSync(MISSING_SKILLS_PATH)).toBe(false);

    mockAapServer = await startMockAapServer();

    const configPath = join(process.cwd(), "aap-mcp.yaml");
    const samplePath = join(process.cwd(), "aap-mcp.sample.yaml");
    if (!existsSync(configPath) && existsSync(samplePath)) {
      copyFileSync(samplePath, configPath);
      createdConfig = true;
    }

    process.env.BASE_URL = `http://localhost:${MOCK_AAP_PORT}`;
    process.env.MCP_PORT = String(MCP_SERVER_PORT);
    process.env.SKILLS_PATH = MISSING_SKILLS_PATH;

    await import("../src/index.js");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 30000);

  afterAll(async () => {
    if (mockAapServer) {
      await new Promise<void>((resolve) =>
        mockAapServer.close(() => resolve()),
      );
    }
    if (createdConfig) {
      rmSync(join(process.cwd(), "aap-mcp.yaml"), { force: true });
    }
  }, 10000);

  it("starts anyway and still serves its tools", async () => {
    const message = await call("tools/list");

    expect(message.error).toBeUndefined();
    expect(message.result.tools.length).toBeGreaterThan(0);
  });

  it("advertises nothing it cannot serve", async () => {
    const result = (await call("server/discover")).result;

    expect(
      result.capabilities.extensions?.["io.modelcontextprotocol/skills"],
    ).toBeUndefined();
    expect(result.capabilities.resources).toBeUndefined();
    expect(result.instructions).toBeUndefined();
  });

  it("answers skills/list as an unknown method", async () => {
    const message = await call("skills/list");

    expect(message.error?.code).toBe(-32601);
  });
});
