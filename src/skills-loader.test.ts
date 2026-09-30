import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import {
  loadSkills,
  readCatalogFile,
  splitFrontmatter,
  MAX_RESOURCES_PER_SKILL,
  MAX_SKILL_BYTES,
} from "./skills-loader.js";

/**
 * The reference skill from ansible/aap-skills, reproduced verbatim enough to
 * exercise the YAML constructs that a naive loader mangles: a literal block
 * scalar (|) for description and a folded scalar with strip chomping (>-) for
 * allowed-tools.
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
id: aap-platform-health-check
version: 1.0.0
category: platform-operations
mcpToolDependencies:
  - server: aap
    tools: [status_retrieve, mesh_visualizer_retrieve]
riskLevel: read-only
sensitiveData: false
aapVersion: ">=2.5"
---

# Platform Health Check

Body content that is not frontmatter.
`;

let root: string;
const warnings: string[] = [];
const warn = (m: string) => warnings.push(m);

const writeSkill = (
  name: string,
  skillMd: string,
  extra: Record<string, string> = {},
) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMd);
  for (const [rel, content] of Object.entries(extra)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-test-"));
  warnings.length = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("splitFrontmatter", () => {
  it("splits on a line that is exactly ---", () => {
    const r = splitFrontmatter(REFERENCE_SKILL_MD);
    expect(r).not.toBeNull();
    expect(r!.yaml).toContain("name: aap-platform-health-check");
    expect(r!.body).toContain("# Platform Health Check");
  });

  it("does not truncate on a --- inside the body", () => {
    const r = splitFrontmatter("---\nname: x\n---\nbody\n\n---\n\nmore body\n");
    expect(r!.yaml).toBe("name: x");
    expect(r!.body).toContain("more body");
  });

  it("returns null when there is no frontmatter", () => {
    expect(splitFrontmatter("# Just a heading\n")).toBeNull();
  });

  it("returns null when the frontmatter is unterminated", () => {
    expect(splitFrontmatter("---\nname: x\nno closing delimiter\n")).toBeNull();
  });
});

describe("loadSkills", () => {
  it("loads a well-formed skill with digests and byte sizes", () => {
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD, {
      "references/sources.md": "# Sources\n",
    });
    const catalog = loadSkills({ directory: root, warn });

    expect(warnings).toEqual([]);
    expect(catalog.skills).toHaveLength(1);

    const skill = catalog.skills[0];
    expect(skill.uri).toBe("skill://aap/aap-platform-health-check/SKILL.md");
    expect(skill.name).toBe("aap-platform-health-check");
    expect(skill.resources).toHaveLength(2);

    const uris = skill.resources.map((r) => r.uri);
    expect(uris).toContain("skill://aap/aap-platform-health-check/SKILL.md");
    expect(uris).toContain(
      "skill://aap/aap-platform-health-check/references/sources.md",
    );
  });

  it("advertises digests and sizes that match the bytes actually served", () => {
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD, {
      "references/sources.md": "# Sources\n",
    });
    const catalog = loadSkills({ directory: root, warn });

    for (const resource of catalog.skills[0].resources) {
      const contents = readCatalogFile(catalog, resource.uri);
      expect(contents).not.toBeNull();
      const bytes = Buffer.from(
        "text" in contents! ? contents.text : contents!.blob,
        "text" in contents! ? "utf8" : "base64",
      );
      expect(bytes.byteLength).toBe(resource.size);
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
        resource.digest,
      );
    }
  });

  // SEP-2640 requires a host to re-parse the fetched SKILL.md and compare its
  // frontmatter field-by-field against the entry's. Any discrepancy is a
  // verification failure equivalent to a digest mismatch. This is the test that
  // catches a well-meaning normalization in the loader.
  it("exposes frontmatter identical to a fresh parse of the served SKILL.md", () => {
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);
    const catalog = loadSkills({ directory: root, warn });
    const skill = catalog.skills[0];

    const served = readCatalogFile(catalog, skill.uri);
    expect(served).not.toBeNull();
    expect("text" in served!).toBe(true);

    const reparsed = yamlLoad(
      splitFrontmatter((served as { text: string }).text)!.yaml,
    );
    expect(reparsed).toEqual(skill.frontmatter);
  });

  it("preserves block and folded scalars without re-wrapping them", () => {
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);
    const skill = loadSkills({ directory: root, warn }).skills[0];

    // Literal block scalar keeps its newlines.
    expect(skill.frontmatter.description).toContain(
      "Run comprehensive health checks across all AAP components and produce\nan actionable",
    );
    // Folded scalar collapses to a single space-separated string, not an array.
    expect(typeof skill.frontmatter["allowed-tools"]).toBe("string");
    expect(skill.frontmatter["allowed-tools"]).toBe(
      "status_retrieve mesh_visualizer_retrieve instances_retrieve instance_groups_list activity_stream_list feature_flags_state_retrieve",
    );
  });

  it("emits resources as an array, never the string 'dynamic'", () => {
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);
    const skill = loadSkills({ directory: root, warn }).skills[0];
    expect(Array.isArray(skill.resources)).toBe(true);
  });

  it("honours a custom URI prefix and supports no prefix at all", () => {
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);
    expect(
      loadSkills({ directory: root, prefix: "redhat/aap", warn }).skills[0].uri,
    ).toBe("skill://redhat/aap/aap-platform-health-check/SKILL.md");
    expect(
      loadSkills({ directory: root, prefix: "", warn }).skills[0].uri,
    ).toBe("skill://aap-platform-health-check/SKILL.md");
  });
});

describe("loadSkills — failure handling", () => {
  it("returns an empty catalog for a missing directory without throwing", () => {
    const catalog = loadSkills({ directory: join(root, "nope"), warn });
    expect(catalog.skills).toEqual([]);
    expect(warnings[0]).toContain("does not exist");
  });

  it("returns an empty catalog for an empty directory", () => {
    expect(loadSkills({ directory: root, warn }).skills).toEqual([]);
  });

  it("skips a skill whose directory name does not match its frontmatter name", () => {
    writeSkill("wrong-directory-name", REFERENCE_SKILL_MD);
    expect(loadSkills({ directory: root, warn }).skills).toEqual([]);
    expect(warnings[0]).toContain("does not match its directory");
  });

  it("skips a skill with malformed YAML and keeps loading the others", () => {
    writeSkill("broken", "---\nname: [unclosed\n---\nbody\n");
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD);

    const catalog = loadSkills({ directory: root, warn });
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0].name).toBe("aap-platform-health-check");
    expect(warnings).toHaveLength(1);
  });

  it("skips a skill with no SKILL.md", () => {
    mkdirSync(join(root, "no-skill-md"), { recursive: true });
    expect(loadSkills({ directory: root, warn }).skills).toEqual([]);
    expect(warnings[0]).toContain("no SKILL.md");
  });

  it("skips a skill whose frontmatter is not a mapping", () => {
    writeSkill("scalar-fm", "---\njust a string\n---\nbody\n");
    expect(loadSkills({ directory: root, warn }).skills).toEqual([]);
    expect(warnings[0]).toContain("not a YAML mapping");
  });

  it("skips a skill missing a description", () => {
    writeSkill("no-desc", "---\nname: no-desc\n---\nbody\n");
    expect(loadSkills({ directory: root, warn }).skills).toEqual([]);
    expect(warnings[0]).toContain("no 'description'");
  });
});

describe("loadSkills — SEP-2640 limits", () => {
  const minimal = (name: string) =>
    `---\nname: ${name}\ndescription: test\n---\nbody\n`;

  it("accepts a skill at exactly the resource limit", () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < MAX_RESOURCES_PER_SKILL - 1; i++) {
      extra[`f${i}.md`] = "x";
    }
    writeSkill("at-limit", minimal("at-limit"), extra);

    const catalog = loadSkills({ directory: root, warn });
    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0].resources).toHaveLength(MAX_RESOURCES_PER_SKILL);
    expect(warnings).toEqual([]);
  });

  it("skips a skill one resource over the limit", () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < MAX_RESOURCES_PER_SKILL; i++) extra[`f${i}.md`] = "x";
    writeSkill("over-limit", minimal("over-limit"), extra);

    expect(loadSkills({ directory: root, warn }).skills).toEqual([]);
    expect(warnings[0]).toContain(
      `exceeds the SEP-2640 limit of ${MAX_RESOURCES_PER_SKILL}`,
    );
  });

  it("skips a skill over the total size limit", () => {
    writeSkill("too-big", minimal("too-big"), {
      "big.md": "x".repeat(MAX_SKILL_BYTES + 1),
    });
    expect(loadSkills({ directory: root, warn }).skills).toEqual([]);
    expect(warnings[0]).toContain("total size exceeds");
  });
});

describe("readCatalogFile — path safety", () => {
  beforeEach(() => {
    writeSkill("aap-platform-health-check", REFERENCE_SKILL_MD, {
      "references/sources.md": "# Sources\n",
    });
  });

  it("returns null for a URI that is not in the catalog", () => {
    const catalog = loadSkills({ directory: root, warn });
    expect(
      readCatalogFile(catalog, "skill://aap/aap-platform-health-check/nope.md"),
    ).toBeNull();
  });

  it.each([
    "skill://aap/aap-platform-health-check/../../../etc/passwd",
    "skill://aap/aap-platform-health-check/%2e%2e%2fetc%2fpasswd",
    "skill://aap/aap-platform-health-check//etc/passwd",
    "skill:///etc/passwd",
    "file:///etc/passwd",
  ])("rejects the traversal attempt %s", (uri) => {
    const catalog = loadSkills({ directory: root, warn });
    expect(readCatalogFile(catalog, uri)).toBeNull();
  });

  it("does not serve a skill containing a symlink that escapes its directory", () => {
    const outside = join(root, "outside-secret.txt");
    writeFileSync(outside, "secret");
    symlinkSync(outside, join(root, "aap-platform-health-check", "leak.md"));

    const catalog = loadSkills({ directory: root, warn });
    expect(catalog.skills).toEqual([]);
    expect(warnings[0]).toContain("outside the skill directory");
  });

  it("serves binary files as base64 blobs rather than mangled text", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(join(root, "aap-platform-health-check", "diagram.png"), png);
    const catalog = loadSkills({ directory: root, warn });
    const contents = readCatalogFile(
      catalog,
      "skill://aap/aap-platform-health-check/diagram.png",
    );
    expect(contents).not.toBeNull();
    expect("blob" in contents!).toBe(true);
    expect(Buffer.from((contents as { blob: string }).blob, "base64")).toEqual(
      png,
    );
  });
});

describe("loadSkills — against the real reference skill", () => {
  const realSkills = join(
    import.meta.dirname,
    "..",
    "..",
    "aap-skills",
    "skills",
  );

  // Integration check against a sibling checkout of ansible/aap-skills.
  // Skipped when that checkout is absent, so CI does not depend on it.
  it.skipIf(!existsSync(realSkills))(
    "loads ansible/aap-skills and round-trips its frontmatter",
    () => {
      const catalog = loadSkills({ directory: realSkills, warn });
      expect(catalog.skills.length).toBeGreaterThan(0);
      expect(warnings).toEqual([]);

      for (const skill of catalog.skills) {
        const served = readCatalogFile(catalog, skill.uri) as { text: string };
        const reparsed = yamlLoad(splitFrontmatter(served.text)!.yaml);
        expect(reparsed).toEqual(skill.frontmatter);
        expect(skill.uri.split("/").at(-2)).toBe(skill.name);
      }
    },
  );
});
