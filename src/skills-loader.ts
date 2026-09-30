/**
 * Skills loader — builds an in-memory catalog of Agent Skills served over MCP
 * per SEP-2640 (io.modelcontextprotocol/skills).
 *
 * The loader takes a plain directory path and knows nothing about how the
 * content arrived. Keeping it ignorant of git/npm/OCI keeps the acquisition
 * mechanism swappable. This mirrors the `local_path` pattern in
 * openapi-loader.ts.
 *
 * The catalog is built once at startup. The server is stateless per request,
 * so re-walking and re-hashing the tree per request would be pure waste.
 *
 * A malformed skill must never take the server down: offenders are skipped
 * with a warning and the rest of the catalog still loads.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { load as yamlLoad } from "js-yaml";

/** SEP-2640 per-skill interoperability limits. */
export const MAX_RESOURCES_PER_SKILL = 512;
export const MAX_SKILL_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * Order two file paths or URIs by Unicode code point.
 *
 * Deliberately not `localeCompare`: that orders by the host's locale, so the
 * same catalog would enumerate differently on two machines. These are file
 * paths and URIs rather than text shown to a person, and the order they are
 * listed in should be a property of the content, not of the server's
 * environment.
 */
export const byCodePoint = (a: string, b: string): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

/** One file within a skill, as it appears in a skill entry's `resources`. */
export interface SkillResource {
  uri: string;
  digest: string;
  size: number;
}

/** A skill entry, the unit returned by skills/list and skills/get. */
export interface SkillEntry {
  /** URI of the skill's SKILL.md — the entry's identity. */
  uri: string;
  name: string;
  description: string;
  /**
   * The skill's YAML frontmatter, verbatim.
   *
   * SEP-2640 requires a host to re-parse the fetched SKILL.md and compare its
   * frontmatter field-by-field against this object; any discrepancy is a
   * verification failure equivalent to a digest mismatch and the skill is not
   * loaded. So this must be exactly what a YAML parse of the served bytes
   * yields — no coercion, no normalization, no synthesized defaults.
   */
  frontmatter: Record<string, unknown>;
  resources: SkillResource[];
}

/** A single file the server will serve over resources/read. */
interface CatalogFile {
  /** Absolute path on disk. Resolved once at load; never derived from a URI. */
  path: string;
  digest: string;
  size: number;
  isText: boolean;
}

export interface SkillCatalog {
  skills: SkillEntry[];
  /** SKILL.md URI -> entry. Backs skills/get. */
  byUri: Map<string, SkillEntry>;
  /**
   * Any served file URI -> its on-disk file. Backs resources/read.
   *
   * resources/read resolves against this map and nothing else. It must never
   * take the path component of an inbound URI and join it onto a base
   * directory — that is the path-traversal hole. A URI absent from this map is
   * not served, full stop.
   */
  files: Map<string, CatalogFile>;
}

export interface LoadSkillsOptions {
  /** Directory containing one subdirectory per skill. */
  directory: string;
  /**
   * Server-chosen organizational prefix for skill URIs. SEP-2640 leaves the
   * preceding segments free; only the final segment of the skill path is
   * constrained (it MUST equal the frontmatter `name`).
   */
  prefix?: string;
  /** Defaults to console.warn; injectable for tests. */
  warn?: (message: string) => void;
}

const EMPTY_CATALOG: SkillCatalog = Object.freeze({
  skills: [],
  byUri: new Map(),
  files: new Map(),
}) as SkillCatalog;

/**
 * Extensions served as text. Everything else is served as a base64 blob.
 * Deliberately a allowlist: misclassifying a binary as text corrupts it, while
 * misclassifying text as a blob is merely unhelpful.
 */
const TEXT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "yaml",
  "yml",
  "json",
  "py",
  "sh",
  "js",
  "ts",
  "toml",
  "ini",
  "cfg",
  "csv",
  "xml",
  "html",
  "css",
  "jinja",
  "j2",
]);

