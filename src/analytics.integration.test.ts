import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ServerAnalytics } from './analytics.js';

// Mock fetch for analytics calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the MCP SDK components
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(() => ({
    sessionId: 'test-session-123',
    handleRequest: vi.fn(),
    close: vi.fn(),
    onclose: null,
  })),
}));

describe('Analytics Integration Tests', () => {
  let app: express.Application;
  let analytics: ServerAnalytics;
  let consoleSpy: any;

  beforeAll(() => {
    // Suppress console output during tests
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    // Create analytics instance
    analytics = new ServerAnalytics('test_write_key', 'test-server', '1.0.0');

    // Create express app for testing
    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Health Check Analytics', () => {
    beforeEach(() => {
      // Mock health check endpoint with analytics
      app.get('/api/v1/health', async (req, res) => {
        try {
          const healthStatus = 'healthy';
          const activeConnections = 2;
          
          if (analytics) {
            const memoryUsage = { heapUsed: 128 * 1024 * 1024 }; // 128MB
            await analytics.trackHealthCheck(
              healthStatus,
              undefined,
              Math.round(memoryUsage.heapUsed / 1024 / 1024),
              activeConnections
            );
          }
          
          res.json({ 
            status: 'ok',
            active_connections: activeConnections,
            uptime: 3600,
            memory_usage_mb: 128
          });
        } catch (error) {
          res.status(500).json({ status: 'error' });
        }
      });
    });

    it('should track health check analytics when endpoint is called', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        active_connections: 2,
        uptime: 3600,
        memory_usage_mb: 128
      });

      // Verify analytics was called
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.segment.io/v1/track',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': expect.stringContaining('Basic ')
          })
        })
      );

      // Check the analytics event data
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      
      expect(body.event).toBe('mcp_server_health_check');
      expect(body.properties).toMatchObject({
        mcp_server_name: 'test-server',
        health_status: 'healthy',
        memory_usage_mb: 128,
        active_connections: 2
      });
    });

    it('should handle health check errors without breaking endpoint', async () => {
      // Make analytics fail
      mockFetch.mockRejectedValue(new Error('Network error'));
      
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(warnSpy).toHaveBeenCalledWith(
        'Analytics tracking error:',
        expect.any(Error)
      );

      warnSpy.mockRestore();
    });
  });

  describe('Server Lifecycle Analytics', () => {
    it('should track server startup', async () => {
      const startTime = Date.now();
      const configHash = 'abc123';
      const startupTime = 1500;

      await analytics.trackServerStarted(configHash, startupTime);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.segment.io/v1/track',
        expect.objectContaining({
          method: 'POST'
        })
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_server_started');
      expect(body.properties).toMatchObject({
        mcp_server_name: 'test-server',
        server_version: '1.0.0',
        configuration_hash: 'abc123',
        startup_time_ms: 1500
      });
    });

    it('should track server shutdown with uptime calculation', async () => {
      await analytics.trackServerStopped('SIGINT');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_server_stopped');
      expect(body.properties).toMatchObject({
        mcp_server_name: 'test-server',
        shutdown_reason: 'SIGINT',
        uptime_seconds: expect.any(Number)
      });
    });
  });

  describe('Session Lifecycle Analytics', () => {
    it('should track complete session lifecycle', async () => {
      const sessionId = 'test-session-123';
      const clientName = 'claude-desktop';

      // Track session start
      await analytics.trackSessionStarted(sessionId, clientName, '1.0.0', 'darwin');
      
      // Track connection
      await analytics.trackConnectionEstablished('http', clientName, '1.0.0');
      
      // Track auth attempt
      await analytics.trackAuthAttempt(clientName, 'bearer_token', true);
      
      // Track tool usage
      await analytics.trackToolCalled('controller.jobs_list', sessionId, clientName, 2);
      await analytics.trackToolCompleted('controller.jobs_list', sessionId, true, 250, 2);
      
      // Track session end
      await analytics.trackSessionEnded(sessionId, 5000);
      await analytics.trackConnectionLost(sessionId, 'session_terminated');

      // Verify all events were tracked
      expect(mockFetch).toHaveBeenCalledTimes(7);

      const eventTypes = mockFetch.mock.calls.map(call => {
        const body = JSON.parse(call[1].body);
        return body.event;
      });

      expect(eventTypes).toEqual([
        'mcp_session_started',
        'mcp_connection_established',
        'mcp_auth_attempt',
        'mcp_tool_called',
        'mcp_tool_completed',
        'mcp_session_ended',
        'mcp_connection_lost'
      ]);
    });

    it('should track failed authentication', async () => {
      await analytics.trackAuthAttempt(
        'claude-desktop',
        'bearer_token',
        false,
        'invalid_token'
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.event).toBe('mcp_auth_attempt');
      expect(body.properties).toMatchObject({
        client_name: 'claude-desktop',
        auth_method: 'bearer_token',
        success: false,
        error_type: 'invalid_token'
      });
    });
  });

  describe('Tool Execution Analytics', () => {
    const sessionId = 'test-session-123';
    const toolName = 'controller.jobs_list';
    const clientName = 'claude-desktop';

    it('should track successful tool execution flow', async () => {
      // Simulate tool called
      await analytics.trackToolCalled(toolName, sessionId, clientName, 3);
      
      // Simulate successful completion
      await analytics.trackToolCompleted(toolName, sessionId, true, 150, 3);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Check tool called event
      const calledBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(calledBody.event).toBe('mcp_tool_called');
      expect(calledBody.properties).toMatchObject({
        tool_name: toolName,
        session_id: sessionId,
        client_name: clientName,
        parameter_count: 3
      });

      // Check tool completed event
      const completedBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(completedBody.event).toBe('mcp_tool_completed');
      expect(completedBody.properties).toMatchObject({
        tool_name: toolName,
        session_id: sessionId,
        success: true,
        execution_time_ms: 150,
        parameter_count: 3,
        error_type: null
      });
    });

    it('should track failed tool execution with error details', async () => {
      const errorMessage = 'HTTP 500: Internal Server Error';
      
      await analytics.trackToolCalled(toolName, sessionId, clientName, 1);
      await analytics.trackToolCompleted(toolName, sessionId, false, 75, 1, errorMessage);
      await analytics.trackError('tool_execution', '500', toolName, clientName, sessionId, 1);

      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Check error tracking
      const errorBody = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(errorBody.event).toBe('mcp_error_occurred');
      expect(errorBody.properties).toMatchObject({
        error_category: 'tool_execution',
        error_code: '500',
        tool_name: toolName,
        client_name: clientName,
        session_id: sessionId,
        parameter_count: 1
      });
    });
  });

  describe('Analytics Middleware Integration', () => {
    beforeEach(() => {
      // Mock analytics injection middleware
      app.use((req, res, next) => {
        const originalSend = res.send;
        res.send = function(body: any) {
          if (res.getHeader('Content-Type') === 'text/html' && typeof body === 'string' && body.includes('</body>')) {
            body = body.replace('</body>', '<!-- Analytics Injected --></body>');
          }
          return originalSend.call(this, body);
        };
        next();
      });

      // Mock HTML endpoint
      app.get('/test-page', (req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.send(`
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <h1>Test Page</h1>
</body>
</html>`);
      });
    });

    it('should inject analytics into HTML responses', async () => {
      const response = await request(app)
        .get('/test-page')
        .expect(200);

      expect(response.text).toContain('<!-- Analytics Injected -->');
      expect(response.text).toContain('<h1>Test Page</h1>');
    });
  });

  describe('Error Handling', () => {
    it('should handle analytics API failures gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network timeout'));
      
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Analytics failure should not break normal operation
      await analytics.trackSessionStarted('session123');

      expect(warnSpy).toHaveBeenCalledWith(
        'Analytics tracking error:',
        expect.any(Error)
      );

      warnSpy.mockRestore();
    });

    it('should handle analytics API HTTP errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      });
      
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await analytics.trackSessionStarted('session123');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Analytics tracking failed: 429 Too Many Requests')
      );

      warnSpy.mockRestore();
    });

    it('should not send analytics when disabled', async () => {
      const disabledAnalytics = new ServerAnalytics(); // No write key

      await disabledAnalytics.trackSessionStarted('session123');
      await disabledAnalytics.trackToolCalled('tool1', 'session123');
      await disabledAnalytics.trackError('test', 'error');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Configuration Integration', () => {
    it('should use custom server name and version', async () => {
      const customAnalytics = new ServerAnalytics(
        'test_key',
        'custom-mcp-server',
        '2.1.0'
      );

      await customAnalytics.trackServerStarted('hash123', 2000);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.properties).toMatchObject({
        mcp_server_name: 'custom-mcp-server',
        server_version: '2.1.0',
        configuration_hash: 'hash123',
        startup_time_ms: 2000
      });
    });

    it('should include timestamp and server name in all events', async () => {
      await analytics.trackSessionStarted('session123');
      await analytics.trackToolCalled('tool1', 'session123');
      await analytics.trackError('test', 'error');

      // Check all calls include required fields
      for (const call of mockFetch.mock.calls) {
        const body = JSON.parse(call[1].body);
        expect(body.properties.mcp_server_name).toBe('test-server');
        expect(body.properties.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });
  });
});