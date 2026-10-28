import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { type Server } from "node:http";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpCall, startMockAapServer } from "./helpers/mock-aap.js";

// A skills_path the loader cannot enumerate throws, unlike a bad skill inside
// a readable root, which only warns. The trigger is a build regression, so the
// server must come up without skills rather than not at all.

const MOCK_AAP_PORT = 18381;
const MCP_SERVER_PORT = 13301;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;

const MISSING_SKILLS_PATH = join(tmpdir(), "e2e-skills-does-not-exist-12345");

let mockAapServer: Server;
let createdConfig = false;

const call = (method: string, params: Record<string, unknown> = {}) =>
  mcpCall(MCP_BASE_URL, method, params);

describe("End-to-End: an unreadable skills_path", () => {
  beforeAll(async () => {
    expect(existsSync(MISSING_SKILLS_PATH)).toBe(false);

    mockAapServer = await startMockAapServer(MOCK_AAP_PORT);

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
