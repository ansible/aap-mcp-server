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
export const parseBooleanOrWarn = (
  name: string,
  raw: string | boolean | undefined,
  fallback: boolean,
): { value: boolean; warning?: string } => {
  // Unquoted in YAML this arrives already parsed; from the environment, and
  // from a quoted YAML value, it is a string.
  if (typeof raw === "boolean") return { value: raw };
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return { value: fallback };
  if (value === "true" || value === "false") {
    return { value: value === "true" };
  }
  return {
    value: fallback,
    warning:
      `${name}="${raw}" is not a recognised value (accepted: true, false). ` +
      `Falling back to ${fallback}.`,
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
  enabled: boolean,
  skillsPath: string,
  catalog: SkillCatalog | undefined,
  loadError: string | undefined,
): string[] => {
  if (!enabled) return ["Skills: disabled (skills_enabled is false)"];
  // ENABLED, because enabled and empty is a broken image, not a choice.
  if (loadError) {
    return [
      `Skills: ENABLED but FAILED to load from ${skillsPath}, serving without skills`,
      `  ✗ ${loadError}`,
    ];
  }
  if (!catalog) return [`Skills: ENABLED but none loaded from ${skillsPath}`];
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
  enabled: boolean;
  skillsPath: string;
  catalog: SkillCatalog | undefined;
  loadError?: string;
  warnings: ClassifiedWarnings;
}): string[] => {
  const { enabled, skillsPath, catalog, loadError, warnings } = input;
  const { skipped, served } = warnings;

  return [
    ...headerLines(enabled, skillsPath, catalog, loadError),
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
