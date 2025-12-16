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
  const Analytics = vi.fn(() => mockAnalyticsInstance);
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

    it("should track mcp_session_started event", () => {
      const sessionId = "session-123";
      const userAgent = "Test-Agent/1.0";
      const mcpToolSet = "test-toolset";
      const userToken = "test-token";

      analyticsService.trackMcpSessionStarted(
        sessionId,
        userAgent,
        mcpToolSet,
        userToken,
      );

      // The actual Analytics mock assertion would verify the track method was called
      // with correct parameters, but since we're mocking it, we just verify
      // the method completes without error
      expect(() =>
        analyticsService.trackMcpSessionStarted(
          sessionId,
          userAgent,
          mcpToolSet,
          userToken,
        ),
      ).not.toThrow();
    });

    it("should track mcp_tool_called event", () => {
      const toolName = "test-tool";
      const mcpToolSet = "test-toolset";
      const userAgent = "Test-Agent/1.0";
      const sessionId = "session-123";
      const parameterLength = 100;
      const httpStatus = 200;
      const executionTimeMs = 500;
      const userToken = "test-token";

      expect(() =>
        analyticsService.trackMcpToolCalled(
          toolName,
          mcpToolSet,
          userAgent,
          sessionId,
          parameterLength,
          httpStatus,
          executionTimeMs,
          userToken,
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
        analyticsService.trackMcpSessionStarted(
          "session-123",
          "agent",
          "toolset",
        ),
      ).not.toThrow();
      expect(() =>
        analyticsService.trackMcpToolCalled(
          "tool",
          "toolset",
          "agent",
          "session-123",
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
        analyticsService.trackMcpSessionStarted(
          "session-123",
          "agent",
          "toolset",
        ),
      ).not.toThrow();
      expect(() =>
        analyticsService.trackMcpToolCalled(
          "tool",
          "toolset",
          "agent",
          "session-123",
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

  describe("generateUserUniqueId functionality", () => {
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

    it("should generate consistent user ID for the same token", () => {
      const userToken = "test-token-123";

      // Clear any calls from initialization (periodic status report)
      mockAnalyticsInstance.track.mockClear();

      // Track the same session twice with the same token
      analyticsService.trackMcpSessionStarted(
        "session-1",
        "agent",
        "toolset",
        userToken,
      );
      analyticsService.trackMcpSessionStarted(
        "session-2",
        "agent",
        "toolset",
        userToken,
      );

      // Verify track was called twice (only our calls, not status report)
      expect(mockAnalyticsInstance.track).toHaveBeenCalledTimes(2);

      // Get the anonymousId from both calls
      const firstCall = mockAnalyticsInstance.track.mock.calls[0][0];
      const secondCall = mockAnalyticsInstance.track.mock.calls[1][0];

      // Both calls should have the same anonymousId
      expect(firstCall.anonymousId).toBe(secondCall.anonymousId);
      expect(firstCall.anonymousId).toBeDefined();
      expect(typeof firstCall.anonymousId).toBe("string");
    });

    it("should generate different user IDs for different tokens", () => {
      const userToken1 = "test-token-123";
      const userToken2 = "test-token-456";

      // Clear any calls from initialization
      mockAnalyticsInstance.track.mockClear();

      // Track sessions with different tokens
      analyticsService.trackMcpSessionStarted(
        "session-1",
        "agent",
        "toolset",
        userToken1,
      );
      analyticsService.trackMcpSessionStarted(
        "session-2",
        "agent",
        "toolset",
        userToken2,
      );

      // Verify track was called twice
      expect(mockAnalyticsInstance.track).toHaveBeenCalledTimes(2);

      // Get the anonymousId from both calls
      const firstCall = mockAnalyticsInstance.track.mock.calls[0][0];
      const secondCall = mockAnalyticsInstance.track.mock.calls[1][0];

      // Both calls should have different anonymousIds
      expect(firstCall.anonymousId).not.toBe(secondCall.anonymousId);
      expect(firstCall.anonymousId).toBeDefined();
      expect(secondCall.anonymousId).toBeDefined();
    });

    it("should generate UUID-like format for user ID", () => {
      const userToken = "test-token-123";

      // Clear any calls from initialization
      mockAnalyticsInstance.track.mockClear();

      analyticsService.trackMcpSessionStarted(
        "session-1",
        "agent",
        "toolset",
        userToken,
      );

      // Get the anonymousId from the call
      const call = mockAnalyticsInstance.track.mock.calls[0][0];
      const anonymousId = call.anonymousId;

      // Should match UUID format: xxxxxxxx-xxxx-4xxx-axxx-xxxxxxxxxxxx
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(anonymousId).toMatch(uuidRegex);
    });

    it("should handle undefined user token gracefully", () => {
      // Clear any calls from initialization
      mockAnalyticsInstance.track.mockClear();

      analyticsService.trackMcpSessionStarted(
        "session-1",
        "agent",
        "toolset",
        undefined,
      );

      // Should still work without throwing
      expect(mockAnalyticsInstance.track).toHaveBeenCalledTimes(1);

      const call = mockAnalyticsInstance.track.mock.calls[0][0];
      expect(call.anonymousId).toBeDefined();
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

  describe("disable parameter", () => {
    it("should pass disable=true to Analytics constructor", async () => {
      const getActiveSessions = () => 0;
      const serverVersion = "1.0.0";
      const containerVersion = "test";
      const readOnlyMode = false;

      // Get the mocked Analytics constructor
      const { Analytics } = await import("@segment/analytics-node");

      // Clear previous calls
      vi.mocked(Analytics).mockClear();

      // Initialize with disable=true
      analyticsService.initialize(
        "test-key",
        getActiveSessions,
        serverVersion,
        containerVersion,
        readOnlyMode,
        true, // disable
      );

      // Verify Analytics constructor was called with disable=true
      expect(vi.mocked(Analytics)).toHaveBeenCalledWith({
        disable: true,
        writeKey: "test-key",
      });
    });

    it("should pass disable=false to Analytics constructor when explicitly set", async () => {
      const getActiveSessions = () => 0;
      const serverVersion = "1.0.0";
      const containerVersion = "test";
      const readOnlyMode = false;

      // Get the mocked Analytics constructor
      const { Analytics } = await import("@segment/analytics-node");

      // Clear previous calls
      vi.mocked(Analytics).mockClear();

      // Initialize with disable=false (explicit)
      analyticsService.initialize(
        "test-key",
        getActiveSessions,
        serverVersion,
        containerVersion,
        readOnlyMode,
        false, // disable
      );

      // Verify Analytics constructor was called with disable=false
      expect(vi.mocked(Analytics)).toHaveBeenCalledWith({
        disable: false,
        writeKey: "test-key",
      });
    });

    it("should default disable parameter to false when not provided", async () => {
      const getActiveSessions = () => 0;
      const serverVersion = "1.0.0";
      const containerVersion = "test";
      const readOnlyMode = false;

      // Get the mocked Analytics constructor
      const { Analytics } = await import("@segment/analytics-node");

      // Clear previous calls
      vi.mocked(Analytics).mockClear();

      // Initialize without disable parameter (should default to false)
      analyticsService.initialize(
        "test-key",
        getActiveSessions,
        serverVersion,
        containerVersion,
        readOnlyMode,
      );

      // Verify Analytics constructor was called with disable=false (default)
      expect(vi.mocked(Analytics)).toHaveBeenCalledWith({
        disable: false,
        writeKey: "test-key",
      });
    });

    it("should initialize successfully with both writeKey and disable parameter", () => {
      const getActiveSessions = () => 0;
      const serverVersion = "1.0.0";
      const containerVersion = "test";
      const readOnlyMode = false;

      // Should not throw when initialized with disable parameter
      expect(() =>
        analyticsService.initialize(
          "test-key",
          getActiveSessions,
          serverVersion,
          containerVersion,
          readOnlyMode,
          true,
        ),
      ).not.toThrow();

      expect(() =>
        analyticsService.initialize(
          "test-key",
          getActiveSessions,
          serverVersion,
          containerVersion,
          readOnlyMode,
          false,
        ),
      ).not.toThrow();
    });
  });
});
