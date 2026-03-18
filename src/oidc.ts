import type { OidcConfig } from "./config-utils.js";

const getTimestamp = (): string => {
  return new Date().toISOString().split(".")[0] + "Z";
};

interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  introspection_endpoint?: string;
  jwks_uri: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
}

interface JwksKey {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  x5c?: string[];
}

interface Jwks {
  keys: JwksKey[];
}

export interface TokenVerificationResult {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  subject?: string;
}

export interface OAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  introspection_endpoint?: string;
  response_types_supported: string[];
}

/**
 * Resolves OIDC discovery and provides token verification via introspection.
 *
 * Follows RFC 9728 (Protected Resource Metadata) and the MCP authorization
 * specification for third-party IdP integration.
 */
export class OidcTokenVerifier {
  private discoveryDoc: OidcDiscoveryDocument | null = null;
  private jwks: Jwks | null = null;
  private config: OidcConfig;
  private serverUrl: string;
  private discoveryFetched = false;

  constructor(config: OidcConfig, serverUrl: string) {
    this.config = config;
    this.serverUrl = serverUrl;
  }

  async initialize(): Promise<void> {
    await this.fetchDiscovery();
  }

  private async fetchDiscovery(): Promise<void> {
    if (this.discoveryFetched) return;

    const issuerUrl = this.config.issuer_url.replace(/\/$/, "");

    const urls = [
      `${issuerUrl}/.well-known/openid-configuration`,
      `${issuerUrl}/.well-known/oauth-authorization-server`,
    ];

    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          this.discoveryDoc =
            (await response.json()) as OidcDiscoveryDocument;
          this.discoveryFetched = true;
          console.log(
            `${getTimestamp()} OIDC discovery loaded from ${url}`,
          );
          return;
        }
      } catch {
        // Try next URL
      }
    }

    throw new Error(
      `Failed to fetch OIDC discovery document from issuer: ${issuerUrl}`,
    );
  }

  private async fetchJwks(): Promise<Jwks> {
    if (this.jwks) return this.jwks;

    await this.fetchDiscovery();
    if (!this.discoveryDoc?.jwks_uri) {
      throw new Error("No jwks_uri in OIDC discovery document");
    }

    const response = await fetch(this.discoveryDoc.jwks_uri);
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS: ${response.status}`);
    }

    this.jwks = (await response.json()) as Jwks;
    return this.jwks;
  }

  getDiscoveryDocument(): OidcDiscoveryDocument | null {
    return this.discoveryDoc;
  }

  getOAuthMetadata(): OAuthServerMetadata | null {
    if (!this.discoveryDoc) return null;
    return {
      issuer: this.discoveryDoc.issuer,
      authorization_endpoint: this.discoveryDoc.authorization_endpoint,
      token_endpoint: this.discoveryDoc.token_endpoint,
      registration_endpoint: this.discoveryDoc.registration_endpoint,
      introspection_endpoint: this.discoveryDoc.introspection_endpoint,
      response_types_supported:
        this.discoveryDoc.response_types_supported || ["code"],
    };
  }

  /**
   * Verify an access token via the OIDC provider's introspection endpoint.
   * Falls back to basic JWT structure validation if introspection is unavailable.
   */
  async verifyAccessToken(
    token: string,
  ): Promise<TokenVerificationResult> {
    await this.fetchDiscovery();

    if (
      this.discoveryDoc?.introspection_endpoint &&
      this.config.client_id &&
      this.config.client_secret
    ) {
      return this.verifyViaIntrospection(token);
    }

    return this.verifyViaJwtStructure(token);
  }

  private async verifyViaIntrospection(
    token: string,
  ): Promise<TokenVerificationResult> {
    const endpoint = this.discoveryDoc!.introspection_endpoint!;

    const params = new URLSearchParams({
      token,
      client_id: this.config.client_id,
    });

    if (this.config.client_secret) {
      params.set("client_secret", this.config.client_secret);
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `${getTimestamp()} OIDC introspection failed: ${response.status} ${text}`,
      );
      throw new Error(`Token introspection failed: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (data.active === false) {
      throw new Error("Token is inactive");
    }

    this.validateAudience(data);
    this.validateRequiredScopes(data);

    return {
      token,
      clientId: (data.client_id as string) || "unknown",
      scopes: (data.scope as string)
        ? (data.scope as string).split(" ")
        : [],
      expiresAt: data.exp as number | undefined,
      subject: data.sub as string | undefined,
    };
  }

  /**
   * Basic JWT structure validation: decode the payload (without cryptographic
   * signature verification) and check standard claims. This is a fallback when
   * introspection is not available.
   *
   * For production deployments, configure introspection (client_id + client_secret)
   * or use the AAP Gateway /me/ endpoint as an additional validation layer.
   */
  private async verifyViaJwtStructure(
    token: string,
  ): Promise<TokenVerificationResult> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf-8"),
      );
    } catch {
      throw new Error("Failed to decode JWT payload");
    }

    const issuerUrl = this.config.issuer_url.replace(/\/$/, "");
    const tokenIssuer = (payload.iss as string)?.replace(/\/$/, "");
    if (tokenIssuer !== issuerUrl) {
      throw new Error(
        `Issuer mismatch: expected ${issuerUrl}, got ${tokenIssuer}`,
      );
    }

    if (payload.exp && (payload.exp as number) < Math.floor(Date.now() / 1000)) {
      throw new Error("Token has expired");
    }

    this.validateAudience(payload);
    this.validateRequiredScopes(payload);

    return {
      token,
      clientId: (payload.azp as string) || (payload.client_id as string) || "unknown",
      scopes: (payload.scope as string)
        ? (payload.scope as string).split(" ")
        : [],
      expiresAt: payload.exp as number | undefined,
      subject: payload.sub as string | undefined,
    };
  }

  private validateAudience(data: Record<string, unknown>): void {
    if (!this.config.audience) return;

    const aud = data.aud;
    const expectedAudience = this.config.audience;
    const audiences: string[] = Array.isArray(aud)
      ? (aud as string[])
      : aud
        ? [aud as string]
        : [];

    if (audiences.length === 0) {
      throw new Error("Token missing audience claim");
    }

    const normalizedExpected = expectedAudience.replace(/\/$/, "");
    const matched = audiences.some(
      (a) => a.replace(/\/$/, "") === normalizedExpected,
    );

    if (!matched) {
      throw new Error(
        `Audience mismatch: expected ${expectedAudience}, got ${audiences.join(", ")}`,
      );
    }
  }

  private validateRequiredScopes(data: Record<string, unknown>): void {
    const requiredScopes = this.config.required_scopes;
    if (!requiredScopes || requiredScopes.length === 0) return;

    const tokenScopes = (data.scope as string)
      ? (data.scope as string).split(" ")
      : [];

    for (const required of requiredScopes) {
      if (!tokenScopes.includes(required)) {
        throw new Error(`Missing required scope: ${required}`);
      }
    }
  }
}

/**
 * Build the RFC 9728 Protected Resource Metadata document for this MCP server.
 */
export function buildProtectedResourceMetadata(
  serverUrl: string,
  oidcConfig: OidcConfig,
): Record<string, unknown> {
  const resource = serverUrl.replace(/\/$/, "");

  return {
    resource,
    authorization_servers: [oidcConfig.issuer_url.replace(/\/$/, "")],
    scopes_supported: oidcConfig.scopes || ["openid"],
    bearer_methods_supported: ["header"],
  };
}
