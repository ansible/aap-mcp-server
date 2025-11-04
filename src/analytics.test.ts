import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerAnalytics, getSegmentSnippet, getAnalyticsTrackingCode } from './analytics.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Analytics Utilities', () => {
  describe('getSegmentSnippet', () => {
    it('should generate valid Segment analytics.js snippet with write key', () => {
      const writeKey = 'test_write_key_123';
      const snippet = getSegmentSnippet(writeKey);
      
      expect(snippet).toContain('<script>');
      expect(snippet).toContain('</script>');
      expect(snippet).toContain(writeKey);
      expect(snippet).toContain('analytics.load');
      expect(snippet).toContain('analytics.page');
      expect(snippet).toContain('cdn.segment.com');
    });

    it('should escape write key in snippet', () => {
      const writeKey = 'test"key';
      const snippet = getSegmentSnippet(writeKey);
      
      expect(snippet).toContain(writeKey);
      // Should not break the JavaScript
      expect(snippet).toContain('analytics.load("test"key")');
    });
  });

  describe('getAnalyticsTrackingCode', () => {
    it('should generate client-side tracking script', () => {
      const trackingCode = getAnalyticsTrackingCode();
      
      expect(trackingCode).toContain('<script>');
      expect(trackingCode).toContain('</script>');
      expect(trackingCode).toContain('addEventListener');
      expect(trackingCode).toContain('analytics.track');
      expect(trackingCode).toContain('Tool Viewed');
      expect(trackingCode).toContain('Category Viewed');
      expect(trackingCode).toContain('Service Viewed');
      expect(trackingCode).toContain('Tools Exported');
    });

    it('should include page properties detection', () => {
      const trackingCode = getAnalyticsTrackingCode();
      
      expect(trackingCode).toContain('page_type');
      expect(trackingCode).toContain('tool_detail');
      expect(trackingCode).toContain('category_tools');
      expect(trackingCode).toContain('dashboard');
    });
  });
});

