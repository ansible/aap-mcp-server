import { AsyncLocalStorage } from "node:async_hooks";
import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { ProxyOptions } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { Response } from "express";

// Configuration for direct-gateway mode (AAP as authorization server).
export interface DirectGatewayConfig {
  baseUrl: string; // AAP base URL
  serverUrl: string; // MCP server's own public URL (used in PRM resource field)
  authorizationServer: string; // Authorization server URL advertised in PRM (env: OAUTH2_AUTHORIZATION_SERVER, defaults to baseUrl)
}

// Carries the MCP client's IP through async operations so the custom fetch
// can attach X-Forwarded-For on outbound requests to the upstream auth server.
const clientIpStore = new AsyncLocalStorage<string>();

// Custom fetch that injects X-Forwarded-For from the current async context.
const forwardingFetch: typeof fetch = (input, init) => {
  const clientIp = clientIpStore.getStore();
  if (clientIp) {
    const headers = new Headers(init?.headers);
    headers.set("X-Forwarded-For", clientIp);
    return fetch(input, { ...init, headers });
  }
  return fetch(input, init);
};

// Configuration required to initialize the OAuth2 provider.
export interface OAuth2Config {
  clientId: string;
  clientSecret?: string; // If omitted, operates as a public client (PKCE only, no secret)
  baseUrl: string; // AAP base URL (OIDC discovery at ${baseUrl}/o/.well-known/openid-configuration)
  serverUrl: string; // MCP server's own public URL (used as issuer and for callback URL)
  allowedRedirectHosts: string[]; // Hostnames allowed in client redirect_uris
}

// Returned by createOAuth2Provider() after successful OIDC discovery.
export interface OAuth2Setup {
  authRouter: express.RequestHandler; // Composed router: callback + PRM + mcpAuthRouter
  verifyAccessToken: (token: string) => Promise<AuthInfo>; // JWT verification via JWKS
  getResourceMetadataUrl: (path: string) => string; // Builds path-specific PRM URL (RFC 9728)
}

interface OIDCMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
}

// Extends ProxyOAuthServerProvider to:
// 1. Add local client registration (MCP clients require RFC 7591)
// 2. Intercept the redirect_uri so the upstream auth server only sees our
//    server's callback URL, not the MCP client's dynamic localhost port.
class AAPProxyOAuthServerProvider extends ProxyOAuthServerProvider {
  private _registeredRedirectUris = new Set<string>();
  private _conf: { clientId: string; clientSecret?: string };
  private _serverCallbackUrl: string;
  private _allowedRedirectHosts: string[];
  // Maps state → { redirect_uri, timestamp }. Entries expire after 10 minutes.
  private _pendingAuthorizations = new Map<
    string,
    { uri: string; createdAt: number }
  >();
  private static readonly PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

  constructor(
    options: ProxyOptions & {
      clientId: string;
      clientSecret?: string;
      serverCallbackUrl: string;
      allowedRedirectHosts: string[];
    },
  ) {
    super(options);
    this._conf = {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    };
    this._serverCallbackUrl = options.serverCallbackUrl;
    this._allowedRedirectHosts = options.allowedRedirectHosts;
  }

  // In-memory client store providing RFC 7591 Dynamic Client Registration.
  //
  // Why POST /register returns credentials without authentication:
  // The MCP protocol requires clients to call POST /register before starting
  // the OAuth2 flow — the client has no token yet at this point. AAP does not
  // support RFC 7591 natively, so we implement it locally. No new client is
  // created on the upstream auth server — the same pre-registered client_id
  // is always returned.
  //
  // Client type is determined by configuration:
  // - Public (no client_secret): PKCE alone protects the token exchange.
  // - Confidential (with client_secret): PKCE + client_secret for defense
  //   in depth. The upstream auth server enforces redirect_uri validation,
  //   so an attacker with the credentials cannot redirect auth codes to an
  //   arbitrary endpoint.
  override get clientsStore(): OAuthRegisteredClientsStore {
    const isConfidential = !!this._conf.clientSecret;
    const authMethod = isConfidential ? "client_secret_post" : "none";

    return {
      getClient: async (
        clientId: string,
      ): Promise<OAuthClientInformationFull | undefined> => {
        if (clientId !== this._conf.clientId) {
          return undefined;
        }

        return {
          client_id: this._conf.clientId,
          ...(isConfidential && { client_secret: this._conf.clientSecret }),
          redirect_uris: [...this._registeredRedirectUris],
          token_endpoint_auth_method: authMethod,
        } as OAuthClientInformationFull;
      },

      registerClient: async (
        clientMetadata: Omit<
          OAuthClientInformationFull,
          "client_id" | "client_id_issued_at"
        >,
      ): Promise<OAuthClientInformationFull> => {
        if (clientMetadata.redirect_uris) {
          for (const uri of clientMetadata.redirect_uris) {
            const parsed = new URL(uri);
            if (!this._allowedRedirectHosts.includes(parsed.hostname)) {
              console.warn(
                `[OAuth2] Rejected redirect_uri with host "%s" (allowed: %s)`,
                parsed.hostname,
                this._allowedRedirectHosts.join(", "),
              );
              throw new Error(
                `Invalid redirect_uri: host "${parsed.hostname}" is not allowed. Configure OAUTH2_ALLOWED_REDIRECT_HOSTS to add it.`,
              );
            }
            this._registeredRedirectUris.add(uri);
          }
        }

        return {
          client_id: this._conf.clientId,
          ...(isConfidential && { client_secret: this._conf.clientSecret }),
          client_id_issued_at: Math.floor(Date.now() / 1000),
          redirect_uris: [...this._registeredRedirectUris],
          token_endpoint_auth_method: authMethod,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        } as OAuthClientInformationFull;
      },
    };
  }

