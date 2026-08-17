import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "http";
import {
  buildConfig,
  buildResourceMetadata,
  buildResourceMetadataUrl,
  buildWwwAuthenticateHeader,
  buildValidMcpPaths,
  createProtectedResourceRouter,
  deriveAuthorizationServerUrl,
  deriveOidcDiscoveryUrl,
  determineSupportedScopes,
  getDiscoveryTimeout,
  getRetryConfig,
  initOAuth2Discovery,
  isOAuth2Enabled,
  probeOidcDiscovery,
  probeOidcDiscoveryWithRetry,
  resolveResourceUrl,
  validateIssuerUrl,
  type ProtectedResourceConfig,
} from "./protected-resource-metadata.js";

// --- isOAuth2Enabled ---

describe("isOAuth2Enabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when OAUTH2_ENABLED is not set", () => {
    delete process.env.OAUTH2_ENABLED;
    expect(isOAuth2Enabled()).toBe(false);
  });

  it("returns true when OAUTH2_ENABLED is 'true'", () => {
    vi.stubEnv("OAUTH2_ENABLED", "true");
    expect(isOAuth2Enabled()).toBe(true);
  });

  it("returns true when OAUTH2_ENABLED is 'TRUE' (case insensitive)", () => {
    vi.stubEnv("OAUTH2_ENABLED", "TRUE");
    expect(isOAuth2Enabled()).toBe(true);
  });

  it("returns false when OAUTH2_ENABLED is 'false'", () => {
    vi.stubEnv("OAUTH2_ENABLED", "false");
    expect(isOAuth2Enabled()).toBe(false);
  });

  it("returns false when OAUTH2_ENABLED is empty string", () => {
    vi.stubEnv("OAUTH2_ENABLED", "");
    expect(isOAuth2Enabled()).toBe(false);
  });
});

// --- getDiscoveryTimeout ---

describe("getDiscoveryTimeout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 10 by default", () => {
    delete process.env.OAUTH2_DISCOVERY_TIMEOUT;
    expect(getDiscoveryTimeout()).toBe(10);
  });

  it("returns configured value", () => {
    vi.stubEnv("OAUTH2_DISCOVERY_TIMEOUT", "30");
    expect(getDiscoveryTimeout()).toBe(30);
  });

  it.each(["abc", "-5", "0"])("returns 10 for invalid value '%s'", (value) => {
    vi.stubEnv("OAUTH2_DISCOVERY_TIMEOUT", value);
    expect(getDiscoveryTimeout()).toBe(10);
  });
});

// --- deriveAuthorizationServerUrl ---

describe("deriveAuthorizationServerUrl", () => {
  it("appends /o to the base URL", () => {
    expect(deriveAuthorizationServerUrl("https://gateway.example.com")).toBe(
      "https://gateway.example.com/o",
    );
  });

  it("strips trailing slashes before appending", () => {
    expect(deriveAuthorizationServerUrl("https://gateway.example.com/")).toBe(
      "https://gateway.example.com/o",
    );
  });
});

// --- deriveOidcDiscoveryUrl ---

describe("deriveOidcDiscoveryUrl", () => {
  it("builds the OIDC discovery URL", () => {
    expect(deriveOidcDiscoveryUrl("https://gateway.example.com")).toBe(
      "https://gateway.example.com/o/.well-known/openid-configuration",
    );
  });
});

// --- buildConfig ---

describe("buildConfig", () => {
  it("builds config with correct values", () => {
    const config = buildConfig(
      "https://gateway.example.com",
      "https://mcp.example.com",
      false,
    );

    expect(config.serverUrl).toBe("https://mcp.example.com");
    expect(config.authorizationServerUrl).toBe("https://gateway.example.com/o");
    expect(config.writeOperationsEnabled).toBe(false);
  });

  it("strips trailing slash from server URL", () => {
    const config = buildConfig(
      "https://gateway.example.com",
      "https://mcp.example.com/",
      true,
    );

    expect(config.serverUrl).toBe("https://mcp.example.com");
    expect(config.writeOperationsEnabled).toBe(true);
  });
});

// --- probeOidcDiscovery ---

