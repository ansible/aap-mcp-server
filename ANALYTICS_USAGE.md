# Analytics Telemetry Usage

This document describes how the MCP server implements telemetry using Segment analytics.

## Configuration

### Environment Variable (recommended)

```bash
export ANALYTICS_KEY="your-segment-write-key"
```

### Configuration File

```yaml
# aap-mcp.yaml
analytics_key: "your-segment-write-key-here"
```

## Events Tracked

### 1. Tool Called (`mcp_tool_called`)

Tracked for every tool invocation (both successful and failed). The server operates in stateless mode, so each request is independent with no session tracking.

**Fields:**

- `tool_name` - Name of the MCP tool
- `mcp_tool_set` - Name of the specific MCP server instance
- `user_agent` - Client user agent string
- `parameter_length` - Size in chars of the input payload
- `http_status` - Return code of the HTTP request
- `execution_time_ms` - Tool execution time in milliseconds
- `user_pseudo_id` - HMAC-SHA-256 pseudonymous user identifier
- `user_type` - User type classification ("internal" | "external")
- `installer_pseudo_id` - HMAC-SHA-256 pseudonymous installer identifier

**Example:**

```json
{
  "event": "mcp_tool_called",
  "anonymousId": "a1b2c3d4e5f6...",
  "properties": {
    "tool_name": "launch_job_template",
    "mcp_tool_set": "job-management",
    "user_agent": "Claude Desktop/0.7.1",
    "parameter_length": 245,
    "http_status": 200,
    "execution_time_ms": 1500,
    "user_pseudo_id": "a1b2c3d4e5f6...",
    "user_type": "external",
    "installer_pseudo_id": "7g8h9i0j1k2l..."
  }
}
```

### 2. Server Status (`mcp_server_status`)

Tracked every 30 minutes to monitor server health.

**Fields:**

- `process_id` - Unique identifier for the server instance (volatile)
- `health_status` - Overall health status ("healthy", "degraded", "unhealthy")
- `active_sessions` - Number of active sessions (in stateless mode, this represents concurrent connections)
- `uptime_seconds` - Server uptime in seconds
- `server_version` - Version of the MCP server
- `container_version` - Version of the container
- `read_only_mode` - Configuration setting for read-only mode

**Example:**

```json
{
  "event": "mcp_server_status",
  "anonymousId": "65236301-c591-402b-a97b-0084c57d5179",
  "properties": {
    "process_id": "65236301-c591-402b-a97b-0084c57d5179",
    "health_status": "healthy",
    "active_sessions": 15,
    "uptime_seconds": 3600,
    "server_version": "1.0.0",
    "container_version": "2.6.1-20251111",
    "read_only_mode": false
  }
}
```
