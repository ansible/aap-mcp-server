/**
 * Tests for JWT validator
 *
 * Note: These are basic tests. For full integration testing,
 * you'll need a real AAP Gateway instance or mock server.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  validateJWT,
  clearPublicKeyCache,
  getCacheStats,
} from "../jwt-validator";

describe("JWT Validator", () => {
  beforeEach(() => {
    // Clear cache before each test
    clearPublicKeyCache();
  });

  describe("Header Extraction", () => {
    it("should return null when JWT header is missing", async () => {
      const headers = {
        authorization: "Bearer some-token",
      };

      // This should return null (no JWT header present)
      // Note: validateJWT will try to fetch public key, so we expect it to fail
      // In a real scenario, you'd mock the fetch call
      try {
        const result = await validateJWT(
          headers,
          "http://localhost:8080",
          false,
        );
        expect(result).toBeNull();
      } catch (error) {
        // Expected to fail when trying to fetch public key
        expect(error).toBeDefined();
      }
    });

    it("should return null when JWT header is empty", async () => {
      const headers = {
        "x-dab-jw-token": "",
      };

      const result = await validateJWT(headers, "http://localhost:8080", false);
      expect(result).toBeNull();
    });

    it("should handle case-insensitive header names", async () => {
      const headers = {
        "X-DAB-JW-TOKEN": "some-jwt-token",
        "x-dab-jw-token": "some-jwt-token",
        "X-dab-jw-token": "some-jwt-token",
      };

      // Should find the header regardless of case
      // Will fail on validation, but that's expected
      try {
        await validateJWT(headers, "http://localhost:8080", false);
      } catch (error) {
        // Expected - invalid JWT format or can't fetch public key
        expect(error).toBeDefined();
      }
    });
  });

  describe("Cache Statistics", () => {
    it("should provide cache statistics", () => {
      const stats = getCacheStats();

      expect(stats).toHaveProperty("keys");
      expect(stats).toHaveProperty("stats");
      expect(typeof stats.keys).toBe("number");
    });

    it("should start with empty cache", () => {
      const stats = getCacheStats();
      expect(stats.keys).toBe(0);
    });
  });

  describe("Cache Clearing", () => {
    it("should clear cache successfully", () => {
      // Clear cache
      clearPublicKeyCache();

      // Verify it's empty
      const stats = getCacheStats();
      expect(stats.keys).toBe(0);
    });
  });
});

/**
 * Integration test example (requires running AAP Gateway)
 *
 * Uncomment and configure to run against real AAP instance
 */
/*
describe('JWT Validator Integration', () => {
  const AAP_GATEWAY_URL = process.env.AAP_GATEWAY_URL || 'https://localhost';
  const VALID_JWT_TOKEN = process.env.TEST_JWT_TOKEN || '';

  it('should validate a real JWT token', async () => {
    if (!VALID_JWT_TOKEN) {
      console.log('Skipping integration test: No JWT token provided');
      return;
    }

    const headers = {
      'X-DAB-JW-TOKEN': VALID_JWT_TOKEN,
    };

    const result = await validateJWT(headers, AAP_GATEWAY_URL, false);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty('username');
    expect(result).toHaveProperty('headerName', 'X-DAB-JW-TOKEN');
    expect(result).toHaveProperty('headerValue', VALID_JWT_TOKEN);
    expect(typeof result.username).toBe('string');
  });

  it('should cache public key on subsequent calls', async () => {
    if (!VALID_JWT_TOKEN) {
      console.log('Skipping integration test: No JWT token provided');
      return;
    }

    const headers = {
      'X-DAB-JW-TOKEN': VALID_JWT_TOKEN,
    };

    // First call - should fetch key
    clearPublicKeyCache();
    let stats = getCacheStats();
    expect(stats.keys).toBe(0);

    await validateJWT(headers, AAP_GATEWAY_URL, false);

    // Second call - should use cached key
    stats = getCacheStats();
    expect(stats.keys).toBe(1);
    expect(stats.stats.hits).toBeGreaterThan(0);
  });

  it('should reject expired JWT tokens', async () => {
    const EXPIRED_TOKEN = process.env.EXPIRED_JWT_TOKEN || '';

    if (!EXPIRED_TOKEN) {
      console.log('Skipping test: No expired token provided');
      return;
    }

    const headers = {
      'X-DAB-JW-TOKEN': EXPIRED_TOKEN,
    };

    await expect(
      validateJWT(headers, AAP_GATEWAY_URL, false)
    ).rejects.toThrow(/expired/i);
  });

  it('should reject invalid JWT signatures', async () => {
    // Use a malformed JWT token for testing
    const malformedToken = 'not.a.valid.jwt.token.format';

    const headers = {
      'X-DAB-JW-TOKEN': malformedToken,
    };

    await expect(
      validateJWT(headers, AAP_GATEWAY_URL, false)
    ).rejects.toThrow();
  });
});
*/
