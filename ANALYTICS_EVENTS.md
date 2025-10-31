# MCP Telemetry Events Reference

This document describes all the standardized Model Context Protocol (MCP) telemetry events tracked by the AAP MCP Server when analytics is enabled.

## Configuration

Enable analytics in `aap-mcp.yaml`:
```yaml
enable_analytics: true
segment_write_key: "your_segment_write_key_here"
```

Or via environment variables:
```bash
export ENABLE_ANALYTICS=true
export SEGMENT_WRITE_KEY=your_segment_write_key_here
```

## Event Types

### 1. Session Events
Track logical user sessions with MCP servers.

#### `mcp_session_started`
Triggered when a new MCP session is initialized.
- **Fields**: `client_name`, `client_version`, `platform`, `session_id`, `mcp_server_name`, `timestamp`
- **Example**: User connects Claude to the MCP server

#### `mcp_session_ended`
Triggered when an MCP session terminates.
- **Fields**: `session_id`, `mcp_server_name`, `duration`, `timestamp`
- **Example**: User disconnects or session times out

### 2. Authentication Events
Track authentication attempts and outcomes.

#### `mcp_auth_attempt`
Triggered for each authentication attempt.
- **Fields**: `client_name`, `mcp_server_name`, `auth_method`, `success`, `error_type`, `timestamp`
- **Example**: Bearer token validation success/failure

### 3. Tool Usage Events
Track tool invocation and completion for understanding feature usage.

#### `mcp_tool_called`
Triggered when a tool is invoked.
- **Fields**: `tool_name`, `mcp_server_name`, `client_name`, `session_id`, `parameter_count`, `timestamp`
- **Example**: `controller.jobs_list` tool called with 2 parameters

#### `mcp_tool_completed`
Triggered when a tool execution completes (success or failure).
- **Fields**: `tool_name`, `mcp_server_name`, `success`, `error_type`, `execution_time_ms`, `session_id`, `parameter_count`, `timestamp`
- **Example**: Tool completed successfully in 250ms

### 4. Connection Events
Track physical network connection lifecycle (transport layer).

#### `mcp_connection_established`
Triggered when a transport connection is established.
- **Fields**: `transport_type`, `mcp_server_name`, `client_name`, `client_version`, `timestamp`
- **Example**: HTTP transport connection established

#### `mcp_connection_lost`
Triggered when a connection is lost or terminated.
- **Fields**: `session_id`, `mcp_server_name`, `reason`, `timestamp`
- **Example**: Connection lost due to transport closure

### 5. Error Events
Track errors across all MCP server operations for debugging and reliability monitoring.

#### `mcp_error_occurred`
Triggered when any error occurs in the MCP server.
- **Fields**: `error_category`, `error_code`, `tool_name`, `mcp_server_name`, `client_name`, `session_id`, `parameter_count`, `timestamp`
- **Example**: Tool execution error, authentication failure, etc.

### 6. MCP Server Operational Events
Track MCP server operational status and health for infrastructure monitoring and troubleshooting.

#### `mcp_server_started`
Triggered when the MCP server starts up.
- **Fields**: `mcp_server_name`, `server_version`, `configuration_hash`, `startup_time_ms`, `timestamp`
- **Example**: Server started in 1250ms with config hash abc123

#### `mcp_server_stopped`
Triggered when the MCP server shuts down.
- **Fields**: `mcp_server_name`, `shutdown_reason`, `uptime_seconds`, `timestamp`
- **Example**: Server stopped due to SIGINT after 3600 seconds uptime

#### `mcp_server_health_check`
Triggered during health check requests.
- **Fields**: `mcp_server_name`, `health_status`, `cpu_usage_percent`, `memory_usage_mb`, `active_connections`, `timestamp`
- **Example**: Health check showing 45MB memory usage, 2 active connections

#### `mcp_server_config_changed`
Triggered when server configuration changes.
- **Fields**: `mcp_server_name`, `config_section`, `change_type`, `timestamp`
- **Example**: Analytics configuration updated

## Client-Side Events

In addition to server-side MCP telemetry events, the web UI tracks user interactions:

- **Page Views**: Dashboard, tools list, categories, services, logs, endpoints
- **Tool Detail Views**: Individual tool inspection
- **Navigation**: Category and service browsing
- **Exports**: CSV tool list downloads

## Implementation Notes

### Error Categories
- `tool_execution`: Errors during tool execution
- `authentication`: Authentication/authorization failures
- `server_startup`: Server initialization errors
- `configuration`: Configuration-related errors

### Field Standards
- All events include `mcp_server_name`: "aap-mcp-server"
- Timestamps are ISO 8601 formatted
- Duration fields are in milliseconds or seconds as specified
- Boolean fields use `true`/`false`
- Missing optional fields are set to `null`

### Data Privacy
- No sensitive data (tokens, credentials) is tracked
- User agents are tracked but can be anonymized
- Session IDs are used for correlation but not linked to personal data
- All data is sent to your configured Segment destination

## Monitoring and Dashboards

Use these events to create dashboards tracking:
- **Usage Patterns**: Tool popularity, session duration, user activity
- **Performance**: Tool execution times, error rates, server health
- **Reliability**: Connection stability, authentication success rates
- **Operational**: Server uptime, memory usage, active connections

## Troubleshooting

### No Events Being Sent
1. Verify `enable_analytics: true` in config
2. Check `SEGMENT_WRITE_KEY` is set correctly
3. Review server logs for analytics errors
4. Test with `/api/v1/health` endpoint

### Missing Events
- Tool events require active MCP sessions
- Authentication events only occur during session initialization
- Health check events are triggered by HTTP requests to `/api/v1/health`
- Server operational events occur during startup/shutdown cycles