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
import { load as yamlLoad } from "js-yaml";
import {
  BEARER_TOKEN,
  mcpCall,
  parseJsonRpcResponse,
  startMockAapServer,
} from "./helpers/mock-aap.js";

// What only breaks on the wire: result shapes, the capability declaration, and
// the two checks a conforming host runs before loading a skill — digest
// agreement and frontmatter fidelity.

const MOCK_AAP_PORT = 18380;
const MCP_SERVER_PORT = 13300;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;

const SKILL_NAME = "aap-platform-health-check";
const SKILL_URI = `skill://aap/${SKILL_NAME}/SKILL.md`;
const REFERENCE_URI = `skill://aap/${SKILL_NAME}/references/sources.md`;

// Carries the constructs in the real ansible/aap-skills SKILL.md that a
// careless loader normalizes away.
const SKILL_MD = `---
# ─── agentskills.io Base Fields ───────────────────────────────────────────
name: ${SKILL_NAME}
description: |
  Run comprehensive health checks across all AAP components and produce
  an actionable diagnostics report.

  Use when: "Is my platform healthy?"
license: Apache-2.0
allowed-tools: >-
  status_retrieve mesh_visualizer_retrieve
  instances_retrieve
metadata:
  author: Red Hat
  version: "1.0.0"
riskLevel: read-only
aapVersion: ">=2.5"
---

# Platform Health Check

Body content, which is not frontmatter and must not appear in it.
`;

const REFERENCE_MD = "# Sources\n\nSupporting reference material.\n";

let mockAapServer: Server;
let skillsRoot: string;
let createdConfig = false;

const call = (method: string, params: Record<string, unknown> = {}) =>
  mcpCall(MCP_BASE_URL, method, params);

/** Handshake as a pre-2026-07-28 client, which answers over SSE. */
const legacyInitialize = async (): Promise<any> => {
  const response = await fetch(`${MCP_BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${BEARER_TOKEN}`,
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1000,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "legacy-skills-test", version: "1.0.0" },
      },
    }),
  });

  return parseJsonRpcResponse(response);
};

/** Fetch a resource's bytes, decoding whichever of text/blob came back. */
const readBytes = async (uri: string): Promise<Buffer> => {
  const message = await call("resources/read", { uri });
  expect(message.error).toBeUndefined();
  const content = message.result.contents[0];
  return "text" in content
    ? Buffer.from(content.text, "utf8")
    : Buffer.from(content.blob, "base64");
};