const isTextFile = (fileName: string): boolean => {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return false;
  return TEXT_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
};

/**
 * Split a SKILL.md into its raw frontmatter block and body.
 *
 * Deliberately does not use a split on "---": the delimiter must be a line
 * that is exactly "---", otherwise a horizontal rule or a "---" inside a block
 * scalar would truncate the frontmatter.
 */
export const splitFrontmatter = (
  raw: string,
): { yaml: string; body: string } | null => {
  const lines = raw.split("\n");
  // Tolerate a UTF-8 BOM and CRLF line endings.
  const first = lines[0]?.replace(/^\uFEFF/, "").trimEnd();
  if (first !== "---") return null;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === "---") {
      return {
        yaml: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  return null;
};

/** Recursively list files under `dir`, relative to it, with POSIX separators. */
const listFilesRecursive = (dir: string, base = dir): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.push(relative(base, full).split(sep).join("/"));
    }
  }
  return out;
};

const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * Parse a SKILL.md's frontmatter and check the fields a servable skill needs.
 *
 * Returns null and warns on anything unservable, so the caller can treat a bad
 * skill as simply absent.
 */
const readSkillFrontmatter = (
  skillMdPath: string,
  dirName: string,
  warn: (m: string) => void,
): {
  frontmatter: Record<string, unknown>;
  name: string;
  description: string;
} | null => {
  let frontmatter: Record<string, unknown>;
  try {
    const split = splitFrontmatter(readFileSync(skillMdPath, "utf8"));
    if (!split) {
      warn(`Skipping skill '${dirName}': SKILL.md has no YAML frontmatter`);
      return null;
    }
    const parsed = yamlLoad(split.yaml);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      warn(`Skipping skill '${dirName}': frontmatter is not a YAML mapping`);
      return null;
    }
    frontmatter = parsed as Record<string, unknown>;
  } catch (error) {
    warn(
      `Skipping skill '${dirName}': ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  const name = frontmatter.name;
  if (typeof name !== "string" || name.length === 0) {
    warn(`Skipping skill '${dirName}': frontmatter has no 'name'`);
    return null;
  }
  // SEP-2640: the final segment of the skill path MUST equal the frontmatter
  // name, and the skill path is derived from the directory. A mismatch would
  // produce a non-conformant URI, so refuse to serve rather than paper over it.
  if (name !== dirName) {
    warn(
      `Skipping skill '${dirName}': frontmatter name '${name}' does not match its directory`,
    );
    return null;
  }

  const description = frontmatter.description;
  if (typeof description !== "string" || description.length === 0) {
    warn(`Skipping skill '${dirName}': frontmatter has no 'description'`);
    return null;
  }

  return { frontmatter, name, description };
};

/**
 * Digest every file in a skill directory, enforcing the escape and size rules.
 *
 * All-or-nothing: if any file is unreadable, escapes the skill directory, or
 * pushes the skill past the byte limit, the whole skill is refused. Serving a
 * partial skill would mean advertising a `resources` list that does not
 * describe the skill an author wrote.
 */
const collectSkillFiles = (
  skillDir: string,
  skillRoot: string,
  skillPath: string,
  dirName: string,
  relPaths: string[],
  warn: (m: string) => void,
): { resources: SkillResource[]; files: Map<string, CatalogFile> } | null => {
  const resources: SkillResource[] = [];
  const files = new Map<string, CatalogFile>();
  let totalBytes = 0;

  for (const rel of relPaths) {
    // A symlink whose target escapes the skill directory is not served. Checked
    // at load time so the read path never has to reason about it.
    let real: string;
    try {
      real = realpathSync(join(skillDir, rel));
    } catch {
      warn(`Skipping skill '${dirName}': cannot resolve '${rel}'`);
      return null;
    }
    if (real !== skillRoot && !real.startsWith(skillRoot + sep)) {
      warn(
        `Skipping skill '${dirName}': '${rel}' resolves outside the skill directory`,
      );
      return null;
    }
    if (!statSync(real).isFile()) continue;

    const bytes = readFileSync(real);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_SKILL_BYTES) {
      warn(
        `Skipping skill '${dirName}': total size exceeds the SEP-2640 limit of ${MAX_SKILL_BYTES} bytes`,
      );
      return null;
    }

    const uri = `skill://${skillPath}/${rel}`;
    const digest = sha256(bytes);
    resources.push({ uri, digest, size: bytes.byteLength });
    files.set(uri, {
      path: real,
      digest,
      size: bytes.byteLength,
      isText: isTextFile(rel),
    });
  }

  return { resources, files };
};

