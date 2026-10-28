import type { SkillCatalog } from "@modelcontextprotocol/server/ext/skills";

// SEP-2640 calls `instructions` "practically bounded in size", so the pointer
// must stay a pointer. Trigger conditions are the part worth the bytes.
const INSTRUCTION_DESCRIPTION_BUDGET = 400;

// Undefined for an empty catalog: a pointer to an unservable skill is worse
// than none, costing the model a call to be told the resource is missing.
export const buildSkillsInstructions = (
  catalog: SkillCatalog,
): string | undefined => {
  const skills = catalog.entries;
  if (skills.length === 0) return undefined;

  const entries = skills.map((skill) => {
    // Collapse to a single line: this lands in a prose block, and a skill's
    // description is frequently a multi-line YAML block scalar.
    const summary = (skill.frontmatter.description ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const trimmed =
      summary.length > INSTRUCTION_DESCRIPTION_BUDGET
        ? `${summary.slice(0, INSTRUCTION_DESCRIPTION_BUDGET).trimEnd()}…`
        : summary;
    return `- ${skill.uri}\n  ${trimmed}`;
  });

  return [
    `This server provides ${skills.length} AAP skill${
      skills.length === 1 ? "" : "s"
    }: documented procedures for platform tasks that are easy to answer`,
    "incompletely. A skill fixes the dimensions that must be checked and the",
    "thresholds that decide what counts as a problem.",
    "",
    "When a request matches one of the skills below, read it with",
    "resources/read and follow its procedure instead of improvising your own",
    "investigation. Each skill lists supporting files; read those the same way",
    "when its steps tell you to.",
    "",
    ...entries,
  ].join("\n");
};
