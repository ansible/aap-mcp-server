import type { SkillCatalog } from "@modelcontextprotocol/server/ext/skills";
import type { SharedContextEntry } from "./shared-context.js";

// SEP-2640 calls `instructions` "practically bounded in size", so the pointer
// must stay a pointer. Trigger conditions are the part worth the bytes.
const INSTRUCTION_DESCRIPTION_BUDGET = 400;

// Collapse to a single line: this lands in a prose block, and a skill's
// description is frequently a multi-line YAML block scalar.
const cap = (text: string): string => {
  const summary = text.replace(/\s+/g, " ").trim();
  return summary.length > INSTRUCTION_DESCRIPTION_BUDGET
    ? `${summary.slice(0, INSTRUCTION_DESCRIPTION_BUDGET).trimEnd()}…`
    : summary;
};

// Undefined for an empty catalog: a pointer to an unservable skill is worse
// than none, costing the model a call to be told the resource is missing.
export const buildSkillsInstructions = (
  catalog: SkillCatalog,
  sharedContext: SharedContextEntry[] = [],
): string | undefined => {
  const skills = catalog.entries;
  if (skills.length === 0) return undefined;

  const sections = [
    `This server provides ${skills.length} AAP skill${
      skills.length === 1 ? "" : "s"
    }: documented procedures for platform tasks that are easy to answer`,
    "incompletely. A skill fixes the dimensions that must be checked and the",
    "thresholds that decide what counts as a problem.",
    "",
    "When a request matches one of the skills below, read it with",
    "resources/read and follow its procedure instead of improvising your own",
    "investigation.",
    "",
    // Measured getting the join wrong by dropping the skill segment, asking
    // for skill://aap/references/foo.md (AAP-99041 Defect 2).
    "A skill may tell you to read one of its supporting files. Take the",
    "skill's URI and replace the final SKILL.md segment with the path the",
    "skill gives you.",
    "",
    ...skills.map(
      (skill) =>
        `- ${skill.uri}\n  ${cap(skill.frontmatter.description ?? "")}`,
    ),
  ];

  if (sharedContext.length > 0) {
    sections.push(
      "",
      "Several skills share common conventions. These are documents, not",
      "capabilities: do not match a user's request against them. Read one when",
      "a skill's procedure tells you to, and only once, because every skill",
      "that cites it means this same document at this same address.",
      "",
      ...sharedContext.map((doc) => `- ${doc.uri}\n  ${cap(doc.summary)}`),
    );
  }

  return sections.join("\n");
};
