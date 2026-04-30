import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsService } from "./analytics.js";

// Create a mock instance that will be shared across all tests
const mockAnalyticsInstance = {
  track: vi.fn(),
  closeAndFlush: vi.fn().mockResolvedValue(undefined),
  on: vi.fn().mockReturnValue(undefined), // Make sure .on() calls return properly
  register: vi.fn().mockReturnValue(undefined), // Mock the register method for plugins
};

// Mock the @segment/analytics-node module to return the same instance every time
vi.mock("@segment/analytics-node", () => {
  const Analytics = vi.fn(function () {
    return mockAnalyticsInstance;
  });
  return { Analytics };
});

describe("Analytics Service", () => {
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    // Create a new analytics service instance for each test
    analyticsService = new AnalyticsService();
    vi.clearAllMocks();
    // Reset the mock analytics instance methods
    mockAnalyticsInstance.track.mockClear();
    mockAnalyticsInstance.closeAndFlush.mockClear();
    mockAnalyticsInstance.on.mockClear();
    mockAnalyticsInstance.register.mockClear();
  });

  describe("initialization", () => {
    it("should initialize with valid write key and start periodic reporting", () => {
      const writeKey = "test-write-key-123";
      const getActiveSessions = () => 0;
      const serverVersion = "1.0.0";
      const containerVersion = "test";
      const readOnlyMode = false;

      expect(() =>
        analyticsService.initialize(
          writeKey,
          getActiveSessions,
          serverVersion,
          containerVersion,
          readOnlyMode,
        ),
      ).not.toThrow();
    });

    it("should handle initialization errors gracefully", () => {
      const writeKey = ""; // Empty key should not cause throwing
      const getActiveSessions = () => 0;
      const serverVersion = "1.0.0";
      const containerVersion = "test";
      const readOnlyMode = false;

      expect(() =>
        analyticsService.initialize(
          writeKey,
          getActiveSessions,
          serverVersion,
          containerVersion,
          readOnlyMode,
        ),
      ).not.toThrow();
    });
  });

  describe("event tracking", () => {
    beforeEach(() => {
      const getActiveSessions = () => 0;
      const serverVersion = "1.0.0";
      const containerVersion = "test";
      const readOnlyMode = false;

      analyticsService.initialize(
        "test-key",
        getActiveSessions,
        serverVersion,
        containerVersion,
        readOnlyMode,
      );
    });

    it("should track mcp_tool_called event", () => {
      const toolName = "test-tool";
      const mcpToolSet = "test-toolset";
      const userAgent = "Test-Agent/1.0";
      const parameterLength = 100;
      const httpStatus = 200;
      const executionTimeMs = 500;
      const userPseudoId = "abc123def456";
      const userType = "external";

      expect(() =>
        analyticsService.trackMcpToolCalled(
          toolName,
          mcpToolSet,
          userAgent,
          parameterLength,
          httpStatus,
          executionTimeMs,
          userPseudoId,
          userType,
        ),
      ).not.toThrow();
    });

    it("should track mcp_server_status event", () => {
      const healthStatus = "healthy" as const;
      const activeSessions = 10;
      const serverVersion = "1.0.0";
      const containerVersion = "1.2.3";
      const readOnlyMode = false;

      expect(() =>
        analyticsService.trackMcpServerStatus(
          healthStatus,
          activeSessions,
          serverVersion,
          containerVersion,
          readOnlyMode,
        ),
      ).not.toThrow();
    });
  });

  describe("disabled state", () => {
    it("should silently ignore tracking calls when not initialized", () => {
      // These should not throw errors even when analytics is not initialized/enabled
      expect(() =>
        analyticsService.trackMcpToolCalled(
          "tool",
          "toolset",
          "agent",
          0,
          200,
          0,
        ),
      ).not.toThrow();
      expect(() =>
        analyticsService.trackMcpServerStatus(
          "healthy",
          0,
          "1.0.0",
          "unknown",
          false,
        ),
      ).not.toThrow();
    });

    it("should silently ignore tracking calls after failed initialization", () => {
      const getActiveSessions = () => 0;
      const serverVersion = "1.0.0";
      const containerVersion = "test";
      const readOnlyMode = false;

      // Initialize with empty key (should fail to enable analytics)
      analyticsService.initialize(
        "",
        getActiveSessions,
        serverVersion,
        containerVersion,
        readOnlyMode,
      );

      // These should not throw errors even when analytics initialization failed
      expect(() =>
        analyticsService.trackMcpToolCalled(
          "tool",
          "toolset",
          "agent",
          0,
          200,
          0,
        ),
      ).not.toThrow();
      expect(() =>
        analyticsService.trackMcpServerStatus(
          "healthy",
          0,
          "1.0.0",
          "unknown",
          false,
        ),
      ).not.toThrow();
    });
  });

  describe("user_pseudo_id and user_type in events", () => {
    beforeEach(() => {
      const getActiveSessions = () => 0;
      analyticsService.initialize(
        "test-key",
        getActiveSessions,
        "1.0.0",
        "test",
        false,
      );
      mockAnalyticsInstance.track.mockClear();
    });

    it("should use provided userPseudoId as anonymousId and in properties", () => {
      analyticsService.trackMcpToolCalled(
        "tool",
        "toolset",
        "agent",
        100,
        200,
        500,
        "pseudo123",
        "internal",
      );

      expect(mockAnalyticsInstance.track).toHaveBeenCalledTimes(1);
      const call = mockAnalyticsInstance.track.mock.calls[0][0];
      expect(call.anonymousId).toBe("pseudo123");
      expect(call.properties.user_pseudo_id).toBe("pseudo123");
      expect(call.properties.user_type).toBe("internal");
    });

    it("should default to anonymous and external when not provided", () => {
      analyticsService.trackMcpToolCalled(
        "tool",
        "toolset",
        "agent",
        100,
        200,
        500,
      );

      expect(mockAnalyticsInstance.track).toHaveBeenCalledTimes(1);
      const call = mockAnalyticsInstance.track.mock.calls[0][0];
      expect(call.anonymousId).toBe("anonymous");
      expect(call.properties.user_pseudo_id).toBe("anonymous");
      expect(call.properties.user_type).toBe("external");
    });

    it("should include installer_pseudo_id in tool called event when provided", () => {
      analyticsService.trackMcpToolCalled(
        "tool",
        "toolset",
        "agent",
        100,
        200,
        500,
        "pseudo123",
        "external",
        "installer-pseudo-abc",
      );

      const call = mockAnalyticsInstance.track.mock.calls[0][0];
      expect(call.properties.installer_pseudo_id).toBe("installer-pseudo-abc");
    });

    it("should default installer_pseudo_id to 'unknown' when not provided", () => {
      analyticsService.trackMcpToolCalled(
        "tool",
        "toolset",
        "agent",
        100,
        200,
        500,
        "pseudo123",
        "external",
      );

      const call = mockAnalyticsInstance.track.mock.calls[0][0];
      expect(call.properties.installer_pseudo_id).toBe("unknown");
    });
  });

  describe("shutdown", () => {
    it("should handle shutdown gracefully", async () => {
      const getActiveSessions = () => 0;
      const serverVersion = "1.0.0";
      const containerVersion = "test";
      const readOnlyMode = false;

      analyticsService.initialize(
        "test-key",
        getActiveSessions,
        serverVersion,
        containerVersion,
        readOnlyMode,
      );
      await expect(analyticsService.shutdown()).resolves.not.toThrow();
    });

    it("should handle shutdown when not initialized", async () => {
      await expect(analyticsService.shutdown()).resolves.not.toThrow();
    });
  });
});
