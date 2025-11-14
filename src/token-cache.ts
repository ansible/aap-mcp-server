/**
 * Token validation cache to prevent duplicate validation requests
 * when multiple MCP clients connect simultaneously
 */

interface TokenCacheEntry {
  permissions: {
    is_superuser: boolean;
    is_platform_auditor: boolean;
  };
  timestamp: number;
}

class TokenCache {
  private cache: Map<string, TokenCacheEntry> = new Map();
  private pendingValidations: Map<string, Promise<TokenCacheEntry["permissions"]>> = new Map();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Get cached permissions or validate token
   * Prevents duplicate validation requests for the same token
   */
  async getOrValidate(
    token: string,
    validateFn: () => Promise<TokenCacheEntry["permissions"]>,
  ): Promise<TokenCacheEntry["permissions"]> {
    // Check if we have a valid cached entry
    const cached = this.cache.get(token);
    if (cached && Date.now() - cached.timestamp < this.TTL_MS) {
      console.log(`Token cache hit (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
      return cached.permissions;
    }

    // Check if validation is already in progress
    const pending = this.pendingValidations.get(token);
    if (pending) {
      console.log("Token validation already in progress, waiting...");
      return pending;
    }

    // Start new validation
    console.log("Token cache miss, validating...");
    const validationPromise = validateFn()
      .then((permissions) => {
        // Store in cache
        this.cache.set(token, {
          permissions,
          timestamp: Date.now(),
        });
        // Remove from pending
        this.pendingValidations.delete(token);
        return permissions;
      })
      .catch((error) => {
        // Remove from pending on error
        this.pendingValidations.delete(token);
        throw error;
      });

    // Store as pending
    this.pendingValidations.set(token, validationPromise);

    return validationPromise;
  }

  /**
   * Clear cached entry for a token
   */
  clear(token: string): void {
    this.cache.delete(token);
  }

  /**
   * Clear all cached entries
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [token, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.TTL_MS) {
        this.cache.delete(token);
      }
    }
  }
}

export const tokenCache = new TokenCache();

// Clean up expired entries every 5 minutes
setInterval(() => {
  tokenCache.cleanup();
}, 5 * 60 * 1000);
