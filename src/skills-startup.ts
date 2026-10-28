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
