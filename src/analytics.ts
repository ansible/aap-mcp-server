import { Analytics } from "@segment/analytics-node";
import { randomUUID } from "node:crypto";
import crypto from "crypto";
import { register } from "prom-client";

export interface AnalyticsEvent {
  anonymousId: string;
  event: string;
  properties: Record<string, any>;
  timestamp?: Date;
}

export interface MetricsSummary {
  totalToolExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  topTools: Array<{ name: string; count: number }>;
  serviceUsage: Record<string, number>;
  errorTypes: Record<string, number>;
  avgExecutionTime: number;
}

export class AnalyticsService {
  private analytics: Analytics | null = null;
  private enabled: boolean = false;
  private writeKey: string | null = null;
  private reportingInterval: NodeJS.Timeout | null = null;

  constructor(writeKey?: string) {
    if (writeKey) {
      this.writeKey = writeKey;
      console.log("[Analytics] Creating Segment.com Analytics client...");
      this.analytics = new Analytics({
        writeKey,
        flushAt: 20, // Larger batch size for periodic reporting
        flushInterval: 60000, // Flush every minute for periodic data
      });
      this.enabled = true;
      console.log(
        "[Analytics] Analytics client created (batch size: 20, flush interval: 60s)",
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.analytics !== null;
  }

  // Generate anonymized installation ID for this service instance
  private generateInstallationId(): string {
    // Use a combination of factors to create a stable but anonymous ID
    const hostname = process.env.HOSTNAME || "localhost";
    const startTime = process.env.START_TIME || Date.now().toString();
    return crypto
      .createHash("sha256")
      .update(`${hostname}-${startTime}`)
      .digest("hex")
      .substring(0, 16);
  }

  // Parse Prometheus metrics to extract usage data
  private async parsePrometheusMetrics(): Promise<MetricsSummary> {
    const metricsString = await register.metrics();
    const lines = metricsString.split("\n");

    let totalExecutions = 0;
    let successfulExecutions = 0;
    let failedExecutions = 0;
    const toolCounts: Record<string, number> = {};
    const serviceCounts: Record<string, number> = {};
    const errorCounts: Record<string, number> = {};
    let totalDuration = 0;
    let durationSamples = 0;

    for (const line of lines) {
      // Parse tool execution counts
      if (line.startsWith("mcp_tool_executions_total{")) {
        const match = line.match(
          /tool_name="([^"]+)".*service="([^"]+)".*status="([^"]+)".*}\s+(\d+)/,
        );
        if (match) {
          const [, toolName, service, status, count] = match;
          const countNum = parseInt(count);

          totalExecutions += countNum;
          toolCounts[toolName] = (toolCounts[toolName] || 0) + countNum;
          serviceCounts[service] = (serviceCounts[service] || 0) + countNum;

          if (status === "success") {
            successfulExecutions += countNum;
          } else {
            failedExecutions += countNum;
          }
        }
      }

      // Parse error counts
      if (line.startsWith("mcp_tool_errors_total{")) {
        const match = line.match(/error_type="([^"]+)".*}\s+(\d+)/);
        if (match) {
          const [, errorType, count] = match;
          errorCounts[errorType] = parseInt(count);
        }
      }

      // Parse execution duration
      if (line.startsWith("mcp_tool_execution_duration_seconds_sum")) {
        const match = line.match(/}\s+([\d.]+)/);
        if (match) {
          totalDuration += parseFloat(match[1]);
        }
      }