describe("End-to-End: SEP-2640 skills", () => {
  beforeAll(async () => {
    skillsRoot = mkdtempSync(join(tmpdir(), "e2e-skills-"));
    mkdirSync(join(skillsRoot, SKILL_NAME, "references"), { recursive: true });
    writeFileSync(join(skillsRoot, SKILL_NAME, "SKILL.md"), SKILL_MD);
    writeFileSync(
      join(skillsRoot, SKILL_NAME, "references", "sources.md"),
      REFERENCE_MD,
    );

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
    if (createdConfig) {
      rmSync(join(process.cwd(), "aap-mcp.yaml"), { force: true });
    }
  }, 10000);

  describe("capability declaration", () => {
    it("advertises the skills extension and pins resources.listChanged false", async () => {
      const message = await call("server/discover");
      const capabilities = message.result.capabilities;

      // directoryRead is not ours to choose: attach() derives it from whether
      // the catalog source implements readDirectory, and the Node source does.
      expect(
        capabilities.extensions?.["io.modelcontextprotocol/skills"],
      ).toEqual({ directoryRead: true });
      // We never send notifications/resources/list_changed, so the SDK
      // default of true would be a promise we do not keep.
      expect(capabilities.resources?.listChanged).toBe(false);
    });

    it("points at every served skill from the instructions field", async () => {
      // Contents are unit-tested; the half that cannot be is whether the
      // field survives to the wire at all.
      const message = await call("server/discover");

      expect(message.result.instructions).toContain(SKILL_URI);
    });

    it("carries the same pointer on the legacy initialize handshake", async () => {
      // server/discover and initialize build their results independently, so
      // one can lose the pointer without the other noticing.
      const message = await legacyInitialize();

      expect(message.result.instructions).toContain(SKILL_URI);
    });
  });

  describe("skills/list", () => {
    it("carries exactly the keys SEP-2640 defines, at both levels", async () => {
      const message = await call("skills/list");
      expect(message.error).toBeUndefined();
      expect(message.result.skills).toHaveLength(1);

      const entry = message.result.skills[0];
      // SEP-2640 puts name and description inside frontmatter. A top-level
      // copy is not part of the entry and must not leak onto the wire.
      expect(Object.keys(entry).sort()).toEqual([
        "frontmatter",
        "resources",
        "uri",
      ]);
      // SKILL_URI embeds SKILL_NAME, so together these also pin SEP-2640's
      // requirement that the path's final segment equal the frontmatter name.
      expect(entry.uri).toBe(SKILL_URI);
      expect(entry.frontmatter.name).toBe(SKILL_NAME);

      // An array of descriptors, never the string "dynamic".
      expect(entry.resources.map((r: any) => r.uri).sort()).toEqual(
        [SKILL_URI, REFERENCE_URI].sort(),
      );
      for (const resource of entry.resources) {
        expect(Object.keys(resource).sort()).toEqual(["digest", "size", "uri"]);
        expect(resource.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(resource.size).toBeGreaterThan(0);
      }
    });

    it("carries the cache hints configured on the catalog", async () => {
      // The hint defaults to 0/private, which would leave skills the only
      // uncacheable surface on the server.
      const result = (await call("skills/list")).result;
      expect(result.ttlMs).toBe(300_000);
      expect(result.cacheScope).toBe("public");
    });
  });

  describe("skills/get", () => {
    it("returns the entry inside a `skill` envelope", async () => {
      const message = await call("skills/get", { uri: SKILL_URI });
      expect(message.error).toBeUndefined();

      // Returning the entry inline round-trips against a hand-written client
      // and is still wrong: the reference client's schema requires the
      // envelope and rejects an inline entry rather than normalizing.
      expect(message.result.skill).toBeDefined();
      expect(message.result.skill.uri).toBe(SKILL_URI);
      expect(message.result.uri).toBeUndefined();
    });

    it("returns byte-for-byte the entry skills/list advertised", async () => {
      const listed = (await call("skills/list")).result.skills[0];
      const fetched = (await call("skills/get", { uri: SKILL_URI })).result
        .skill;
      expect(fetched).toEqual(listed);
    });

    it.each([
      ["a URI it does not serve", { uri: "skill://aap/nope/SKILL.md" }],
      ["no uri at all", {}],
    ])("errors on %s rather than returning nothing", async (_label, params) => {
      const message = await call("skills/get", params);
      expect(message.error).toBeDefined();
      expect(message.result).toBeUndefined();
    });
  });

  describe("resources/read", () => {
    it("serves bytes matching the advertised digest and size", async () => {
      const entry = (await call("skills/list")).result.skills[0];

      for (const resource of entry.resources) {
        const bytes = await readBytes(resource.uri);
        expect(bytes.byteLength).toBe(resource.size);
        expect(
          `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        ).toBe(resource.digest);
      }
    });

    it.each([
      `skill://aap/${SKILL_NAME}/../../../etc/passwd`,
      `skill://aap/${SKILL_NAME}/%2e%2e/%2e%2e/etc/passwd`,
      "skill://aap/../../etc/passwd",
      "file:///etc/passwd",
    ])("refuses to read %s", async (uri) => {
      const message = await call("resources/read", { uri });
      expect(message.error).toBeDefined();
      expect(message.result).toBeUndefined();
    });
  });

  describe("frontmatter fidelity", () => {
    // SEP-2640's load-bearing MUST: a host re-parses the fetched SKILL.md and
    // compares frontmatter field-by-field against the advertised entry, so a
    // helpful normalization in the loader silently breaks every host.
    //
    // The second test is not redundant: equality only shows the SDK agrees
    // with js-yaml. Were it normalizing the bytes it serves as well as the
    // frontmatter it advertises, both would shift together and still match.
    it("re-parsing the served SKILL.md reproduces the advertised frontmatter", async () => {
      const entry = (await call("skills/list")).result.skills[0];
      const served = (await readBytes(SKILL_URI)).toString("utf8");

      const lines = served.split("\n");
      const end = lines.findIndex(
        (line, i) => i > 0 && line.trimEnd() === "---",
      );
      const reparsed = yamlLoad(lines.slice(1, end).join("\n"));

      expect(reparsed).toEqual(entry.frontmatter);
    });

    it("keeps scalar styles and quoted versions as YAML read them", async () => {
      const frontmatter = (await call("skills/list")).result.skills[0]
        .frontmatter;

      // Literal block scalar: newlines survive.
      expect(frontmatter.description).toContain("components and produce\nan");
      // Folded scalar: one space-separated string, not an array of tools.
      expect(frontmatter["allowed-tools"]).toBe(
        "status_retrieve mesh_visualizer_retrieve instances_retrieve",
      );
      // Quoted version stays a string; unquoted stays whatever YAML made it.
      expect(frontmatter.metadata.version).toBe("1.0.0");
      expect(frontmatter.aapVersion).toBe(">=2.5");
      expect(JSON.stringify(frontmatter)).not.toContain("Body content");
    });
  });

  describe("resources/list", () => {
    it("lists one entry point per skill, not every file", async () => {
      // Reference files stay reachable through the skill:// template but are
      // not enumerated, so a client that never reads SKILL.md never learns one
      // exists: a skill has to cite its own.
      const message = await call("resources/list");
      expect(message.error).toBeUndefined();

      const uris = message.result.resources.map((r: any) => r.uri);
      expect(uris).toEqual([SKILL_URI]);
      expect(uris).not.toContain(REFERENCE_URI);
    });
  });

  describe("no regression in tools", () => {
    it("still serves tools alongside skills", async () => {
      const message = await call("tools/list");
      expect(message.error).toBeUndefined();
      expect(message.result.tools.length).toBeGreaterThan(0);
    });
  });
});
