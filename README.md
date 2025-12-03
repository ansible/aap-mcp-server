# AAP MCP Service

A Model Context Protocol (MCP) service that provides access to Ansible Automation Platform (AAP) APIs through OpenAPI specifications.

## Prerequisites

- Node.js 18 or higher
- Access to an Ansible Automation Platform instance
- Valid AAP authentication token

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd aap-mcp-server
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Configuration

The service uses a YAML configuration file (`aap-mcp.yaml`) for flexible configuration management. Copy the sample configuration to get started:

```bash
cp aap-mcp.sample.yaml aap-mcp.yaml
```

### Configuration File Structure

The configuration file supports the following options:

#### Basic Settings

```yaml
# Disable HTTPS certificate validation for development (optional, defaults to false)
ignore-certificate-errors: true

# AAP base URL (optional, defaults to https://localhost)
# Lower priority than BASE_URL environment variable
base_url: "https://your-aap-instance.com"
```

#### Service Configuration

Configure which AAP services to load and how to access their OpenAPI specifications:

```yaml
services:
  - name: controller
    url: "https://custom-controller.example.com/api/v2/schema/" # Optional: custom URL
    local_path: "data/controller-schema.json" # Optional: local file path
    enabled: true # Optional: enable/disable service

  - name: galaxy
    url: "https://custom-galaxy.example.com/api/v3/openapi.json"
    local_path: "data/galaxy-schema.json"
    enabled: true

  - name: gateway
    # Uses default URLs if not specified
    enabled: true

  - name: eda
    enabled: false # Disable this service
```

**Service Configuration Rules:**

- **name**: Must be one of: `controller`, `galaxy`, `gateway`, `eda`
- **url**: Custom OpenAPI specification URL (optional, uses service defaults if not specified)
- **local_path**: Path to local OpenAPI file (optional, if set, loads from file instead of URL)
- **enabled**: Enable/disable the service (optional, defaults to true)

#### Toolsets

Define custom toolsets that group related functionality:

```yaml
toolsets:
  job_management:
    - controller.job_templates_launch_create
    - controller.workflow_job_templates_launch_create
    - controller.jobs_read
    - controller.workflow_jobs_read

  inventory_management:
    - controller.inventories_list
    - controller.hosts_list
    - controller.groups_list

  system_monitoring:
    - controller.ping_list
    - controller.config_list
    - gateway.activitystream_list
```

### Environment Variables

Environment variables take precedence over configuration file settings:

```bash
# AAP Gateway Authentication token (required)
BEARER_TOKEN_OAUTH2_AUTHENTICATION=your_aap_token_here

# AAP base URL (highest priority)
BASE_URL=https://your-aap-instance.com

# MCP server port (optional, defaults to 3000)
MCP_PORT=3000
```

### Configuration Priority

Configuration values are resolved in the following order (highest to lowest priority):

1. **Environment Variables** (e.g., `BASE_URL`, `BEARER_TOKEN_OAUTH2_AUTHENTICATION`)
2. **Configuration File** (`aap-mcp.yaml`)
3. **Default Values** (built-in defaults)

### User Toolsets

The service supports role-based access control through user toolsets.

## Usage

### Starting the Service

1. **Configure the service** by copying and editing the sample configuration:

```bash
cp aap-mcp.sample.yaml aap-mcp.yaml
# Edit aap-mcp.yaml with your AAP instance details
```

2. **Start the service**:

```bash
# Development mode
npm run dev

# Production mode
npm start
```

### MCP Endpoints

The service provides several MCP endpoints:

- **Standard MCP**: `/mcp` (POST, GET, DELETE)
- **Toolset-specific**: `/mcp/{toolset}` where toolset matches your configured toolsets

### Authentication

Include your AAP token in the Authorization header:

```
Authorization: Bearer your_aap_token_here
```

### Session Management

The service uses session-based authentication:

1. Initialize a session with a POST request containing your token
2. Use the returned `Mcp-Session-Id` header for subsequent requests
3. The service validates tokens and determines user permissions automatically

### Connecting to Claude

#### Option 1: Token in Authorization Header

```bash
claude mcp add aap-mcp -t http http://localhost:3000/mcp -H 'Authorization: Bearer your_aap_token_here'
```

#### Option 2: Token in Environment Variable

1. Configure the token as an environment variable:

```bash
export BEARER_TOKEN_OAUTH2_AUTHENTICATION=your_aap_token_here
```

2. Start the service:

```bash
npm run dev
```

3. Register with Claude:

```bash
claude mcp add aap-mcp -t http http://localhost:3000/mcp
```

#### Option 3: Using Custom Toolsets

To use specific toolsets defined in your configuration:

```bash
# Use job management tools only
claude mcp add aap-mcp-jobs -t http http://localhost:3000/mcp/job_management

# Use inventory management tools
claude mcp add aap-mcp-inventory -t http http://localhost:3000/mcp/inventory_management

# Use system monitoring tools
claude mcp add aap-mcp-monitoring -t http http://localhost:3000/mcp/system_monitoring
```