      if (line.startsWith("mcp_tool_execution_duration_seconds_count")) {
        const match = line.match(/}\s+(\d+)/);
        if (match) {
          durationSamples += parseInt(match[1]);
        }
      }
    }

    // Get top 10 tools by usage
    const topTools = Object.entries(toolCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return {
      totalToolExecutions: totalExecutions,
      successfulExecutions,
      failedExecutions,
      topTools,
      serviceUsage: serviceCounts,
      errorTypes: errorCounts,
      avgExecutionTime:
        durationSamples > 0 ? totalDuration / durationSamples : 0,
    };
  }

  // Send aggregated metrics summary to Segment
  private async sendMetricsSummary(
    isInitialReport: boolean = false,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const timestamp = new Date().toISOString();
    console.log(
      `[Analytics] [${timestamp}] Collecting metrics for Segment.com...`,
    );

    try {
      const summary = await this.parsePrometheusMetrics();
      const installationId = this.generateInstallationId();

      // Skip if no usage to report, except for initial report (to confirm analytics is working)
      if (summary.totalToolExecutions === 0 && !isInitialReport) {
        console.log(
          `[Analytics] [${timestamp}] No tool executions to report in this period - skipping`,
        );
        return;
      }

      if (isInitialReport && summary.totalToolExecutions === 0) {
        console.log(
          `[Analytics] [${timestamp}] Initial report: No executions yet, but sending to confirm analytics is working`,
        );
      }

      console.log(
        `[Analytics] [${timestamp}] Preparing to send usage summary to Segment.com:`,
      );
      console.log(
        `[Analytics]   - Total executions: ${summary.totalToolExecutions}`,
      );
      console.log(
        `[Analytics]   - Successful: ${summary.successfulExecutions}`,
      );
      console.log(`[Analytics]   - Failed: ${summary.failedExecutions}`);
      console.log(
        `[Analytics]   - Success rate: ${(summary.totalToolExecutions > 0
          ? (summary.successfulExecutions / summary.totalToolExecutions) * 100
          : 0
        ).toFixed(1)}%`,
      );
      console.log(
        `[Analytics]   - Top tools: ${summary.topTools
          .slice(0, 3)
          .map((t) => t.name)
          .join(", ")}`,
      );
      console.log(`[Analytics]   - Installation ID: ${installationId}`);

      const event: AnalyticsEvent = {
        anonymousId: installationId,
        event: "MCP Server Usage Summary",
        properties: {
          total_executions: summary.totalToolExecutions,
          successful_executions: summary.successfulExecutions,
          failed_executions: summary.failedExecutions,
          success_rate:
            summary.totalToolExecutions > 0
              ? summary.successfulExecutions / summary.totalToolExecutions
              : 0,
          top_tools: summary.topTools,
          service_usage: summary.serviceUsage,
          error_types: summary.errorTypes,
          avg_execution_time_seconds: summary.avgExecutionTime,
          reporting_period_hours: 5,
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date(),
      };

      console.log(`[Analytics] [${timestamp}] Sending event to Segment.com...`);
      await this.analytics?.track(event);
      console.log(
        `[Analytics] [${timestamp}] ✓ Successfully sent usage summary to Segment.com`,
      );
    } catch (error) {
      console.error(
        `[Analytics] [${timestamp}] ✗ Failed to send metrics summary to Segment.com:`,
        error,
      );
    }
  }

  // Start periodic reporting every 5 hours
  startPeriodicReporting(): void {
    if (!this.isEnabled()) return;

    // Clear any existing interval
    this.stopPeriodicReporting();

    const firstReportTime = new Date(Date.now() + 60000).toISOString();
    console.log(
      `[Analytics] Periodic reporting enabled - sending reports to Segment.com every 5 hours`,
    );
    console.log(`[Analytics] First report scheduled for: ${firstReportTime}`);

    // Send initial report after 1 minute startup delay
    setTimeout(() => {
      console.log(
        "[Analytics] Initial report triggered (1 minute after startup)",
      );
      this.sendMetricsSummary(true); // isInitialReport = true
    }, 60000);

    // Set up 5-hour interval (5 * 60 * 60 * 1000 ms)
    this.reportingInterval = setInterval(
      () => {
        console.log("[Analytics] Periodic report triggered (5-hour interval)");
        this.sendMetricsSummary();
      },
      5 * 60 * 60 * 1000,
    );
  }

  // Stop periodic reporting
  stopPeriodicReporting(): void {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
      console.log(
        "[Analytics] Periodic reporting stopped - no more data will be sent to Segment.com",
      );
    }
  }

  // Send final report and flush
  async flush(): Promise<void> {
    if (!this.isEnabled()) return;

    console.log("[Analytics] Flushing analytics data before shutdown...");

    try {
      // Send final metrics summary before shutdown
      console.log(
        "[Analytics] Sending final metrics summary to Segment.com...",
      );
      await this.sendMetricsSummary();

      console.log(
        "[Analytics] Closing Segment.com connection and flushing remaining events...",
      );
      await this.analytics?.closeAndFlush();
      console.log(
        "[Analytics] ✓ Successfully flushed all analytics data to Segment.com",
      );
    } catch (error) {
      console.error("[Analytics] ✗ Failed to flush analytics data:", error);
    }
  }
}

// Create a default instance that can be configured later
export let analyticsService: AnalyticsService = new AnalyticsService();

// Function to initialize analytics with configuration
export function initializeAnalytics(writeKey?: string): void {
  if (writeKey) {
    console.log("[Analytics] Initializing analytics service...");
    console.log(
      `[Analytics] Segment.com write key: ${writeKey.substring(0, 8)}...`,
    );
    analyticsService = new AnalyticsService(writeKey);
    analyticsService.startPeriodicReporting();
    console.log("[Analytics] ✓ Analytics service initialized successfully");
    console.log(
      "[Analytics] Anonymous usage metrics will be sent to Segment.com every 5 hours",
    );
  } else {
    console.log(
      "[Analytics] Analytics service disabled - no Segment write key provided",
    );
    console.log(
      "[Analytics] To enable analytics, set SEGMENT_WRITE_KEY environment variable or segment_write_key in config",
    );
  }
}
