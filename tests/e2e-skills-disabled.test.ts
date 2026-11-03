import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { type Server } from "node:http";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpCall, startMockAapServer } from "./helpers/mock-aap.js";

// Both trees are valid and populated, unlike the other disabled-state cases:
// nothing is served only because skills_enabled says so.

const MOCK_AAP_PORT = 18383;
const MCP_SERVER_PORT = 13303;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;

const SKILL_NAME = "aap-platform-health-check";
const SKILL_MD = `---
name: ${SKILL_NAME}
description: Run health checks across AAP components.
---

# Platform Health Check
`;

let mockAapServer: Server;
let skillsRoot: string;
let sharedRoot: string;
let createdConfig = false;

const call = (method: string, params: Record<string, unknown> = {}) =>
  mcpCall(MCP_BASE_URL, method, params);

describe("End-to-End: skills_enabled false with content present", () => {
  beforeAll(async () => {
    skillsRoot = mkdtempSync(join(tmpdir(), "e2e-skills-disabled-"));
    mkdirSync(join(skillsRoot, SKILL_NAME), { recursive: true });
    writeFileSync(join(skillsRoot, SKILL_NAME, "SKILL.md"), SKILL_MD);

    sharedRoot = mkdtempSync(join(tmpdir(), "e2e-context-disabled-"));
    writeFileSync(join(sharedRoot, "output-format.md"), "# Output format\n");

    mockAapServer = await startMockAapServer(MOCK_AAP_PORT);

    const configPath = join(process.cwd(), "aap-mcp.yaml");
    const samplePath = join(process.cwd(), "aap-mcp.sample.yaml");
    if (!existsSync(configPath) && existsSync(samplePath)) {
      copyFileSync(samplePath, configPath);
      createdConfig = true;
    }

    process.env.BASE_URL = `http://localhost:${MOCK_AAP_PORT}`;
    process.env.MCP_PORT = String(MCP_SERVER_PORT);
    process.env.SKILLS_PATH = skillsRoot;
    process.env.SHARED_CONTEXT_PATH = sharedRoot;
    delete process.env.SKILLS_ENABLED;

    await import("../src/index.js");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 30000);

  afterAll(async () => {
    if (mockAapServer) {
      await new Promise<void>((resolve) =>
        mockAapServer.close(() => resolve()),
      );
    }
    rmSync(skillsRoot, { recursive: true, force: true });
    rmSync(sharedRoot, { recursive: true, force: true });
    if (createdConfig) {
      rmSync(join(process.cwd(), "aap-mcp.yaml"), { force: true });
    }
  }, 10000);

  it("false is the default, so an unset value serves no tools fewer", async () => {
    const message = await call("tools/list");

    expect(message.error).toBeUndefined();
    expect(message.result.tools.length).toBeGreaterThan(0);
  });

  it("behaves as though the feature does not exist", async () => {
    const result = (await call("server/discover")).result;

    expect(
      result.capabilities.extensions?.["io.modelcontextprotocol/skills"],
    ).toBeUndefined();
    expect(result.capabilities.resources).toBeUndefined();
    expect(result.instructions).toBeUndefined();
  });

  it("serves neither the skill nor the shared document", async () => {
    expect((await call("skills/list")).error?.code).toBe(-32601);

    const skill = await call("resources/read", {
      uri: `skill://aap/${SKILL_NAME}/SKILL.md`,
    });
    const shared = await call("resources/read", {
      uri: "aap://context/output-format.md",
    });

    expect(skill.error).toBeDefined();
    expect(shared.error).toBeDefined();
  });
});
