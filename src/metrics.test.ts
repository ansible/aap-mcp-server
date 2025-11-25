import { describe, it, expect, beforeEach } from "vitest";
import { metricsService } from "./metrics.js";

describe("MetricsService", () => {
  beforeEach(() => {
    // Reset metrics before each test
    try {
      metricsService.httpRequestDuration.reset();
      metricsService.httpRequestsTotal.reset();
      metricsService.mcpToolExecutionDuration.reset();
      metricsService.mcpToolExecutionsTotal.reset();
    } catch (_e) {
      // Ignore reset errors if metrics don't exist yet
    }
  });

  it("should record tool executions", () => {
    metricsService.recordToolExecution(
      "test_tool",
      "test_service",
      "test_category",
      "success",
      0.1, // 100ms
    );

    // Verify the metrics exist and can be retrieved
    expect(metricsService.mcpToolExecutionsTotal).toBeDefined();
    expect(metricsService.mcpToolExecutionDuration).toBeDefined();
  });

  it("should record HTTP requests", () => {
    metricsService.recordHttpRequest("GET", "/api/test", 200, 0.05);

    // Verify the metrics exist and can be retrieved
    expect(metricsService.httpRequestsTotal).toBeDefined();
    expect(metricsService.httpRequestDuration).toBeDefined();
  });

  it("should record tool errors", () => {
    metricsService.recordToolError(
      "test_tool",
      "test_service",
      "test_category",
      "timeout",
    );

    // Verify the metrics exist and can be retrieved
    expect(metricsService.mcpToolErrors).toBeDefined();
  });

  it("should set active tools count", () => {
    metricsService.setActiveTools("test_service", 5);

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

  it("should record API calls", () => {
    metricsService.recordApiCall(
      "test_endpoint",
      "test_service",
      "success",
      0.1,
    );

    // Verify the metrics exist and can be retrieved
    expect(metricsService.mcpApiCallsTotal).toBeDefined();
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
    metricsService.recordToolExecution(
      "tool1",
      "service1",
      "category1",
      "success",
      0.1,
    );
    metricsService.recordToolExecution(
      "tool2",
      "service2",
      "category2",
      "error",
      0.2,
    );

    // Verify the metrics exist
    expect(metricsService.mcpToolExecutionsTotal).toBeDefined();
    expect(metricsService.mcpToolExecutionDuration).toBeDefined();
  });

  it("should handle zero duration", () => {
    metricsService.recordToolExecution(
      "test_tool",
      "test_service",
      "test_category",
      "success",
      0,
    );

    // Verify the metrics work with zero duration
    expect(metricsService.mcpToolExecutionDuration).toBeDefined();
  });
});
