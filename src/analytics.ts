import { Analytics } from "@segment/analytics-node";
import { randomUUID } from "node:crypto";
import { createValidationPlugin } from "./analytics-validation-plugin.js";
import { metricsService } from "./metrics.js";

/**
 * Analytics service for MCP server telemetry using Segment
 */
export class AnalyticsService {
  private analytics: Analytics | null = null;
  private isEnabled = false;
  private processId: string;
  private startTime: number;
  private statusReportInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Generate volatile process ID that changes on each restart
    this.processId = randomUUID();
    this.startTime = Date.now();
  }

  /**
   * Initialize analytics with the provided write key and start periodic status reporting
   * @param writeKey - Segment write key from configuration (already validated and trimmed)
   * @param getActiveSessions - Function to get the current active session count
   * @param serverVersion - Version of the MCP server
   * @param containerVersion - Version of the container
   * @param readOnlyMode - Configuration setting for read_only mode
   */
  initialize(
    writeKey: string,
    getActiveSessions: () => number,
    serverVersion: string,
    containerVersion: string,
    readOnlyMode: boolean,
  ): void {
    try {
      this.analytics = new Analytics({
        writeKey,
      });

      // Register validation plugin
      const validationPlugin = createValidationPlugin({
        dropInvalidEvents: true,
        logger: (message: string, data?: any) => {
          console.error(message, data ? JSON.stringify(data, null, 2) : "");
        },
        logSuccess: false, // Only log errors, not successes
      });

      this.analytics.register(validationPlugin);
      console.log(
        "Analytics: Telemetry initialized successfully with validation plugin",
      );

      // Track successful telemetry events
      this.analytics.on("track", (ctx) => {
        if (ctx.event && ctx.event.event) {
          metricsService.recordTelemetrySent(ctx.event.event);
        }
      });

      // Track telemetry errors
      this.analytics.on("error", (err) => {
        console.error("Analytics: error:", err);
        metricsService.recordTelemetryError();
      });
      this.isEnabled = true;

      // Start periodic status reporting automatically
      this.startPeriodicStatusReporting(
        getActiveSessions,
        serverVersion,
        containerVersion,
        readOnlyMode,
      );
    } catch (error) {
      console.error("Analytics: Failed to initialize telemetry:", error);
      this.isEnabled = false;
    }
  }

  /**
   * Safely shut down analytics
   */
  async shutdown(): Promise<void> {
    // Clear the periodic status reporting interval
    if (this.statusReportInterval) {
      clearInterval(this.statusReportInterval);
      this.statusReportInterval = null;
    }

    if (this.analytics) {
      try {
        await this.analytics.closeAndFlush();
        console.log("Analytics: Telemetry shut down successfully");
      } catch (error) {
        console.error("Analytics: Error during shutdown:", error);
      }
      this.analytics = null;
      this.isEnabled = false;
    }
  }

  /**
   * Track MCP tool called event
   * @param toolName - Name of the MCP tool
   * @param mcpToolSet - Name of the specific MCP server instance
   * @param userAgent - Client user agent string
   * @param parameterLength - Size in chars of the input payload
   * @param httpStatus - Return code of the http request
   * @param executionTimeMs - Tool execution time in milliseconds
   * @param userPseudoId - HMAC-SHA-256 pseudonymous user identifier
   * @param userType - User type classification ("internal" | "external")
   * @param installerPseudoId - HMAC-SHA-256 pseudonymous installer identifier
   */
  trackMcpToolCalled(
    toolName: string,
    mcpToolSet: string,
    userAgent: string,
    parameterLength: number,
    httpStatus: number,
    executionTimeMs: number,
    userPseudoId: string = "anonymous",
    userType: string = "external",
    installerPseudoId: string = "unknown",
  ): void {
    if (!this.isEnabled) return;
    try {
      this.analytics!.track({
        event: "mcp_tool_called",
        anonymousId: userPseudoId,
        properties: {
          tool_name: toolName,
          user_pseudo_id: userPseudoId,
          user_type: userType,
          installer_pseudo_id: installerPseudoId,
          mcp_tool_set: mcpToolSet,
          user_agent: userAgent,
          parameter_length: parameterLength,
          http_status: httpStatus,
          execution_time_ms: executionTimeMs,
        },
      });
    } catch (error) {
      console.error("Analytics: Error tracking mcp_tool_called:", error);
    }
  }

  /**
   * Track MCP server status event (sent every 30 minutes)
   * @param healthStatus - Overall health status of the server
   * @param activeSessions - Number of active sessions
   * @param serverVersion - Version of the MCP server
   * @param containerVersion - Version of the container
   * @param readOnlyMode - Configuration setting for read_only mode
   */
  trackMcpServerStatus(
    healthStatus: "healthy" | "degraded" | "unhealthy",
    activeSessions: number,
    serverVersion: string,
    containerVersion: string,
    readOnlyMode: boolean,
  ): void {
    if (!this.isEnabled) return;
    try {
      const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

      this.analytics!.track({
        event: "mcp_server_status",
        anonymousId: this.processId,
        properties: {
          process_id: this.processId,
          health_status: healthStatus,
          active_sessions: activeSessions,
          uptime_seconds: uptimeSeconds,
          server_version: serverVersion,
          container_version: containerVersion,
          read_only_mode: readOnlyMode,
        },
      });
    } catch (error) {
      console.error("Analytics: Error tracking mcp_server_status:", error);
      // Error metrics will be tracked by analytics.on("error") listener
    }
  }

  /**
   * Start periodic server status reporting (every 30 minutes)
   */
  startPeriodicStatusReporting(
    getActiveSessions: () => number,
    serverVersion: string,
    containerVersion: string,
    readOnlyMode: boolean,
  ): NodeJS.Timeout {
    const reportStatus = () => {
      try {
        const activeSessions = getActiveSessions();
        // For now, we assume healthy status. This could be enhanced to check AAP connectivity
        const healthStatus = "healthy" as const;

        this.trackMcpServerStatus(
          healthStatus,
          activeSessions,
          serverVersion,
          containerVersion,
          readOnlyMode,
        );

        console.log(
          `Analytics: Sent periodic status report (${activeSessions} active sessions)`,
        );
      } catch (error) {
        console.error("Analytics: Error in periodic status reporting:", error);
      }
    };

    // Send initial status report
    reportStatus();

    // Schedule periodic reports every 30 minutes
    this.statusReportInterval = setInterval(reportStatus, 30 * 60 * 1000); // 30 minutes in milliseconds

    console.log(
      "Analytics: Started periodic status reporting (every 30 minutes)",
    );
    return this.statusReportInterval;
  }

  /**
   * Get process ID for this instance
   */
  getProcessId(): string {
    return this.processId;
  }
}

export interface SessionStartedEvent {
  user_agent?: string;
  sess_id: string;
  mcp_tool_set?: string;
  process_id: string;
  user_pseudo_id: string;
  user_type: string;
  installer_pseudo_id: string;
}

export interface ToolCalledEvent {
  tool_name: string;
  mcp_tool_set: string;
  user_agent: string;
  sess_id: string;
  parameter_length: number;
  http_status: number;
  execution_time_ms: number;
  user_pseudo_id: string;
  user_type: string;
  installer_pseudo_id: string;
}

export interface ServerStatusEvent {
  process_id: string;
  health_status: "healthy" | "degraded" | "unhealthy";
  active_sessions: number;
  uptime_seconds: number;
  server_version: string;
  container_version: string;
  read_only_mode: boolean;
}
