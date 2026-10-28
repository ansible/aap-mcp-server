# AAP MCP Service

A Model Context Protocol (MCP) service that provides access to Ansible Automation Platform (AAP) APIs through OpenAPI specifications.

## Prerequisites

- Node.js 22 or higher
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
# AAP base URL (highest priority)
BASE_URL=https://your-aap-instance.com

# MCP server port (optional, defaults to 3000)
MCP_PORT=3000

# Change this to true to get access to the write operations
#ALLOW_WRITE_OPERATIONS=true

# Extra browser origins allowed for DNS-rebinding protection (comma-separated).
# The gateway (BASE_URL) and localhost are always allowed; this is additive.
# Also settable via `allowed_origins` in aap-mcp.yaml (env var takes precedence).
#ALLOWED_ORIGINS=https://chatbot.example.com,https://console.example.com

# Secret for the multi-round-trip (MRTR) requestState integrity codec.
# Optional and forward-looking: when set, the server HMAC-signs and verifies the
# `requestState` blobs used by `input_required` handlers (MCP 2026-07-28). No
# handler returns `input_required` today, so leaving this unset changes nothing.
# NOTE: if you add such a handler, its `requestState` MUST be produced via
# `requestStateCodec.mint(...)` or verification will reject the client's retry.
#REQUEST_STATE_SECRET=<random-high-entropy-string>

# Directory of skills to serve over the MCP skills extension (SEP-2640).
# Unset or empty disables skills entirely. See "Serving Skills" below.
# Also settable via `skills_path` in aap-mcp.yaml (env var takes precedence).
#SKILLS_PATH=/opt/aap-mcp/skills

# Organizational prefix for skill URIs (optional, defaults to "aap").
#SKILLS_URI_PREFIX=aap

# Name the served skills in the server's `instructions` field: "on" (default)
# or "off". Any other value is reported at startup and the default kept.
#SKILLS_INSTRUCTIONS=on
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

Toolset endpoints narrow the _tools_ on offer. When skills are enabled, the full skill catalog
is served from every endpoint, toolset-specific ones included — see
[Serving Skills](#serving-skills).

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

## Serving Skills

Alongside tools, the service can serve **skills** — packaged procedural instructions a client
loads to carry out a multi-step task, defined by the MCP skills extension
([SEP-2640](https://modelcontextprotocol.io/seps/2640-skills-extension)) and implemented by
the MCP TypeScript SDK 2.4.0 or later.

Skills are **off by default**. Point the server at a directory to enable them:

```bash
SKILLS_PATH=/opt/aap-mcp/skills npm start
```

or in `aap-mcp.yaml`:

```yaml
skills_path: "/opt/aap-mcp/skills"
skills_uri_prefix: "aap" # optional, defaults to "aap"
```

With `SKILLS_PATH` unset or empty the extension is not advertised and `skills/list` and
`skills/get` are not registered. The catalog is read once at startup, so content changes need
a restart, and unlike tools it is not narrowed by toolset: every endpoint, `/mcp/{toolset}`
included, serves the whole catalog.

### Directory layout

Each immediate subdirectory of `SKILLS_PATH` is one skill:

```
skills/
└── aap-platform-health-check/
    ├── SKILL.md                     # required
    └── references/
        └── red-hat-sources.md       # optional supporting files
```

`SKILL.md` needs YAML frontmatter carrying at least `name` and `description`, and **`name`
must equal the directory name** — SEP-2640 requires the last segment of a skill's URI path to
match its frontmatter name.

### What clients see

| Method           | Returns                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `skills/list`    | Every skill, each as `{uri, frontmatter, resources}`                    |
| `skills/get`     | One skill by URI, wrapped as `{"skill": {…}}`                           |
| `resources/list` | One entry per skill — its `SKILL.md`, and nothing below it              |
| `resources/read` | The bytes of any skill file, addressed `skill://<prefix>/<name>/<file>` |

Every file in a `skills/list` entry carries a SHA-256 `digest` and byte `size` for clients to
verify. Note that `resources/list` advertises each skill's `SKILL.md` only, while
`resources/read` serves any file in the skill directory — **so a skill must cite its own
reference files**, or a client never learns they exist.

The extension is advertised as `{"directoryRead": true}`, so `resources/directory/read` also
works. That value is derived by the SDK from the catalog source rather than configured here:
the Node source implements directory reads, and declining them would mean not using the
catalog.

The server also names every skill it serves, by URI and description, in the `instructions`
field of `server/discover`. That is base protocol rather than an extension, so clients that
implement nothing of SEP-2640 still find the skills; without it, in testing, they did not. Set
`skills_instructions: "off"` (or `SKILLS_INSTRUCTIONS=off`) to serve skills only through the
extension methods.

### A skill that fails to load

A bad skill is skipped with a warning rather than failing startup, so one bad `SKILL.md`
cannot take the server's tools down with it. A skill is skipped when:

- it has no `SKILL.md`, or its frontmatter is missing, malformed, or not a mapping;
- it lacks `name` or `description`, or its `name` disagrees with its directory;
- it contains a symlink — **any** symlink, even to a file inside the same skill, so shared
  content has to be copied in rather than linked;
- its frontmatter uses YAML outside the SDK's restricted subset (block mappings and sequences,
  plain, quoted and block scalars, comments, and flow collections only if they open and close
  on one line), so a multi-line `tools: [ ... ]` is rejected;
- one of its file names cannot be represented in a URI.

Exceeding the SEP-2640 limits of 512 files or 16 MiB is **not** a skip: the skill is still
served in full, though a conforming host may decline it. The startup log reports those under
`warning(s), still served`.

A `skills_path` the server cannot read at all — missing, not a directory, no permission — is
reported as an error and skills are disabled for that run. The server still starts and serves
its tools.

Every skipped skill is named in the startup log with its file, line and reason:

```
Skills: 2 loaded from /opt/aap-mcp/skills
  ✓ skill://aap/aap-effective-access-review/SKILL.md
  ✓ skill://aap/aap-skill-creator/SKILL.md
  1 skill SKIPPED and NOT served:
  ✗ aap-platform-health-check/SKILL.md: SKILL.md frontmatter: line 43: a flow collection must close on the same line (skill skipped)
```

### Verifying a deployment

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) (2.6.0 or later) checks
conformance rather than just displaying results:

```bash
npx @modelcontextprotocol/inspector --cli \
  --server-url http://localhost:3000/mcp --transport http \
  --header "Authorization: Bearer your_aap_token_here" \
  --method skills/list --verify
```

It verifies digests, sizes, frontmatter fidelity and the size limits, naming the offending
file or field. Exit `0` means clean, `7` a verification failure, `8` a skill too large to
check fully.

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
   - Ensure Node.js version 22 or higher is installed

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
