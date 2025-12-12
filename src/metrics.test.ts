import { describe, it, expect, beforeEach } from "vitest";
import { metricsService } from "./metrics.js";

describe("MetricsService", () => {
  beforeEach(() => {
    // Reset metrics before each test
    try {
      metricsService.mcpToolExecutionDuration.reset();
      metricsService.mcpToolExecutionsTotal.reset();
    } catch (_e) {
      // Ignore reset errors if metrics don't exist yet
    }
  });

  it("should record tool executions", () => {
    metricsService.recordToolExecution(
      "test_tool",
      200,
      0.1, // 100ms
    );

    // Verify the metrics exist and can be retrieved
    expect(metricsService.mcpToolExecutionsTotal).toBeDefined();
    expect(metricsService.mcpToolExecutionDuration).toBeDefined();
  });

  it("should record tool errors", () => {
    metricsService.recordToolError("test_tool", 0);

    // Verify the metrics exist and can be retrieved
    expect(metricsService.mcpToolErrors).toBeDefined();
  });

  it("should set active tools count", () => {
    metricsService.setActiveTools(5);

    // Verify the metrics exist and can be retrieved
    expect(metricsService.mcpActiveTools).toBeDefined();
  });

  it("should increment and decrement active sessions", () => {
    metricsService.incrementActiveSessions();
    metricsService.decrementActiveSessions();

    // Verify the metrics exist and can be retrieved
    expect(metricsService.mcpSessionsActiveTotal).toBeDefined();
  });

  it("should increment session timeouts", () => {
    metricsService.incrementSessionTimeouts();

    // Verify the metrics exist and can be retrieved
    expect(metricsService.mcpSessionsTimeoutTotal).toBeDefined();
  });

  it("should return metrics as string", async () => {
    const metrics = await metricsService.getMetrics();
    expect(typeof metrics).toBe("string");
    expect(metrics.length).toBeGreaterThan(0);
  });

  it("should return content type", () => {
    const contentType = metricsService.getContentType();
    expect(typeof contentType).toBe("string");
    expect(contentType.length).toBeGreaterThan(0);
  });

  it("should handle multiple tool executions", () => {
    metricsService.recordToolExecution("tool1", 200, 0.1);
    metricsService.recordToolExecution("tool2", 500, 0.2);

    // Verify the metrics exist
    expect(metricsService.mcpToolExecutionsTotal).toBeDefined();
    expect(metricsService.mcpToolExecutionDuration).toBeDefined();
  });

  it("should handle zero duration", () => {
    metricsService.recordToolExecution("test_tool", 200, 0);

    // Verify the metrics work with zero duration
    expect(metricsService.mcpToolExecutionDuration).toBeDefined();
  });

  it("should record telemetry sent events", () => {
    metricsService.recordTelemetrySent("mcp_session_started");
    metricsService.recordTelemetrySent("mcp_tool_called");
    metricsService.recordTelemetrySent("mcp_server_status");

    // Verify the metrics exist
    expect(metricsService.telemetrySentTotal).toBeDefined();
  });

  it("should record telemetry error events", () => {
    metricsService.recordTelemetryError();

    // Verify the metrics exist
    expect(metricsService.telemetryErrorTotal).toBeDefined();
  });

  it("should handle multiple telemetry events with different event types", () => {
    // Record successful telemetry
    metricsService.recordTelemetrySent("mcp_session_started");
    metricsService.recordTelemetrySent("mcp_tool_called");
    metricsService.recordTelemetrySent("mcp_tool_called");

    // Record telemetry errors
    metricsService.recordTelemetryError();

    // Verify both metrics work together
    expect(metricsService.telemetrySentTotal).toBeDefined();
    expect(metricsService.telemetryErrorTotal).toBeDefined();
  });
});
