/**
 * Analytics utility for Segment integration
 * Provides both server-side tracking and client-side snippet generation
 */

export interface AnalyticsEvent {
  event: string;
  properties?: Record<string, any>;
  userId?: string;
  anonymousId?: string;
}

/**
 * Generates the Segment analytics.js snippet for client-side tracking
 */
export function getSegmentSnippet(writeKey: string): string {
  return `
<script>
  !function(){var analytics=window.analytics=window.analytics||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error("Segment snippet included twice.");else{analytics.invoked=!0;analytics.methods=["trackSubmit","trackClick","trackLink","trackForm","pageview","identify","reset","group","track","ready","alias","debug","page","once","off","on","addSourceMiddleware","addIntegrationMiddleware","setAnonymousId","addDestinationMiddleware"];analytics.factory=function(e){return function(){var t=Array.prototype.slice.call(arguments);t.unshift(e);analytics.push(t);return analytics}};for(var e=0;e<analytics.methods.length;e++){var key=analytics.methods[e];analytics[key]=analytics.factory(key)}analytics.load=function(key,e){var t=document.createElement("script");t.type="text/javascript";t.async=!0;t.src="https://cdn.segment.com/analytics.js/v1/" + key + "/analytics.min.js";var n=document.getElementsByTagName("script")[0];n.parentNode.insertBefore(t,n);analytics._loadOptions=e};analytics._writeKey="${writeKey}";analytics.SNIPPET_VERSION="4.15.3";
  
  // Add error handling for blocked analytics
  analytics.load("${writeKey}");
  analytics.page();
  
  // Fallback: if analytics is blocked, create a stub
  setTimeout(function() {
    if (!window.analytics || !window.analytics.track || typeof window.analytics.track !== 'function') {
      console.warn('Segment analytics blocked by ad blocker - using fallback tracking');
      window.analytics = {
        track: function(event, properties) {
          console.log('Analytics Event (blocked):', event, properties);
        },
        page: function(properties) {
          console.log('Page View (blocked):', properties);
        },
        identify: function(userId, traits) {
          console.log('Identify (blocked):', userId, traits);
        }
      };
    }
  }, 1000);
  }}();
</script>`;
}

/**
 * Generates analytics tracking code for common UI interactions
 */
export function getAnalyticsTrackingCode(): string {
  return `
<script>
  // Track tool clicks
  document.addEventListener('click', function(e) {
    const toolLink = e.target.closest('a[href*="/tools/"]');
    if (toolLink && window.analytics) {
      const toolName = toolLink.getAttribute('href').split('/tools/')[1];
      analytics.track('Tool Viewed', {
        tool_name: toolName,
        page: window.location.pathname
      });
    }
    
    // Track category navigation
    const categoryLink = e.target.closest('a[href*="/category/"]');
    if (categoryLink && window.analytics) {
      const categoryName = categoryLink.getAttribute('href').split('/category/')[1];
      analytics.track('Category Viewed', {
        category_name: categoryName,
        page: window.location.pathname
      });
    }
    
    // Track service navigation
    const serviceLink = e.target.closest('a[href*="/services/"]');
    if (serviceLink && window.analytics) {
      const serviceName = serviceLink.getAttribute('href').split('/services/')[1];
      analytics.track('Service Viewed', {
        service_name: serviceName,
        page: window.location.pathname
      });
    }
    
    // Track CSV export
    const csvLink = e.target.closest('a[href*="/export/tools/csv"]');
    if (csvLink && window.analytics) {
      analytics.track('Tools Exported', {
        format: 'csv',
        page: window.location.pathname
      });
    }
  });
  
  // Track page views with additional context
  if (window.analytics) {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    let pageProperties = {
      path: window.location.pathname,
      url: window.location.href
    };
    
    // Add specific context based on page type
    if (pathParts[0] === 'tools' && pathParts[1]) {
      pageProperties.tool_name = pathParts[1];
      pageProperties.page_type = 'tool_detail';
    } else if (pathParts[0] === 'category' && pathParts[1]) {
      pageProperties.category_name = pathParts[1];
      pageProperties.page_type = 'category_tools';
    } else if (pathParts[0] === 'services' && pathParts[1]) {
      pageProperties.service_name = pathParts[1];
      pageProperties.page_type = 'service_tools';
    } else if (pathParts[0] === 'category' && !pathParts[1]) {
      pageProperties.page_type = 'categories_overview';
    } else if (pathParts[0] === 'services' && !pathParts[1]) {
      pageProperties.page_type = 'services_overview';
    } else if (pathParts[0] === 'tools' && !pathParts[1]) {
      pageProperties.page_type = 'tools_list';
    } else if (pathParts[0] === 'logs') {
      pageProperties.page_type = 'logs';
    } else if (pathParts[0] === 'endpoints') {
      pageProperties.page_type = 'endpoints';
    } else if (pathParts.length === 0) {
      pageProperties.page_type = 'dashboard';
    }
    
    analytics.page(pageProperties);
  }
</script>`;
}

