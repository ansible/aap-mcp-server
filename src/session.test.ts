import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SessionManager } from "./session.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Mock the metrics service
vi.mock("./metrics.js", () => ({
  metricsService: {
    incrementActiveSessions: vi.fn(),
    decrementActiveSessions: vi.fn(),
    incrementSessionTimeouts: vi.fn(),
  },
}));

import { metricsService } from "./metrics.js";

describe("SessionManager", () => {
  let sessionManager: SessionManager;
  let mockTransport: StreamableHTTPServerTransport;
  let mockTransport2: StreamableHTTPServerTransport;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Enable fake timers
    vi.useFakeTimers();

    // Create new instance for each test with 10-second timeout for faster testing
    sessionManager = new SessionManager(10);

    // Create mock transports
    mockTransport = {
      close: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockTransport2 = {
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
  });

  afterEach(() => {
    // Restore real timers
    vi.useRealTimers();
  });

  describe("store()", () => {
    it("should store session data correctly", () => {
      const sessionId = "session-123";
      const token = "token-456";
      const userAgent = "TestAgent/1.0";
      const toolset = "test-toolset";

      sessionManager.store(sessionId, token, userAgent, toolset, mockTransport);

      expect(sessionManager.has(sessionId)).toBe(true);
      expect(sessionManager.get(sessionId)).toEqual({
        token,
        userAgent,
        toolset,
        transport: mockTransport,
      });
    });

    it("should increment active sessions metrics", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      expect(metricsService.incrementActiveSessions).toHaveBeenCalledTimes(1);
    });

    it("should log session storage", () => {
      const originalLog = console.log;
      let loggedMessage = "";

      console.log = (message: string) => {
        loggedMessage = message;
      };

      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      expect(loggedMessage).toMatch(
        /Stored session data for session-1: userAgent=Agent\/1\.0, toolset=toolset1, active_session\(s\)=1/,
      );

      console.log = originalLog;
    });

    it("should track active session count", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      expect(sessionManager.getActiveCount()).toBe(1);

      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );
      expect(sessionManager.getActiveCount()).toBe(2);
    });

    it("should overwrite existing session data", () => {
      const sessionId = "session-1";

      // Store initial data
      sessionManager.store(
        sessionId,
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      expect(sessionManager.getToken(sessionId)).toBe("token-1");

      // Overwrite with new data
      sessionManager.store(
        sessionId,
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );
      expect(sessionManager.getToken(sessionId)).toBe("token-2");
      expect(sessionManager.getToolset(sessionId)).toBe("toolset2");
    });
  });

  describe("get()", () => {
    it("should return session data for existing session", () => {
      const sessionId = "session-1";
      const expectedData = {
        token: "token-1",
        userAgent: "Agent/1.0",
        toolset: "toolset1",
        transport: mockTransport,
      };

      sessionManager.store(
        sessionId,
        expectedData.token,
        expectedData.userAgent,
        expectedData.toolset,
        expectedData.transport,
      );

      expect(sessionManager.get(sessionId)).toEqual(expectedData);
    });

    it("should return undefined for non-existent session", () => {
      expect(sessionManager.get("non-existent")).toBeUndefined();
    });
  });

  describe("has()", () => {
    it("should return true for existing session", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      expect(sessionManager.has("session-1")).toBe(true);
    });

    it("should return false for non-existent session", () => {
      expect(sessionManager.has("non-existent")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(sessionManager.has("")).toBe(false);
    });
  });

  describe("delete()", () => {
    it("should delete existing session data", () => {
      const sessionId = "session-1";
      sessionManager.store(
        sessionId,
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      expect(sessionManager.has(sessionId)).toBe(true);
      sessionManager.delete(sessionId);
      expect(sessionManager.has(sessionId)).toBe(false);
    });

    it("should decrement active sessions metrics", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      sessionManager.delete("session-1");

      expect(metricsService.decrementActiveSessions).toHaveBeenCalledTimes(1);
    });

    it("should log session deletion", () => {
      const originalLog = console.log;
      let loggedMessage = "";

      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      console.log = (message: string) => {
        loggedMessage = message;
      };

      sessionManager.delete("session-1");

      expect(loggedMessage).toMatch(
        /Removed session data for terminated session/,
      );

      console.log = originalLog;
    });

    it("should handle deletion of non-existent session gracefully", () => {
      // Should not throw or call metrics
      expect(() => sessionManager.delete("non-existent")).not.toThrow();
      expect(metricsService.decrementActiveSessions).not.toHaveBeenCalled();
    });

    it("should update active session count", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );
      expect(sessionManager.getActiveCount()).toBe(2);

      sessionManager.delete("session-1");
      expect(sessionManager.getActiveCount()).toBe(1);

      sessionManager.delete("session-2");
      expect(sessionManager.getActiveCount()).toBe(0);
    });
  });

  describe("getAllSessionIds()", () => {
    it("should return empty array when no sessions", () => {
      expect(sessionManager.getAllSessionIds()).toEqual([]);
    });

    it("should return all session IDs", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );

      const sessionIds = sessionManager.getAllSessionIds();
      expect(sessionIds).toHaveLength(2);
      expect(sessionIds).toContain("session-1");
      expect(sessionIds).toContain("session-2");
    });

    it("should update after session deletion", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );

      expect(sessionManager.getAllSessionIds()).toHaveLength(2);

      sessionManager.delete("session-1");
      const remainingIds = sessionManager.getAllSessionIds();
      expect(remainingIds).toHaveLength(1);
      expect(remainingIds).toContain("session-2");
    });
  });

  describe("getActiveCount()", () => {
    it("should return 0 when no sessions", () => {
      expect(sessionManager.getActiveCount()).toBe(0);
    });

    it("should return correct count with multiple sessions", () => {
      expect(sessionManager.getActiveCount()).toBe(0);

      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      expect(sessionManager.getActiveCount()).toBe(1);

      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );
      expect(sessionManager.getActiveCount()).toBe(2);

      sessionManager.delete("session-1");
      expect(sessionManager.getActiveCount()).toBe(1);

      sessionManager.delete("session-2");
      expect(sessionManager.getActiveCount()).toBe(0);
    });
  });

  describe("Property Getters", () => {
    beforeEach(() => {
      sessionManager.store(
        "session-1",
        "token-123",
        "TestAgent/1.0",
        "test-toolset",
        mockTransport,
      );
    });

    describe("getToken()", () => {
      it("should return token for existing session", () => {
        expect(sessionManager.getToken("session-1")).toBe("token-123");
      });

      it("should return undefined for non-existent session", () => {
        expect(sessionManager.getToken("non-existent")).toBeUndefined();
      });
    });

    describe("getToolset()", () => {
      it("should return toolset for existing session", () => {
        expect(sessionManager.getToolset("session-1")).toBe("test-toolset");
      });

      it("should throw error for non-existent session", () => {
        expect(() => sessionManager.getToolset("non-existent")).toThrow(
          "Invalid or missing session ID",
        );
      });
    });

    describe("getUserAgent()", () => {
      it("should return user agent for existing session", () => {
        expect(sessionManager.getUserAgent("session-1")).toBe("TestAgent/1.0");
      });

      it("should return undefined for non-existent session", () => {
        expect(sessionManager.getUserAgent("non-existent")).toBeUndefined();
      });
    });

    describe("getTransport()", () => {
      it("should return transport for existing session", () => {
        expect(sessionManager.getTransport("session-1")).toBe(mockTransport);
      });

      it("should return undefined for non-existent session", () => {
        expect(sessionManager.getTransport("non-existent")).toBeUndefined();
      });
    });
  });

  describe("closeAllSessions()", () => {
    it("should close all transports and delete all sessions", async () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );

      expect(sessionManager.getActiveCount()).toBe(2);

      await sessionManager.closeAllSessions();

      expect(mockTransport.close).toHaveBeenCalledTimes(1);
      expect(mockTransport2.close).toHaveBeenCalledTimes(1);
      expect(sessionManager.getActiveCount()).toBe(0);
    });

    it("should log closure attempts", async () => {
      const originalLog = console.log;
      const loggedMessages: string[] = [];

      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      console.log = (message: string) => {
        loggedMessages.push(message);
      };

      await sessionManager.closeAllSessions();

      expect(loggedMessages).toContainEqual(
        expect.stringMatching(/Closing transport during shutdown/),
      );

      console.log = originalLog;
    });

    it("should handle transport close errors gracefully", async () => {
      const originalError = console.error;
      let loggedError = "";
      let loggedErrorObj: any = null;

      const errorTransport = {
        close: vi.fn().mockRejectedValue(new Error("Close failed")),
      } as any;

      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        errorTransport,
      );
      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport,
      );

      console.error = (message: string, error?: any) => {
        loggedError = message;
        loggedErrorObj = error;
      };

      // Should not throw despite error
      await expect(sessionManager.closeAllSessions()).resolves.toBeUndefined();

      expect(loggedError).toMatch(/Error closing transport/);
      expect(loggedErrorObj).toBeInstanceOf(Error);
      expect(loggedErrorObj.message).toBe("Close failed");

      console.error = originalError;

      // Should still delete sessions even if close fails
      expect(sessionManager.getActiveCount()).toBe(0);
    });

    it("should handle sessions with undefined transports", async () => {
      // Manually add session data with undefined transport
      const sessionManager = new SessionManager();
      (sessionManager as any).sessions["session-1"] = {
        token: "token-1",
        userAgent: "Agent/1.0",
        toolset: "toolset1",
        transport: undefined,
      };

      // Should not throw
      await expect(sessionManager.closeAllSessions()).resolves.toBeUndefined();
      expect(sessionManager.getActiveCount()).toBe(0);
    });

    it("should handle empty session manager", async () => {
      await expect(sessionManager.closeAllSessions()).resolves.toBeUndefined();
      expect(sessionManager.getActiveCount()).toBe(0);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complex session lifecycle", async () => {
      // Add multiple sessions
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );

      expect(sessionManager.getActiveCount()).toBe(2);
      expect(metricsService.incrementActiveSessions).toHaveBeenCalledTimes(2);

      // Verify individual access
      expect(sessionManager.getToken("session-1")).toBe("token-1");
      expect(sessionManager.getToolset("session-2")).toBe("toolset2");

      // Delete one session
      sessionManager.delete("session-1");
      expect(sessionManager.getActiveCount()).toBe(1);
      expect(sessionManager.has("session-1")).toBe(false);
      expect(sessionManager.has("session-2")).toBe(true);

      // Close remaining sessions
      await sessionManager.closeAllSessions();
      expect(sessionManager.getActiveCount()).toBe(0);
      expect(mockTransport2.close).toHaveBeenCalledTimes(1);
    });

    it("should maintain data integrity across operations", () => {
      const sessionData = {
        id: "session-test",
        token: "token-test",
        userAgent: "TestSuite/1.0",
        toolset: "integration-test",
      };

      // Store session
      sessionManager.store(
        sessionData.id,
        sessionData.token,
        sessionData.userAgent,
        sessionData.toolset,
        mockTransport,
      );

      // Verify all getters return correct data
      expect(sessionManager.get(sessionData.id)).toEqual({
        token: sessionData.token,
        userAgent: sessionData.userAgent,
        toolset: sessionData.toolset,
        transport: mockTransport,
      });

      expect(sessionManager.getToken(sessionData.id)).toBe(sessionData.token);
      expect(sessionManager.getUserAgent(sessionData.id)).toBe(
        sessionData.userAgent,
      );
      expect(sessionManager.getToolset(sessionData.id)).toBe(
        sessionData.toolset,
      );
      expect(sessionManager.getTransport(sessionData.id)).toBe(mockTransport);
    });
  });

  describe("Session Timeout", () => {
    it("should use default timeout of 120 seconds when no timeout specified", () => {
      const defaultSessionManager = new SessionManager();

      defaultSessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      expect(defaultSessionManager.getActiveCount()).toBe(1);

      // Advance time by 119 seconds - session should still exist
      vi.advanceTimersByTime(119000);
      expect(defaultSessionManager.getActiveCount()).toBe(1);

      // Advance time by 1 more second (total 120) - session should be deleted automatically
      vi.advanceTimersByTime(1000);
      expect(defaultSessionManager.getActiveCount()).toBe(0);
    });

    it("should use custom timeout when specified in constructor", () => {
      const customSessionManager = new SessionManager(5); // 5 seconds

      customSessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      expect(customSessionManager.getActiveCount()).toBe(1);

      // Advance time by 4 seconds - session should still exist
      vi.advanceTimersByTime(4000);
      expect(customSessionManager.getActiveCount()).toBe(1);

      // Advance time by 1 more second (total 5) - session should be deleted automatically
      vi.advanceTimersByTime(1000);
      expect(customSessionManager.getActiveCount()).toBe(0);
    });

    it("should automatically delete session after 10 seconds", () => {
      const originalLog = console.log;
      const loggedMessages: string[] = [];

      console.log = (message: string) => {
        loggedMessages.push(message);
      };

      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      expect(sessionManager.has("session-1")).toBe(true);

      // Advance time by 10 seconds
      vi.advanceTimersByTime(10000);

      // Session should be automatically deleted
      expect(sessionManager.has("session-1")).toBe(false);
      expect(loggedMessages).toContainEqual(
        expect.stringMatching(
          /Session session-1 timed out, removing from active sessions/,
        ),
      );

      console.log = originalLog;
    });

    it("should increment timeout metrics when session times out", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      expect(sessionManager.has("session-1")).toBe(true);

      // Advance time by 10 seconds to trigger timeout
      vi.advanceTimersByTime(10000);

      // Session should be automatically deleted and timeout metric incremented
      expect(sessionManager.has("session-1")).toBe(false);
      expect(metricsService.incrementSessionTimeouts).toHaveBeenCalledTimes(1);
    });

    it("should increment timeout metrics for multiple session timeouts", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );

      expect(sessionManager.getActiveCount()).toBe(2);

      // Advance time by 10 seconds to trigger both timeouts
      vi.advanceTimersByTime(10000);

      // Both sessions should be automatically deleted and timeout metric incremented twice
      expect(sessionManager.getActiveCount()).toBe(0);
      expect(metricsService.incrementSessionTimeouts).toHaveBeenCalledTimes(2);
    });

    it("should reset timeout when accessing session via get()", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      // Wait 5 seconds
      vi.advanceTimersByTime(5000);

      // Access session via get() - should reset timeout
      const session = sessionManager.get("session-1");
      expect(session).toBeDefined();

      // Wait another 5 seconds (total 10 seconds from original creation)
      vi.advanceTimersByTime(5000);

      // Session should still exist because timeout was reset
      expect(sessionManager.has("session-1")).toBe(true);

      // Wait another 10 seconds from the reset
      vi.advanceTimersByTime(10000);

      // Now session should be deleted
      expect(sessionManager.has("session-1")).toBe(false);
    });

    it("should reset timeout when checking session existence via has()", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      // Wait 5 seconds
      vi.advanceTimersByTime(5000);

      // Check existence via has() - should reset timeout
      expect(sessionManager.has("session-1")).toBe(true);

      // Wait another 5 seconds (total 10 seconds from original creation)
      vi.advanceTimersByTime(5000);

      // Session should still exist because timeout was reset
      expect(sessionManager.has("session-1")).toBe(true);

      // Wait another 10 seconds from the reset
      vi.advanceTimersByTime(10000);

      // Now session should be deleted
      expect(sessionManager.has("session-1")).toBe(false);
    });

    it("should reset timeout when accessing via property getters", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      // Wait 5 seconds
      vi.advanceTimersByTime(5000);

      // Access via getToken() - should reset timeout
      expect(sessionManager.getToken("session-1")).toBe("token-1");

      // Wait another 5 seconds
      vi.advanceTimersByTime(5000);

      // Access via getToolset() - should reset timeout again
      expect(sessionManager.getToolset("session-1")).toBe("toolset1");

      // Wait another 5 seconds
      vi.advanceTimersByTime(5000);

      // Access via getUserAgent() - should reset timeout again
      expect(sessionManager.getUserAgent("session-1")).toBe("Agent/1.0");

      // Wait another 5 seconds
      vi.advanceTimersByTime(5000);

      // Access via getTransport() - should reset timeout again
      expect(sessionManager.getTransport("session-1")).toBe(mockTransport);

      // Session should still exist
      expect(sessionManager.has("session-1")).toBe(true);

      // Wait 10 seconds without access
      vi.advanceTimersByTime(10000);

      // Now session should be deleted
      expect(sessionManager.has("session-1")).toBe(false);
    });

    it("should clear timeout when manually deleting session", () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      // Manually delete session
      sessionManager.delete("session-1");

      // clearTimeout should have been called
      expect(clearTimeoutSpy).toHaveBeenCalled();

      // Advance time by 10 seconds
      vi.advanceTimersByTime(10000);

      // Session should remain deleted (timeout callback should not run)
      expect(sessionManager.has("session-1")).toBe(false);

      clearTimeoutSpy.mockRestore();
    });

    it("should handle timeout when overwriting existing session", () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      // Wait 5 seconds
      vi.advanceTimersByTime(5000);

      // Overwrite session - should clear old timeout and create new one
      sessionManager.store(
        "session-1",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );

      // clearTimeout should have been called for the old timeout
      expect(clearTimeoutSpy).toHaveBeenCalled();

      // Wait another 5 seconds (total 10 from original, but only 5 from overwrite)
      vi.advanceTimersByTime(5000);

      // Session should still exist because new timeout was created
      expect(sessionManager.has("session-1")).toBe(true);
      expect(sessionManager.getToken("session-1")).toBe("token-2");

      // Wait another 10 seconds from the overwrite
      vi.advanceTimersByTime(10000);

      // Now session should be deleted
      expect(sessionManager.has("session-1")).toBe(false);

      clearTimeoutSpy.mockRestore();
    });

    it("should not return timeout property in get() method", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      const session = sessionManager.get("session-1");

      expect(session).toEqual({
        token: "token-1",
        userAgent: "Agent/1.0",
        toolset: "toolset1",
        transport: mockTransport,
      });

      // Should not contain timeout property
      expect(session).not.toHaveProperty("timeout");
    });

    it("should handle timeout cleanup during closeAllSessions()", async () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );
      sessionManager.store(
        "session-2",
        "token-2",
        "Agent/2.0",
        "toolset2",
        mockTransport2,
      );

      expect(sessionManager.getActiveCount()).toBe(2);

      await sessionManager.closeAllSessions();

      // All sessions should be deleted
      expect(sessionManager.getActiveCount()).toBe(0);
      expect(sessionManager.has("session-1")).toBe(false);
      expect(sessionManager.has("session-2")).toBe(false);
    });

    it("should handle concurrent timeout resets correctly", () => {
      sessionManager.store(
        "session-1",
        "token-1",
        "Agent/1.0",
        "toolset1",
        mockTransport,
      );

      // Wait 3 seconds
      vi.advanceTimersByTime(3000);

      // Multiple rapid accesses should all reset the timeout
      sessionManager.has("session-1");
      sessionManager.get("session-1");
      sessionManager.getToken("session-1");
      sessionManager.getToolset("session-1");

      // Wait 7 seconds (total 10 from creation, but timeouts were reset)
      vi.advanceTimersByTime(7000);

      // Session should still exist
      expect(sessionManager.has("session-1")).toBe(true);

      // Wait another 10 seconds from last access
      vi.advanceTimersByTime(10000);

      // Now session should be deleted
      expect(sessionManager.has("session-1")).toBe(false);
    });
  });
});
