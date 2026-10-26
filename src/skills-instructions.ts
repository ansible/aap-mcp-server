/**
 * SEP-2640 instructions pointer.
 *
 * This is the only piece of skills serving the server owns. The MCP TypeScript
 * SDK's skills extension handles the rest — catalog loading, digests, sizes,
 * frontmatter fidelity, per-skill limits, skills/list, skills/get and the
 * skill:// resource template — so what is left here is the discovery mechanism
 * the SDK deliberately does not implement for us:
 *
 *   "A server MAY direct the agent to specific skill URIs from its
 *    `instructions` field. This requires no discovery machinery on the host;
 *    the URI is simply present in the model's context and readable via
 *    resources/read."
 *
 * Reachable is not the same as findable. Measured on a cold client session with
 * the single prompt "is my AAP platform healthy?": with nothing advertised the
 * client made seven tool calls, zero resource calls, never found the skill, and
 * reported the platform healthy while an inventory source was failing. With the
 * pointer, reading the skill was its first action.
 *
 * `instructions` is base protocol, present since 2024-11-05, so it reaches
 * clients that have implemented nothing beyond core MCP — including every
 * client that has not implemented the skills extension. It costs no entry in
 * tools/list.
 */

import type { SkillCatalog } from "@modelcontextprotocol/server/ext/skills";

/**
 * Per-skill cap on the description text carried into the server instructions.
 *
 * SEP-2640 calls the `instructions` field "practically bounded in size" and
 * cites that bound as a reason skills exist at all, so the pointer must stay a
 * pointer and never inline skill content. The trigger conditions are the part
 * worth the bytes: they are what a model matches a prompt against.
 */
const INSTRUCTION_DESCRIPTION_BUDGET = 400;

/**
 * Advertise the skill catalog in the server's `instructions` field.
 *
 * Returns undefined for an empty catalog, so the server never advertises
 * something it cannot serve: a pointer to an unservable skill is worse than no
 * pointer, because the model spends a call to be told the resource is missing.
 */
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