## Available Tools

The service generates tools from AAP OpenAPI specifications for:

- **EDA** (Event-Driven Ansible): Activations, projects, rulebooks, decision environments
- **Controller**: Jobs, job templates, inventories, projects, organizations
- **Gateway**: User and team management, organizations, role definitions
- **Galaxy**: Collection management and versions

Tool availability depends on your configured toolsets and user permissions.

## Prometheus Metrics

The service includes comprehensive Prometheus metrics for monitoring and observability. Enable metrics in your configuration:

```yaml
# In aap-mcp.yaml
enable_metrics: true
```

Or via environment variable:

```bash
export ENABLE_METRICS=true
```

### Metrics Endpoint

When enabled, Prometheus metrics are available at:

```
http://localhost:3000/metrics
```

### Available Metrics

- **HTTP Metrics**: Request counts, duration, and status codes
- **MCP Tool Metrics**: Tool execution counts, duration, success/failure rates
- **System Metrics**: CPU, memory, garbage collection, event loop lag
- **API Call Metrics**: AAP API calls by service, endpoint, and method

## Development

### Key Features

- **Flexible Configuration**: YAML-based configuration with environment variable overrides
- **Service Selection**: Enable/disable specific AAP services
- **Local File Support**: Load OpenAPI specs from local files or remote URLs
- **Role-based Access Control**: Custom toolsets and permission-based tool filtering
- **Session Management**: Token validation and user permission detection
- **Prometheus Metrics**: Comprehensive metrics for monitoring and observability

### Configuration Design

The configuration system follows a hierarchical approach:

1. **Environment Variables** (highest priority)
   - `BASE_URL`: AAP instance URL
   - `BEARER_TOKEN_OAUTH2_AUTHENTICATION`: Authentication token
   - `MCP_PORT`: Server port

2. **YAML Configuration File** (`aap-mcp.yaml`)
   - Service definitions with custom URLs and local file paths
   - Custom toolsets for role-based access
   - Feature toggles (certificate validation, write operations)

3. **Built-in Defaults** (lowest priority)
   - Default OpenAPI specification URLs for each service
   - Standard port (3000) and base URL (https://localhost)

## Container Deployment

### Building the Container

Build the image with:

```bash
podman build -f Containerfile . -t aap-mcp
```

### Running with Docker/Podman

```bash
# Basic run with environment variables
podman run -d \
  -e BASE_URL=https://your-aap-instance.com \
  -e BEARER_TOKEN_OAUTH2_AUTHENTICATION=your_token_here \
  -p 3000:3000 \
  localhost/aap-mcp

# Run with custom configuration file
podman run -d \
  -v /path/to/your/aap-mcp.yaml:/app/aap-mcp.yaml:ro \
  -e BEARER_TOKEN_OAUTH2_AUTHENTICATION=your_token_here \
  -p 3000:3000 \
  localhost/aap-mcp
```

### Kubernetes Deployment

The project includes a complete Kubernetes deployment configuration in `kubernetes/deployment.yaml`:

```bash
# Deploy to Kubernetes
kubectl apply -f kubernetes/deployment.yaml

# Check deployment status
kubectl get pods -l app=aap-mcp
kubectl logs -l app=aap-mcp
```

The Kubernetes deployment includes:

- **ConfigMap**: Stores the YAML configuration
- **Deployment**: Runs the service with health checks
- **PersistentVolumeClaim**: Stores API query logs
- **Service**: Internal cluster networking
- **Route**: External access (OpenShift)

## Troubleshooting

### Common Issues

1. **Authentication failed**:
   - Verify your AAP token is valid and has appropriate permissions
   - Check that `BEARER_TOKEN_OAUTH2_AUTHENTICATION` is set correctly
   - Ensure the token has access to the AAP services you're trying to use

2. **No tools available**:
   - Check that your token provides the expected user permissions
   - Verify services are enabled in your configuration
   - Check the toolset configuration matches your intended tool access

3. **Connection refused**:
   - Ensure AAP is running and accessible at the configured base URL
   - Check `base_url` in configuration or `BASE_URL` environment variable
   - Verify network connectivity and firewall settings

4. **OpenAPI spec loading failed**:
   - Check if `local_path` files exist and are readable
   - Verify URLs are accessible if not using local files
   - Review certificate validation settings for HTTPS endpoints

5. **Missing dependencies**:
   - Run `npm install` to install required packages
   - Ensure Node.js version 18 or higher is installed

### Configuration Validation

Validate your YAML configuration:

```bash
# Check YAML syntax
yq eval . aap-mcp.yaml

# Validate against sample
diff aap-mcp.sample.yaml aap-mcp.yaml
```

### Health Monitoring

The service includes a health check endpoint:

```bash
# Check service health
curl http://localhost:3000/api/v1/health

# Expected response
{"status":"ok"}
```

## License

Apache-2.0
