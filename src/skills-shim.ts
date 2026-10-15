/**
 * SEP-2640 skills serving — tool-based compatibility shim (ANSTRAT-2420 / B6).
 *
 * The native surface in skills-server.ts is reachable today: a client that has
 * not implemented the skills extension can still call resources/list, see the
 * skill:// URIs and read them. Access is not the gap. **Discovery is.** A model
 * asked "is my platform healthy?" never looks at the resource list, because the
 * tool list is a strictly more prominent surface in every client we have seen.
 *
 * This shim re-publishes the same catalog on that more prominent surface. It
 * adds no capability — every tool here has an exact native equivalent:
 *
 *   list_skills      ->  skills/list
 *   get_skill        ->  skills/get
 *   read_skill_file  ->  resources/read
 *   <skill-name>     ->  skills/get on that one skill
 *
 * Two shapes, because which one works is the open question B6 has to answer and
 * they differ in exactly the dimension that matters:
 *
 *   "catalog"     three generic tools mirroring the three native methods. Cheap
 *                 and uniform, but a tool named `list_skills` competes poorly
 *                 with a tool named `discover` for a model's attention — it
 *                 still requires the model to go looking for skills.
 *
 *   "skill-tools" one tool per skill, named and described as the skill itself.
 *                 Nothing has to be gone looking for: `aap-platform-health-check`
 *                 sits in tools/list next to `discover`, and its description
 *                 carries the skill's own trigger conditions.
 *
 * Run both against the same prompt; the difference between them is the finding.
 *
 * The shim is explicitly temporary and is deprecated as clients adopt native
 * discovery, so every description below says so.
 */

import { byCodePoint, readCatalogFile } from "./skills-loader.js";
import type { SkillCatalog, SkillEntry } from "./skills-loader.js";

/** Which tools the shim publishes. "off" publishes none. */
export type ShimMode = "off" | "catalog" | "skill-tools" | "both";

export const SHIM_MODES: ShimMode[] = ["off", "catalog", "skill-tools", "both"];

export const parseShimMode = (value: string): ShimMode =>
  (SHIM_MODES as string[]).includes(value) ? (value as ShimMode) : "off";

/** Appended to every shim tool description, per B6's acceptance criteria. */
const TEMPORARY_NOTICE =
  "Temporary compatibility path: this tool mirrors the MCP skills extension " +
  "(SEP-2640) for clients that have not implemented it, and will be removed " +
  "once native skill discovery is widely available.";

interface ShimTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

type ToolCallResult = { content: Array<{ type: "text"; text: string }> };

const text = (value: string): ToolCallResult => ({
  content: [{ type: "text", text: value }],
});

const json = (value: unknown): ToolCallResult =>
  text(JSON.stringify(value, null, 2));

/**
 * Reference files belonging to a skill — every resource except the SKILL.md
 * that identifies it.
 *
 * A client reaching a skill through the shim has, by assumption, not
 * implemented the extension; it may not read resources either. So the shim has
 * to hand it the sibling URIs explicitly, or a skill step that says "read
 * references/advisory-baselines.md" has nothing to act on. The PoC measured
 * that file visibly driving the severity bands in the output, so this is
 * load-bearing, not completeness for its own sake.
 */
const referenceUris = (entry: SkillEntry): string[] =>
  entry.resources.map((r) => r.uri).filter((uri) => uri !== entry.uri);

/** The SKILL.md body plus a pointer at the skill's other files. */
const skillDocument = (catalog: SkillCatalog, entry: SkillEntry): string => {
  const contents = readCatalogFile(catalog, entry.uri);
  const body =
    contents && "text" in contents
      ? contents.text
      : `(unreadable: ${entry.uri})`;

  const refs = referenceUris(entry);
  if (refs.length === 0) return body;

  return [
    body,
    "",
    "---",
    "",
    "Supporting files for this skill. Read one with the `read_skill_file`",
    "tool, passing the URI verbatim. SKILL.md may refer to these by relative",
    "path; the URIs below are the addresses to actually request.",
    "",
    ...refs.map((uri) => `- ${uri}`),
  ].join("\n");
};

