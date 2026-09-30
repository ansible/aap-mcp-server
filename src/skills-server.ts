/**
 * SEP-2640 skills serving — protocol layer.
 *
 * Registers the three methods that make a skill catalog reachable:
 *   skills/list     enumerate the skills this server serves   (MUST)
 *   skills/get      fetch one skill's entry by URI            (MUST)
 *   resources/read  read a skill file's contents
 *
 * plus resources/list, so that declaring a `resources` capability does not
 * leave clients calling a method that answers MethodNotFound.
 *
 * Kept out of index.ts for the same reason discover.ts is: it is a coherent
 * surface with its own rules, and index.ts is already long.
 *
 * Three SDK behaviours this module works around, all verified against
 * @modelcontextprotocol/server v2.0.0:
 *
 *  1. The `cacheHints` server option does NOT apply to skills/*. fillCacheFields
 *     gates on a closed list of six methods (tools/list, prompts/list,
 *     resources/list, resources/templates/list, resources/read, server/discover);
 *     a hint configured for skills/list is silently discarded. So skills/list
 *     emits ttlMs and cacheScope by hand. resources/read IS on that list, so it
 *     is left to the native option.
 *
 *  2. `resultType: "complete"` is stamped automatically for every method,
 *     custom ones included. Handlers must not supply it, and the result schemas
 *     below must not declare it — declaring it is what triggers
 *     typescript-sdk#2789, where conforming responses are rejected client-side.
 *
 *  3. Declaring a `resources` capability defaults its `listChanged` to true.
 *     We register resources statically and never emit
 *     notifications/resources/list_changed, so the caller must pin it false.
 */

import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { readCatalogFile, type SkillCatalog } from "./skills-loader.js";

/**
 * Freshness hint for skills/list. The catalog is built once at startup and is
 * immutable for the life of the process, so a shared five-minute TTL is safe
 * and matches what the server already advertises for tools/list.
 */
export const SKILLS_LIST_TTL_MS = 300_000;
export const SKILLS_LIST_CACHE_SCOPE = "public";

/**
 * Minimal Standard Schema implementations for the 3-arg setRequestHandler form.
 *
 * Hand-rolled rather than pulling in zod: zod is only present here as a
 * transitive dependency of the SDK, and these two shapes are too small to
 * justify a direct dependency on it.
 */
const standardSchema = <T>(
  validate: (value: unknown) => T,
): { "~standard": StandardSchemaLike<T> } => ({
  "~standard": {
    version: 1,
    vendor: "aap-mcp",
    validate: (value: unknown) => {
      try {
        return { value: validate(value) };
      } catch (error) {
        return {
          issues: [
            { message: error instanceof Error ? error.message : String(error) },
          ],
        };
      }
    },
  },
});

interface StandardSchemaLike<T> {
  version: 1;
  vendor: string;
  validate: (
    value: unknown,
  ) => { value: T } | { issues: Array<{ message: string }> };
  /**
   * Phantom property. Standard Schema carries input/output types here for
   * inference only; it is never present at runtime, which is why it is
   * optional and never assigned.
   */
  types?: { input: unknown; output: T };
}

/** skills/list takes no required params; an optional cursor is tolerated. */
const ListParams = standardSchema((value) => {
  const params = (value ?? {}) as Record<string, unknown>;
  return {
    cursor: typeof params.cursor === "string" ? params.cursor : undefined,
  };
});

/** skills/get requires a skill URI. */
const GetParams = standardSchema((value) => {
  const params = (value ?? {}) as Record<string, unknown>;
  if (typeof params.uri !== "string" || params.uri.length === 0) {
    throw new Error("'uri' is required and must be a string");
  }
  return { uri: params.uri };
});

/**
 * Wire shape of a skill entry, per SEP-2640: uri, frontmatter, resources.
 *
 * Note there is deliberately no top-level `name` or `description` — the spec
 * puts both inside `frontmatter`, and a host reads them from there. Our
 * internal SkillEntry carries them separately for sorting and logging; they
 * must not leak onto the wire.
 */
const toWireEntry = (entry: {
  uri: string;
  frontmatter: Record<string, unknown>;
  resources: Array<{ uri: string; digest: string; size: number }>;
}) => ({
  uri: entry.uri,
  frontmatter: entry.frontmatter,
  resources: entry.resources,
});

/**
 * Register the skills surface on an McpServer.
 *
 * The caller is responsible for declaring the capabilities — see
 * SKILLS_CAPABILITIES — because capabilities are fixed at construction time.
 */
export const registerSkillHandlers = (
  server: McpServer,
  catalog: SkillCatalog,
): void => {
  server.server.setRequestHandler(
    "skills/list",
    { params: ListParams },
    async () => ({
      skills: catalog.skills.map(toWireEntry),
      // Emitted by hand: the SDK's cacheHints option does not reach skills/*.
      ttlMs: SKILLS_LIST_TTL_MS,
      cacheScope: SKILLS_LIST_CACHE_SCOPE,
    }),
  );

  server.server.setRequestHandler(
    "skills/get",
    { params: GetParams },
    async (params) => {
      const entry = catalog.byUri.get(params.uri);
      if (!entry) {
        // A URI this server does not serve as a skill must error rather than
        // return an empty result: the error is the signal that the URI is not
        // a skill here, which is the whole point of skills/get.
        throw new ProtocolError(
          ProtocolErrorCode.ResourceNotFound,
          `Not a skill served by this server: ${params.uri}`,
        );
      }
      // The entry goes inside a `skill` envelope. Returning it inline looks
      // reasonable and round-trips against our own client, but clients reject
      // it: the reference implementation's schema requires the envelope and
      // deliberately does not normalize an inline entry past its conformance
      // checks. SEP-2640 leaves the caching attributes optional here; we send
      // them because this result is as immutable as skills/list.
      return {
        skill: toWireEntry(entry),
        ttlMs: SKILLS_LIST_TTL_MS,
        cacheScope: SKILLS_LIST_CACHE_SCOPE,
      };
    },
  );

  server.server.setRequestHandler("resources/list", async () => ({
    resources: [...catalog.files.keys()].sort().map((uri) => ({
      uri,
      name: uri.slice(uri.lastIndexOf("/") + 1),
      mimeType: uri.endsWith(".md") ? "text/markdown" : undefined,
    })),
  }));

  server.server.setRequestHandler("resources/read", async (request) => {
    const { uri } = request.params;

    const contents = readCatalogFile(catalog, uri);
    if (!contents) {
      // Resolved against the catalog and nothing else. The URI's path is never
      // joined onto a base directory, so traversal has nothing to traverse.
      throw new ProtocolError(
        ProtocolErrorCode.ResourceNotFound,
        `Resource not found: ${uri}`,
      );
    }

    return { contents: [contents] };
  });
};

/**
 * Capabilities a skills-serving instance must declare.
 *
 * `directoryRead: false` — resources/directory/read is out of scope; a host
 * holding a complete resources manifest gains nothing from it.
 *
 * `resources.listChanged: false` — the SDK defaults this to true as soon as a
 * resources capability is declared. We register resources statically and never
 * emit notifications/resources/list_changed, so advertising listChanged would
 * promise something we do not honour.
 */
export const SKILLS_CAPABILITIES = {
  resources: { listChanged: false, subscribe: false },
  extensions: {
    "io.modelcontextprotocol/skills": { directoryRead: false },
  },
} as const;
