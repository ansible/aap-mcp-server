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
([SEP-2640](https://modelcontextprotocol.io/seps/2640-skills-extension),
[overview](https://modelcontextprotocol.io/extensions/skills/overview)). A tool is a single
call the model can make; a skill is a document telling it which calls to make, in what order,
and how to interpret the results.

The protocol mechanics come from the MCP TypeScript SDK (2.4.0 or later), which carries the
SEP-2640 implementation.

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
`skills/get` are not registered — the server behaves exactly as it did before skills existed.

The catalog is read once at startup, so adding or editing a skill needs a restart. Unlike
tools, it is not narrowed by toolset: every endpoint, `/mcp/{toolset}` included, serves the
whole catalog.

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

The path is a plain directory, which keeps the server ignorant of how the content arrived: a
git submodule in the container image, a working copy in local development, or an unpacked OCI
artifact later all look the same to it.

### What clients see

| Method           | Returns                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `skills/list`    | Every skill, each as `{uri, frontmatter, resources}`                    |
| `skills/get`     | One skill by URI, wrapped as `{"skill": {…}}`                           |
| `resources/list` | One entry per skill — its `SKILL.md`, and nothing below it              |
| `resources/read` | The bytes of any skill file, addressed `skill://<prefix>/<name>/<file>` |

Every file in a `skills/list` entry carries a SHA-256 `digest` and byte `size`. Clients are
expected to verify both, and to re-parse the fetched `SKILL.md` and confirm its frontmatter
matches what the listing advertised, before loading a skill.

Note the asymmetry between the last two rows: `resources/list` advertises each skill's
`SKILL.md` only, while `resources/read` will serve any file in the skill directory. That is
progressive disclosure working as intended — the listing stays one line per skill however
many files it carries — but it is an authoring constraint. **A client that never reads
`SKILL.md` never learns a reference file exists, so a skill must cite its own files.**

`resources/list` is worth knowing about even though the extension does not require it. No
mainstream client implements `skills/list` yet, so in practice a client that knows nothing
about SEP-2640 still reaches these skills: it lists resources, sees the `skill://` URI, and
reads the `SKILL.md` through `resources/read`.

### Discovery: the instructions pointer

Reachable is not the same as findable. Asked "is my AAP platform healthy?" against a server
serving a skill whose trigger conditions contain that question almost verbatim, a real client
made seven tool calls, zero resource calls, and never found the skill. Nothing draws a model to
the resource list.

SEP-2640 anticipates this and defines a second discovery mechanism alongside `skills/list`:

> A server MAY direct the agent to specific skill URIs from its `instructions` field. This
> requires no discovery machinery on the host; the URI is simply present in the model's context
> and readable via `resources/read`.

So the server names every skill it serves — URI plus description, trigger conditions included —
in the `instructions` field of its `server/discover` result. The client injects that into the
model's context at connection, which means there is nothing to discover: the model already
holds the URI and reads it directly. On the same prompt that failed above, the skill is read as
the client's first action.

This is base protocol rather than an extension, so it works on any MCP client, and it costs no
entry in `tools/list`. It is on by default; set `skills_instructions: "off"` (or
`SKILLS_INSTRUCTIONS=off`) to leave only the SEP-2640 methods.

Two caveats worth knowing. A client that does not surface server instructions gets no benefit —
the pointer is passive text, not something the model can stumble into. And a client reaching a
skill this way reads it over `resources/read` without ever seeing the digests published on
`skills/list`, so the integrity check described above goes unexercised on that path.

### A skill that fails to load

Loading is deliberately forgiving: a skill is skipped with a warning rather than failing
startup, so one bad `SKILL.md` in a content directory cannot take the server's tools down with
it. A skill is skipped when it has no `SKILL.md`; its frontmatter is missing, malformed, or not
a mapping; it lacks `name` or `description`; its `name` disagrees with its directory; it
exceeds the SEP-2640 limits of 512 files or 16 MiB; or it contains a symlink. A missing
`SKILLS_PATH` directory yields an empty catalog and a warning.

Note the symlink rule is absolute, not a containment check: the loader refuses **any** symlink,
including one pointing at a sibling file inside the same skill directory, and drops the whole
skill rather than just that file (`symlinks and other special files are not followed; copy the
file instead`). Shared content has to be copied in, not linked.

One skip reason is easy to hit by accident. The SDK does not use a general YAML parser for
frontmatter — it reads a **restricted subset** (block mappings and sequences, plain, quoted and
block scalars, comments, and flow collections only if they open and close on the same line) and
refuses anything outside it. A multi-line `tools: [ ... ]` is legal YAML and will be rejected.
The reason is deliberate: SEP-2640 makes a host re-parse `SKILL.md` and compare frontmatter
field by field, so any disagreement between the server's parser and the host's is a
verification failure. The SDK stays where disagreement is improbable and declines to guess.

Every skipped skill is named in the startup log with its file, line and reason:

```
Skills: 2 loaded from /opt/aap-mcp/skills
  ✓ skill://aap/aap-effective-access-review/SKILL.md
  ✓ skill://aap/aap-skill-creator/SKILL.md
  1 skill SKIPPED and NOT served:
  ✗ aap-platform-health-check/SKILL.md: SKILL.md frontmatter: line 43: a flow collection must close on the same line (skill skipped)
```

If a skill you expect is absent from `skills/list`, that log says which one and why.

### Verifying a deployment

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) (2.6.0 or later) checks
conformance rather than just displaying results:

```bash
npx @modelcontextprotocol/inspector --cli \
  --server-url http://localhost:3000/mcp --transport http \
  --header "Authorization: Bearer your_aap_token_here" \
  --method skills/list --verify
```

It fetches each file, verifies it against the advertised digest and size, re-parses the served
`SKILL.md` and compares frontmatter field by field, and checks the size limits. Exit `0` means
clean, `7` a verification failure, `8` a skill too large to check fully. Findings name the
offending file or frontmatter field.

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