/**
 * MCP Server Analytics - Implements standardized telemetry events
 */
export class ServerAnalytics {
  private writeKey: string;
  private enabled: boolean;
  private mcpServerName: string;
  private serverVersion: string;
  private startTime: number;

  constructor(writeKey?: string, mcpServerName = 'aap-mcp-server', serverVersion = '1.0.0') {
    this.writeKey = writeKey || '';
    this.enabled = Boolean(writeKey);
    this.mcpServerName = mcpServerName;
    this.serverVersion = serverVersion;
    this.startTime = Date.now();
  }

  /**
   * Track standardized MCP telemetry events
   */
  async track(event: AnalyticsEvent): Promise<void> {
    console.log(`[ANALYTICS] Attempting to track event: ${event.event}`);
    console.log(`[ANALYTICS] Analytics enabled: ${this.enabled}`);
    console.log(`[ANALYTICS] Write key present: ${!!this.writeKey}`);
    
    if (!this.enabled) {
      console.log(`[ANALYTICS] Analytics disabled, skipping event: ${event.event}`);
      return;
    }

    try {
      const payload = {
        writeKey: this.writeKey,
        type: 'track',
        event: event.event,
        properties: {
          ...event.properties,
          mcp_server_name: this.mcpServerName,
          timestamp: new Date().toISOString()
        },
        userId: event.userId,
        anonymousId: event.anonymousId || this.generateAnonymousId(),
        timestamp: new Date().toISOString()
      };

      console.log(`[ANALYTICS] Sending event to Segment:`, JSON.stringify(payload, null, 2));

      // Send to Segment's HTTP API
      const response = await fetch('https://api.segment.io/v1/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(this.writeKey + ':').toString('base64')}`
        },
        body: JSON.stringify(payload)
      });

