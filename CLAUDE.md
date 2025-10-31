# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build and Development
- `npm run build` - Compile TypeScript to JavaScript in dist/ directory
- `npm run dev` - Start development server with tsx (hot reload)
- `npm start` - Start production server from compiled dist/

### Testing  
- `npm test` - Run tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:ui` - Run tests with UI interface
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:coverage:watch` - Run coverage in watch mode

### Tools and Utilities
- `npm run update-controller-schema` - Update Ansible Controller schema from remote source

## Architecture Overview

This is an **Ansible Automation Platform (AAP) MCP Server** that provides Model Context Protocol (MCP) access to AAP APIs through OpenAPI specifications. The service acts as a bridge between Claude and AAP services.

### Core Components

**Main Entry Point (`src/index.ts`):**
- Express.js HTTP server providing MCP endpoints
- Session management with token validation
- Web UI dashboard (optional)
- Prometheus metrics integration
- Multi-service OpenAPI spec loading and tool generation

**OpenAPI Processing (`src/openapi-loader.ts`):**
- Loads OpenAPI specs from URLs or local files for 4 AAP services:
  - **EDA** (Event-Driven Ansible)
  - **Controller** (AWX/Tower)
  - **Gateway** (User/team management)
  - **Galaxy** (Collection management)
- Service-specific URL patterns and reformat functions
- Local file fallback support

**Tool Generation (`src/extract-tools.ts`):**
- Custom fork of openapi-mcp-generator
- Converts OpenAPI operations to MCP tool definitions
- Handles parameter mapping, request body processing
- Service-specific naming conventions (e.g., `controller.jobs_list`)

**Configuration System:**
- YAML-based configuration (`aap-mcp.yaml`) with environment variable overrides
- Priority: Environment Variables > YAML Config > Defaults
- Category-based tool filtering for role-based access
- Service enable/disable flags

**Web UI Dashboard (`src/views/`):**
- Optional web interface for browsing tools and logs
- Tool categorization and success rate monitoring
- API query logging and metrics visualization

### Key Architecture Patterns

1. **Service Abstraction**: Each AAP service (EDA, Controller, Gateway, Galaxy) has its own URL patterns and tool reformatting logic
2. **Category-Based Access Control**: Tools are grouped into categories (e.g., `job_management`, `inventory_management`) for user permission filtering
3. **Session Management**: Bearer tokens validated against AAP Gateway `/api/gateway/v1/me/` endpoint with permission detection
4. **Tool Filtering Pipeline**: OpenAPI → Tool Generation → Category Filtering → MCP Tool Response

### Configuration Priority
1. **Environment Variables** (`BASE_URL`, `BEARER_TOKEN_OAUTH2_AUTHENTICATION`, `MCP_PORT`)
2. **YAML Configuration File** (`aap-mcp.yaml`)
3. **Built-in Defaults**

### MCP Endpoints
- `/mcp` - Standard MCP endpoint (all tools based on session permissions)
- `/mcp/{category}` - Category-specific endpoints (e.g., `/mcp/job_management`)
- `/{category}/mcp` - Alternative category routing pattern

### Important Implementation Notes
- Tools are generated dynamically from OpenAPI specs at startup
- Each tool includes service metadata, logs, and size calculations
- Session tokens are validated once during initialization, then reused
- Category filtering happens at the MCP `list_tools` level
- Web UI is completely optional and disabled by default

### Analytics Integration
- **Segment Analytics** with standardized MCP telemetry events
- **Client-side tracking**: analytics.js snippet injection for web UI interactions
- **Server-side tracking**: Full MCP telemetry event coverage including:
  - Session Events: `mcp_session_started`, `mcp_session_ended`
  - Authentication Events: `mcp_auth_attempt` (success/failure tracking)
  - Tool Usage Events: `mcp_tool_called`, `mcp_tool_completed`
  - Connection Events: `mcp_connection_established`, `mcp_connection_lost`
  - Error Events: `mcp_error_occurred` (categorized by error type)
  - Server Operational Events: `mcp_server_started`, `mcp_server_stopped`, `mcp_server_health_check`, `mcp_server_config_changed`
- Configuration: `enable_analytics: true` and `segment_write_key` in YAML config
- Environment variables: `ENABLE_ANALYTICS`, `SEGMENT_WRITE_KEY`
- Automatic injection into all HTML responses when Web UI is enabled
- Enhanced health endpoint with analytics tracking at `/api/v1/health`

### Testing Configuration
- Uses Vitest with comprehensive coverage requirements (80% across all metrics)
- Test files: `src/**/*.{test,spec}.ts` and `tests/**/*.{test,spec}.ts`
- Coverage thresholds enforced for branches, functions, lines, and statements