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

### 1. Session Started (`mcp_session_started`)

Tracked when a new MCP session is established.

**Fields:**

- `user_agent` - Client user agent string
- `sess_id` - Unique session identifier (UUID)
- `mcp_tool_set` - Name of the specific MCP server instance
- `process_id` - Unique identifier for the server instance (volatile)
- `user_unique_id` - Generated from process_id and user access token

**Example:**

```json
{
  "event": "mcp_session_started",
  "properties": {
    "user_agent": "Claude Desktop/0.7.1",
    "sess_id": "95f5b3cd-5931-4982-92d1-508f98045918",
    "mcp_tool_set": "job-management",
    "process_id": "65236301-c591-402b-a97b-0084c57d5179",
    "user_unique_id": "b519f181-62f3-4eb7-bf96-6c1a1e9756e0"
  }
}
```

### 2. Tool Called (`mcp_tool_called`)

Tracked for every tool invocation (both successful and failed).

**Fields:**

- `tool_name` - Name of the MCP tool
- `mcp_tool_set` - Name of the specific MCP server instance
- `user_agent` - Client user agent string
- `sess_id` - Session identifier (UUID)
- `parameter_length` - Size in chars of the input payload
- `http_status` - Return code of the HTTP request
- `execution_time_ms` - Tool execution time in milliseconds
- `user_unique_id` - Generated from process_id and user access token

**Example:**

```json
{
  "event": "mcp_tool_called",
  "properties": {
    "tool_name": "launch_job_template",
    "mcp_tool_set": "job-management",
    "user_agent": "Claude Desktop/0.7.1",
    "sess_id": "95f5b3cd-5931-4982-92d1-508f98045918",
    "parameter_length": 245,
    "http_status": 200,
    "execution_time_ms": 1500,
    "user_unique_id": "b519f181-62f3-4eb7-bf96-6c1a1e9756e0"
  }
}
```

### 3. Server Status (`mcp_server_status`)

Tracked every 30 minutes to monitor server health.

**Fields:**

- `process_id` - Unique identifier for the server instance (volatile)
- `health_status` - Overall health status ("healthy", "degraded", "unhealthy")
- `active_sessions` - Number of active sessions
- `uptime_seconds` - Server uptime in seconds
- `server_version` - Version of the MCP server
- `container_version` - Version of the container
- `read_only_mode` - Configuration setting for read-only mode

**Example:**

```json
{
  "event": "mcp_server_status",
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