describe("probeOidcDiscovery", () => {
  let mockServer: http.Server;
  let mockPort: number;
  let responseBody: object;
  let responseStatus: number;

  beforeEach(async () => {
    responseBody = {
      issuer: "",
      authorization_endpoint: "http://localhost/o/authorize/",
      token_endpoint: "http://localhost/o/token/",
    };
    responseStatus = 200;

    const mockApp = express();
    mockApp.get(
      "/o/.well-known/openid-configuration",
      (req: express.Request, res: express.Response) => {
        res.status(responseStatus).json(responseBody);
      },
    );

    await new Promise<void>((resolve) => {
      mockServer = mockApp.listen(0, () => {
        const addr = mockServer.address();
        if (addr && typeof addr !== "string") {
          mockPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  it("succeeds when issuer matches expected value", async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    responseBody = { ...responseBody, issuer: `${baseUrl}/o` };

    const result = await probeOidcDiscovery(baseUrl, 5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issuer).toBe(`${baseUrl}/o`);
    }
  });

  it("succeeds when issuer matches after port normalization", async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    responseBody = {
      ...responseBody,
      issuer: `http://localhost:${mockPort}/o`,
    };

    const result = await probeOidcDiscovery(baseUrl, 5);

    expect(result.ok).toBe(true);
  });

  it("fails when metadata issuer is not a valid URL", async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    responseBody = { ...responseBody, issuer: "not-a-url" };

    const result = await probeOidcDiscovery(baseUrl, 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not a valid URL");
    }
  });

  it("fails when metadata issuer uses non-http protocol", async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    responseBody = { ...responseBody, issuer: "ftp://example.com/o" };

    const result = await probeOidcDiscovery(baseUrl, 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("http or https");
    }
  });

  it("fails when issuer does not match", async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    responseBody = { ...responseBody, issuer: "https://wrong-issuer.com/o" };

    const result = await probeOidcDiscovery(baseUrl, 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Issuer mismatch");
      expect(result.reason).toContain(`${baseUrl}/o`);
      expect(result.reason).toContain("wrong-issuer");
    }
  });

  it("fails when response is not 200", async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    responseStatus = 500;

    const result = await probeOidcDiscovery(baseUrl, 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("HTTP 500");
    }
  });

  it("fails when issuer field is missing", async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    responseBody = { authorization_endpoint: "http://localhost/o/authorize/" };

    const result = await probeOidcDiscovery(baseUrl, 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("missing issuer");
    }
  });

  it("fails when response is not valid JSON", async () => {
    const badJsonApp = express();
    badJsonApp.get(
      "/o/.well-known/openid-configuration",
      (_req: express.Request, res: express.Response) => {
        res.set("Content-Type", "application/json");
        res.status(200).send("not valid json{{{");
      },
    );
    const badJsonServer = await new Promise<http.Server>((resolve) => {
      const s = badJsonApp.listen(0, () => resolve(s));
    });
    const badJsonPort = (badJsonServer.address() as { port: number }).port;

    try {
      const result = await probeOidcDiscovery(
        `http://localhost:${badJsonPort}`,
        5,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("unparseable JSON");
      }
    } finally {
      await new Promise<void>((resolve) =>
        badJsonServer.close(() => resolve()),
      );
    }
  });

  it("fails when server is unreachable", async () => {
    const result = await probeOidcDiscovery("http://localhost:1", 2);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("OIDC Discovery failed");
    }
  });

  it("fails on timeout", async () => {
    const slowApp = express();
    slowApp.get(
      "/o/.well-known/openid-configuration",
      (_req: express.Request, _res: express.Response) => {
        // Never responds
      },
    );
    const slowServer = await new Promise<http.Server>((resolve) => {
      const s = slowApp.listen(0, () => resolve(s));
    });
    const slowPort = (slowServer.address() as { port: number }).port;

    try {
      const result = await probeOidcDiscovery(
        `http://localhost:${slowPort}`,
        1,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("timed out");
      }
    } finally {
      await new Promise<void>((resolve) => slowServer.close(() => resolve()));
    }
  });

  it("fails when base URL is not a valid URL", async () => {
    const result = await probeOidcDiscovery("not-a-url", 5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Expected issuer");
      expect(result.reason).toContain("not a valid URL");
    }
  });
});

// --- validateIssuerUrl ---