  override async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Store the MCP client's original redirect_uri keyed by state
    if (params.state) {
      this._evictExpiredAuthorizations();
      this._pendingAuthorizations.set(params.state, {
        uri: params.redirectUri,
        createdAt: Date.now(),
      });
    }

    // Redirect to upstream with OUR callback URL instead of the client's
    const modifiedParams: AuthorizationParams = {
      ...params,
      redirectUri: this._serverCallbackUrl,
    };

    return super.authorize(client, modifiedParams, res);
  }

  override async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    _redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // Send OUR callback URL to the upstream token endpoint (must match
    // what was used in the authorize step)
    return super.exchangeAuthorizationCode(
      client,
      authorizationCode,
      codeVerifier,
      this._serverCallbackUrl,
      resource,
    );
  }

  // Retrieves and removes the MCP client's original redirect_uri for a given
  // OAuth state parameter. Returns undefined if the state is unknown or expired.
  getOriginalRedirectUri(state: string): string | undefined {
    const entry = this._pendingAuthorizations.get(state);
    this._pendingAuthorizations.delete(state);
    if (!entry) return undefined;
    if (
      Date.now() - entry.createdAt >
      AAPProxyOAuthServerProvider.PENDING_AUTH_TTL_MS
    ) {
      return undefined;
    }
    return entry.uri;
  }

  // Removes expired pending authorizations to prevent memory buildup.
  private _evictExpiredAuthorizations(): void {
    const now = Date.now();
    for (const [key, entry] of this._pendingAuthorizations) {
      if (
        now - entry.createdAt >
        AAPProxyOAuthServerProvider.PENDING_AUTH_TTL_MS
      ) {
        this._pendingAuthorizations.delete(key);
      }
    }
  }
}

