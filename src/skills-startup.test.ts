import { describe, it, expect } from "vitest";
import type { SkillCatalog } from "@modelcontextprotocol/server/ext/skills";
import {
  classifySkillWarnings,
  formatSkillsReport,
  parseBooleanOrWarn,
  type ClassifiedWarnings,
} from "./skills-startup.js";

const catalogOf = (...names: string[]) =>
  ({
    entries: names.map((name) => ({ uri: `skill://aap/${name}/SKILL.md` })),
  }) as unknown as SkillCatalog;

const noWarnings: ClassifiedWarnings = { catalog: [], skipped: [], served: [] };

describe("parseBooleanOrWarn", () => {
  it.each([
    ["true", true],
    ["  FALSE  ", false],
    // Unquoted in YAML, so js-yaml hands over a boolean rather than a string.
    [false, false],
    [undefined, true],
    ["   ", true],
  ])("reads %s as %s", (raw, expected) => {
    expect(parseBooleanOrWarn("skills_instructions", raw, true)).toEqual({
      value: expected,
    });
  });

  it("reports an unrecognised value instead of silently defaulting", () => {
    const { value, warning } = parseBooleanOrWarn(
      "skills_instructions",
      "on",
      true,
    );

    expect(value).toBe(true);
    expect(warning).toContain('skills_instructions="on"');
    expect(warning).toContain("Falling back to true");
  });

  it("stays false when skills_enabled is mistyped", () => {
    // Reaches the server through the installers' unvalidated pass-through.
    const { value, warning } = parseBooleanOrWarn(
      "skills_enabled",
      "yes",
      false,
    );

    expect(value).toBe(false);
    expect(warning).toContain('skills_enabled="yes"');
    expect(warning).toContain("accepted: true, false");
    expect(warning).toContain("Falling back to false");
  });
});

describe("classifySkillWarnings", () => {
  it("separates a skipped skill from one served despite a warning", () => {
    // Structural, because warnings carry no severity: exceeding the SEP-2640
    // limits warns and still serves, while a bad name does not.
    const warnings = [
      { path: "oversized/SKILL.md", message: "exceeds the limit of 512 files" },
      { path: "bad-name/SKILL.md", message: "frontmatter name must match" },
    ];

    const classified = classifySkillWarnings(warnings, catalogOf("oversized"));

    expect(classified.served.map((w) => w.path)).toEqual([
      "oversized/SKILL.md",
    ]);
    expect(classified.skipped.map((w) => w.path)).toEqual([
      "bad-name/SKILL.md",
    ]);
    expect(classified.catalog).toEqual([]);
  });

  it("does not count a catalog-level problem as a skipped skill", () => {
    const warnings = [{ path: ".", message: "no skills found" }];

    const classified = classifySkillWarnings(warnings, undefined);

    expect(classified.catalog).toEqual(warnings);
    expect(classified.skipped).toEqual([]);
  });
});

describe("formatSkillsReport", () => {
  it("says skills are disabled, naming the setting that turns them on", () => {
    const lines = formatSkillsReport({
      enabled: false,
      skillsPath: "/app/skills",
      catalog: undefined,
      warnings: noWarnings,
    });

    expect(lines).toEqual(["Skills: disabled (skills_enabled is false)"]);
  });

  it("separates enabled-but-empty from disabled, which look alike otherwise", () => {
    const lines = formatSkillsReport({
      enabled: true,
      skillsPath: "/app/skills",
      catalog: undefined,
      warnings: noWarnings,
    });

    expect(lines).toEqual(["Skills: ENABLED but none loaded from /app/skills"]);
  });

  it("reports a path it could not read as a failure, not as an empty one", () => {
    const lines = formatSkillsReport({
      enabled: true,
      skillsPath: "/opt/skills",
      catalog: undefined,
      loadError: "cannot be listed: ENOENT",
      warnings: noWarnings,
    });

    expect(lines[0]).toContain("FAILED to load from /opt/skills");
    expect(lines[1]).toContain("ENOENT");
  });

  it("reports a readable path with nothing in it", () => {
    const lines = formatSkillsReport({
      enabled: true,
      skillsPath: "/opt/skills",
      catalog: undefined,
      warnings: {
        ...noWarnings,
        catalog: [{ path: ".", message: "no skills found" }],
      },
    });

    expect(lines).toEqual([
      "Skills: ENABLED but none loaded from /opt/skills",
      "  ! no skills found",
    ]);
  });

  it("names every served skill, then its skips and its warnings apart", () => {
    const lines = formatSkillsReport({
      enabled: true,
      skillsPath: "/opt/skills",
      catalog: catalogOf("good", "oversized"),
      warnings: {
        catalog: [],
        skipped: [
          { path: "bad/SKILL.md", message: "malformed" },
          { path: "worse/SKILL.md", message: "malformed" },
        ],
        served: [{ path: "oversized", message: "exceeds the limit" }],
      },
    });

    expect(lines).toEqual([
      "Skills: 2 loaded from /opt/skills",
      "  ✓ skill://aap/good/SKILL.md",
      "  ✓ skill://aap/oversized/SKILL.md",
      "  2 skills SKIPPED and NOT served:",
      "  ✗ bad/SKILL.md: malformed",
      "  ✗ worse/SKILL.md: malformed",
      "  1 warning, still served:",
      "  ! oversized: exceeds the limit",
    ]);
  });
});