describe("validateIssuerUrl", () => {
  it.each([
    ["https://example.com/o", "https://example.com/o", "valid https URL"],
    ["http://localhost/o", "http://localhost/o", "valid http URL"],
    [
      "https://example.com:443/o",
      "https://example.com/o",
      "strips default https port 443",
    ],
    [
      "http://localhost:80/o",
      "http://localhost/o",
      "strips default http port 80",
    ],
    [
      "https://example.com:8443/o",
      "https://example.com:8443/o",
      "preserves non-default ports",
    ],
    [
      "https://example.com/o/",
      "https://example.com/o",
      "strips trailing slashes",
    ],
  ])("normalizes %s → %s (%s)", (input, expected) => {
    const result = validateIssuerUrl(input, "Test");
    expect(result).toEqual({ ok: true, normalized: expected });
  });

  it.each([
    ["not-a-url", "Test", "not a valid URL", "invalid URL"],
    ["ftp://example.com/o", "Test", "http or https", "non-http(s) protocol"],
    ["bad", "Metadata issuer", "Metadata issuer", "includes label in reason"],
  ])("rejects %s — %s (%s)", (input, label, expectedReason) => {
    const result = validateIssuerUrl(input, label);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(expectedReason);
    }
  });
});

// --- determineSupportedScopes ---

describe("determineSupportedScopes", () => {
  it("returns read-only scope when write operations are disabled", () => {
    expect(determineSupportedScopes(false)).toEqual(["read"]);
  });

  it("returns read and write scopes when write operations are enabled", () => {
    expect(determineSupportedScopes(true)).toEqual(["read", "write"]);
  });
});

// --- resolveResourceUrl ---

describe("resolveResourceUrl", () => {
  it("combines server URL and path", () => {
    expect(resolveResourceUrl("https://mcp.example.com", "/mcp")).toBe(
      "https://mcp.example.com/mcp",
    );
  });

  it("strips trailing slash from server URL", () => {
    expect(resolveResourceUrl("https://mcp.example.com/", "/mcp")).toBe(
      "https://mcp.example.com/mcp",
    );
  });

  it("adds leading slash to path when missing", () => {
    expect(resolveResourceUrl("https://mcp.example.com", "mcp")).toBe(
      "https://mcp.example.com/mcp",
    );
  });

  it("handles root path", () => {
    expect(resolveResourceUrl("https://mcp.example.com", "/")).toBe(
      "https://mcp.example.com/",
    );
  });

  it("handles nested paths", () => {
    expect(resolveResourceUrl("https://mcp.example.com", "/toolset/mcp")).toBe(
      "https://mcp.example.com/toolset/mcp",
    );
  });
});

// --- buildResourceMetadata ---

describe("buildResourceMetadata", () => {
  const config: ProtectedResourceConfig = {
    serverUrl: "https://mcp.example.com",
    authorizationServerUrl: "https://gateway.example.com/o",
    writeOperationsEnabled: false,
  };

  it("returns correct metadata for a resource URL", () => {
    const metadata = buildResourceMetadata(
      "https://mcp.example.com/mcp",
      config,
    );

    expect(metadata.resource).toBe("https://mcp.example.com/mcp");
    expect(metadata.authorization_servers).toEqual([
      "https://gateway.example.com/o",
    ]);
    expect(metadata.scopes_supported).toEqual(["read"]);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
    expect(metadata.resource_name).toBe("Ansible MCP Server");
  });

  it("includes write scope when write operations are enabled", () => {
    const writeConfig = { ...config, writeOperationsEnabled: true };
    const metadata = buildResourceMetadata(
      "https://mcp.example.com/mcp",
      writeConfig,
    );

    expect(metadata.scopes_supported).toEqual(["read", "write"]);
  });

  it("resource field matches the provided resource URL exactly", () => {
    const url = "https://mcp.example.com/toolset/mcp";
    const metadata = buildResourceMetadata(url, config);

    expect(metadata.resource).toBe(url);
  });
});

// --- buildResourceMetadataUrl ---

describe("buildResourceMetadataUrl", () => {
  it("constructs metadata URL for /mcp path", () => {
    expect(buildResourceMetadataUrl("https://mcp.example.com", "/mcp")).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("constructs metadata URL for nested path", () => {
    expect(
      buildResourceMetadataUrl("https://mcp.example.com", "/toolset/mcp"),
    ).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource/toolset/mcp",
    );
  });

  it("strips trailing slash from server URL", () => {
    expect(buildResourceMetadataUrl("https://mcp.example.com/", "/mcp")).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    );
  });
});

