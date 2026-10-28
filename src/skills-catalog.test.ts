import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@modelcontextprotocol/server/ext/skills/node";

// SDK behaviour, not ours: these pin what the wiring and the docs assume, so
// an SDK bump that changes it fails here rather than in production.

let root: string;
let outside: string;

const writeSkill = (name: string, extra: () => void = () => undefined) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: A skill.\n---\n\nBody\n`,
  );
  extra();
  return dir;
};

const load = (onWarning: (w: { path: string; message: string }) => void) =>
  loadSkills(root, { prefix: "aap", onWarning });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-catalog-test-"));
  outside = mkdtempSync(join(tmpdir(), "skills-catalog-outside-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("path containment at catalog build time", () => {
  // The catalog assigns files to skills by path prefix over a walked tree, so
  // no path comes from untrusted input and there is nothing to traverse at
  // build time. Symlinks are the only way in from outside the tree.

  it("drops a skill whose symlink escapes, and only that skill", async () => {
    // Also why we take the default skip-with-warning over `strict`: one bad
    // skill must not cost the server its other skills, nor its tools.
    writeFileSync(join(outside, "secret.md"), "# Secret\n");
    writeSkill("good-skill");
    writeSkill("escaping-skill", () =>
      symlinkSync(
        join(outside, "secret.md"),
        join(root, "escaping-skill", "leak.md"),
      ),
    );

    const warnings: { path: string; message: string }[] = [];
    const catalog = await load((w) => warnings.push(w));

    expect(catalog.entries.map((entry) => entry.uri)).toEqual([
      "skill://aap/good-skill/SKILL.md",
    ]);
    expect(warnings.map((w) => w.message).join(" ")).toContain("not followed");
  });

  it("drops the skill even when the symlink target is inside it", async () => {
    // The rule is absolute, not a containment check — the opposite of what
    // "containment" would imply, and the reason shared content has to be
    // copied into each skill rather than linked (AAP-99041).
    writeSkill("linking-skill", () => {
      const dir = join(root, "linking-skill");
      writeFileSync(join(dir, "real.md"), "# Real\n");
      symlinkSync(join(dir, "real.md"), join(dir, "alias.md"));
    });

    const warnings: { path: string; message: string }[] = [];
    const catalog = await load((w) => warnings.push(w));

    expect(catalog.entries).toHaveLength(0);
    expect(warnings.map((w) => w.message).join(" ")).toContain(
      "copy the file instead",
    );
  });
});

describe("SEP-2640 per-skill limits", () => {
  it("warns past 512 files but still serves the skill", async () => {
    // Exceeding the limits does NOT skip the skill, so the failure lands at a
    // conforming host rather than here.
    writeSkill("oversized-skill", () => {
      const dir = join(root, "oversized-skill");
      for (let i = 0; i < 600; i++) {
        writeFileSync(join(dir, `f${String(i).padStart(4, "0")}.md`), "# F\n");
      }
    });

    const warnings: { path: string; message: string }[] = [];
    const catalog = await load((w) => warnings.push(w));

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0].resources.length).toBeGreaterThan(512);

    const message = warnings.map((w) => w.message).join(" ");
    expect(message).toContain("exceeds the limit of 512 files");
    expect(message).toContain("16777216 bytes");
    expect(message).toContain("some hosts may decline it");
  });

  it("counts bytes against the 16 MiB limit, not just file count", async () => {
    // Lowered limit rather than writing 16 MiB to disk on every run.
    writeSkill("heavy-skill", () =>
      writeFileSync(join(root, "heavy-skill", "big.md"), "x".repeat(64 * 1024)),
    );

    const warnings: { path: string; message: string }[] = [];
    const catalog = await loadSkills(root, {
      prefix: "aap",
      limits: { files: 512, bytes: 32 * 1024 },
      onWarning: (w) => warnings.push(w),
    });

    expect(catalog.entries).toHaveLength(1);
    expect(warnings.map((w) => w.message).join(" ")).toContain(
      "exceeds the limit",
    );
  });
});
