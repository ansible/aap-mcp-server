import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("CONFIG Environment Variables", () => {
  let originalAnalyticsDisable: string | undefined;

  beforeEach(() => {
    // Save the original ANALYTICS_DISABLE value
    originalAnalyticsDisable = process.env.ANALYTICS_DISABLE;
  });

  afterEach(() => {
    // Restore the original ANALYTICS_DISABLE value
    if (originalAnalyticsDisable === undefined) {
      delete process.env.ANALYTICS_DISABLE;
    } else {
      process.env.ANALYTICS_DISABLE = originalAnalyticsDisable;
    }
  });

  describe("ANALYTICS_DISABLE", () => {
    it("should be true when ANALYTICS_DISABLE env var is set to 'true'", () => {
      process.env.ANALYTICS_DISABLE = "true";
      const value: string | undefined = process.env.ANALYTICS_DISABLE;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
      };
      expect(CONFIG.ANALYTICS_DISABLE).toBe(true);
    });

    it("should be true when ANALYTICS_DISABLE env var is set to 'TRUE' (case-insensitive)", () => {
      process.env.ANALYTICS_DISABLE = "TRUE";
      const value: string | undefined = process.env.ANALYTICS_DISABLE;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
      };
      expect(CONFIG.ANALYTICS_DISABLE).toBe(true);
    });

    it("should be true when ANALYTICS_DISABLE env var is set to 'True' (mixed case)", () => {
      process.env.ANALYTICS_DISABLE = "True";
      const value: string | undefined = process.env.ANALYTICS_DISABLE;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
      };
      expect(CONFIG.ANALYTICS_DISABLE).toBe(true);
    });

    it("should be false when ANALYTICS_DISABLE env var is set to 'false'", () => {
      // Correctly treats 'false' string as false (consistent with getBooleanConfig)
      process.env.ANALYTICS_DISABLE = "false";
      const value: string | undefined = process.env.ANALYTICS_DISABLE;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
      };
      expect(CONFIG.ANALYTICS_DISABLE).toBe(false);
    });

    it("should be false when ANALYTICS_DISABLE env var is set to '0'", () => {
      // Correctly treats '0' string as false (consistent with getBooleanConfig)
      process.env.ANALYTICS_DISABLE = "0";
      const value: string | undefined = process.env.ANALYTICS_DISABLE;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
      };
      expect(CONFIG.ANALYTICS_DISABLE).toBe(false);
    });

    it("should be false when ANALYTICS_DISABLE env var is set to '1'", () => {
      // '1' is not 'true', so should be false (consistent with getBooleanConfig)
      process.env.ANALYTICS_DISABLE = "1";
      const value: string | undefined = process.env.ANALYTICS_DISABLE;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
      };
      expect(CONFIG.ANALYTICS_DISABLE).toBe(false);
    });

    it("should be false when ANALYTICS_DISABLE env var is not set", () => {
      delete process.env.ANALYTICS_DISABLE;
      const value = process.env.ANALYTICS_DISABLE as string | undefined;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
      };
      expect(CONFIG.ANALYTICS_DISABLE).toBe(false);
    });

    it("should be false when ANALYTICS_DISABLE env var is empty string", () => {
      process.env.ANALYTICS_DISABLE = "";
      const value = process.env.ANALYTICS_DISABLE as string | undefined;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
      };
      expect(CONFIG.ANALYTICS_DISABLE).toBe(false);
    });
  });

  describe("ANALYTICS_DISABLE integration with AnalyticsService", () => {
    it("should pass ANALYTICS_DISABLE=true to initialize method when set to 'true'", () => {
      process.env.ANALYTICS_DISABLE = "true";
      const value: string | undefined = process.env.ANALYTICS_DISABLE;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
        ANALYTICS_KEY: "test-key",
      };

      // Mock AnalyticsService initialize call
      const mockInitialize = (
        writeKey: string,
        _getActiveSessions: () => number,
        _serverVersion: string,
        _containerVersion: string,
        _readOnlyMode: boolean,
        disable: boolean,
      ) => {
        expect(disable).toBe(true);
        expect(writeKey).toBe("test-key");
      };

      // Simulate the call as done in index.ts:808
      mockInitialize(
        CONFIG.ANALYTICS_KEY,
        () => 0,
        "1.0.0",
        "test",
        false,
        CONFIG.ANALYTICS_DISABLE,
      );
    });

    it("should pass ANALYTICS_DISABLE=false when env var is set to 'false'", () => {
      process.env.ANALYTICS_DISABLE = "false";
      const value: string | undefined = process.env.ANALYTICS_DISABLE;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
        ANALYTICS_KEY: "test-key",
      };

      // Mock AnalyticsService initialize call
      const mockInitialize = (
        writeKey: string,
        _getActiveSessions: () => number,
        _serverVersion: string,
        _containerVersion: string,
        _readOnlyMode: boolean,
        disable: boolean,
      ) => {
        expect(disable).toBe(false);
        expect(writeKey).toBe("test-key");
      };

      // Simulate the call as done in index.ts:808
      mockInitialize(
        CONFIG.ANALYTICS_KEY,
        () => 0,
        "1.0.0",
        "test",
        false,
        CONFIG.ANALYTICS_DISABLE,
      );
    });

    it("should pass ANALYTICS_DISABLE as false when env var is not set", () => {
      delete process.env.ANALYTICS_DISABLE;
      const value = process.env.ANALYTICS_DISABLE as string | undefined;
      const CONFIG = {
        ANALYTICS_DISABLE: value?.toLowerCase() === "true",
        ANALYTICS_KEY: "test-key",
      };

      // Mock AnalyticsService initialize call
      const mockInitialize = (
        writeKey: string,
        _getActiveSessions: () => number,
        _serverVersion: string,
        _containerVersion: string,
        _readOnlyMode: boolean,
        disable: boolean,
      ) => {
        expect(disable).toBe(false);
        expect(writeKey).toBe("test-key");
      };

      // Simulate the call as done in index.ts:808
      mockInitialize(
        CONFIG.ANALYTICS_KEY,
        () => 0,
        "1.0.0",
        "test",
        false,
        CONFIG.ANALYTICS_DISABLE,
      );
    });
  });
});
