import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerAnalytics } from './analytics.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('MCP Telemetry Events Compliance', () => {
  let analytics: ServerAnalytics;
  
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK'
    });
    analytics = new ServerAnalytics('test_write_key', 'aap-mcp-server', '1.0.0');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Session Events', () => {
    describe('mcp_session_started', () => {
      it('should include all required fields', async () => {
        await analytics.trackSessionStarted(
          'session_123',
          'claude-desktop',
          '1.2.3',
          'darwin'
        );

        const callArgs = mockFetch.mock.calls[0];
        const body = JSON.parse(callArgs[1].body);

        expect(body.event).toBe('mcp_session_started');
        expect(body.properties).toMatchObject({
          client_name: 'claude-desktop',
          client_version: '1.2.3',
          platform: 'darwin',
          session_id: 'session_123',
          mcp_server_name: 'aap-mcp-server',
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
        expect(body.userId).toBe('session_123');
      });

      it('should handle missing optional fields with defaults', async () => {
        await analytics.trackSessionStarted('session_123');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties).toMatchObject({
          client_name: 'unknown',
          client_version: 'unknown',
          platform: process.platform,
          session_id: 'session_123'
        });
      });
    });

    describe('mcp_session_ended', () => {
      it('should include all required fields', async () => {
        await analytics.trackSessionEnded('session_123', 5432);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_session_ended');
        expect(body.properties).toMatchObject({
          session_id: 'session_123',
          mcp_server_name: 'aap-mcp-server',
          duration: 5432,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
      });

      it('should default duration to 0 when not provided', async () => {
        await analytics.trackSessionEnded('session_123');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties.duration).toBe(0);
      });
    });
  });

  describe('2. Authentication Events', () => {
    describe('mcp_auth_attempt', () => {
      it('should track successful authentication', async () => {
        await analytics.trackAuthAttempt('claude-desktop', 'bearer_token', true);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_auth_attempt');
        expect(body.properties).toMatchObject({
          client_name: 'claude-desktop',
          mcp_server_name: 'aap-mcp-server',
          auth_method: 'bearer_token',
          success: true,
          error_type: null,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
      });

      it('should track failed authentication with error type', async () => {
        await analytics.trackAuthAttempt(
          'claude-desktop',
          'bearer_token',
          false,
          'invalid_token'
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties).toMatchObject({
          success: false,
          error_type: 'invalid_token'
        });
      });

      it('should handle unknown client name', async () => {
        await analytics.trackAuthAttempt('', 'bearer_token', true);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties.client_name).toBe('unknown');
      });
    });
  });

  describe('3. Tool Usage Events', () => {
    describe('mcp_tool_called', () => {
      it('should include all required fields', async () => {
        await analytics.trackToolCalled(
          'controller.jobs_list',
          'session_123',
          'claude-desktop',
          3
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_tool_called');
        expect(body.properties).toMatchObject({
          tool_name: 'controller.jobs_list',
          mcp_server_name: 'aap-mcp-server',
          client_name: 'claude-desktop',
          session_id: 'session_123',
          parameter_count: 3,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
        expect(body.userId).toBe('session_123');
      });

      it('should default parameter count to 0', async () => {
        await analytics.trackToolCalled('tool', 'session', 'client');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties.parameter_count).toBe(0);
      });

      it('should handle unknown client name', async () => {
        await analytics.trackToolCalled('tool', 'session');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties.client_name).toBe('unknown');
      });
    });

    describe('mcp_tool_completed', () => {
      it('should track successful tool completion', async () => {
        await analytics.trackToolCompleted(
          'controller.jobs_list',
          'session_123',
          true,
          250,
          3
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_tool_completed');
        expect(body.properties).toMatchObject({
          tool_name: 'controller.jobs_list',
          mcp_server_name: 'aap-mcp-server',
          success: true,
          error_type: null,
          execution_time_ms: 250,
          session_id: 'session_123',
          parameter_count: 3,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
      });

      it('should track failed tool completion with error', async () => {
        await analytics.trackToolCompleted(
          'controller.jobs_list',
          'session_123',
          false,
          150,
          2,
          'HTTP 500: Internal Server Error'
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties).toMatchObject({
          success: false,
          error_type: 'HTTP 500: Internal Server Error',
          execution_time_ms: 150,
          parameter_count: 2
        });
      });

      it('should default parameter count to 0', async () => {
        await analytics.trackToolCompleted('tool', 'session', true, 100);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties.parameter_count).toBe(0);
      });
    });
  });

  describe('4. Connection Events', () => {
    describe('mcp_connection_established', () => {
      it('should include all required fields', async () => {
        await analytics.trackConnectionEstablished(
          'http',
          'claude-desktop',
          '1.2.3'
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_connection_established');
        expect(body.properties).toMatchObject({
          transport_type: 'http',
          mcp_server_name: 'aap-mcp-server',
          client_name: 'claude-desktop',
          client_version: '1.2.3',
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
      });

      it('should handle unknown client info', async () => {
        await analytics.trackConnectionEstablished('websocket');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties).toMatchObject({
          transport_type: 'websocket',
          client_name: 'unknown',
          client_version: 'unknown'
        });
      });
    });

    describe('mcp_connection_lost', () => {
      it('should include all required fields', async () => {
        await analytics.trackConnectionLost('session_123', 'transport_closed');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_connection_lost');
        expect(body.properties).toMatchObject({
          session_id: 'session_123',
          mcp_server_name: 'aap-mcp-server',
          reason: 'transport_closed',
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
        expect(body.userId).toBe('session_123');
      });

      it('should default reason to unknown', async () => {
        await analytics.trackConnectionLost('session_123');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties.reason).toBe('unknown');
      });
    });
  });

  describe('5. Error Events', () => {
    describe('mcp_error_occurred', () => {
      it('should include all required fields', async () => {
        await analytics.trackError(
          'tool_execution',
          '500',
          'controller.jobs_list',
          'claude-desktop',
          'session_123',
          2
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_error_occurred');
        expect(body.properties).toMatchObject({
          error_category: 'tool_execution',
          error_code: '500',
          tool_name: 'controller.jobs_list',
          mcp_server_name: 'aap-mcp-server',
          client_name: 'claude-desktop',
          session_id: 'session_123',
          parameter_count: 2,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
        expect(body.userId).toBe('session_123');
      });

      it('should handle minimal error context', async () => {
        await analytics.trackError('authentication', 'invalid_token');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties).toMatchObject({
          error_category: 'authentication',
          error_code: 'invalid_token',
          tool_name: null,
          client_name: 'unknown',
          session_id: null,
          parameter_count: 0
        });
      });

      it('should support various error categories', async () => {
        const categories = [
          'tool_execution',
          'authentication',
          'server_startup',
          'configuration'
        ];

        for (const category of categories) {
          await analytics.trackError(category, 'test_error');
          
          const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
          expect(body.properties.error_category).toBe(category);
        }

        expect(mockFetch).toHaveBeenCalledTimes(categories.length);
      });
    });
  });

  describe('6. MCP Server Operational Events', () => {
    describe('mcp_server_started', () => {
      it('should include all required fields', async () => {
        await analytics.trackServerStarted('config_hash_123', 1500);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_server_started');
        expect(body.properties).toMatchObject({
          mcp_server_name: 'aap-mcp-server',
          server_version: '1.0.0',
          configuration_hash: 'config_hash_123',
          startup_time_ms: 1500,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
      });

      it('should handle missing optional fields', async () => {
        await analytics.trackServerStarted();

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties).toMatchObject({
          configuration_hash: 'unknown',
          startup_time_ms: 0
        });
      });
    });

    describe('mcp_server_stopped', () => {
      it('should include all required fields', async () => {
        await analytics.trackServerStopped('SIGINT', 3600);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_server_stopped');
        expect(body.properties).toMatchObject({
          mcp_server_name: 'aap-mcp-server',
          shutdown_reason: 'SIGINT',
          uptime_seconds: 3600,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
      });

      it('should calculate uptime automatically when not provided', async () => {
        // Wait a small amount to ensure uptime is > 0
        await new Promise(resolve => setTimeout(resolve, 1));
        await analytics.trackServerStopped('SIGTERM');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties.uptime_seconds).toBeGreaterThanOrEqual(0);
      });
    });

    describe('mcp_server_health_check', () => {
      it('should include all required fields', async () => {
        await analytics.trackHealthCheck('healthy', 45.5, 128, 3);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_server_health_check');
        expect(body.properties).toMatchObject({
          mcp_server_name: 'aap-mcp-server',
          health_status: 'healthy',
          cpu_usage_percent: 45.5,
          memory_usage_mb: 128,
          active_connections: 3,
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
      });

      it('should handle missing optional metrics', async () => {
        await analytics.trackHealthCheck('healthy');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.properties).toMatchObject({
          health_status: 'healthy',
          cpu_usage_percent: null,
          memory_usage_mb: null,
          active_connections: 0
        });
      });

      it('should support different health statuses', async () => {
        const statuses = ['healthy', 'degraded', 'unhealthy', 'unknown'];

        for (const status of statuses) {
          await analytics.trackHealthCheck(status);
          
          const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
          expect(body.properties.health_status).toBe(status);
        }
      });
    });

    describe('mcp_server_config_changed', () => {
      it('should include all required fields', async () => {
        await analytics.trackConfigChanged('analytics', 'updated');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.event).toBe('mcp_server_config_changed');
        expect(body.properties).toMatchObject({
          mcp_server_name: 'aap-mcp-server',
          config_section: 'analytics',
          change_type: 'updated',
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
        });
      });

      it('should support different change types', async () => {
        const changeTypes = ['created', 'updated', 'deleted', 'reloaded'];

        for (const changeType of changeTypes) {
          await analytics.trackConfigChanged('test_section', changeType);
          
          const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
          expect(body.properties.change_type).toBe(changeType);
        }
      });
    });
  });

  describe('Event Structure Compliance', () => {
    it('should include mcp_server_name in all events', async () => {
      // Test one event from each category
      await analytics.trackSessionStarted('session');
      await analytics.trackAuthAttempt('client', 'method', true);
      await analytics.trackToolCalled('tool', 'session');
      await analytics.trackConnectionEstablished('http');
      await analytics.trackError('category', 'code');
      await analytics.trackServerStarted();

      for (const call of mockFetch.mock.calls) {
        const body = JSON.parse(call[1].body);
        expect(body.properties.mcp_server_name).toBe('aap-mcp-server');
      }
    });

    it('should include timestamp in all events', async () => {
      await analytics.trackSessionStarted('session');
      await analytics.trackToolCalled('tool', 'session');
      
      for (const call of mockFetch.mock.calls) {
        const body = JSON.parse(call[1].body);
        expect(body.properties.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });

    it('should use correct event naming convention', async () => {
      const expectedEvents = [
        'mcp_session_started',
        'mcp_session_ended',
        'mcp_auth_attempt',
        'mcp_tool_called',
        'mcp_tool_completed',
        'mcp_connection_established',
        'mcp_connection_lost',
        'mcp_error_occurred',
        'mcp_server_started',
        'mcp_server_stopped',
        'mcp_server_health_check',
        'mcp_server_config_changed'
      ];

      // Track all event types
      await analytics.trackSessionStarted('session');
      await analytics.trackSessionEnded('session');
      await analytics.trackAuthAttempt('client', 'method', true);
      await analytics.trackToolCalled('tool', 'session');
      await analytics.trackToolCompleted('tool', 'session', true, 100);
      await analytics.trackConnectionEstablished('http');
      await analytics.trackConnectionLost('session');
      await analytics.trackError('category', 'code');
      await analytics.trackServerStarted();
      await analytics.trackServerStopped('reason');
      await analytics.trackHealthCheck('healthy');
      await analytics.trackConfigChanged('section', 'type');

      const actualEvents = mockFetch.mock.calls.map(call => {
        const body = JSON.parse(call[1].body);
        return body.event;
      });

      expect(actualEvents).toEqual(expectedEvents);
    });

    it('should use proper field data types', async () => {
      await analytics.trackToolCompleted('tool', 'session', true, 250, 3);
      await analytics.trackHealthCheck('healthy', 45.5, 128, 3);

      const toolBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(typeof toolBody.properties.success).toBe('boolean');
      expect(typeof toolBody.properties.execution_time_ms).toBe('number');
      expect(typeof toolBody.properties.parameter_count).toBe('number');

      const healthBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(typeof healthBody.properties.cpu_usage_percent).toBe('number');
      expect(typeof healthBody.properties.memory_usage_mb).toBe('number');
      expect(typeof healthBody.properties.active_connections).toBe('number');
    });
  });
});