const CATALOG_TOOLS = (): ShimTool[] => [
  {
    name: "list_skills",
    description:
      "List the AAP skills this server provides. A skill is a documented " +
      "procedure telling you which tools to call, in what order, and how to " +
      "interpret the results — follow one instead of improvising when the " +
      "task matches its trigger conditions. Returns each skill's URI and " +
      `frontmatter, including the description that states when to use it. ${TEMPORARY_NOTICE}`,
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_skill",
    description:
      "Fetch one AAP skill by URI, returning its full SKILL.md instructions " +
      "and the URIs of its supporting files. Call this before starting the " +
      `task the skill covers, then follow the procedure it describes. ${TEMPORARY_NOTICE}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        uri: {
          type: "string",
          description:
            "Skill URI as returned by list_skills, e.g. " +
            "skill://aap/aap-platform-health-check/SKILL.md",
        },
      },
      required: ["uri"],
    },
  },
  {
    name: "read_skill_file",
    description:
      "Read a supporting file belonging to an AAP skill — reference tables, " +
      "baselines, thresholds. Call this when a skill's instructions tell you " +
      `to consult one of its files. ${TEMPORARY_NOTICE}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        uri: {
          type: "string",
          description:
            "File URI as listed in the skill's resources, e.g. " +
            "skill://aap/aap-platform-health-check/references/advisory-baselines.md",
        },
      },
      required: ["uri"],
    },
  },
];

/**
 * One tool per skill, named as the skill is named.
 *
 * The description leads with the skill's own description, frontmatter verbatim,
 * because that text already contains the trigger conditions a model matches a
 * prompt against — the health-check skill lists "Is my platform healthy?" among
 * them, which is the exact prompt the cold-discovery test failed on.
 *
 * Calling the tool returns instructions rather than performing the work. That
 * is the honest shape: a skill is a document, and the model executes it using
 * the tools it already has. Saying so in the description keeps the model from
 * treating a returned procedure as a finished result.
 */
const skillTool = (entry: SkillEntry): ShimTool => ({
  name: entry.name,
  description:
    `${entry.description.trim()}\n\n` +
    "Calling this tool returns the step-by-step procedure for this task; it " +
    "does not perform the task. Read the returned instructions and carry " +
    "them out using the platform tools, following every step in order. " +
    `${TEMPORARY_NOTICE}`,
  inputSchema: { type: "object" as const, properties: {}, required: [] },
});

/**
 * The tools the shim publishes under a given mode.
 *
 * "skill-tools" still publishes read_skill_file: the per-skill tools hand back
 * instructions that cite supporting files, and without a reader those citations
 * are dead ends for a client that cannot read resources.
 */
export const buildShimTools = (
  catalog: SkillCatalog,
  mode: ShimMode,
): ShimTool[] => {
  if (mode === "off" || catalog.skills.length === 0) return [];

  const perSkill = catalog.skills.map(skillTool);
  const [listSkills, getSkill, readFile] = CATALOG_TOOLS();

  switch (mode) {
    case "catalog":
      return [listSkills, getSkill, readFile];
    case "skill-tools":
      return [...perSkill, readFile];
    case "both":
      return [...perSkill, listSkills, getSkill, readFile];
  }
};

export const isShimTool = (
  name: string,
  catalog: SkillCatalog,
  mode: ShimMode,
): boolean => buildShimTools(catalog, mode).some((tool) => tool.name === name);

/** Dispatch a shim tool call. Mirrors handleDiscoverTool's shape. */
export const handleShimTool = (
  name: string,
  args: Record<string, unknown>,
  catalog: SkillCatalog,
): ToolCallResult => {
  if (name === "list_skills") {
    return json(
      catalog.skills.map((entry) => ({
        uri: entry.uri,
        frontmatter: entry.frontmatter,
        resources: entry.resources,
      })),
    );
  }

  if (name === "get_skill" || name === "read_skill_file") {
    const uri = args.uri;
    if (typeof uri !== "string" || uri.length === 0) {
      throw new Error("'uri' is required and must be a string");
    }

    if (name === "get_skill") {
      const entry = catalog.byUri.get(uri);
      if (!entry) {
        throw new Error(`Not a skill served by this server: ${uri}`);
      }
      return text(skillDocument(catalog, entry));
    }

    // Resolved against the catalog and nothing else, exactly as resources/read
    // does. The URI's path is never joined onto a base directory, so the shim
    // inherits the native path-confinement property rather than reimplementing
    // it — a second code path onto the filesystem is a second chance to get
    // traversal wrong.
    const contents = readCatalogFile(catalog, uri);
    if (!contents) {
      const known = [...catalog.files.keys()].sort(byCodePoint).join("\n");
      throw new Error(`Not a file served by this server: ${uri}\n\n${known}`);
    }
    return text("text" in contents ? contents.text : contents.blob);
  }

  const entry = catalog.skills.find((skill) => skill.name === name);
  if (!entry) {
    throw new Error(`Unknown skills-shim tool: ${name}`);
  }
  return text(skillDocument(catalog, entry));
};