// Initializes the OAuth2 provider by performing OIDC discovery against the
// upstream AAP auth server, then assembles the composed Express router that
// handles: /oauth/callback, /.well-known/oauth-protected-resource/{path},
// and the SDK's mcpAuthRouter (/authorize, /token, /register, /revoke,
// /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource).
export async function createOAuth2Provider(
  config: OAuth2Config,
): Promise<OAuth2Setup> {
  // Discover upstream OAuth2/OIDC endpoints
  const oidcUrl = `${config.baseUrl}/o/.well-known/openid-configuration`;
  const oidcResponse = await fetch(oidcUrl, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!oidcResponse.ok) {
    throw new Error(
      `Failed to fetch OIDC configuration from ${oidcUrl}: ${oidcResponse.status} ${oidcResponse.statusText}`,
    );
  }
  const oidcMetadata = (await oidcResponse.json()) as OIDCMetadata;

  // Validate that discovered endpoint URLs belong to the expected origin
  const expectedOrigin = new URL(config.baseUrl).origin;
  const endpointsToValidate: [string, string][] = [
    ["authorization_endpoint", oidcMetadata.authorization_endpoint],
    ["token_endpoint", oidcMetadata.token_endpoint],
    ["jwks_uri", oidcMetadata.jwks_uri],
  ];
  if (oidcMetadata.revocation_endpoint) {
    endpointsToValidate.push([
      "revocation_endpoint",
      oidcMetadata.revocation_endpoint,
    ]);
  }
  for (const [name, url] of endpointsToValidate) {
    if (new URL(url).origin !== expectedOrigin) {
      throw new Error(
        `OIDC metadata ${name} origin mismatch: expected ${expectedOrigin}, got ${new URL(url).origin}`,
      );
    }
  }

  // Build JWKS verifier for local JWT access token validation
  const jwks = createRemoteJWKSet(new URL(oidcMetadata.jwks_uri));

  const verifyAccessToken = async (token: string): Promise<AuthInfo> => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: oidcMetadata.issuer,
      audience: "ansible-services",
    });

    return {
      token,
      clientId: config.clientId,
      scopes: payload.scope ? String(payload.scope).split(" ") : [],
      expiresAt: payload.exp,
      extra: {
        sub: payload.sub,
        email: (payload as Record<string, unknown>).email,
        preferred_username: (payload as Record<string, unknown>)
          .preferred_username,
      },
    };
  };

  // The intermediary callback URL registered on the upstream auth server.
  // MCP clients use dynamic localhost ports that can't be pre-registered,
  // so we intercept with our own fixed callback and forward the auth code.
  const serverCallbackUrl = `${config.serverUrl}/oauth/callback`;

  const provider = new AAPProxyOAuthServerProvider({
    endpoints: {
      authorizationUrl: oidcMetadata.authorization_endpoint,
      tokenUrl: oidcMetadata.token_endpoint,
      // AAP's OIDC metadata does not advertise revocation_endpoint;
      // fall back to the known endpoint until the upstream bug is fixed.
      revocationUrl:
        oidcMetadata.revocation_endpoint || `${config.baseUrl}/o/revoke_token/`,
    },
    fetch: forwardingFetch,
    verifyAccessToken,
    getClient: async () => undefined,
    clientId: config.clientId,
    ...(config.clientSecret && { clientSecret: config.clientSecret }),
    serverCallbackUrl,
    allowedRedirectHosts: config.allowedRedirectHosts,
  });

  const serverUrl = new URL(config.serverUrl);

  // SDK-provided router: mounts /authorize, /token, /register, /revoke,
  // /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource
  const authRouterMiddleware = mcpAuthRouter({
    provider,
    issuerUrl: serverUrl,
    baseUrl: serverUrl,
    resourceServerUrl: serverUrl,
  });

  // Callback endpoint: receives auth code from upstream, forwards to the MCP client
  const callbackRouter = express.Router();
  callbackRouter.get("/oauth/callback", (req, res) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const error = req.query.error as string;

    if (error) {
      const errorDesc =
        (req.query.error_description as string) || "Authorization failed";
      if (state) {
        const originalUri = provider.getOriginalRedirectUri(state);
        if (originalUri) {
          const redirectUrl = new URL(originalUri);
          redirectUrl.searchParams.set("error", error);
          redirectUrl.searchParams.set("error_description", errorDesc);
          redirectUrl.searchParams.set("state", state);
          res.redirect(redirectUrl.toString());
          return;
        }
      }
      res.status(400).json({ error, error_description: errorDesc });
      return;
    }

    if (!state || !code) {
      res.status(400).json({ error: "missing state or code" });
      return;
    }

    const originalRedirectUri = provider.getOriginalRedirectUri(state);
    if (!originalRedirectUri) {
      res.status(400).json({ error: "unknown authorization state" });
      return;
    }

    // Forward the auth code to the MCP client's original callback
    const redirectUrl = new URL(originalRedirectUri);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", state);
    res.redirect(redirectUrl.toString());
  });

  // Dynamic protected resource metadata for path-specific endpoints (RFC 9728).
  // Some MCP clients strict-match the "resource" field against the URL they
  // connect to, so /.well-known/oauth-protected-resource/mcp must return
  // resource: "http://host:port/mcp", and similarly for toolset endpoints.
  const dynamicPrmRouter = express.Router();
  dynamicPrmRouter.get(
    "/.well-known/oauth-protected-resource/{*splat}",
    (req, res) => {
      const prefix = "/.well-known/oauth-protected-resource";
      const resourcePath = req.path.slice(prefix.length) || "/";
      const resourceUrl = new URL(resourcePath, serverUrl);
      res.set("Cache-Control", "no-store").json({
        resource: resourceUrl.href,
        authorization_servers: [serverUrl.href],
      });
    },
  );

  // Captures the MCP client's IP into AsyncLocalStorage so forwardingFetch
  // can attach X-Forwarded-For on outbound requests to the upstream auth server.
  const captureClientIp: express.RequestHandler = (req, _res, next) => {
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp =
      typeof forwarded === "string"
        ? forwarded.split(",")[0].trim()
        : req.ip || "unknown";
    clientIpStore.run(clientIp, () => next());
  };

  // Order matters: callback and dynamic PRM must be matched before the SDK
  // router, which has its own catch-all /.well-known/oauth-protected-resource.
  const composedRouter = express.Router();
  composedRouter.use(captureClientIp);
  composedRouter.use(callbackRouter);
  composedRouter.use(dynamicPrmRouter);
  composedRouter.use(authRouterMiddleware);

  // Builds the /.well-known/oauth-protected-resource URL for a given MCP
  // endpoint path. Used in WWW-Authenticate headers on 401 responses.
  const getResourceMetadataUrl = (path: string): string => {
    const resourceUrl = new URL(path, serverUrl);
    return getOAuthProtectedResourceMetadataUrl(resourceUrl);
  };

  return {
    authRouter: composedRouter,
    verifyAccessToken,
    getResourceMetadataUrl,
  };
}

