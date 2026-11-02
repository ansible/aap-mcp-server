import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import type { Dirent } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import * as yaml from "js-yaml";

export interface SharedContextEntry {
  uri: string;
  /** Path relative to the root, forming the URI's final segments. */
  ref: string;
  text: string;
  size: number;
  digest: string;
  /** Frontmatter description or first heading, quoted by the instructions pointer. */
  summary: string;
}

export interface SharedContextWarning {
  path: string;
  message: string;
}

// Fixed, unlike skills_uri_prefix: skill content cites these URIs directly, so
// the authority cannot be a deployment option.
const URI_PREFIX = "aap://context/";

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

// Scanned rather than matched: a lazy group between two --- delimiters
// backtracks across the whole file when the closing one is missing.
const splitFrontmatter = (text: string): [block: string, body: string] => {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return ["", text];
  const close = lines.indexOf("---", 1);
  if (close === -1) return ["", text];
  return [lines.slice(1, close).join("\n"), lines.slice(close + 1).join("\n")];
};

// Parsed, not pattern-matched: a folded or literal description captures its
// own indicator ("|", ">-") if you read the line instead of the value.
const described = (block: string): string => {
  let frontmatter: unknown;
  try {
    frontmatter = yaml.load(block);
  } catch {
    return "";
  }
  if (typeof frontmatter !== "object" || frontmatter === null) return "";
  const value = (frontmatter as { description?: unknown }).description;
  return typeof value === "string" ? oneLine(value) : "";
};

const summarize = (text: string): string => {
  const [block, body] = splitFrontmatter(text);
  // Searched below the frontmatter only: a YAML comment line also starts "#".
  const summary = described(block) || /^#[ \t]+([^\n]+)/m.exec(body)?.[1];
  return summary ? oneLine(summary) : "";
};

interface Walked {
  entries: SharedContextEntry[];
  warnings: SharedContextWarning[];
}

const NOTHING: Walked = { entries: [], warnings: [] };

const refused = (path: string, message: string): Walked => ({
  entries: [],
  warnings: [{ path, message }],
});

export const loadSharedContext = async (
  root: string,
  options: { onWarning?: (warning: SharedContextWarning) => void } = {},
): Promise<SharedContextEntry[]> => {
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    options.onWarning?.({ path: root, message: "directory not found" });
    return [];
  }

  // A directory's children are visited together and their results flattened in
  // name order, so parallel reads cost the report none of its determinism.
  const walk = async (dir: string): Promise<Walked> => {
    let dirents: Dirent[];
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      const at = relative(realRoot, dir) || ".";
      return refused(at, `could not be read: ${describe(error)}`);
    }

    const byName = [...dirents].sort((a, b) => (a.name < b.name ? -1 : 1));
    const walked = await Promise.all(byName.map((child) => visit(dir, child)));
    return {
      entries: walked.flatMap((one) => one.entries),
      warnings: walked.flatMap((one) => one.warnings),
    };
  };

  const visit = async (dir: string, dirent: Dirent): Promise<Walked> => {
    const full = join(dir, dirent.name);
    const ref = relative(realRoot, full).split(sep).join("/");

    // Refused outright, the same rule the SDK applies to skills. It is what
    // keeps a document from resolving outside the configured root.
    if (dirent.isSymbolicLink()) {
      return refused(ref, "is a symlink and was not served");
    }
    if (dirent.isDirectory()) return walk(full);
    if (!dirent.isFile() || extname(dirent.name).toLowerCase() !== ".md") {
      return NOTHING;
    }

    // Hashed as it sits on disk: re-encoding the decoded string would advertise
    // a digest for bytes the file does not contain.
    const bytes = await readFile(full);
    const text = bytes.toString("utf8");
    return {
      entries: [
        {
          uri: `${URI_PREFIX}${ref}`,
          ref,
          text,
          size: bytes.byteLength,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          summary: summarize(text),
        },
      ],
      warnings: [],
    };
  };

  const { entries, warnings } = await walk(realRoot);
  for (const warning of warnings) options.onWarning?.(warning);
  return entries;
};

// Held in memory rather than re-read per request: createMcpServer runs on every
// request, and serving the cached bytes keeps the digest advertised and the
// bytes returned from drifting apart.
export const attachSharedContext = (
  server: McpServer,
  entries: SharedContextEntry[],
): void => {
  for (const entry of entries) {
    server.registerResource(
      entry.ref,
      entry.uri,
      {
        ...(entry.summary ? { description: entry.summary } : {}),
        mimeType: "text/markdown",
        size: entry.size,
        // No native field for a digest, so it rides _meta under the name
        // SEP-2640 gives it on a skill's resource entries.
        _meta: { digest: entry.digest },
        cacheHint: { ttlMs: 300_000, cacheScope: "public" },
      },
      // Restated on the read: skill content cites the URI directly, so a
      // client reaches the document without the list that declares the type.
      (uri) => ({
        contents: [
          { uri: uri.href, mimeType: "text/markdown", text: entry.text },
        ],
      }),
    );
  }
};

export const formatSharedContextReport = (input: {
  path: string;
  entries: SharedContextEntry[];
  warnings: SharedContextWarning[];
}): string[] => {
  const { path, entries, warnings } = input;
  if (!path) return [];

  return [
    `Shared context: ${entries.length} document${
      entries.length === 1 ? "" : "s"
    } from ${path}`,
    ...entries.map((entry) => `  ✓ ${entry.uri} (${entry.size}B)`),
    ...warnings.map((warning) => `  ✗ ${warning.path}: ${warning.message}`),
  ];
};