describe('ServerAnalytics', () => {
  let analytics: ServerAnalytics;
  
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with write key', () => {
      analytics = new ServerAnalytics('test_key', 'test-server', '2.0.0');
      expect(analytics).toBeDefined();
    });

    it('should be disabled without write key', () => {
      analytics = new ServerAnalytics();
      expect(analytics).toBeDefined();
    });

    it('should set server name and version', () => {
      analytics = new ServerAnalytics('test_key', 'custom-server', '3.0.0');
      expect(analytics).toBeDefined();
    });
  });

  describe('track method', () => {
    beforeEach(() => {
      analytics = new ServerAnalytics('test_write_key', 'test-server');
    });

    it('should send events to Segment API', async () => {
      await analytics.track({
        event: 'test_event',
        properties: { key: 'value' },
        userId: 'user123'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.segment.io/v1/track',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': expect.stringContaining('Basic ')
          }),
          body: expect.stringContaining('test_event')
        })
      );
    });

    it('should include server name in properties', async () => {
      await analytics.track({
        event: 'test_event',
        properties: { key: 'value' }
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      
      expect(body.properties.mcp_server_name).toBe('test-server');
      expect(body.properties.timestamp).toBeDefined();
      expect(body.properties.key).toBe('value');
    });

    it('should generate anonymous ID when not provided', async () => {
      await analytics.track({
        event: 'test_event',
        properties: {}
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      
      expect(body.anonymousId).toMatch(/^anon_/);
    });

    it('should not send events when disabled', async () => {
      const disabledAnalytics = new ServerAnalytics();
      
      await disabledAnalytics.track({
        event: 'test_event',
        properties: {}
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request'
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await analytics.track({
        event: 'test_event',
        properties: {}
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ANALYTICS] Tracking error:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await analytics.track({
        event: 'test_event',
        properties: {}
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ANALYTICS] Tracking error:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Session Events', () => {
    beforeEach(() => {
      analytics = new ServerAnalytics('test_key');
    });

    it('should track session started with all fields', async () => {
      await analytics.trackSessionStarted(
        'session123',
        'claude-desktop',
        '1.0.0',
        'darwin'
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_session_started');
      expect(body.properties).toMatchObject({
        session_id: 'session123',
        client_name: 'claude-desktop',
        client_version: '1.0.0',
        platform: 'darwin'
      });
      expect(body.userId).toBe('session123');
    });

    it('should track session started with defaults', async () => {
      await analytics.trackSessionStarted('session123');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.properties).toMatchObject({
        session_id: 'session123',
        client_name: 'unknown',
        client_version: 'unknown',
        platform: process.platform
      });
    });

    it('should track session ended', async () => {
      await analytics.trackSessionEnded('session123', 5000);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_session_ended');
      expect(body.properties).toMatchObject({
        session_id: 'session123',
        duration: 5000
      });
    });
  });

  describe('Authentication Events', () => {
    beforeEach(() => {
      analytics = new ServerAnalytics('test_key');
    });

    it('should track successful auth attempt', async () => {
      await analytics.trackAuthAttempt('claude-desktop', 'bearer_token', true);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_auth_attempt');
      expect(body.properties).toMatchObject({
        client_name: 'claude-desktop',
        auth_method: 'bearer_token',
        success: true,
        error_type: null
      });
    });

    it('should track failed auth attempt with error', async () => {
      await analytics.trackAuthAttempt(
        'claude-desktop',
        'bearer_token',
        false,
        'invalid_token'
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.properties).toMatchObject({
        success: false,
        error_type: 'invalid_token'
      });
    });
  });

  describe('Tool Usage Events', () => {
    beforeEach(() => {
      analytics = new ServerAnalytics('test_key');
    });

    it('should track tool called', async () => {
      await analytics.trackToolCalled(
        'controller.jobs_list',
        'session123',
        'claude-desktop',
        3
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_tool_called');
      expect(body.properties).toMatchObject({
        tool_name: 'controller.jobs_list',
        session_id: 'session123',
        client_name: 'claude-desktop',
        parameter_count: 3
      });
    });

    it('should track successful tool completion', async () => {
      await analytics.trackToolCompleted(
        'controller.jobs_list',
        'session123',
        true,
        250,
        2
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_tool_completed');
      expect(body.properties).toMatchObject({
        tool_name: 'controller.jobs_list',
        session_id: 'session123',
        success: true,
        execution_time_ms: 250,
        parameter_count: 2,
        error_type: null
      });
    });

    it('should track failed tool completion', async () => {
      await analytics.trackToolCompleted(
        'controller.jobs_list',
        'session123',
        false,
        150,
        2,
        'HTTP 500: Internal Server Error'
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.properties).toMatchObject({
        success: false,
        error_type: 'HTTP 500: Internal Server Error'
      });
    });
  });

  describe('Connection Events', () => {
    beforeEach(() => {
      analytics = new ServerAnalytics('test_key');
    });

    it('should track connection established', async () => {
      await analytics.trackConnectionEstablished(
        'http',
        'claude-desktop',
        '1.0.0'
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_connection_established');
      expect(body.properties).toMatchObject({
        transport_type: 'http',
        client_name: 'claude-desktop',
        client_version: '1.0.0'
      });
    });

    it('should track connection lost', async () => {
      await analytics.trackConnectionLost('session123', 'transport_closed');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_connection_lost');
      expect(body.properties).toMatchObject({
        session_id: 'session123',
        reason: 'transport_closed'
      });
    });
  });

  describe('Error Events', () => {
    beforeEach(() => {
      analytics = new ServerAnalytics('test_key');
    });

    it('should track error with all context', async () => {
      await analytics.trackError(
        'tool_execution',
        '500',
        'controller.jobs_list',
        'claude-desktop',
        'session123',
        2
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_error_occurred');
      expect(body.properties).toMatchObject({
        error_category: 'tool_execution',
        error_code: '500',
        tool_name: 'controller.jobs_list',
        client_name: 'claude-desktop',
        session_id: 'session123',
        parameter_count: 2
      });
    });

    it('should track error with minimal context', async () => {
      await analytics.trackError('authentication', 'invalid_token');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.properties).toMatchObject({
        error_category: 'authentication',
        error_code: 'invalid_token',
        tool_name: null,
        client_name: 'unknown',
        session_id: null,
        parameter_count: 0
      });
    });
  });

  describe('Server Operational Events', () => {
    beforeEach(() => {
      analytics = new ServerAnalytics('test_key', 'test-server', '2.0.0');
    });

    it('should track server started', async () => {
      await analytics.trackServerStarted('abc123', 1500);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_server_started');
      expect(body.properties).toMatchObject({
        server_version: '2.0.0',
        configuration_hash: 'abc123',
        startup_time_ms: 1500
      });
    });

    it('should track server stopped', async () => {
      await analytics.trackServerStopped('SIGINT', 3600);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_server_stopped');
      expect(body.properties).toMatchObject({
        shutdown_reason: 'SIGINT',
        uptime_seconds: 3600
      });
    });

    it('should track health check', async () => {
      await analytics.trackHealthCheck('healthy', 45.5, 128, 3);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_server_health_check');
      expect(body.properties).toMatchObject({
        health_status: 'healthy',
        cpu_usage_percent: 45.5,
        memory_usage_mb: 128,
        active_connections: 3
      });
    });

    it('should track config changed', async () => {
      await analytics.trackConfigChanged('analytics', 'updated');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_server_config_changed');
      expect(body.properties).toMatchObject({
        config_section: 'analytics',
        change_type: 'updated'
      });
    });
  });

  describe('Legacy compatibility methods', () => {
    beforeEach(() => {
      analytics = new ServerAnalytics('test_key');
    });

    it('should support legacy trackToolExecution', async () => {
      await analytics.trackToolExecution('tool1', true, 100, 'session123');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_tool_completed');
      expect(body.properties.tool_name).toBe('tool1');
      expect(body.properties.success).toBe(true);
      expect(body.properties.execution_time_ms).toBe(100);
    });

    it('should support legacy trackSession for started', async () => {
      await analytics.trackSession('session_started', 'session123', {
        client_name: 'test-client'
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_session_started');
      expect(body.properties.client_name).toBe('test-client');
    });

    it('should support legacy trackSession for ended', async () => {
      await analytics.trackSession('session_ended', 'session123', {
        duration: 5000
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_session_ended');
      expect(body.properties.duration).toBe(5000);
    });
  });
});