// --- buildWwwAuthenticateHeader ---

describe("buildWwwAuthenticateHeader", () => {
  const metadataUrl =
    "https://mcp.example.com/.well-known/oauth-protected-resource/mcp";

  it("builds header for missing token (no error parameter)", () => {
    const header = buildWwwAuthenticateHeader(metadataUrl, ["read"]);

    expect(header).toBe(
      `Bearer resource_metadata="${metadataUrl}", scope="read"`,
    );
  });

  it("builds header for invalid token with error parameter", () => {
    const header = buildWwwAuthenticateHeader(
      metadataUrl,
      ["read"],
      "invalid_token",
    );

    expect(header).toBe(
      `Bearer error="invalid_token", resource_metadata="${metadataUrl}", scope="read"`,
    );
  });

  it("includes correct scope value for read-write mode", () => {
    const header = buildWwwAuthenticateHeader(metadataUrl, ["read", "write"]);

    expect(header).toContain('scope="read write"');
  });

  it("starts with Bearer scheme", () => {
    const header = buildWwwAuthenticateHeader(metadataUrl, ["read"]);

    expect(header).toMatch(/^Bearer /);
  });

  it("sanitizes double quotes from resource_metadata URL", () => {
    const maliciousUrl =
      'https://example.com/.well-known/oauth-protected-resource/"injected';
    const header = buildWwwAuthenticateHeader(maliciousUrl, ["read"]);

    expect(header).not.toContain('""');
    expect(header).not.toContain('"injected');
  });

  it("sanitizes backslashes from resource_metadata URL", () => {
    const maliciousUrl =
      "https://example.com/.well-known/oauth-protected-resource/\\path";
    const header = buildWwwAuthenticateHeader(maliciousUrl, ["read"]);

    expect(header).not.toContain("\\");
  });
});

// --- Backward compatibility: OAuth disabled ---

