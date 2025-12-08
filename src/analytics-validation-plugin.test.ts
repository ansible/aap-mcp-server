import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createValidationPlugin,
  validateSessionStartedEvent,
  validateToolCalledEvent,
  validateServerStatusEvent,
} from "./analytics-validation-plugin.js";

describe("Analytics Validation Plugin", () => {
  const mockLogger = vi.fn();
  const mockContext = {
    event: {},
    cancel: vi.fn().mockReturnThis(),
    updateEvent: vi.fn().mockReturnThis(),
  } as any; // Use type assertion for test mocks

  beforeEach(() => {
    mockLogger.mockClear();
    mockContext.cancel.mockClear();
    mockContext.updateEvent.mockClear();
  });

  describe("validateSessionStartedEvent", () => {
    it("should validate a correct session started event", () => {
      const validEvent = {
        sess_id: "session-123",
        process_id: "process-456",
        user_unique_id: "user-789",
        user_agent: "TestAgent/1.0",
        mcp_tool_set: "test-toolset",
      };

      expect(validateSessionStartedEvent(validEvent)).toBe(true);
    });

    it("should reject event with missing required fields", () => {
      const invalidEvent = {
        user_agent: "TestAgent/1.0",
        // Missing sess_id, process_id, user_unique_id
      };

      expect(validateSessionStartedEvent(invalidEvent)).toBe(false);
    });

    it("should reject event with invalid field types", () => {
      const invalidEvent = {
        sess_id: 123, // Should be string
        process_id: "process-456",
        user_unique_id: "user-789",
      };

      expect(validateSessionStartedEvent(invalidEvent)).toBe(false);
    });

    it("should accept event with optional fields", () => {
      const validEvent = {
        sess_id: "session-123",
        process_id: "process-456",
        user_unique_id: "user-789",
      };

      expect(validateSessionStartedEvent(validEvent)).toBe(true);
    });

    it("should reject event with unexpected fields", () => {
      const invalidEvent = {
        sess_id: "session-123",
        process_id: "process-456",
        user_unique_id: "user-789",
        unexpected_field: "value",
      };

      expect(validateSessionStartedEvent(invalidEvent)).toBe(false);
    });
  });

  describe("validateToolCalledEvent", () => {
    it("should validate a correct tool called event", () => {
      const validEvent = {
        tool_name: "test-tool",
        mcp_tool_set: "test-toolset",
        user_agent: "TestAgent/1.0",
        sess_id: "session-123",
        parameter_length: 100,
        http_status: 200,
        execution_time_ms: 500,
        user_unique_id: "user-789",
      };

      expect(validateToolCalledEvent(validEvent)).toBe(true);
    });

    it("should reject event with missing required fields", () => {
      const invalidEvent = {
        tool_name: "test-tool",
        // Missing other required fields
      };

      expect(validateToolCalledEvent(invalidEvent)).toBe(false);
    });

    it("should reject event with invalid HTTP status codes", () => {
      const invalidEvent = {
        tool_name: "test-tool",
        mcp_tool_set: "test-toolset",
        user_agent: "TestAgent/1.0",
        sess_id: "session-123",
        parameter_length: 100,
        http_status: 99, // Invalid HTTP status
        execution_time_ms: 500,
        user_unique_id: "user-789",
      };

      expect(validateToolCalledEvent(invalidEvent)).toBe(false);
    });

    it("should reject event with negative parameter length", () => {
      const invalidEvent = {
        tool_name: "test-tool",
        mcp_tool_set: "test-toolset",
        user_agent: "TestAgent/1.0",
        sess_id: "session-123",
        parameter_length: -10, // Invalid negative value
        http_status: 200,
        execution_time_ms: 500,
        user_unique_id: "user-789",
      };

      expect(validateToolCalledEvent(invalidEvent)).toBe(false);
    });

    it("should reject event with negative execution time", () => {
      const invalidEvent = {
        tool_name: "test-tool",
        mcp_tool_set: "test-toolset",
        user_agent: "TestAgent/1.0",
        sess_id: "session-123",
        parameter_length: 100,
        http_status: 200,
        execution_time_ms: -100, // Invalid negative value
        user_unique_id: "user-789",
      };

      expect(validateToolCalledEvent(invalidEvent)).toBe(false);
    });

    it("should accept valid edge case HTTP status codes", () => {
      const validEvent = {
        tool_name: "test-tool",
        mcp_tool_set: "test-toolset",
        user_agent: "TestAgent/1.0",
        sess_id: "session-123",
        parameter_length: 0,
        http_status: 599, // Valid edge case
        execution_time_ms: 0,
        user_unique_id: "user-789",
      };

      expect(validateToolCalledEvent(validEvent)).toBe(true);
    });
  });

  describe("validateServerStatusEvent", () => {
    it("should validate a correct server status event", () => {
      const validEvent = {
        process_id: "process-123",
        health_status: "healthy",
        active_sessions: 5,
        uptime_seconds: 3600,
        server_version: "1.2.3",
        container_version: "v2.1.0",
        read_only_mode: false,
      };

      expect(validateServerStatusEvent(validEvent)).toBe(true);
    });

    it("should reject event with invalid health status", () => {
      const invalidEvent = {
        process_id: "process-123",
        health_status: "unknown", // Invalid status
        active_sessions: 5,
        uptime_seconds: 3600,
        server_version: "1.2.3",
        container_version: "v2.1.0",
        read_only_mode: false,
      };

      expect(validateServerStatusEvent(invalidEvent)).toBe(false);
    });

    it("should accept all valid health status values", () => {
      const healthStatuses = ["healthy", "degraded", "unhealthy"];

      healthStatuses.forEach((status) => {
        const validEvent = {
          process_id: "process-123",
          health_status: status,
          active_sessions: 5,
          uptime_seconds: 3600,
          server_version: "1.2.3",
          container_version: "v2.1.0",
          read_only_mode: false,
        };

        expect(validateServerStatusEvent(validEvent)).toBe(true);
      });
    });

    it("should reject event with negative active sessions", () => {
      const invalidEvent = {
        process_id: "process-123",
        health_status: "healthy",
        active_sessions: -1, // Invalid negative value
        uptime_seconds: 3600,
        server_version: "1.2.3",
        container_version: "v2.1.0",
        read_only_mode: false,
      };

      expect(validateServerStatusEvent(invalidEvent)).toBe(false);
    });

    it("should reject event with non-boolean read_only_mode", () => {
      const invalidEvent = {
        process_id: "process-123",
        health_status: "healthy",
        active_sessions: 5,
        uptime_seconds: 3600,
        server_version: "1.2.3",
        container_version: "v2.1.0",
        read_only_mode: "false", // Should be boolean, not string
      };

      expect(validateServerStatusEvent(invalidEvent)).toBe(false);
    });
  });

  describe("createValidationPlugin", () => {
    it("should create a plugin with default configuration", () => {
      const plugin = createValidationPlugin();

      expect(plugin).toBeDefined();
      expect(plugin.name).toBe("Analytics Event Validation");
      expect(plugin.type).toBe("before");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.isLoaded()).toBe(true);
      expect(typeof plugin.track).toBe("function");
    });

    it("should create a plugin with custom configuration", () => {
      const customLogger = vi.fn();
      const plugin = createValidationPlugin({
        dropInvalidEvents: true,
        logger: customLogger,
        logSuccess: true,
      });

      expect(plugin).toBeDefined();
      expect(plugin.name).toBe("Analytics Event Validation");
    });

    describe("plugin track behavior", () => {
      it("should pass through valid events without logging", () => {
        const plugin = createValidationPlugin({
          logger: mockLogger,
          logSuccess: false,
        });

        const validContext = {
          ...mockContext,
          event: {
            event: "mcp_session_started",
            properties: {
              sess_id: "session-123",
              process_id: "process-456",
              user_unique_id: "user-789",
            },
          },
        };

        const result = plugin.track!(validContext);

        expect(result).toBe(validContext);
        expect(mockLogger).not.toHaveBeenCalled();
        expect(mockContext.cancel).not.toHaveBeenCalled();
      });

      it("should log validation errors for invalid events", () => {
        const plugin = createValidationPlugin({
          logger: mockLogger,
          dropInvalidEvents: false,
        });

        const invalidContext = {
          ...mockContext,
          event: {
            event: "mcp_session_started",
            properties: {
              // Missing required fields
            },
          },
        };

        const result = plugin.track!(invalidContext);

        expect(result).toBe(invalidContext);
        expect(mockLogger).toHaveBeenCalledWith(
          expect.stringContaining("failed validation"),
          expect.any(Object),
        );
        expect(mockContext.cancel).not.toHaveBeenCalled();
      });

      it("should drop invalid events when configured to do so", () => {
        const plugin = createValidationPlugin({
          logger: mockLogger,
          dropInvalidEvents: true,
        });

        const invalidContext = {
          ...mockContext,
          event: {
            event: "mcp_session_started",
            properties: {
              // Missing required fields
            },
          },
        };

        plugin.track!(invalidContext);

        expect(mockLogger).toHaveBeenCalled();
        expect(mockContext.cancel).toHaveBeenCalled();
      });

      it("should log success messages when configured to do so", () => {
        const plugin = createValidationPlugin({
          logger: mockLogger,
          logSuccess: true,
        });

        const validContext = {
          ...mockContext,
          event: {
            event: "mcp_session_started",
            properties: {
              sess_id: "session-123",
              process_id: "process-456",
              user_unique_id: "user-789",
            },
          },
        };

        plugin.track!(validContext);

        expect(mockLogger).toHaveBeenCalledWith(
          expect.stringContaining("passed validation"),
        );
        expect(mockContext.cancel).not.toHaveBeenCalled();
      });

      it("should handle invalid event structure gracefully", () => {
        const plugin = createValidationPlugin({
          logger: mockLogger,
        });

        const malformedContext = {
          ...mockContext,
          event: null, // Invalid event structure
        };

        const result = plugin.track!(malformedContext);

        expect(mockLogger).toHaveBeenCalledWith(
          expect.stringContaining("Invalid event structure"),
          expect.any(Object),
        );
        expect(result).toBe(malformedContext); // Should not drop when dropInvalidEvents is false
      });

      it("should handle unknown event types", () => {
        const plugin = createValidationPlugin({
          logger: mockLogger,
        });

        const unknownEventContext = {
          ...mockContext,
          event: {
            event: "unknown_event_type",
            properties: {
              some: "data",
            },
          },
        };

        plugin.track!(unknownEventContext);

        expect(mockLogger).toHaveBeenCalledWith(
          expect.stringContaining("failed validation"),
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                issue: "Unknown event type: unknown_event_type",
              }),
            ]),
          }),
        );
      });

      it("should validate all tool called event fields", () => {
        const plugin = createValidationPlugin({
          logger: mockLogger,
        });

        const invalidToolContext = {
          ...mockContext,
          event: {
            event: "mcp_tool_called",
            properties: {
              tool_name: "", // Invalid empty string
              mcp_tool_set: "test-toolset",
              user_agent: "TestAgent/1.0",
              sess_id: "session-123",
              parameter_length: "not-a-number", // Invalid type
              http_status: 200,
              execution_time_ms: 500,
              user_unique_id: "user-789",
            },
          },
        };

        plugin.track!(invalidToolContext);

        expect(mockLogger).toHaveBeenCalledWith(
          expect.stringContaining("failed validation"),
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: "tool_name",
                issue: "Field value is invalid",
              }),
              expect.objectContaining({
                field: "parameter_length",
                issue: "Field value is invalid",
              }),
            ]),
          }),
        );
      });

      it("should validate server status event fields", () => {
        const plugin = createValidationPlugin({
          logger: mockLogger,
        });

        const invalidStatusContext = {
          ...mockContext,
          event: {
            event: "mcp_server_status",
            properties: {
              process_id: "",
              health_status: "sick", // Invalid health status
              active_sessions: -1, // Invalid negative value
              uptime_seconds: 3600,
              server_version: "",
              container_version: "v2.1.0",
              read_only_mode: "true", // Should be boolean
            },
          },
        };

        plugin.track!(invalidStatusContext);

        expect(mockLogger).toHaveBeenCalledWith(
          expect.stringContaining("failed validation"),
          expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: "process_id",
                issue: "Field value is invalid",
              }),
              expect.objectContaining({
                field: "health_status",
                issue: "Field value is invalid",
              }),
              expect.objectContaining({
                field: "active_sessions",
                issue: "Field value is invalid",
              }),
              expect.objectContaining({
                field: "server_version",
                issue: "Field value is invalid",
              }),
              expect.objectContaining({
                field: "read_only_mode",
                issue: "Field value is invalid",
              }),
            ]),
          }),
        );
      });

      it("should handle events with properties as null/undefined", () => {
        const plugin = createValidationPlugin({
          logger: mockLogger,
        });

        const nullPropsContext = {
          ...mockContext,
          event: {
            event: "mcp_session_started",
            properties: null,
          },
        };

        plugin.track!(nullPropsContext);

        expect(mockLogger).toHaveBeenCalledWith(
          expect.stringContaining("Invalid event structure"),
          expect.objectContaining({
            event: expect.objectContaining({
              event: "mcp_session_started",
              properties: null,
            }),
          }),
        );
      });
    });

    describe("plugin other event handlers", () => {
      it("should pass through identify events", () => {
        const plugin = createValidationPlugin();
        const context = { ...mockContext };

        const result = plugin.identify!(context);

        expect(result).toBe(context);
      });

      it("should pass through group events", () => {
        const plugin = createValidationPlugin();
        const context = { ...mockContext };

        const result = plugin.group!(context);

        expect(result).toBe(context);
      });

      it("should pass through page events", () => {
        const plugin = createValidationPlugin();
        const context = { ...mockContext };

        const result = plugin.page!(context);

        expect(result).toBe(context);
      });

      it("should pass through screen events", () => {
        const plugin = createValidationPlugin();
        const context = { ...mockContext };

        const result = plugin.screen!(context);

        expect(result).toBe(context);
      });

      it("should pass through alias events", () => {
        const plugin = createValidationPlugin();
        const context = { ...mockContext };

        const result = plugin.alias!(context);

        expect(result).toBe(context);
      });
    });
  });

  describe("edge cases and error conditions", () => {
    it("should handle HTTP status boundary values correctly", () => {
      const plugin = createValidationPlugin({
        logger: mockLogger,
      });

      // Test valid boundary values
      const validBoundaries = [
        100, 199, 200, 299, 300, 399, 400, 499, 500, 599,
      ];

      validBoundaries.forEach((status) => {
        mockLogger.mockClear();

        const context = {
          ...mockContext,
          event: {
            event: "mcp_tool_called",
            properties: {
              tool_name: "test-tool",
              mcp_tool_set: "test-toolset",
              user_agent: "TestAgent/1.0",
              sess_id: "session-123",
              parameter_length: 100,
              http_status: status,
              execution_time_ms: 500,
              user_unique_id: "user-789",
            },
          },
        };

        plugin.track!(context);

        expect(mockLogger).not.toHaveBeenCalled();
      });

      // Test invalid boundary values
      const invalidBoundaries = [99, 600];

      invalidBoundaries.forEach((status) => {
        mockLogger.mockClear();

        const context = {
          ...mockContext,
          event: {
            event: "mcp_tool_called",
            properties: {
              tool_name: "test-tool",
              mcp_tool_set: "test-toolset",
              user_agent: "TestAgent/1.0",
              sess_id: "session-123",
              parameter_length: 100,
              http_status: status,
              execution_time_ms: 500,
              user_unique_id: "user-789",
            },
          },
        };

        plugin.track!(context);

        expect(mockLogger).toHaveBeenCalledWith(
          expect.stringContaining("failed validation"),
          expect.any(Object),
        );
      });
    });

    it("should handle zero values correctly", () => {
      const plugin = createValidationPlugin({
        logger: mockLogger,
      });

      const contextWithZeros = {
        ...mockContext,
        event: {
          event: "mcp_tool_called",
          properties: {
            tool_name: "test-tool",
            mcp_tool_set: "test-toolset",
            user_agent: "TestAgent/1.0",
            sess_id: "session-123",
            parameter_length: 0, // Zero should be valid
            http_status: 200,
            execution_time_ms: 0, // Zero should be valid
            user_unique_id: "user-789",
          },
        },
      };

      plugin.track!(contextWithZeros);

      expect(mockLogger).not.toHaveBeenCalled();
    });

    it("should detect and report multiple validation errors", () => {
      const plugin = createValidationPlugin({
        logger: mockLogger,
      });

      const multipleErrorsContext = {
        ...mockContext,
        event: {
          event: "mcp_tool_called",
          properties: {
            tool_name: "", // Invalid
            mcp_tool_set: "", // Invalid
            user_agent: "", // Invalid
            sess_id: "", // Invalid
            parameter_length: -1, // Invalid
            http_status: 99, // Invalid
            execution_time_ms: -1, // Invalid
            user_unique_id: "", // Invalid
            extra_field: "should not be here", // Unexpected
          },
        },
      };

      plugin.track!(multipleErrorsContext);

      expect(mockLogger).toHaveBeenCalledWith(
        expect.stringContaining("failed validation"),
        expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({ field: "tool_name" }),
            expect.objectContaining({ field: "mcp_tool_set" }),
            expect.objectContaining({ field: "user_agent" }),
            expect.objectContaining({ field: "sess_id" }),
            expect.objectContaining({ field: "parameter_length" }),
            expect.objectContaining({ field: "http_status" }),
            expect.objectContaining({ field: "execution_time_ms" }),
            expect.objectContaining({ field: "user_unique_id" }),
            expect.objectContaining({ field: "extra_field" }),
          ]),
        }),
      );

      // Should have detected 9 errors
      const logCall = mockLogger.mock.calls[0][1];
      expect(logCall.errors).toHaveLength(9);
    });
  });
});
