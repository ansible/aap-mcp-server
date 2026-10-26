import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";
import { buildSkillsInstructions } from "./skills-instructions.js";

/**
 * A reference skill close enough to ansible/aap-skills to exercise the YAML the
 * pointer has to survive: a literal block scalar (|) for description, a folded
 * scalar with strip chomping (>-) for allowed-tools, a comment, and a nested
 * mapping.
 *
 * `tools` is a block sequence rather than a flow sequence on purpose. The SDK
 * reads frontmatter with a hand-rolled parser over the restricted subset skills
 * actually use, and rejects a flow collection spanning lines rather than risk
 * parsing it differently from a full YAML parser — SEP-2640 makes a host
 * re-parse SKILL.md and compare frontmatter field by field, so cross-parser
 * disagreement is a verification failure. ansible/aap-skills#11 moved the real
 * content into this subset and added CI to keep it there.
 */
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

/** Load with warnings swallowed: these tests assert on output, not on logs. */
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
    // Nothing to point at: advertising skills we do not serve would send a
    // model after URIs that answer ResourceNotFound.
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

  it("carries the trigger conditions a model matches a prompt against", async () => {
    // The whole mechanism rests on this: the description is what lets a model
    // connect "is my platform healthy?" to this skill with no discovery round
    // trip. Dropping to name-only would quietly defeat the feature.
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);

    const instructions = buildSkillsInstructions(await load())!;

    expect(instructions).toContain('"Is my platform healthy?"');
    expect(instructions).toContain("NOT for: remediation actions");
  });

  it("collapses a multi-line description onto one line", async () => {
    // Descriptions are routinely literal block scalars. Emitted raw, their
    // newlines break the one-entry-per-line shape of the list.
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);

    const instructions = buildSkillsInstructions(await load())!;

    const entry = instructions
      .split("\n")
      .find((line) => line.trim().startsWith("Run comprehensive"));
    expect(entry).toBeDefined();
    expect(entry).toContain("Use when:");
  });

  it("truncates a description that would blow the instructions budget", async () => {
    // SEP-2640 calls `instructions` practically bounded in size and cites that
    // bound as a reason skills exist at all. The pointer has to stay a pointer.
    //
    // 900 characters rather than something arbitrarily large: the Agent Skills
    // specification caps `description` at 1024 and the SDK enforces it, so a
    // skill with a 5000-character description is never truncated here — it is
    // never served at all. 900 is the case this actually guards.
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

  it("omits a skill the loader refused to serve", async () => {
    // A pointer to an unservable skill is worse than no pointer: the model
    // spends a call to be told the resource does not exist. The SDK skips a
    // skill whose directory name and frontmatter name disagree, so the pointer
    // must be built from what the catalog holds, never from a directory listing.
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