describe("backward compatibility when OAuth is disabled", () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    app.post("/mcp", (req, res) => {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Unauthorized: Bearer token required" },
        id: null,
      });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("401 response does NOT include WWW-Authenticate when OAuth is not configured", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("/.well-known/oauth-protected-resource returns 404 when router is not mounted", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource`,
    );

    expect(response.status).toBe(404);
  });
});

// --- buildValidMcpPaths ---

describe("buildValidMcpPaths", () => {
  it("includes root and /mcp paths", () => {
    const paths = buildValidMcpPaths([]);
    expect(paths.has("/")).toBe(true);
    expect(paths.has("/mcp")).toBe(true);
  });

  it("includes both path formats for each toolset", () => {
    const paths = buildValidMcpPaths(["job_management"]);
    expect(paths.has("/mcp/job_management")).toBe(true);
    expect(paths.has("/job_management/mcp")).toBe(true);
  });

  it("includes paths for multiple toolsets", () => {
    const paths = buildValidMcpPaths([
      "job_management",
      "inventory_management",
    ]);
    expect(paths.size).toBe(6);
  });
});

// --- createProtectedResourceRouter (HTTP-level) ---

describe("createProtectedResourceRouter", () => {
  const config: ProtectedResourceConfig = {
    serverUrl: "https://mcp.example.com",
    authorizationServerUrl: "https://gateway.example.com/o",
    writeOperationsEnabled: false,
  };

  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    app = express();
    app.use(
      createProtectedResourceRouter(config, [
        "job_management",
        "inventory_management",
      ]),
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr !== "string") {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("GET /.well-known/oauth-protected-resource returns 200 with correct metadata", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resource).toBe("https://mcp.example.com/");
    expect(body.authorization_servers).toEqual([
      "https://gateway.example.com/o",
    ]);
    expect(body.scopes_supported).toEqual(["read"]);
    expect(body.bearer_methods_supported).toEqual(["header"]);
    expect(body.resource_name).toBe("Ansible MCP Server");
  });

  it("GET /.well-known/oauth-protected-resource returns application/json", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource`,
    );

    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("GET /.well-known/oauth-protected-resource returns Cache-Control: no-store", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource`,
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /.well-known/oauth-protected-resource/mcp returns path-specific metadata", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resource).toBe("https://mcp.example.com/mcp");
  });

  it("GET /.well-known/oauth-protected-resource/mcp/job_management returns toolset-specific metadata", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp/job_management`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resource).toBe("https://mcp.example.com/mcp/job_management");
  });

  it("GET /.well-known/oauth-protected-resource/job_management/mcp returns alternate toolset path", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/job_management/mcp`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resource).toBe("https://mcp.example.com/job_management/mcp");
  });

  it("returns 405 for POST requests", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource`,
      { method: "POST" },
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, OPTIONS");
  });

  it("returns 405 for PUT requests on path-specific endpoint", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
      { method: "PUT" },
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, OPTIONS");
  });

  it("returns 404 for unknown toolset path", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/nonexistent/mcp`,
    );

    expect(response.status).toBe(404);
  });

  it("path-specific endpoint returns Cache-Control: no-store", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

// --- getRetryConfig ---

describe("getRetryConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to unbounded retries when env var is not set", () => {
    delete process.env.OAUTH2_DISCOVERY_MAX_RETRIES;
    delete process.env.OAUTH2_DISCOVERY_RETRY_DELAY_MS;
    delete process.env.OAUTH2_DISCOVERY_MAX_RETRY_DELAY_MS;

    const config = getRetryConfig();
    expect(config.maxRetries).toBe(-1);
    expect(config.initialDelayMs).toBe(30000);
    expect(config.maxDelayMs).toBe(180000);
  });

  it("reads values from env vars", () => {
    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRIES", "3");
    vi.stubEnv("OAUTH2_DISCOVERY_RETRY_DELAY_MS", "1000");
    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRY_DELAY_MS", "30000");

    const config = getRetryConfig();
    expect(config.maxRetries).toBe(3);
    expect(config.initialDelayMs).toBe(1000);
    expect(config.maxDelayMs).toBe(30000);
  });

  it("treats maxRetries=0 as no retries", () => {
    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRIES", "0");

    const config = getRetryConfig();
    expect(config.maxRetries).toBe(0);
  });

  it("falls back to unbounded for invalid maxRetries", () => {
    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRIES", "abc");
    vi.stubEnv("OAUTH2_DISCOVERY_RETRY_DELAY_MS", "-1");
    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRY_DELAY_MS", "0");

    const config = getRetryConfig();
    expect(config.maxRetries).toBe(-1);
    expect(config.initialDelayMs).toBe(30000);
    expect(config.maxDelayMs).toBe(180000);
  });
});

// --- probeOidcDiscoveryWithRetry ---

describe("probeOidcDiscoveryWithRetry", () => {
  let mockServer: http.Server;
  let mockPort: number;
  let requestCount: number;
  let responseStatus: number;
  let responseBody: object;

  beforeEach(async () => {
    requestCount = 0;
    responseStatus = 503;
    responseBody = {};

    const mockApp = express();
    mockApp.get(
      "/o/.well-known/openid-configuration",
      (req: express.Request, res: express.Response) => {
        requestCount++;
        res.status(responseStatus).json(responseBody);
      },
    );

    await new Promise<void>((resolve) => {
      mockServer = mockApp.listen(0, () => {
        const addr = mockServer.address();
        if (addr && typeof addr !== "string") {
          mockPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  it("returns failure after exhausting all retries", async () => {
    const result = await probeOidcDiscoveryWithRetry(
      `http://localhost:${mockPort}`,
      2,
      { maxRetries: 2, initialDelayMs: 10, maxDelayMs: 50 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("after 2 retries");
    }
    expect(requestCount).toBe(2);
  });

  it("succeeds on a retry after initial failures", async () => {
    const baseUrl = `http://localhost:${mockPort}`;
    let callCount = 0;

    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });

    const mockApp = express();
    mockApp.get(
      "/o/.well-known/openid-configuration",
      (req: express.Request, res: express.Response) => {
        callCount++;
        if (callCount < 3) {
          res.status(503).json({});
        } else {
          res.status(200).json({ issuer: `${baseUrl}/o` });
        }
      },
    );

    await new Promise<void>((resolve) => {
      mockServer = mockApp.listen(mockPort, () => resolve());
    });

    const result = await probeOidcDiscoveryWithRetry(baseUrl, 2, {
      maxRetries: 5,
      initialDelayMs: 10,
      maxDelayMs: 50,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issuer).toBe(`${baseUrl}/o`);
    }
    expect(callCount).toBe(3);
  });

  it("applies exponential backoff between retries", async () => {
    const timestamps: number[] = [];
    const origDateNow = Date.now;

    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });

    const mockApp = express();
    mockApp.get(
      "/o/.well-known/openid-configuration",
      (req: express.Request, res: express.Response) => {
        timestamps.push(origDateNow.call(Date));
        res.status(503).json({});
      },
    );

    await new Promise<void>((resolve) => {
      mockServer = mockApp.listen(mockPort, () => resolve());
    });

    await probeOidcDiscoveryWithRetry(`http://localhost:${mockPort}`, 2, {
      maxRetries: 3,
      initialDelayMs: 50,
      maxDelayMs: 500,
    });

    expect(timestamps).toHaveLength(3);
    const gap1 = timestamps[1]! - timestamps[0]!;
    const gap2 = timestamps[2]! - timestamps[1]!;
    expect(gap1).toBeGreaterThanOrEqual(40);
    expect(gap2).toBeGreaterThanOrEqual(80);
    expect(gap2).toBeGreaterThan(gap1);
  });

  it("does not retry when maxRetries is 0", async () => {
    const result = await probeOidcDiscoveryWithRetry(
      `http://localhost:${mockPort}`,
      2,
      { maxRetries: 0, initialDelayMs: 10, maxDelayMs: 50 },
    );

    expect(result.ok).toBe(false);
    expect(requestCount).toBe(0);
  });
});

