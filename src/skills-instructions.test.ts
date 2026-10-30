import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";
import { buildSkillsInstructions } from "./skills-instructions.js";

// `tools` is a block sequence rather than a flow sequence on purpose: the SDK
// parses frontmatter over a restricted subset and rejects a flow collection
// spanning lines.
const REFERENCE_SKILL_MD = `---
# ─── agentskills.io Base Fields ─────────────────────────────────────────────
name: aap-platform-health-check
description: |
  Run comprehensive health checks across all AAP components and produce
  an actionable diagnostics report with correlated analysis.

  Use when:
  - "Is my platform healthy?"
  - "Run diagnostics on my AAP"

  NOT for: remediation actions (recommend steps but do not execute).
license: Apache-2.0
allowed-tools: >-
  status_retrieve mesh_visualizer_retrieve instances_retrieve
  instance_groups_list activity_stream_list feature_flags_state_retrieve
metadata:
  author: Red Hat
  version: "1.0.0"
mcpToolDependencies:
  - server: aap
    tools:
      - status_retrieve
      - mesh_visualizer_retrieve
riskLevel: read-only
aapVersion: ">=2.5"
---

# Platform Health Check

Body content that is not frontmatter.
`;

let root: string;

const writeSkill = (name: string, skillMd: string) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMd);
  return dir;
};

const load = (prefix?: string) =>
  loadSkills(root, {
    ...(prefix ? { prefix } : {}),
    onWarning: () => {},
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-instructions-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildSkillsInstructions", () => {
  it("returns undefined for an empty catalog", async () => {
    expect(buildSkillsInstructions(await load())).toBeUndefined();
  });

  it("names every served skill by URI", async () => {
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);
    writeSkill(
      "aap-skill-creator",
      "---\nname: aap-skill-creator\ndescription: Create AAP skills.\n---\nBody\n",
    );

    const catalog = await load("aap");
    const instructions = buildSkillsInstructions(catalog);

    expect(catalog.entries).toHaveLength(2);
    expect(instructions).toBeDefined();
    for (const skill of catalog.entries) {
      expect(instructions).toContain(skill.uri);
    }
  });

  it("carries the trigger conditions, collapsed onto one line", async () => {
    // Asserted together because they fail together: trigger conditions arrive
    // in a block scalar whose newlines would break the one-entry-per-line list.
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);

    const instructions = buildSkillsInstructions(await load())!;

    const entry = instructions
      .split("\n")
      .find((line) => line.trim().startsWith("Run comprehensive"));
    expect(entry).toContain('"Is my platform healthy?"');
    expect(entry).toContain("NOT for: remediation actions");
  });

  it("truncates a description that would blow the instructions budget", async () => {
    // 900 rather than something arbitrarily large: Agent Skills caps
    // `description` at 1024 and the SDK enforces it, so a longer one is never
    // served, let alone truncated.
    writeSkill(
      "verbose-skill",
      `---\nname: verbose-skill\ndescription: ${"x".repeat(900)}\n---\nBody\n`,
    );

    const catalog = await load();
    expect(catalog.entries).toHaveLength(1);

    const instructions = buildSkillsInstructions(catalog)!;

    expect(instructions).toContain("…");
    expect(instructions.length).toBeLessThan(1000);
  });

  it("states how to address a skill's supporting files", async () => {
    // Without the rule a model synthesizes the join and was measured dropping
    // the skill segment (AAP-99041 Defect 2).
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);

    const instructions = buildSkillsInstructions(await load())!;

    expect(instructions).toContain("replace the final SKILL.md segment");
  });

  it("lists shared context as documents rather than capabilities", async () => {
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);

    const instructions = buildSkillsInstructions(await load(), [
      {
        uri: "aap://context/output-format.md",
        ref: "output-format.md",
        text: "# Output format\n",
        size: 16,
        digest: "sha256:abc",
        summary: "Report structure and markdown rules",
      },
    ])!;

    expect(instructions).toContain("aap://context/output-format.md");
    expect(instructions).toContain("Report structure and markdown rules");
    expect(instructions).toContain("not");
    expect(instructions).toContain("capabilities");
  });

  it("omits a skill the loader refused to serve", async () => {
    // The pointer must be built from the catalog, never a directory listing.
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);
    writeSkill(
      "mismatched",
      "---\nname: something-else\ndescription: Mismatched name.\n---\nBody\n",
    );

    const catalog = await load();
    const instructions = buildSkillsInstructions(catalog)!;

    expect(catalog.entries).toHaveLength(1);
    expect(instructions).not.toContain("mismatched");
    expect(instructions).not.toContain("something-else");
  });
});
