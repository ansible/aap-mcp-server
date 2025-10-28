import { Analytics } from '@segment/analytics-node';
import { randomUUID } from 'node:crypto';
import crypto from 'crypto';
import { register } from 'prom-client';

export interface AnalyticsEvent {
  userId?: string;
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
      this.analytics = new Analytics({
        writeKey,
        flushAt: 20, // Larger batch size for periodic reporting
        flushInterval: 60000, // Flush every minute for periodic data
      });
      this.enabled = true;
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.analytics !== null;
  }

  // Generate anonymized installation ID for this service instance
  private generateInstallationId(): string {
    // Use a combination of factors to create a stable but anonymous ID
    const hostname = process.env.HOSTNAME || 'localhost';
    const startTime = process.env.START_TIME || Date.now().toString();
    return crypto.createHash('sha256').update(`${hostname}-${startTime}`).digest('hex').substring(0, 16);
  }

  // Parse Prometheus metrics to extract usage data
  private async parsePrometheusMetrics(): Promise<MetricsSummary> {
    const metricsString = await register.metrics();
    const lines = metricsString.split('\n');
    
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
      if (line.startsWith('mcp_tool_executions_total{')) {
        const match = line.match(/tool_name="([^"]+)".*service="([^"]+)".*status="([^"]+)".*}\s+(\d+)/);
        if (match) {
          const [, toolName, service, status, count] = match;
          const countNum = parseInt(count);
          
          totalExecutions += countNum;
          toolCounts[toolName] = (toolCounts[toolName] || 0) + countNum;
          serviceCounts[service] = (serviceCounts[service] || 0) + countNum;
          
          if (status === 'success') {
            successfulExecutions += countNum;
          } else {
            failedExecutions += countNum;
          }
        }
      }
      
      // Parse error counts
      if (line.startsWith('mcp_tool_errors_total{')) {
        const match = line.match(/error_type="([^"]+)".*}\s+(\d+)/);
        if (match) {
          const [, errorType, count] = match;
          errorCounts[errorType] = parseInt(count);
        }
      }
      
      // Parse execution duration
      if (line.startsWith('mcp_tool_execution_duration_seconds_sum')) {
        const match = line.match(/}\s+([\d.]+)/);
        if (match) {
          totalDuration += parseFloat(match[1]);
        }
      }
      
      if (line.startsWith('mcp_tool_execution_duration_seconds_count')) {
        const match = line.match(/}\s+(\d+)/);
        if (match) {
          durationSamples += parseInt(match[1]);
        }
      }
    }

    // Get top 10 tools by usage
    const topTools = Object.entries(toolCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return {
      totalToolExecutions: totalExecutions,
      successfulExecutions,
      failedExecutions,
      topTools,
      serviceUsage: serviceCounts,
      errorTypes: errorCounts,
      avgExecutionTime: durationSamples > 0 ? totalDuration / durationSamples : 0
    };
  }

  // Send aggregated metrics summary to Segment
  private async sendMetricsSummary(): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const summary = await this.parsePrometheusMetrics();
      const installationId = this.generateInstallationId();

      // Only send if there's actual usage to report
      if (summary.totalToolExecutions === 0) {
        console.log('No tool executions to report in this period');
        return;
      }

      const event: AnalyticsEvent = {
        userId: installationId,
        event: 'Usage Summary',
        properties: {
          total_executions: summary.totalToolExecutions,
          successful_executions: summary.successfulExecutions,
          failed_executions: summary.failedExecutions,
          success_rate: summary.totalToolExecutions > 0 ? summary.successfulExecutions / summary.totalToolExecutions : 0,
          top_tools: summary.topTools,
          service_usage: summary.serviceUsage,
          error_types: summary.errorTypes,
          avg_execution_time_seconds: summary.avgExecutionTime,
          reporting_period_hours: 5,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date()
      };

      await this.analytics?.track(event);
      console.log(`Analytics summary sent: ${summary.totalToolExecutions} executions, ${summary.successfulExecutions} successful`);
    } catch (error) {
      console.error('Failed to send metrics summary:', error);
    }
  }

  // Start periodic reporting every 5 hours
  startPeriodicReporting(): void {
    if (!this.isEnabled()) return;

    // Clear any existing interval
    this.stopPeriodicReporting();

    // Send initial report after 1 minute startup delay
    setTimeout(() => {
      this.sendMetricsSummary();
    }, 60000);

    // Set up 5-hour interval (5 * 60 * 60 * 1000 ms)
    this.reportingInterval = setInterval(() => {
      this.sendMetricsSummary();
    }, 5 * 60 * 60 * 1000);

    console.log('Analytics periodic reporting started (every 5 hours)');
  }

  // Stop periodic reporting
  stopPeriodicReporting(): void {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
      console.log('Analytics periodic reporting stopped');
    }
  }

  // Send final report and flush
  async flush(): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      // Send final metrics summary before shutdown
      await this.sendMetricsSummary();
      await this.analytics?.closeAndFlush();
    } catch (error) {
      console.error('Failed to flush analytics:', error);
    }
  }
}

// Create a default instance that can be configured later
export let analyticsService: AnalyticsService = new AnalyticsService();

// Function to initialize analytics with configuration
export function initializeAnalytics(writeKey?: string): void {
  if (writeKey) {
    analyticsService = new AnalyticsService(writeKey);
    analyticsService.startPeriodicReporting();
    console.log('Analytics service initialized with Segment.com (5-hour periodic reporting)');
  } else {
    console.log('Analytics service disabled - no Segment write key provided');
  }
}