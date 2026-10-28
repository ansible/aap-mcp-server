/**
 * Startup-time skills bookkeeping: reading an on/off setting, sorting loader
 * warnings into skips and non-skips, and rendering the startup report. Pure,
 * so the failure paths can be tested without booting a server.
 */

import type { SkillCatalog } from "@modelcontextprotocol/server/ext/skills";

export interface SkillWarning {
  path: string;
  message: string;
}

export interface ClassifiedWarnings {
  /** Problems with the catalog root rather than with any one skill. */
  catalog: SkillWarning[];
  /** Skills that never reached the catalog and are not served. */
  skipped: SkillWarning[];
  /** Skills served in spite of a warning — exceeding the SEP-2640 limits. */
  served: SkillWarning[];
}

// Parse an on/off setting. Reports an unrecognised value rather than silently
// defaulting: these arrive through the installers' generic pass-through, which
// does not schema-validate, so this is the only place a typo can surface.
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
// reached the catalog — rather than by matching message text. Exceeding the
// SEP-2640 limits only warns, and the skill is still served.
export const classifySkillWarnings = (
  warnings: SkillWarning[],
  catalog: SkillCatalog | undefined,
): ClassifiedWarnings => {
  const servedDirs = new Set(
    (catalog?.entries ?? []).map((entry) => entry.uri.split("/").at(-2)),
  );
  // Catalog-level problems are reported against ".", which is no skill's
  // directory and must not be counted as a skipped skill.
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

/** The `Skills:` block of the startup banner, one string per line. */
export const formatSkillsReport = (input: {
  skillsPath: string;
  catalog: SkillCatalog | undefined;
  loadError?: string;
  warnings: ClassifiedWarnings;
}): string[] => {
  const { skillsPath, catalog, loadError, warnings } = input;
  const lines: string[] = [];

  if (!skillsPath) {
    lines.push("Skills: disabled (no skills_path / SKILLS_PATH configured)");
  } else if (loadError) {
    lines.push(
      `Skills: FAILED to load from ${skillsPath}, serving without skills`,
    );
    lines.push(`  ✗ ${loadError}`);
  } else if (!catalog) {
    lines.push(`Skills: none loaded from ${skillsPath}`);
  } else {
    lines.push(`Skills: ${catalog.entries.length} loaded from ${skillsPath}`);
    for (const entry of catalog.entries) {
      lines.push(`  ✓ ${entry.uri}`);
    }
  }

  for (const warning of warnings.catalog) {
    lines.push(`  ! ${warning.message}`);
  }
  if (warnings.skipped.length > 0) {
    const plural = warnings.skipped.length === 1 ? "" : "s";
    lines.push(
      `  ${warnings.skipped.length} skill${plural} SKIPPED and NOT served:`,
    );
    for (const warning of warnings.skipped) {
      lines.push(`  ✗ ${warning.path}: ${warning.message}`);
    }
  }
  if (warnings.served.length > 0) {
    const plural = warnings.served.length === 1 ? "" : "s";
    lines.push(`  ${warnings.served.length} warning${plural}, still served:`);
    for (const warning of warnings.served) {
      lines.push(`  ! ${warning.path}: ${warning.message}`);
    }
  }

  return lines;
};
