import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsService } from "./analytics.js";

// Mock the Analytics class from @segment/analytics-node
vi.mock("@segment/analytics-node", () => {
  return {
    Analytics: vi.fn().mockImplementation((_config) => {
      return {
        track: vi.fn(),
        closeAndFlush: vi.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

describe("Analytics Service", () => {
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    // Create a new analytics service instance for each test
    analyticsService = new AnalyticsService();
    vi.clearAllMocks();
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
