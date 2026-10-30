import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatSharedContextReport,
  loadSharedContext,
  type SharedContextWarning,
} from "./shared-context.js";

let root: string;

const write = (relativePath: string, text: string) => {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
  return full;
};

const load = (warnings: SharedContextWarning[] = []) =>
  loadSharedContext(root, { onWarning: (w) => warnings.push(w) });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shared-context-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loadSharedContext", () => {
  it("gives one document one URI, with a verifiable digest and size", async () => {
    // The whole point: copied into each skill the document has N addresses,
    // and a client's response cache is keyed on the URI.
    const text = "# Output format\n\nRules.\n";
    write("output-format.md", text);

    const [entry] = await load();

    expect(entry.uri).toBe("aap://context/output-format.md");
    const bytes = Buffer.from(text, "utf8");
    expect(entry.size).toBe(bytes.byteLength);
    expect(entry.digest).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
  });

  it("summarizes from frontmatter, falling back below it rather than into it", async () => {
    // The heading fallback must skip the frontmatter block: a YAML comment
    // line also starts with "#".
    write(
      "described.md",
      "---\ndescription: Report structure and markdown rules\n---\n\n# Output format\n",
    );
    write(
      "undescribed.md",
      "---\n# ─── Base Fields ───\nname: thing\n---\n\n# The Real Heading\n",
    );

    const summaries = (await load()).map((entry) => entry.summary);

    expect(summaries).toEqual([
      "Report structure and markdown rules",
      "The Real Heading",
    ]);
  });

  it("keeps nested paths in the URI so two files can share a name", async () => {
    write("reports/format.md", "# Reports\n");
    write("authoring/format.md", "# Authoring\n");

    expect((await load()).map((entry) => entry.uri)).toEqual([
      "aap://context/authoring/format.md",
      "aap://context/reports/format.md",
    ]);
  });

  it("serves markdown and nothing else", async () => {
    write("output-format.md", "# Output format\n");
    write("notes.pdf", "binary-ish");

    expect((await load()).map((entry) => entry.ref)).toEqual([
      "output-format.md",
    ]);
  });

  it("refuses a symlink and names it", async () => {
    // Matches the skills rule rather than resolving and checking containment:
    // refusing outright is what keeps a document inside the configured root.
    write("output-format.md", "# Output format\n");
    symlinkSync(join(root, "output-format.md"), join(root, "alias.md"));

    const warnings: SharedContextWarning[] = [];
    const entries = await load(warnings);

    expect(entries.map((entry) => entry.ref)).toEqual(["output-format.md"]);
    expect(warnings).toEqual([
      { path: "alias.md", message: "is a symlink and was not served" },
    ]);
  });

  it.each([
    ["a missing directory", "nope", "directory not found"],
    ["a path that is a file", "notes.md", "could not be read"],
  ])("serves nothing and warns for %s", async (_label, child, message) => {
    // Never a reason to fail startup: skills ship inside the image, so a
    // missing COPY must not cost the server its tools.
    write("notes.md", "# Notes\n");
    const warnings: SharedContextWarning[] = [];

    const entries = await loadSharedContext(join(root, child), {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(entries).toEqual([]);
    expect(warnings[0].message).toContain(message);
  });
});

describe("formatSharedContextReport", () => {
  it("reports nothing when no directory is configured", () => {
    expect(
      formatSharedContextReport({ path: "", entries: [], warnings: [] }),
    ).toEqual([]);
  });

  it("distinguishes a configured directory that is absent from an empty one", () => {
    // Same count either way, so the warning line is the only thing telling an
    // operator the image is missing a COPY.
    const empty = formatSharedContextReport({
      path: "/ctx",
      entries: [],
      warnings: [],
    });
    const absent = formatSharedContextReport({
      path: "/ctx",
      entries: [],
      warnings: [{ path: "/ctx", message: "directory not found" }],
    });

    expect(empty).toEqual(["Shared context: 0 documents from /ctx"]);
    expect(absent).toEqual([
      "Shared context: 0 documents from /ctx",
      "  ✗ /ctx: directory not found",
    ]);
  });

  it("names every served document with its size", async () => {
    write("output-format.md", "# Output format\n");

    const lines = formatSharedContextReport({
      path: root,
      entries: await load(),
      warnings: [],
    });

    expect(lines[0]).toBe(`Shared context: 1 document from ${root}`);
    expect(lines[1]).toBe("  ✓ aap://context/output-format.md (16B)");
  });
});
