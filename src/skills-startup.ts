import type { SkillCatalog } from "@modelcontextprotocol/server/ext/skills";

export interface SkillWarning {
  path: string;
  message: string;
}

export interface ClassifiedWarnings {
  /** Problems with the catalog root rather than with any one skill. */
  catalog: SkillWarning[];
  skipped: SkillWarning[];
  /** Served in spite of a warning — exceeding the SEP-2640 limits. */
  served: SkillWarning[];
}

// Reports an unrecognised value rather than silently defaulting: these arrive
// through the installers' generic pass-through, which does not schema-validate,
// so this is the only place a typo can surface.
export const parseOnOff = (
  name: string,
  raw: string | undefined,
  fallback: boolean,
): { value: boolean; warning?: string } => {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return { value: fallback };
  if (value === "on" || value === "off") return { value: value === "on" };
  return {
    value: fallback,
    warning:
      `${name}="${raw}" is not a recognised value (accepted: "on", "off"). ` +
      `Falling back to "${fallback ? "on" : "off"}".`,
  };
};

const skillDirOf = (path: string): string => path.split("/")[0];

// Warnings carry no severity, so classify structurally — by whether the skill
// reached the catalog — rather than by matching message text.
export const classifySkillWarnings = (
  warnings: SkillWarning[],
  catalog: SkillCatalog | undefined,
): ClassifiedWarnings => {
  const servedDirs = new Set(
    (catalog?.entries ?? []).map((entry) => entry.uri.split("/").at(-2)),
  );
  const perSkill = warnings.filter((warning) => warning.path !== ".");
  return {
    catalog: warnings.filter((warning) => warning.path === "."),
    skipped: perSkill.filter(
      (warning) => !servedDirs.has(skillDirOf(warning.path)),
    ),
    served: perSkill.filter((warning) =>
      servedDirs.has(skillDirOf(warning.path)),
    ),
  };
};

const plural = (count: number): string => (count === 1 ? "" : "s");

const headerLines = (
  skillsPath: string,
  catalog: SkillCatalog | undefined,
  loadError: string | undefined,
): string[] => {
  if (!skillsPath) {
    return ["Skills: disabled (no skills_path / SKILLS_PATH configured)"];
  }
  if (loadError) {
    return [
      `Skills: FAILED to load from ${skillsPath}, serving without skills`,
      `  ✗ ${loadError}`,
    ];
  }
  if (!catalog) return [`Skills: none loaded from ${skillsPath}`];
  return [
    `Skills: ${catalog.entries.length} loaded from ${skillsPath}`,
    ...catalog.entries.map((entry) => `  ✓ ${entry.uri}`),
  ];
};

const warningLines = (
  warnings: SkillWarning[],
  heading: string,
  mark: string,
): string[] =>
  warnings.length === 0
    ? []
    : [heading, ...warnings.map((w) => `  ${mark} ${w.path}: ${w.message}`)];

export const formatSkillsReport = (input: {
  skillsPath: string;
  catalog: SkillCatalog | undefined;
  loadError?: string;
  warnings: ClassifiedWarnings;
}): string[] => {
  const { skillsPath, catalog, loadError, warnings } = input;
  const { skipped, served } = warnings;

  return [
    ...headerLines(skillsPath, catalog, loadError),
    ...warnings.catalog.map((warning) => `  ! ${warning.message}`),
    ...warningLines(
      skipped,
      `  ${skipped.length} skill${plural(skipped.length)} SKIPPED and NOT served:`,
      "✗",
    ),
    ...warningLines(
      served,
      `  ${served.length} warning${plural(served.length)}, still served:`,
      "!",
    ),
  ];
};
