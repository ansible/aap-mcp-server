import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OidcTokenVerifier,
  buildProtectedResourceMetadata,
} from "./oidc.js";
import type { OidcConfig } from "./config-utils.js";

const mockDiscoveryDoc = {
  issuer: "https://sso.example.com/realms/aap",
  authorization_endpoint:
    "https://sso.example.com/realms/aap/protocol/openid-connect/auth",
  token_endpoint:
    "https://sso.example.com/realms/aap/protocol/openid-connect/token",
  introspection_endpoint:
    "https://sso.example.com/realms/aap/protocol/openid-connect/token/introspect",
  jwks_uri: "https://sso.example.com/realms/aap/protocol/openid-connect/certs",
  registration_endpoint:
    "https://sso.example.com/realms/aap/clients-registrations/openid-connect",
  scopes_supported: ["openid", "mcp:tools"],
  response_types_supported: ["code"],
};

function createJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", typ: "JWT" },
): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode(header)}.${encode(payload)}.fake-signature`;
}

describe("OidcTokenVerifier", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("initialize", () => {
    it("should fetch OIDC discovery document", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDiscoveryDoc),
      });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      expect(global.fetch).toHaveBeenCalledWith(
        "https://sso.example.com/realms/aap/.well-known/openid-configuration",
      );

      const doc = verifier.getDiscoveryDocument();
      expect(doc).toBeTruthy();
      expect(doc!.issuer).toBe("https://sso.example.com/realms/aap");
    });

    it("should try OAuth AS metadata if OIDC discovery fails", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscoveryDoc),
        });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://sso.example.com/realms/aap/.well-known/oauth-authorization-server",
      );
    });

    it("should throw when discovery fails for all URLs", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: false, status: 404 });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await expect(verifier.initialize()).rejects.toThrow(
        "Failed to fetch OIDC discovery document",
      );
    });

    it("should strip trailing slash from issuer URL", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDiscoveryDoc),
      });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap/",
        client_id: "aap-mcp",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      expect(global.fetch).toHaveBeenCalledWith(
        "https://sso.example.com/realms/aap/.well-known/openid-configuration",
      );
    });
  });

  describe("verifyAccessToken via introspection", () => {
    it("should verify a valid token", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscoveryDoc),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              active: true,
              client_id: "test-client",
              scope: "openid mcp:tools",
              exp: Math.floor(Date.now() / 1000) + 3600,
              sub: "user-123",
              aud: "http://localhost:3000",
            }),
        });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
        client_secret: "secret",
        audience: "http://localhost:3000",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      const result = await verifier.verifyAccessToken("valid-token");
      expect(result.clientId).toBe("test-client");
      expect(result.scopes).toContain("openid");
      expect(result.scopes).toContain("mcp:tools");
      expect(result.subject).toBe("user-123");
    });

    it("should reject inactive token", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscoveryDoc),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ active: false }),
        });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
        client_secret: "secret",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      await expect(verifier.verifyAccessToken("expired-token")).rejects.toThrow(
        "Token is inactive",
      );
    });

    it("should reject token with wrong audience", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscoveryDoc),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              active: true,
              client_id: "test-client",
              aud: "https://other-server.com",
            }),
        });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
        client_secret: "secret",
        audience: "http://localhost:3000",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      await expect(verifier.verifyAccessToken("wrong-aud-token")).rejects.toThrow(
        "Audience mismatch",
      );
    });

    it("should reject token missing required scopes", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscoveryDoc),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              active: true,
              client_id: "test-client",
              scope: "openid",
            }),
        });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
        client_secret: "secret",
        required_scopes: ["mcp:tools"],
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      await expect(
        verifier.verifyAccessToken("limited-scope-token"),
      ).rejects.toThrow("Missing required scope: mcp:tools");
    });

    it("should handle introspection endpoint failure", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscoveryDoc),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal server error"),
        });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
        client_secret: "secret",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      await expect(verifier.verifyAccessToken("any-token")).rejects.toThrow(
        "Token introspection failed",
      );
    });
  });

  describe("verifyAccessToken via JWT structure (no introspection)", () => {
    it("should verify a valid JWT", async () => {
      const payload = {
        iss: "https://sso.example.com/realms/aap",
        aud: "http://localhost:3000",
        sub: "user-456",
        azp: "client-app",
        scope: "openid mcp:tools",
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const discoveryWithoutIntrospection = {
        ...mockDiscoveryDoc,
        introspection_endpoint: undefined,
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(discoveryWithoutIntrospection),
      });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
        audience: "http://localhost:3000",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      const result = await verifier.verifyAccessToken(createJwt(payload));
      expect(result.clientId).toBe("client-app");
      expect(result.subject).toBe("user-456");
      expect(result.scopes).toContain("mcp:tools");
    });

    it("should reject expired JWT", async () => {
      const payload = {
        iss: "https://sso.example.com/realms/aap",
        sub: "user-456",
        exp: Math.floor(Date.now() / 1000) - 3600,
      };

      const discoveryWithoutIntrospection = {
        ...mockDiscoveryDoc,
        introspection_endpoint: undefined,
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(discoveryWithoutIntrospection),
      });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      await expect(
        verifier.verifyAccessToken(createJwt(payload)),
      ).rejects.toThrow("Token has expired");
    });

    it("should reject JWT with wrong issuer", async () => {
      const payload = {
        iss: "https://evil.example.com/realms/aap",
        sub: "user-456",
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      const discoveryWithoutIntrospection = {
        ...mockDiscoveryDoc,
        introspection_endpoint: undefined,
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(discoveryWithoutIntrospection),
      });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      await expect(
        verifier.verifyAccessToken(createJwt(payload)),
      ).rejects.toThrow("Issuer mismatch");
    });

    it("should reject non-JWT token", async () => {
      const discoveryWithoutIntrospection = {
        ...mockDiscoveryDoc,
        introspection_endpoint: undefined,
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(discoveryWithoutIntrospection),
      });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      await expect(
        verifier.verifyAccessToken("not-a-jwt-token"),
      ).rejects.toThrow("Invalid JWT format");
    });
  });

  describe("getOAuthMetadata", () => {
    it("should return OAuth metadata from discovery", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDiscoveryDoc),
      });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      const metadata = verifier.getOAuthMetadata();
      expect(metadata).toBeTruthy();
      expect(metadata!.issuer).toBe("https://sso.example.com/realms/aap");
      expect(metadata!.authorization_endpoint).toContain("auth");
      expect(metadata!.token_endpoint).toContain("token");
    });

    it("should return null before initialization", () => {
      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      expect(verifier.getOAuthMetadata()).toBeNull();
    });
  });

  describe("audience validation", () => {
    it("should accept array audience with matching entry", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscoveryDoc),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              active: true,
              client_id: "test",
              aud: ["https://other.com", "http://localhost:3000"],
            }),
        });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
        client_secret: "secret",
        audience: "http://localhost:3000",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      const result = await verifier.verifyAccessToken("valid-token");
      expect(result.clientId).toBe("test");
    });

    it("should normalize trailing slashes in audience comparison", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscoveryDoc),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              active: true,
              client_id: "test",
              aud: "http://localhost:3000/",
            }),
        });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
        client_secret: "secret",
        audience: "http://localhost:3000",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      const result = await verifier.verifyAccessToken("valid-token");
      expect(result.clientId).toBe("test");
    });

    it("should skip audience validation when not configured", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscoveryDoc),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              active: true,
              client_id: "test",
            }),
        });

      const config: OidcConfig = {
        enabled: true,
        issuer_url: "https://sso.example.com/realms/aap",
        client_id: "aap-mcp",
        client_secret: "secret",
      };

      const verifier = new OidcTokenVerifier(config, "http://localhost:3000");
      await verifier.initialize();

      const result = await verifier.verifyAccessToken("valid-token");
      expect(result.clientId).toBe("test");
    });
  });
});

describe("buildProtectedResourceMetadata", () => {
  it("should build correct PRM document", () => {
    const config: OidcConfig = {
      enabled: true,
      issuer_url: "https://sso.example.com/realms/aap/",
      client_id: "aap-mcp",
      scopes: ["openid", "mcp:tools"],
    };

    const metadata = buildProtectedResourceMetadata(
      "http://localhost:3000",
      config,
    );

    expect(metadata.resource).toBe("http://localhost:3000");
    expect(metadata.authorization_servers).toEqual([
      "https://sso.example.com/realms/aap",
    ]);
    expect(metadata.scopes_supported).toEqual(["openid", "mcp:tools"]);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });

  it("should strip trailing slashes from URLs", () => {
    const config: OidcConfig = {
      enabled: true,
      issuer_url: "https://sso.example.com/realms/aap/",
      client_id: "aap-mcp",
    };

    const metadata = buildProtectedResourceMetadata(
      "http://localhost:3000/",
      config,
    );

    expect(metadata.resource).toBe("http://localhost:3000");
    expect(metadata.authorization_servers).toEqual([
      "https://sso.example.com/realms/aap",
    ]);
  });

  it("should default scopes to openid when not specified", () => {
    const config: OidcConfig = {
      enabled: true,
      issuer_url: "https://sso.example.com/realms/aap",
      client_id: "aap-mcp",
    };

    const metadata = buildProtectedResourceMetadata(
      "http://localhost:3000",
      config,
    );

    expect(metadata.scopes_supported).toEqual(["openid"]);
  });
});
