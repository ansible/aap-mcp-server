import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import {
  validateJWT,
  clearPublicKeyCache,
  getCacheStats,
} from "./jwt-validator.js";

// Generate a test RSA key pair once for the entire test suite.
// Using real keys ensures the actual jwt.verify() path is exercised.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const BASE_URL = "http://test-gateway";

const DEFAULT_CLAIMS = {
  user_data: { username: "admin" },
  aud: "ansible-services",
  iss: "ansible-issuer",
};

function signToken(
  claims: object = DEFAULT_CLAIMS,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(claims, privateKey, {
    algorithm: "RS256",
    expiresIn: "1h",
    ...options,
  });
}

function mockPublicKeyEndpoint(key: string = publicKey): void {
  vi.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ public_key: key }),
  } as Response);
}

beforeEach(() => {
  clearPublicKeyCache();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// validateJWT — header detection
// ---------------------------------------------------------------------------

describe("validateJWT — header detection", () => {
  it("returns null when X-DAB-JW-TOKEN header is absent", async () => {
    const result = await validateJWT({}, BASE_URL);
    expect(result).toBeNull();
  });

  it("returns null when X-DAB-JW-TOKEN header is present but empty", async () => {
    const result = await validateJWT({ "x-dab-jw-token": "" }, BASE_URL);
    expect(result).toBeNull();
  });

  it("returns null when X-DAB-JW-TOKEN header is whitespace only", async () => {
    const result = await validateJWT({ "x-dab-jw-token": "   " }, BASE_URL);
    expect(result).toBeNull();
  });

  it("finds the header case-insensitively (uppercase)", async () => {
    mockPublicKeyEndpoint();
    const token = signToken();
    const result = await validateJWT({ "X-DAB-JW-TOKEN": token }, BASE_URL);
    expect(result).not.toBeNull();
    expect(result?.username).toBe("admin");
  });

  it("finds the header case-insensitively (mixed case)", async () => {
    mockPublicKeyEndpoint();
    const token = signToken();
    const result = await validateJWT({ "X-Dab-Jw-Token": token }, BASE_URL);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateJWT — successful validation
// ---------------------------------------------------------------------------

describe("validateJWT — successful validation", () => {
  it("returns ValidatedJWTUser with correct fields for a valid token", async () => {
    mockPublicKeyEndpoint();
    const token = signToken();

    const result = await validateJWT(
      { "x-dab-jw-token": token },
      BASE_URL,
    );

    expect(result).not.toBeNull();
    expect(result?.username).toBe("admin");
    expect(result?.headerName).toBe("X-DAB-JW-TOKEN");
    expect(result?.headerValue).toBe(token);
  });

  it("fetches the public key from the correct endpoint", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ public_key: publicKey }),
    } as Response);

    const token = signToken();
    await validateJWT({ "x-dab-jw-token": token }, BASE_URL);

    expect(fetchSpy).toHaveBeenCalledWith(
      `${BASE_URL}/api/gateway/v1/jwt_key/`,
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("accepts a response with a 'key' field instead of 'public_key'", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ key: publicKey }),
    } as Response);

    const token = signToken();
    const result = await validateJWT({ "x-dab-jw-token": token }, BASE_URL);
    expect(result?.username).toBe("admin");
  });
});

// ---------------------------------------------------------------------------
// validateJWT — public key caching
// ---------------------------------------------------------------------------

