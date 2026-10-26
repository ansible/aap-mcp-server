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

/**
 * SDK catalog behaviour this server depends on.
 *
 * These are not tests of our code — the SDK owns the loader. They pin the
 * behaviour our wiring and our operator-facing documentation assume, so an SDK
 * bump that changes it fails here rather than in production. AAP-99339 asks
 * for exactly this: "everything the SDK provides is verified here rather than
 * built".
 */

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
  // AAP-99339 asks us to confirm containment holds "for the catalog build as
  // well as the read path". Reading the 2.4.0 source settles the shape of the
  // answer: the catalog is an enumeration of a walked tree, and a file belongs
  // to a skill by path prefix. No path is ever built from untrusted input, so
  // there is no traversal to defeat at build time — the read-path traversal
  // vectors in tests/e2e-skills.test.ts cover the half that takes input.
  //
  // That leaves exactly one way to pull content in from outside the tree, and
  // these tests pin it.

  it("drops the whole skill when a symlink escapes its directory", async () => {
    writeFileSync(join(outside, "secret.md"), "# Secret\n");
    writeSkill("escaping-skill", () =>
      symlinkSync(
        join(outside, "secret.md"),
        join(root, "escaping-skill", "leak.md"),
      ),
    );

    const warnings: { path: string; message: string }[] = [];
    const catalog = await load((w) => warnings.push(w));

    expect(catalog.entries).toHaveLength(0);
    expect(warnings.map((w) => w.message).join(" ")).toContain("not followed");
  });

  it("drops the skill even when the symlink target is inside it", async () => {
    // The rule is absolute, not a containment check. Worth pinning separately
    // because it is the opposite of what "containment" would imply, and
    // because it is the measured reason shared content has to be copied into
    // each skill rather than linked (AAP-99041).
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

  it("does not let one bad skill take out the rest of the catalog", async () => {
    // The reason we use the default skip-with-warning rather than `strict`:
    // one unreadable skill in a content directory must not cost the server its
    // other skills, and must not cost it its tools.
    writeFileSync(join(outside, "secret.md"), "# Secret\n");
    writeSkill("good-skill");
    writeSkill("escaping-skill", () =>
      symlinkSync(
        join(outside, "secret.md"),
        join(root, "escaping-skill", "leak.md"),
      ),
    );

    const catalog = await load(() => undefined);

    expect(catalog.entries.map((entry) => entry.uri)).toEqual([
      "skill://aap/good-skill/SKILL.md",
    ]);
  });
});

describe("SEP-2640 per-skill limits", () => {
  it("warns past 512 files but still serves the skill", async () => {
    // Deliberately asserting the surprising half. Exceeding the limits does
    // NOT skip the skill — the catalog is built and every resource served,
    // with a warning saying "some hosts may decline it". So the failure lands
    // at a conforming host rather than here, which is why the startup log
    // reports this separately from a skip instead of calling it "not served".
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
    // One file, well under the file limit, over the byte limit. Asserted with
    // a lowered limit rather than by writing 16 MiB to disk on every run.
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
