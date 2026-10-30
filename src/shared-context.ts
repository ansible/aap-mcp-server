import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";

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

const summarize = (text: string): string => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (frontmatter) {
    const described = /^description:\s*(.+)$/m.exec(frontmatter[1]);
    if (described) return described[1].trim().replace(/^["']|["']$/g, "");
  }
  // Below the frontmatter only: a YAML comment line also starts with "#".
  const body = frontmatter ? text.slice(frontmatter[0].length) : text;
  const heading = /^#\s+(.+)$/m.exec(body);
  return heading ? heading[1].trim() : "";
};

export const loadSharedContext = async (
  root: string,
  options: { onWarning?: (warning: SharedContextWarning) => void } = {},
): Promise<SharedContextEntry[]> => {
  const warn = (path: string, message: string) =>
    options.onWarning?.({ path, message });

  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    warn(root, "directory not found");
    return [];
  }

  const entries: SharedContextEntry[] = [];

  const walk = async (dir: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      warn(
        relative(realRoot, dir) || ".",
        `could not be read: ${describe(error)}`,
      );
      return;
    }

    for (const dirent of dirents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, dirent.name);
      const ref = relative(realRoot, full).split(sep).join("/");

      // Refused outright, the same rule the SDK applies to skills. It is what
      // keeps a document from resolving outside the configured root.
      if (dirent.isSymbolicLink()) {
        warn(ref, "is a symlink and was not served");
        continue;
      }
      if (dirent.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!dirent.isFile() || extname(dirent.name).toLowerCase() !== ".md") {
        continue;
      }

      const text = await readFile(full, "utf8");
      const bytes = Buffer.from(text, "utf8");
      entries.push({
        uri: `${URI_PREFIX}${ref}`,
        ref,
        text,
        size: bytes.byteLength,
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        summary: summarize(text),
      });
    }
  };

  await walk(realRoot);
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
      async (uri) => ({ contents: [{ uri: uri.href, text: entry.text }] }),
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