      console.log(`[ANALYTICS] Segment API response: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const responseText = await response.text();
        console.warn(`[ANALYTICS] Tracking failed: ${response.status} ${response.statusText}`);
        console.warn(`[ANALYTICS] Response body:`, responseText);
      } else {
        console.log(`[ANALYTICS] Successfully sent event: ${event.event}`);
      }
    } catch (error) {
      console.warn('[ANALYTICS] Tracking error:', error);
    }
  }

  // 1. Session Events
  async trackSessionStarted(sessionId: string, clientName?: string, clientVersion?: string, platform?: string): Promise<void> {
    await this.track({
      event: 'mcp_session_started',
      properties: {
        client_name: clientName || 'unknown',
        client_version: clientVersion || 'unknown',
        platform: platform || process.platform,
        session_id: sessionId,
        mcp_server_name: this.mcpServerName
      },
      userId: sessionId
    });
  }

  async trackSessionEnded(sessionId: string, duration?: number): Promise<void> {
    await this.track({
      event: 'mcp_session_ended',
      properties: {
        session_id: sessionId,
        mcp_server_name: this.mcpServerName,
        duration: duration || 0
      },
      userId: sessionId
    });
  }

  // 2. Authentication Events
  async trackAuthAttempt(clientName: string, authMethod: string, success: boolean, errorType?: string): Promise<void> {
    await this.track({
      event: 'mcp_auth_attempt',
      properties: {
        client_name: clientName || 'unknown',
        mcp_server_name: this.mcpServerName,
        auth_method: authMethod,
        success,
        error_type: errorType || null
      }
    });
  }

  // 3. Tool Usage Events
  async trackToolCalled(toolName: string, sessionId: string, clientName?: string, parameterCount = 0): Promise<void> {
    await this.track({
      event: 'mcp_tool_called',
      properties: {
        tool_name: toolName,
        mcp_server_name: this.mcpServerName,
        client_name: clientName || 'unknown',
        session_id: sessionId,
        parameter_count: parameterCount
      },
      userId: sessionId
    });
  }

  async trackToolCompleted(toolName: string, sessionId: string, success: boolean, executionTimeMs: number, parameterCount = 0, errorType?: string): Promise<void> {
    await this.track({
      event: 'mcp_tool_completed',
      properties: {
        tool_name: toolName,
        mcp_server_name: this.mcpServerName,
        success,
        error_type: errorType || null,
        execution_time_ms: executionTimeMs,
        session_id: sessionId,
        parameter_count: parameterCount
      },
      userId: sessionId
    });
  }

  // 4. Connection Events
  async trackConnectionEstablished(transportType: string, clientName?: string, clientVersion?: string): Promise<void> {
    await this.track({
      event: 'mcp_connection_established',
      properties: {
        transport_type: transportType,
        mcp_server_name: this.mcpServerName,
        client_name: clientName || 'unknown',
        client_version: clientVersion || 'unknown'
      }
    });
  }

  async trackConnectionLost(sessionId: string, reason?: string): Promise<void> {
    await this.track({
      event: 'mcp_connection_lost',
      properties: {
        session_id: sessionId,
        mcp_server_name: this.mcpServerName,
        reason: reason || 'unknown'
      },
      userId: sessionId
    });
  }

  // 5. Error Events
  async trackError(errorCategory: string, errorCode: string, toolName?: string, clientName?: string, sessionId?: string, parameterCount = 0): Promise<void> {
    await this.track({
      event: 'mcp_error_occurred',
      properties: {
        error_category: errorCategory,
        error_code: errorCode,
        tool_name: toolName || null,
        mcp_server_name: this.mcpServerName,
        client_name: clientName || 'unknown',
        session_id: sessionId || null,
        parameter_count: parameterCount
      },
      userId: sessionId
    });
  }

  // 6. MCP Server Operational Events
  async trackServerStarted(configurationHash?: string, startupTimeMs?: number): Promise<void> {
    await this.track({
      event: 'mcp_server_started',
      properties: {
        mcp_server_name: this.mcpServerName,
        server_version: this.serverVersion,
        configuration_hash: configurationHash || 'unknown',
        startup_time_ms: startupTimeMs || 0
      }
    });
  }

  async trackServerStopped(shutdownReason: string, uptimeSeconds?: number): Promise<void> {
    const uptime = uptimeSeconds || Math.floor((Date.now() - this.startTime) / 1000);
    await this.track({
      event: 'mcp_server_stopped',
      properties: {
        mcp_server_name: this.mcpServerName,
        shutdown_reason: shutdownReason,
        uptime_seconds: uptime
      }
    });
  }

  async trackHealthCheck(healthStatus: string, cpuUsagePercent?: number, memoryUsageMb?: number, activeConnections?: number): Promise<void> {
    await this.track({
      event: 'mcp_server_health_check',
      properties: {
        mcp_server_name: this.mcpServerName,
        health_status: healthStatus,
        cpu_usage_percent: cpuUsagePercent || null,
        memory_usage_mb: memoryUsageMb || null,
        active_connections: activeConnections || 0
      }
    });
  }

  async trackConfigChanged(configSection: string, changeType: string): Promise<void> {
    await this.track({
      event: 'mcp_server_config_changed',
      properties: {
        mcp_server_name: this.mcpServerName,
        config_section: configSection,
        change_type: changeType
      }
    });
  }

  // Legacy methods for backward compatibility
  async trackToolExecution(toolName: string, success: boolean, duration: number, sessionId?: string): Promise<void> {
    await this.trackToolCompleted(toolName, sessionId || 'unknown', success, duration);
  }

  async trackSession(event: 'session_started' | 'session_ended', sessionId: string, properties?: Record<string, any>): Promise<void> {
    if (event === 'session_started') {
      await this.trackSessionStarted(sessionId, properties?.client_name, properties?.client_version, properties?.platform);
    } else {
      await this.trackSessionEnded(sessionId, properties?.duration);
    }
  }

  private generateAnonymousId(): string {
    return 'anon_' + Math.random().toString(36).substr(2, 9);
  }
}