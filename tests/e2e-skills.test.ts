import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";
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

// SEP-2640 skills served over HTTP, end to end.
//
// Catalog construction belongs to the SDK; the pointer built from it is
// covered by src/skills-instructions.test.ts. This file covers what only
// breaks on the wire: result shapes, the capability declaration, and the two
// checks a conforming host runs before loading a skill — digest agreement and
// frontmatter fidelity. A loader can be perfect and the server still unusable
// if skills/get answers in the wrong envelope.

const MOCK_AAP_PORT = 18380;
const MCP_SERVER_PORT = 13300;
const MCP_BASE_URL = `http://localhost:${MCP_SERVER_PORT}`;
const BEARER_TOKEN = "test-bearer-token";

const MODERN_VERSION = "2026-07-28";
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_META_KEY =
  "io.modelcontextprotocol/clientCapabilities";

const SKILL_NAME = "aap-platform-health-check";
const SKILL_URI = `skill://aap/${SKILL_NAME}/SKILL.md`;
const REFERENCE_URI = `skill://aap/${SKILL_NAME}/references/sources.md`;

/**
 * A fixture carrying the constructs in the real ansible/aap-skills SKILL.md
 * that a careless loader normalizes away.
 */
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
// Only clean up the config this file wrote: a developer's own must survive.
let createdConfig = false;

const modernEnvelope = () => ({
  [PROTOCOL_VERSION_META_KEY]: MODERN_VERSION,
  [CLIENT_CAPABILITIES_META_KEY]: {},
});

/** Methods whose body param the modern era mirrors into the Mcp-Name header. */
const MCP_NAME_HEADER_SOURCE: Record<string, string> = {
  "resources/read": "uri",
  "tools/call": "name",
};

let nextId = 1;

/**
 * Issue a modern-era JSON-RPC call and return the decoded message. The modern
 * transport requires headers and body to agree, so Mcp-Method is always sent
 * and Mcp-Name mirrored for the spec methods carrying a target. Custom methods
 * (skills/*) are not name-checked.
 */
const call = async (
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${BEARER_TOKEN}`,
    "mcp-protocol-version": MODERN_VERSION,
    "mcp-method": method,
  };
  const nameSource = MCP_NAME_HEADER_SOURCE[method];
  if (nameSource && typeof params[nameSource] === "string") {
    headers["mcp-name"] = params[nameSource] as string;
  }

  const response = await fetch(`${MCP_BASE_URL}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params: { ...params, _meta: modernEnvelope() },
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
      id: nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "legacy-skills-test", version: "1.0.0" },
      },
    }),
  });

  const text = await response.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error(`No SSE data frame in response: ${text}`);
  return JSON.parse(dataLine.slice("data:".length).trim());
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

const startMockAapServer = (): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const pathname = parseUrl(req.url || "", true).pathname || "";
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === "/api/gateway/v1/me/") {
        if (!req.headers["authorization"]?.startsWith("Bearer ")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "no creds" }));
          return;
        }
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

describe("End-to-End: SEP-2640 skills", () => {
  beforeAll(async () => {
    skillsRoot = mkdtempSync(join(tmpdir(), "e2e-skills-"));
    mkdirSync(join(skillsRoot, SKILL_NAME, "references"), { recursive: true });
    writeFileSync(join(skillsRoot, SKILL_NAME, "SKILL.md"), SKILL_MD);
    writeFileSync(
      join(skillsRoot, SKILL_NAME, "references", "sources.md"),
      REFERENCE_MD,
    );

    mockAapServer = await startMockAapServer();

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
      // the catalog source implements readDirectory, and the Node source
      // does. Declining it would mean not using the catalog.
      expect(
        capabilities.extensions?.["io.modelcontextprotocol/skills"],
      ).toEqual({ directoryRead: true });
      // Resources are registered statically and we never send
      // notifications/resources/list_changed, so the SDK default of true
      // would be a promise we do not keep.
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
      // one can lose the pointer without the other noticing — and a client
      // old enough to handshake is the one least likely to know SEP-2640.
      const message = await legacyInitialize();

      expect(message.result.instructions).toContain(SKILL_URI);
    });
  });

  describe("skills/list", () => {
    it("returns entries shaped uri/frontmatter/resources and nothing else", async () => {
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
    });

    it("lists resources as an array of uri/digest/size, never 'dynamic'", async () => {
      const entry = (await call("skills/list")).result.skills[0];

      expect(Array.isArray(entry.resources)).toBe(true);
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
      // The body is not frontmatter.
      expect(JSON.stringify(frontmatter)).not.toContain("Body content");
    });
  });

  describe("resources/list", () => {
    it("lists one entry point per skill, not every file", async () => {
      // Reference files stay reachable through the skill:// template (the
      // digest test above reads REFERENCE_URI) but are not enumerated. That
      // is progressive disclosure by design, and the consequence is an
      // authoring constraint rather than a serving bug: a client that never
      // reads SKILL.md never learns a reference file exists, so a skill has
      // to cite its own.
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
