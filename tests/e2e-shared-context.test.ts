import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { type Server } from "node:http";
import { createHash } from "node:crypto";
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

// Runs with skills_instructions off, the configuration that will outlive the
// pointer: shared context must stay reachable on base MCP alone, since skill
// content cites its absolute URI and nothing else supplies one.

const MOCK_AAP_PORT = 18382;
const MCP_SERVER_PORT = 13302;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;

const SKILL_NAME = "aap-platform-health-check";
const SHARED_URI = "aap://context/output-format.md";
const SHARED_MD =
  "---\ndescription: Report formatting standard.\n---\n\n# Output format\n\nRules every skill follows.\n";

let mockAapServer: Server;
let skillsRoot: string;
let sharedRoot: string;
let createdConfig = false;

const call = (method: string, params: Record<string, unknown> = {}) =>
  mcpCall(MCP_BASE_URL, method, params);

describe("End-to-End: shared context without the instructions pointer", () => {
  beforeAll(async () => {
    skillsRoot = mkdtempSync(join(tmpdir(), "e2e-shared-skills-"));
    mkdirSync(join(skillsRoot, SKILL_NAME), { recursive: true });
    writeFileSync(
      join(skillsRoot, SKILL_NAME, "SKILL.md"),
      `---\nname: ${SKILL_NAME}\ndescription: Check platform health.\n---\n\nRead ${SHARED_URI} for the report format.\n`,
    );

    sharedRoot = mkdtempSync(join(tmpdir(), "e2e-shared-context-"));
    writeFileSync(join(sharedRoot, "output-format.md"), SHARED_MD);

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
    process.env.SKILLS_INSTRUCTIONS = "off";

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

  it("stays reachable with the pointer switched off", async () => {
    const discover = (await call("server/discover")).result;
    expect(discover.instructions).toBeUndefined();

    const message = await call("resources/read", { uri: SHARED_URI });
    expect(message.error).toBeUndefined();
    expect(message.result.contents[0].text).toBe(SHARED_MD);
  });

  it("advertises a digest and size a client can verify the bytes against", async () => {
    const resources = (await call("resources/list")).result.resources;
    const descriptor = resources.find((r: any) => r.uri === SHARED_URI);

    const bytes = Buffer.from(SHARED_MD, "utf8");
    expect(descriptor.size).toBe(bytes.byteLength);
    expect(descriptor._meta.digest).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
    expect(descriptor.description).toBe("Report formatting standard.");
  });

  it("is listed as a resource but never offered as a skill", async () => {
    // It is reference material. In skills/list a client would match a user's
    // request against it.
    const skills = (await call("skills/list")).result.skills;

    expect(skills.map((s: any) => s.uri)).not.toContain(SHARED_URI);
    expect(skills).toHaveLength(1);
  });

  it("still serves tools and skills alongside it", async () => {
    expect((await call("tools/list")).result.tools.length).toBeGreaterThan(0);
    expect(
      (await call("skills/get", { uri: `skill://aap/${SKILL_NAME}/SKILL.md` }))
        .result.skill,
    ).toBeDefined();
  });
});
