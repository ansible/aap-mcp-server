import express from "express";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";

// --- Constants ---

export const RESOURCE_NAME = "Ansible MCP Server";

// --- Types ---

export interface ProtectedResourceConfig {
  serverUrl: string;
  authorizationServerUrl: string;
  writeOperationsEnabled: boolean;
}

export interface ProtectedResourceMetadataResponse {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_name: string;
}

interface OidcDiscoveryResponse {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  [key: string]: unknown;
}

// --- Helpers ---

function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") {
    end--;
  }
  return url.slice(0, end);
}

export function validateIssuerUrl(
  raw: string,
  label: string,
): { ok: true; normalized: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `${label} is not a valid URL: "${raw}"` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      ok: false,
      reason: `${label} must use http or https, got "${url.protocol}"`,
    };
  }
  return {
    ok: true,
    normalized: stripTrailingSlashes(url.origin + url.pathname),
  };
}

// --- Configuration ---

export function isOAuth2Enabled(): boolean {
  return process.env.OAUTH2_ENABLED?.toLowerCase() === "true";
}

export function getDiscoveryTimeout(): number {
  const timeout = Number.parseInt(
    process.env.OAUTH2_DISCOVERY_TIMEOUT || "10",
    10,
  );
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 10;
}

export function deriveAuthorizationServerUrl(baseUrl: string): string {
  return `${stripTrailingSlashes(baseUrl)}/o`;
}

export function deriveOidcDiscoveryUrl(baseUrl: string): string {
  return `${deriveAuthorizationServerUrl(baseUrl)}/.well-known/openid-configuration`;
}

export function buildConfig(
  baseUrl: string,
  mcpServerUrl: string,
  writeOperationsEnabled: boolean,
): ProtectedResourceConfig {
  return {
    serverUrl: stripTrailingSlashes(mcpServerUrl),
    authorizationServerUrl: deriveAuthorizationServerUrl(baseUrl),
    writeOperationsEnabled,
  };
}

// --- OIDC Discovery probe ---

export async function probeOidcDiscovery(
  baseUrl: string,
  timeoutSeconds: number,
): Promise<{ ok: true; issuer: string } | { ok: false; reason: string }> {
  const discoveryUrl = deriveOidcDiscoveryUrl(baseUrl);
  const expectedIssuerRaw = deriveAuthorizationServerUrl(baseUrl);

  const expectedResult = validateIssuerUrl(
    expectedIssuerRaw,
    "Expected issuer",
  );
  if (!expectedResult.ok) {
    return expectedResult;
  }

  try {
    const response = await fetch(discoveryUrl, {
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: `OIDC Discovery returned HTTP ${response.status}`,
      };
    }

    let metadata: OidcDiscoveryResponse;
    try {
      metadata = (await response.json()) as OidcDiscoveryResponse;
    } catch {
      return { ok: false, reason: "OIDC Discovery returned unparseable JSON" };
    }

    if (!metadata.issuer) {
      return {
        ok: false,
        reason: "OIDC Discovery response missing issuer field",
      };
    }

    const metadataResult = validateIssuerUrl(
      metadata.issuer,
      "Metadata issuer",
    );
    if (!metadataResult.ok) {
      return metadataResult;
    }

    // Intentional: normalized comparison instead of RFC 8414 exact-string match
    // to tolerate default-port differences between AAP gateway and base URL config.
    if (metadataResult.normalized !== expectedResult.normalized) {
      return {
        ok: false,
        reason: `Issuer mismatch: expected "${expectedIssuerRaw}", got "${metadata.issuer}"`,
      };
    }

    return { ok: true, issuer: metadata.issuer };
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return {
        ok: false,
        reason: `OIDC Discovery timed out after ${timeoutSeconds} seconds`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `OIDC Discovery failed: ${message}` };
  }
}

// --- Metadata builders ---

export function determineSupportedScopes(writeEnabled: boolean): string[] {
  return writeEnabled ? ["read", "write"] : ["read"];
}

export function resolveResourceUrl(
  serverUrl: string,
  resourcePath: string,
): string {
  return new URL(resourcePath, serverUrl).href;
}

export function buildResourceMetadata(
  resourceUrl: string,
  config: ProtectedResourceConfig,
): ProtectedResourceMetadataResponse {
  return {
    resource: resourceUrl,
    authorization_servers: [config.authorizationServerUrl],
    scopes_supported: determineSupportedScopes(config.writeOperationsEnabled),
    bearer_methods_supported: ["header"],
    resource_name: RESOURCE_NAME,
  };
}

// --- WWW-Authenticate header (RFC 6750) ---

export type Rfc6750Error =
  "invalid_request" | "invalid_token" | "insufficient_scope";

function sanitizeHeaderValue(value: string): string {
  return value.replace(/["\\]/g, "");
}

export function buildResourceMetadataUrl(
  serverUrl: string,
  requestPath: string,
): string {
  const resourceUrl = new URL(requestPath, serverUrl);
  return getOAuthProtectedResourceMetadataUrl(resourceUrl);
}

export function buildWwwAuthenticateHeader(
  resourceMetadataUrl: string,
  scopes: string[],
  error?: Rfc6750Error,
): string {
  const sanitizedUrl = sanitizeHeaderValue(resourceMetadataUrl);
  const scopeValue = scopes.join(" ");
  const parts = [
    ...(error ? [`error="${error}"`] : []),
    `resource_metadata="${sanitizedUrl}"`,
    `scope="${scopeValue}"`,
  ];
  return `Bearer ${parts.join(", ")}`;
}

// --- Express router ---

function extractResourcePath(fullPath: string): string {
  const prefix = "/.well-known/oauth-protected-resource";
  const resourcePath = fullPath.slice(prefix.length);
  return resourcePath || "/";
}

export function buildValidMcpPaths(toolsetNames: string[]): Set<string> {
  const paths = new Set<string>();
  paths.add("/");
  paths.add("/mcp");
  for (const name of toolsetNames) {
    paths.add(`/mcp/${name}`);
    paths.add(`/${name}/mcp`);
  }
  return paths;
}

function isValidResourcePath(
  resourcePath: string,
  validPaths: Set<string>,
): boolean {
  return validPaths.has(resourcePath);
}

export function createProtectedResourceRouter(
  config: ProtectedResourceConfig,
  toolsetNames: string[],
): express.Router {
  const router = express.Router();
  const validPaths = buildValidMcpPaths(toolsetNames);

  const handleMetadataRequest = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (req.method !== "GET" && req.method !== "OPTIONS") {
      res.status(405).set("Allow", "GET, OPTIONS").end();
      return;
    }

    const resourcePath = extractResourcePath(req.path);

    if (!isValidResourcePath(resourcePath, validPaths)) {
      next();
      return;
    }

    const resourceUrl = resolveResourceUrl(config.serverUrl, resourcePath);
    const metadata = buildResourceMetadata(resourceUrl, config);

    res.set("Cache-Control", "no-store");
    res.set("Access-Control-Allow-Origin", "*");
    res.json(metadata);
  };

  router.all("/.well-known/oauth-protected-resource", handleMetadataRequest);
  router.all(
    "/.well-known/oauth-protected-resource/{*splat}",
    handleMetadataRequest,
  );

  return router;
}