describe("validateJWT — public key caching", () => {
  it("fetches the public key only once for multiple requests", async () => {
    const fetchSpy = mockPublicKeyEndpoint() as unknown;
    const spyFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ public_key: publicKey }),
    } as Response);

    const token = signToken();
    await validateJWT({ "x-dab-jw-token": token }, BASE_URL);
    await validateJWT({ "x-dab-jw-token": token }, BASE_URL);
    await validateJWT({ "x-dab-jw-token": token }, BASE_URL);

    // Public key endpoint should only be called once (cached after first call)
    const keyFetches = spyFetch.mock.calls.filter((call) =>
      (call[0] as string).includes("jwt_key"),
    );
    expect(keyFetches).toHaveLength(1);
  });

  it("re-fetches the public key after the cache is cleared", async () => {
    const spyFetch = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ public_key: publicKey }),
    } as Response);

    const token = signToken();
    await validateJWT({ "x-dab-jw-token": token }, BASE_URL);

    clearPublicKeyCache();

    await validateJWT({ "x-dab-jw-token": token }, BASE_URL);

    const keyFetches = spyFetch.mock.calls.filter((call) =>
      (call[0] as string).includes("jwt_key"),
    );
    expect(keyFetches).toHaveLength(2);
  });

  it("getCacheStats reflects a populated cache", async () => {
    mockPublicKeyEndpoint();
    const token = signToken();
    await validateJWT({ "x-dab-jw-token": token }, BASE_URL);

    const stats = getCacheStats();
    expect(stats.keys).toBeGreaterThan(0);
  });

  it("getCacheStats reflects an empty cache after clearing", async () => {
    mockPublicKeyEndpoint();
    const token = signToken();
    await validateJWT({ "x-dab-jw-token": token }, BASE_URL);

    clearPublicKeyCache();
    const stats = getCacheStats();
    expect(stats.keys).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateJWT — key rotation handling
// ---------------------------------------------------------------------------

describe("validateJWT — key rotation handling", () => {
  it("retries with a fresh key when the cached key causes a signature failure", async () => {
    const { privateKey: rotatedPrivateKey, publicKey: rotatedPublicKey } =
      generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });

    // First request: return the OLD public key (will fail signature check)
    // Second request (retry after cache clear): return the NEW public key
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ public_key: publicKey }), // old key
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ public_key: rotatedPublicKey }), // new key
      } as Response);

    // Token signed with the NEW private key (after rotation)
    const token = jwt.sign(DEFAULT_CLAIMS, rotatedPrivateKey, {
      algorithm: "RS256",
      expiresIn: "1h",
    });

    // Should succeed: first attempt fails (old key), retry succeeds (new key)
    const result = await validateJWT({ "x-dab-jw-token": token }, BASE_URL);

    expect(result?.username).toBe("admin");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws after retry if the fresh key still fails", async () => {
    const { privateKey: unknownKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    // Both fetches return the same key that doesn't match the token
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ public_key: publicKey }),
    } as Response);

    const token = jwt.sign(DEFAULT_CLAIMS, unknownKey, { algorithm: "RS256" });

    await expect(
      validateJWT({ "x-dab-jw-token": token }, BASE_URL),
    ).rejects.toThrow(/invalid signature/i);
  });
});

// ---------------------------------------------------------------------------
// validateJWT — token validation failures
// ---------------------------------------------------------------------------

describe("validateJWT — token validation failures", () => {
  it("throws when the JWT is expired", async () => {
    mockPublicKeyEndpoint();
    const token = signToken(DEFAULT_CLAIMS, { expiresIn: -1 });

    await expect(
      validateJWT({ "x-dab-jw-token": token }, BASE_URL),
    ).rejects.toThrow(/expired/i);
  });

  it("throws when the audience is wrong", async () => {
    mockPublicKeyEndpoint();
    const token = signToken({ ...DEFAULT_CLAIMS, aud: "wrong-audience" });

    await expect(
      validateJWT({ "x-dab-jw-token": token }, BASE_URL),
    ).rejects.toThrow();
  });

  it("throws when the issuer is wrong", async () => {
    mockPublicKeyEndpoint();
    const token = signToken({ ...DEFAULT_CLAIMS, iss: "wrong-issuer" });

    await expect(
      validateJWT({ "x-dab-jw-token": token }, BASE_URL),
    ).rejects.toThrow();
  });

  it("throws when the token is signed with a different key", async () => {
    mockPublicKeyEndpoint(); // serves our test public key
    const { privateKey: otherKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const token = jwt.sign(DEFAULT_CLAIMS, otherKey, { algorithm: "RS256" });

    await expect(
      validateJWT({ "x-dab-jw-token": token }, BASE_URL),
    ).rejects.toThrow(/invalid signature/i);
  });

  it("throws when user_data is missing from the payload", async () => {
    mockPublicKeyEndpoint();
    const token = jwt.sign(
      { aud: "ansible-services", iss: "ansible-issuer" },
      privateKey,
      { algorithm: "RS256" },
    );

    await expect(
      validateJWT({ "x-dab-jw-token": token }, BASE_URL),
    ).rejects.toThrow(/user_data/i);
  });

  it("throws when the token is malformed", async () => {
    mockPublicKeyEndpoint();

    await expect(
      validateJWT({ "x-dab-jw-token": "not.a.jwt" }, BASE_URL),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateJWT — public key fetch failures
// ---------------------------------------------------------------------------

describe("validateJWT — public key fetch failures", () => {
  it("throws when the public key endpoint returns a non-200 response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as Response);

    const token = signToken();
    await expect(
      validateJWT({ "x-dab-jw-token": token }, BASE_URL),
    ).rejects.toThrow(/503/);
  });

  it("throws when the public key endpoint returns an empty body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const token = signToken();
    await expect(
      validateJWT({ "x-dab-jw-token": token }, BASE_URL),
    ).rejects.toThrow(/public key not found/i);
  });

  it("throws when fetch itself throws (network error)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const token = signToken();
    await expect(
      validateJWT({ "x-dab-jw-token": token }, BASE_URL),
    ).rejects.toThrow();
  });
});
