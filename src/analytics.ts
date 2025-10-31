import { Analytics } from '@segment/analytics-node';
import { randomUUID } from 'node:crypto';
import crypto from 'crypto';

export interface AnalyticsEvent {
  userId?: string;
  event: string;
  properties: Record<string, any>;
  timestamp?: Date;
}

export interface ToolUsageEvent {
  toolName: string;
  service: string;
  success: boolean;
  duration: number;
  errorType?: string;
  endpoint?: string;
  responseCode?: number;
}

export class AnalyticsService {
  private analytics: Analytics | null = null;
  private enabled: boolean = false;
  private writeKey: string | null = null;

  constructor(writeKey?: string) {
    if (writeKey) {
      this.writeKey = writeKey;
      this.analytics = new Analytics({
        writeKey,
        flushAt: 10, // Flush after 10 events
        flushInterval: 30000, // Flush every 30 seconds
      });
      this.enabled = true;
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.analytics !== null;
  }

  // Generate anonymized user ID based on session or request data
  private generateAnonymousUserId(sessionId?: string, userAgent?: string): string {
    const data = sessionId || userAgent || 'anonymous';
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  // Anonymize tool name to remove any potential sensitive information
  private anonymizeToolName(toolName: string): string {
    // Extract service prefix and generic action
    const parts = toolName.split('.');
    if (parts.length >= 2) {
      const service = parts[0];
      const action = parts[1];
      
      // Categorize actions into generic types
      if (action.includes('read') || action.includes('list') || action.includes('get')) {
        return `${service}.read_operation`;
      } else if (action.includes('create') || action.includes('launch') || action.includes('post')) {
        return `${service}.create_operation`;
      } else if (action.includes('update') || action.includes('patch') || action.includes('put')) {
        return `${service}.update_operation`;
      } else if (action.includes('delete') || action.includes('remove')) {
        return `${service}.delete_operation`;
      }
      
      return `${service}.other_operation`;
    }
    
    return 'unknown.operation';
  }

  async trackToolUsage(
    toolUsage: ToolUsageEvent,
    sessionId?: string,
    userAgent?: string
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const anonymousUserId = this.generateAnonymousUserId(sessionId, userAgent);
    const anonymizedToolName = this.anonymizeToolName(toolUsage.toolName);

    const event: AnalyticsEvent = {
      userId: anonymousUserId,
      event: 'Tool Executed',
      properties: {
        tool_name: anonymizedToolName,
        service: toolUsage.service,
        success: toolUsage.success,
        duration_ms: Math.round(toolUsage.duration * 1000),
        error_type: toolUsage.errorType || null,
        response_code: toolUsage.responseCode || null,
        has_endpoint: !!toolUsage.endpoint,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date()
    };

    try {
      this.analytics?.track(event);
    } catch (error) {
      console.error('Failed to track analytics event:', error);
    }
  }

  async trackServiceUsage(service: string, toolCount: number, sessionId?: string): Promise<void> {
    if (!this.isEnabled()) return;

    const anonymousUserId = this.generateAnonymousUserId(sessionId);

    const event: AnalyticsEvent = {
      userId: anonymousUserId,
      event: 'Service Session Started',
      properties: {
        service,
        available_tools: toolCount,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date()
    };

    try {
      this.analytics?.track(event);
    } catch (error) {
      console.error('Failed to track service usage event:', error);
    }
  }

  async trackSessionStart(
    services: string[],
    totalTools: number,
    userType: 'anonymous' | 'user' | 'admin',
    sessionId?: string
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const anonymousUserId = this.generateAnonymousUserId(sessionId);

    const event: AnalyticsEvent = {
      userId: anonymousUserId,
      event: 'MCP Session Started',
      properties: {
        services_enabled: services,
        total_tools_available: totalTools,
        user_type: userType,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date()
    };

    try {
      this.analytics?.track(event);
    } catch (error) {
      console.error('Failed to track session start event:', error);
    }
  }

  async trackError(
    errorType: string,
    service?: string,
    toolName?: string,
    sessionId?: string
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const anonymousUserId = this.generateAnonymousUserId(sessionId);
    const anonymizedToolName = toolName ? this.anonymizeToolName(toolName) : null;

    const event: AnalyticsEvent = {
      userId: anonymousUserId,
      event: 'Error Occurred',
      properties: {
        error_type: errorType,
        service: service || null,
        tool_name: anonymizedToolName,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date()
    };

    try {
      this.analytics?.track(event);
    } catch (error) {
      console.error('Failed to track error event:', error);
    }
  }

  async flush(): Promise<void> {
    if (!this.isEnabled()) return;

    try {
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
    console.log('Analytics service initialized with Segment.com');
  } else {
    console.log('Analytics service disabled - no Segment write key provided');
  }
}