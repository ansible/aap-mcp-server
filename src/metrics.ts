import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

export class MetricsService {
  public readonly httpRequestsTotal: Counter<string>;
  public readonly httpRequestDuration: Histogram<string>;
  public readonly mcpToolExecutionsTotal: Counter<string>;
  public readonly mcpToolExecutionDuration: Histogram<string>;
  public readonly mcpToolErrors: Counter<string>;
  public readonly mcpActiveTools: Gauge<string>;
  public readonly mcpActiveSessions: Gauge<string>;
  public readonly mcpApiCallsTotal: Counter<string>;

  constructor() {
    // Enable default metrics collection (CPU, memory, GC, etc.)
    collectDefaultMetrics({ register });

    // HTTP request metrics
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [register]
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
      registers: [register]
    });

    // MCP-specific metrics
    this.mcpToolExecutionsTotal = new Counter({
      name: 'mcp_tool_executions_total',
      help: 'Total number of MCP tool executions',
      labelNames: ['tool_name', 'service', 'status'],
      registers: [register]
    });

    this.mcpToolExecutionDuration = new Histogram({
      name: 'mcp_tool_execution_duration_seconds',
      help: 'MCP tool execution duration in seconds',
      labelNames: ['tool_name', 'service'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [register]
    });

    this.mcpToolErrors = new Counter({
      name: 'mcp_tool_errors_total',
      help: 'Total number of MCP tool execution errors',
      labelNames: ['tool_name', 'service', 'error_type'],
      registers: [register]
    });

    this.mcpActiveTools = new Gauge({
      name: 'mcp_active_tools',
      help: 'Number of currently active MCP tools',
      labelNames: ['service'],
      registers: [register]
    });

    this.mcpActiveSessions = new Gauge({
      name: 'mcp_active_sessions',
      help: 'Number of currently active MCP sessions',
      registers: [register]
    });

    this.mcpApiCallsTotal = new Counter({
      name: 'mcp_api_calls_total',
      help: 'Total number of AAP API calls made by tools',
      labelNames: ['service', 'endpoint', 'method', 'status_code'],
      registers: [register]
    });
  }

  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    this.httpRequestsTotal.labels(method, route, statusCode.toString()).inc();
    this.httpRequestDuration.labels(method, route, statusCode.toString()).observe(duration);
  }

  recordToolExecution(toolName: string, service: string, status: 'success' | 'error', duration: number): void {
    this.mcpToolExecutionsTotal.labels(toolName, service, status).inc();
    this.mcpToolExecutionDuration.labels(toolName, service).observe(duration);
  }

  recordToolError(toolName: string, service: string, errorType: string): void {
    this.mcpToolErrors.labels(toolName, service, errorType).inc();
  }

  setActiveTools(service: string, count: number): void {
    this.mcpActiveTools.labels(service).set(count);
  }

  incrementActiveSessions(): void {
    this.mcpActiveSessions.inc();
  }

  decrementActiveSessions(): void {
    this.mcpActiveSessions.dec();
  }

  recordApiCall(service: string, endpoint: string, method: string, statusCode: number): void {
    this.mcpApiCallsTotal.labels(service, endpoint, method, statusCode.toString()).inc();
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