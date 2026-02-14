/**
 * JWT Validator for AAP Authentication
 *
 * This module validates JWT tokens from AAP Gateway.
 * It fetches the public key from AAP Gateway and caches it for performance.
 *
 * Based on: ansible_mcp_tools/authentication/validators/aap_jwt_validator.py
 */

import jwt from "jsonwebtoken";
import NodeCache from "node-cache";

const AUTHENTICATION_HEADER_NAME = "X-DAB-JW-TOKEN";
const JWT_AUDIENCE = "ansible-services";
const JWT_ISSUER = "ansible-issuer";
const CACHE_TTL = 600; // 10 minutes (same as Python version)
const CACHE_MAX_KEYS = 100;

// Cache for storing public keys
const publicKeyCache = new NodeCache({
  stdTTL: CACHE_TTL,
  maxKeys: CACHE_MAX_KEYS,
  checkperiod: 120, // Check for expired keys every 2 minutes
});

interface JWTUserData {
  username: string;
  [key: string]: any;
}

interface JWTPayload {
  user_data: JWTUserData;
  exp: number;
  aud: string;
  iss: string;
  [key: string]: any;
}

export interface ValidatedJWTUser {
  username: string;
  headerName: string;
  headerValue: string;
}

/**
 * Fetch the RSA public key from AAP Gateway
 * Implements caching to avoid repeated requests
 */
async function getPublicKey(
  baseUrl: string,
  verifyCert: boolean = true,
): Promise<string> {
  const cacheKey = `jwt_public_key_${baseUrl}`;

  // Check cache first
  const cachedKey = publicKeyCache.get<string>(cacheKey);
  if (cachedKey) {
    return cachedKey;
  }

  // Fetch from AAP Gateway
  const url = `${baseUrl}/api/gateway/v1/jwt_key/`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    // @ts-ignore - Node.js fetch supports rejectUnauthorized
    agent: verifyCert
      ? undefined
      : new (await import("https")).Agent({
          rejectUnauthorized: false,
        }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to get JWT public key: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { public_key?: string; key?: string };
  const publicKey = data.public_key || data.key;

  if (!publicKey) {
    throw new Error("Public key not found in response");
  }

  // Cache the public key
  publicKeyCache.set(cacheKey, publicKey);

  return publicKey;
}

/**
 * Decode and validate JWT token
 */
function decodeJWTToken(token: string, publicKey: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
    }) as JWTPayload;

    // Verify user_data exists
    if (!decoded.user_data || !decoded.user_data.username) {
      throw new Error("JWT token missing required user_data");
    }

    return decoded;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to decode JWT token: ${error.message}`);
    }
    throw new Error("Failed to decode JWT token: Unknown error");
  }
}

/**
 * Validate JWT token from request headers
 *
 * @param headers - HTTP request headers
 * @param baseUrl - AAP Gateway base URL
 * @param verifyCert - Whether to verify SSL certificates (default: true)
 * @returns ValidatedJWTUser object if successful, null if no JWT header present
 * @throws Error if JWT validation fails
 */
export async function validateJWT(
  headers: Record<string, string | string[] | undefined>,
  baseUrl: string,
  verifyCert: boolean = true,
): Promise<ValidatedJWTUser | null> {
  // Extract JWT token from header (case-insensitive)
  const headerName = Object.keys(headers).find(
    (key) => key.toLowerCase() === AUTHENTICATION_HEADER_NAME.toLowerCase(),
  );

  if (!headerName) {
    console.debug(`JWT header '${AUTHENTICATION_HEADER_NAME}' not found`);
    return null;
  }

  const headerValue = headers[headerName];
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!token || token.trim() === "") {
    console.debug(`JWT header '${AUTHENTICATION_HEADER_NAME}' has no value`);
    return null;
  }

  try {
    // Get public key (with caching)
    const publicKey = await getPublicKey(baseUrl, verifyCert);

    // Decode and validate JWT
    const payload = decodeJWTToken(token, publicKey);

    // Return validated user
    return {
      username: payload.user_data.username,
      headerName: AUTHENTICATION_HEADER_NAME,
      headerValue: token,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error(`JWT validation error: ${error.message}`);
      throw new Error(`JWT authentication failed: ${error.message}`);
    }
    throw new Error("JWT authentication failed: Unknown error");
  }
}

/**
 * Clear the public key cache
 * Useful for testing or when you need to force a refresh
 */
export function clearPublicKeyCache(): void {
  publicKeyCache.flushAll();
}

/**
 * Get cache statistics
 * Useful for monitoring and debugging
 */
export function getCacheStats() {
  return {
    keys: publicKeyCache.keys().length,
    stats: publicKeyCache.getStats(),
  };
}