// Direct-gateway mode: AAP gateway is the authorization server. The MCP
// server only serves Protected Resource Metadata (RFC 9728) pointing
// clients directly to the gateway. The gateway handles everything:
// AS metadata discovery, dynamic client registration, authorization,
// and token exchange. Token validation uses the legacy /me/ endpoint.
export async function createDirectGatewaySetup(
  config: DirectGatewayConfig,
): Promise<OAuth2Setup> {
  const ts = () => new Date().toISOString().split(".")[0] + "Z";

  const serverUrl = new URL(config.serverUrl);
  const authorizationServerUrl = config.authorizationServer;

  // Discover the gateway's OIDC metadata to validate connectivity at startup.
  const oidcUrl = `${authorizationServerUrl}/.well-known/openid-configuration`;
  console.log(`${ts()} [direct-gateway] Discovering OIDC at ${oidcUrl}`);
  const oidcResponse = await fetch(oidcUrl, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!oidcResponse.ok) {
    throw new Error(
      `Failed to fetch OIDC configuration from ${oidcUrl}: ${oidcResponse.status} ${oidcResponse.statusText}`,
    );
  }
  const oidcMetadata = (await oidcResponse.json()) as OIDCMetadata & {
    registration_endpoint?: string;
  };

  console.log(`${ts()} [direct-gateway] OIDC discovery successful:`);
  console.log(`${ts()}   issuer: ${oidcMetadata.issuer}`);
  console.log(
    `${ts()}   authorization_endpoint: ${oidcMetadata.authorization_endpoint}`,
  );
  console.log(`${ts()}   token_endpoint: ${oidcMetadata.token_endpoint}`);
  if (oidcMetadata.registration_endpoint) {
    console.log(
      `${ts()}   registration_endpoint: ${oidcMetadata.registration_endpoint}`,
    );
  }

  // Use the configured authorization server URL in PRM as-is, preserving
  // any path component (e.g. /o) so clients discover AS metadata at the
  // correct RFC 8414 path on the gateway.
  const authorizationServer = authorizationServerUrl.replace(/\/+$/, "");

  console.log(
    `${ts()} [direct-gateway] Initialized — PRM authorization_servers: ${authorizationServer} (issuer: ${oidcMetadata.issuer})`,
  );

  const router = express.Router();

  // PRM — root
  router.get("/.well-known/oauth-protected-resource", (req, res) => {
    console.log(`${ts()} [direct-gateway] PRM request (root) from ${req.ip}`);
    const body = {
      resource: serverUrl.href,
      authorization_servers: [authorizationServer],
    };
    console.log(
      `${ts()} [direct-gateway] PRM response: ${JSON.stringify(body)}`,
    );
    res.set("Cache-Control", "no-store").json(body);
  });

  // PRM — path-specific (e.g. /mcp, /toolset/mcp)
  router.get("/.well-known/oauth-protected-resource/{*splat}", (req, res) => {
    const prefix = "/.well-known/oauth-protected-resource";
    const resourcePath = req.path.slice(prefix.length) || "/";
    const resourceUrl = new URL(resourcePath, serverUrl);
    console.log(
      `${ts()} [direct-gateway] PRM request (path: ${resourcePath}) from ${req.ip}`,
    );
    const body = {
      resource: resourceUrl.href,
      authorization_servers: [authorizationServer],
    };
    console.log(
      `${ts()} [direct-gateway] PRM response: ${JSON.stringify(body)}`,
    );
    res.set("Cache-Control", "no-store").json(body);
  });

  const getResourceMetadataUrl = (path: string): string => {
    const resourceUrl = new URL(path, serverUrl);
    return getOAuthProtectedResourceMetadataUrl(resourceUrl);
  };

  // No JWT verification — token validation falls back to legacy /me/ endpoint.
  const verifyAccessToken = async (_token: string): Promise<AuthInfo> => {
    throw new Error(
      "direct-gateway: no local JWT verification, use legacy auth",
    );
  };

  return {
    authRouter: router,
    verifyAccessToken,
    getResourceMetadataUrl,
  };
}