/**
 * Load one skill directory into an entry plus its files.
 * Returns null and warns if the skill is unservable for any reason.
 */
const loadOneSkill = (
  skillDir: string,
  dirName: string,
  prefix: string,
  warn: (m: string) => void,
): { entry: SkillEntry; files: Map<string, CatalogFile> } | null => {
  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    warn(`Skipping skill '${dirName}': no SKILL.md`);
    return null;
  }

  const parsed = readSkillFrontmatter(skillMdPath, dirName, warn);
  if (!parsed) return null;
  const { frontmatter, name, description } = parsed;

  const skillPath = prefix ? `${prefix}/${name}` : name;
  const relPaths = listFilesRecursive(skillDir).sort(byCodePoint);

  if (relPaths.length > MAX_RESOURCES_PER_SKILL) {
    warn(
      `Skipping skill '${dirName}': ${relPaths.length} files exceeds the SEP-2640 limit of ${MAX_RESOURCES_PER_SKILL}`,
    );
    return null;
  }

  // Resolve the skill root once so symlink escapes can be detected against it.
  const collected = collectSkillFiles(
    skillDir,
    realpathSync(skillDir),
    skillPath,
    dirName,
    relPaths,
    warn,
  );
  if (!collected) return null;

  return {
    entry: {
      uri: `skill://${skillPath}/SKILL.md`,
      name,
      description,
      frontmatter,
      resources: collected.resources,
    },
    files: collected.files,
  };
};

/**
 * Build the skill catalog. Never throws: a missing directory or an unservable
 * skill yields a warning and a smaller catalog, not a failed startup.
 */
export const loadSkills = (options: LoadSkillsOptions): SkillCatalog => {
  const { directory, prefix = "aap", warn = console.warn } = options;

  if (!directory) return EMPTY_CATALOG;
  if (!existsSync(directory)) {
    warn(`Skills directory '${directory}' does not exist; skills disabled`);
    return EMPTY_CATALOG;
  }
  if (!statSync(directory).isDirectory()) {
    warn(`Skills path '${directory}' is not a directory; skills disabled`);
    return EMPTY_CATALOG;
  }

  const skills: SkillEntry[] = [];
  const byUri = new Map<string, SkillEntry>();
  const files = new Map<string, CatalogFile>();

  for (const dirent of readdirSync(directory, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const loaded = loadOneSkill(
      join(directory, dirent.name),
      dirent.name,
      prefix,
      warn,
    );
    if (!loaded) continue;

    skills.push(loaded.entry);
    byUri.set(loaded.entry.uri, loaded.entry);
    for (const [uri, file] of loaded.files) files.set(uri, file);
  }

  skills.sort((a, b) => byCodePoint(a.name, b.name));
  return { skills, byUri, files };
};

/** Read a catalog file's contents, shaped for a resources/read result. */
export const readCatalogFile = (
  catalog: SkillCatalog,
  uri: string,
):
  | { uri: string; mimeType: string; text: string }
  | { uri: string; mimeType: string; blob: string }
  | null => {
  const file = catalog.files.get(uri);
  if (!file) return null;

  const bytes = readFileSync(file.path);
  return file.isText
    ? { uri, mimeType: "text/plain", text: bytes.toString("utf8") }
    : {
        uri,
        mimeType: "application/octet-stream",
        blob: bytes.toString("base64"),
      };
};