// --- initOAuth2Discovery ---

describe("initOAuth2Discovery", () => {
  let mockServer: http.Server;
  let mockPort: number;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (mockServer) {
      await new Promise<void>((resolve) => {
        mockServer.close(() => resolve());
      });
    }
  });

  const startMockOidc = async (
    handler: (
      port: number,
    ) => (req: express.Request, res: express.Response) => void,
  ): Promise<string> => {
    const mockApp = express();
    await new Promise<void>((resolve) => {
      mockServer = mockApp.listen(0, () => {
        const addr = mockServer.address();
        if (addr && typeof addr !== "string") {
          mockPort = addr.port;
        }
        resolve();
      });
    });
    mockApp.get("/o/.well-known/openid-configuration", handler(mockPort));
    return `http://localhost:${mockPort}`;
  };

  it("calls onEnabled immediately when probe succeeds", async () => {
    const baseUrl = await startMockOidc((port) => (_req, res) => {
      res.status(200).json({ issuer: `http://localhost:${port}/o` });
    });
    const onEnabled = vi.fn();

    await initOAuth2Discovery(baseUrl, onEnabled);

    expect(onEnabled).toHaveBeenCalledOnce();
  });

  it("does not call onEnabled when probe fails and maxRetries is 0", async () => {
    const baseUrl = await startMockOidc(() => (_req, res) => {
      res.status(503).json({});
    });
    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRIES", "0");
    const onEnabled = vi.fn();

    await initOAuth2Discovery(baseUrl, onEnabled);

    expect(onEnabled).not.toHaveBeenCalled();
  });

  it("calls onEnabled after successful retry", async () => {
    let callCount = 0;
    const baseUrl = await startMockOidc((port) => (_req, res) => {
      callCount++;
      if (callCount < 3) {
        res.status(503).json({});
      } else {
        res.status(200).json({ issuer: `http://localhost:${port}/o` });
      }
    });

    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRIES", "5");
    vi.stubEnv("OAUTH2_DISCOVERY_RETRY_DELAY_MS", "10");
    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRY_DELAY_MS", "50");
    const onEnabled = vi.fn();

    await initOAuth2Discovery(baseUrl, onEnabled);

    await vi.waitFor(() => {
      expect(onEnabled).toHaveBeenCalledOnce();
    });
  });

  it("does not call onEnabled when all retries exhausted", async () => {
    const baseUrl = await startMockOidc(() => (_req, res) => {
      res.status(503).json({});
    });
    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRIES", "2");
    vi.stubEnv("OAUTH2_DISCOVERY_RETRY_DELAY_MS", "10");
    vi.stubEnv("OAUTH2_DISCOVERY_MAX_RETRY_DELAY_MS", "50");
    const onEnabled = vi.fn();

    await initOAuth2Discovery(baseUrl, onEnabled);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onEnabled).not.toHaveBeenCalled();
  });
});
