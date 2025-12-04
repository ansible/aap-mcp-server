import {
  register,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from "prom-client";

export class MetricsService {
  public readonly httpRequestsTotal: Counter<string>;
  public readonly mcpToolExecutionsTotal: Counter<string>;
  public readonly mcpToolExecutionDuration: Histogram<string>;
  public readonly mcpToolErrors: Counter<string>;
  public readonly mcpActiveTools: Gauge<string>;
  public readonly mcpSessionsActiveTotal: Gauge<string>;
  public readonly mcpSessionsTimeoutTotal: Counter<string>;

  constructor() {
    // Enable default metrics collection (CPU, memory, GC, etc.)
    collectDefaultMetrics({ register });

    // HTTP request metrics
    this.httpRequestsTotal = new Counter({
      name: "http_requests_total",
      help: "Total number of HTTP requests",
      labelNames: ["method", "route", "status_code"],
      registers: [register],
    });

    // MCP-specific metrics
    this.mcpToolExecutionsTotal = new Counter({
      name: "mcp_tool_executions_total",
      help: "Total number of MCP tool executions",
      labelNames: ["tool_name", "service", "toolset", "status_code"],
      registers: [register],
    });

    this.mcpToolExecutionDuration = new Histogram({
      name: "mcp_tool_execution_duration_seconds",
      help: "MCP tool execution duration in seconds",
      labelNames: ["tool_name", "service", "toolset"],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [register],
    });

    this.mcpToolErrors = new Counter({
      name: "mcp_tool_errors_total",
      help: "Total number of MCP tool execution errors",
      labelNames: ["tool_name", "service", "toolset", "status_code"],
      registers: [register],
    });

    this.mcpActiveTools = new Gauge({
      name: "mcp_active_tools",
      help: "Number of currently active MCP tools",
      labelNames: ["service"],
      registers: [register],
    });

    this.mcpSessionsActiveTotal = new Gauge({
      name: "mcp_sessions_active_total",
      help: "Number of currently active MCP sessions",
      registers: [register],
    });

    this.mcpSessionsTimeoutTotal = new Counter({
      name: "mcp_sessions_timeout_total",
      help: "Total number of MCP sessions that have timed out",
      registers: [register],
    });
  }

  recordToolExecution(
    toolName: string,
    service: string,
    toolset: string,
    statusCode: number,
    executionTimeMs: number,
  ): void {
    this.mcpToolExecutionsTotal
      .labels(toolName, service, toolset, statusCode.toString())
      .inc();
    this.mcpToolExecutionDuration
      .labels(toolName, service, toolset)
      .observe(executionTimeMs / 1000);
  }

  recordToolError(
    toolName: string,
    service: string,
    toolset: string,
    statusCode: number,
  ): void {
    this.mcpToolErrors
      .labels(toolName, service, toolset, statusCode.toString())
      .inc();
  }

  setActiveTools(service: string, count: number): void {
    this.mcpActiveTools.labels(service).set(count);
  }

  incrementActiveSessions(): void {
    this.mcpSessionsActiveTotal.inc();
  }

  decrementActiveSessions(): void {
    this.mcpSessionsActiveTotal.dec();
  }

  incrementSessionTimeouts(): void {
    this.mcpSessionsTimeoutTotal.inc();
  }

  getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }
}
// Singleton instance
export const metricsService = new MetricsService();
