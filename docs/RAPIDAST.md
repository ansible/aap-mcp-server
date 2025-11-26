# RapiDAST Security Scanning

This document describes how to use RapiDAST to perform security scanning of the AAP MCP Server.

## Overview

RapiDAST (Rapid DAST) from Red Hat Product Security performs **passive security scanning** of the AAP MCP Server using HAR-imported requests.

**Current Approach**:

- Generate HAR file with comprehensive MCP protocol requests
- Import into OWASP ZAP via RapiDAST
- Run passive scanning only (fast, ~2 seconds)
- Active scanning is disabled (takes 1-2+ hours, incompatible with CI/CD timeouts)

**Why Passive Scanning Only?**

Passive scanning analyzes captured HTTP request/response pairs as-is without modification, completing in seconds. Active scanning generates hundreds of modified requests per endpoint for vulnerability testing, taking 1-2+ hours even with minimal policies—far exceeding GitHub Actions' 30-minute timeout.

See [Implementation Journey](./rapidast-implementation-journey.md) for the complete evolution and technical decisions.

## Components

### 1. Mock AAP Server (`scripts/mock-aap-server.ts`)

A minimal HTTP server that mocks essential AAP authentication endpoints:

- `GET /api/gateway/v1/me/` - Returns mock user data for token validation
- `GET /health` - Health check endpoint

The MCP server requires token validation during startup. The mock server accepts any bearer token and returns fixed user data, enabling security testing without a real AAP instance.

### 2. HAR Generator (`scripts/generate-mcp-har.ts`)

Generates `mcp-requests.har` containing 18 HTTP request/response pairs:

- **6 endpoint categories**: job_management, inventory_management, system_monitoring, user_management, security_compliance, platform_configuration
- **3 requests per category**:
  1. `initialize` - Sends MCP initialization request, captures session ID from response header
  2. `tools/list` - Lists available tools (with session ID header)
  3. `tools/call` - Calls one representative tool (with session ID header)

Each category gets a unique session ID to properly test the initialization flow.

**Key Feature**: Session management is handled internally by the script—each category loop resets the session ID to ensure independent sessions.

### 3. RapiDAST Configuration (`rapidast-config.yml`)

Defines the scan configuration:

```yaml
config:
  configVersion: 6

general:
  verbose: true # Show scan progress

application:
  shortName: "aap-mcp-server"
  url: "http://localhost:3000"

scanners:
  zap:
    container:
      parameters:
        executable: "zap.sh"
        extraCli: "-config log.level=INFO" # ZAP INFO logging

    # Import HAR file with all MCP requests
    importUrlsFromFile:
      type: "har"
      fileName: "mcp-requests.har"

    # Passive scanning only
    passiveScan:
      disabledRules: "2,10015,10024,10027,10054,10096,10109,10112"
```

### 4. GitHub Workflow (`.github/workflows/rapidast.yml`)

Automated security scanning workflow that:

1. Starts mock AAP server (port 8080)
2. Starts MCP server configured to use mock AAP (port 3000)
3. Generates HAR file with all 6 endpoint categories
4. Runs RapiDAST with passive scanning
5. Uploads results as artifacts
6. Displays summary in workflow UI

**Trigger**: Manual only (workflow_dispatch)

## Running Locally

### Prerequisites

- Node.js 18.x or higher
- Docker (for running RapiDAST container)
- curl (for health checks)

### Quick Start

1. Start the mock AAP server:

```bash
npx tsx scripts/mock-aap-server.ts &
# Wait for "Mock AAP server listening on port 8080"
```

2. In another terminal, start the MCP server:

```bash
cp aap-mcp.sample.yaml aap-mcp.yaml
BASE_URL=http://localhost:8080 \
BEARER_TOKEN_OAUTH2_AUTHENTICATION=test-token \
npm start &
# Wait for "Server ready on port 3000"
```

3. Generate the HAR file:

```bash
BASE_URL=http://localhost:3000 \
BEARER_TOKEN_OAUTH2_AUTHENTICATION=test-token \
npx tsx scripts/generate-mcp-har.ts
# Creates mcp-requests.har with 18 HTTP entries
```

4. Run RapiDAST in Docker:

```bash
docker run --rm \
  --network host \
  -v $(pwd):/opt/rapidast/work:Z \
  quay.io/redhatproductsecurity/rapidast:latest \
  --config /opt/rapidast/work/rapidast-config.yml
```

5. View results:

```bash
# Results in results/*/*/zap/
open results/*/*/zap/zap-report.html
```

## Running in GitHub Actions

The RapiDAST scan is configured as a manually-triggered workflow:

1. Go to the "Actions" tab in GitHub
2. Select "RapiDAST Security Scan" from workflows
3. Click "Run workflow"

The workflow will:

- Build and start servers in GitHub Actions environment
- Generate HAR file with all MCP endpoint requests
- Run security scan using Red Hat's RapiDAST container
- Upload results as artifacts
- Display summary of findings

## Viewing Results

### GitHub Actions

After a workflow run completes:

1. Go to the workflow run page
2. Scroll to "Artifacts" section
3. Download "rapidast-results" artifact
4. Extract and view reports

The artifact contains:

- `results/*/*/zap/zap-report.json` - Detailed JSON report
- `results/*/*/zap/zap-report.html` - Human-readable HTML report
- `results/*/*/zap/zap-report.xml` - XML report for CI/CD integration

### Local Scans

Results are stored in `results/` directory:

```
results/
  └── <timestamp>/
      └── <scan-name>/
          └── zap/
              ├── zap-report.json
              ├── zap-report.html
              └── zap-report.xml
```

### Typical Results

```
FAIL: 0
WARN-NEW: 3
PASS: 54
```

Warnings are expected and low-severity:

- Missing security headers (CSP, HSTS, etc.) - acceptable for internal APIs
- Information disclosure via headers - by design for debugging

## Performance

| Metric               | Value               |
| -------------------- | ------------------- |
| Total workflow time  | ~2 minutes          |
| Passive scan time    | ~2 seconds          |
| HAR file size        | ~100K               |
| HTTP requests tested | 18                  |
| Endpoint categories  | 6                   |
| Success rate         | 100% (all HTTP 200) |

## Configuration

### Passive Scan Disabled Rules

The following ZAP rules are disabled to reduce false positives:

- `2` - Private IP disclosure (internal API)
- `10015` - Re-examine Cache-control directives
- `10024` - Information disclosure (debug headers)
- `10027` - Information disclosure (suspicious comments)
- `10054` - Cookie without SameSite attribute
- `10096` - Timestamp disclosure
- `10109` - Modern Web Application (framework detection)
- `10112` - Session management response

### Why Active Scanning is Disabled

Active scanning takes 1-2+ hours even with the "API-scan-minimal" policy, far exceeding GitHub Actions' 30-minute timeout. ZAP's automation framework doesn't support time-limiting active scans via configuration.

**Passive scanning provides adequate coverage** for API security:

- Information disclosure
- Missing security headers
- Insecure cookie configurations
- CORS misconfigurations
- TLS/SSL issues
- Authentication/session management issues

**For comprehensive testing**, run active scans separately:

- Scheduled nightly jobs (no time constraints)
- Local development (on-demand)
- Dedicated security testing environments

See [Implementation Journey](./rapidast-implementation-journey.md) for detailed analysis of why other approaches weren't viable.

### Customizing the Configuration

Edit `rapidast-config.yml` to:

- Modify disabled passive scan rules
- Add ZAP add-ons (`miscOptions.additionalAddons`)
- Enable active scanning for local/scheduled testing (add `activeScan` section with desired policy)

See [RapiDAST configuration documentation](https://github.com/RedHatProductSecurity/rapidast/tree/development/config) for all options.

## Troubleshooting

### Mock AAP Server Won't Start

Check if port 8080 is already in use:

```bash
lsof -i :8080
```

Use a different port:

```bash
MOCK_AAP_PORT=9000 npx tsx scripts/mock-aap-server.ts
```

Then update `BASE_URL` when starting MCP server:

```bash
BASE_URL=http://localhost:9000 npm start
```

### MCP Server Authentication Fails

Ensure:

1. Mock AAP server is running and accessible
2. `BASE_URL` environment variable points to mock AAP server
3. Bearer token is provided (any value works with mock)

Test mock server:

```bash
curl http://localhost:8080/health
curl -H "Authorization: Bearer test" http://localhost:8080/api/gateway/v1/me/
```

### Docker Networking Issues

If RapiDAST in Docker can't reach the MCP server:

- **Linux**: Use `--network host` to share the host's network
- **Mac/Windows**: Use `host.docker.internal` instead of `localhost` in `rapidast-config.yml`
- **Verify**: Check servers are accessible:

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:8080/health
```

### HAR Generation Fails

Common issues:

1. **MCP server not running**: Start with `npm start`
2. **Wrong BASE_URL**: Should be `http://localhost:3000` (where MCP server runs)
3. **Missing token**: Set `BEARER_TOKEN_OAUTH2_AUTHENTICATION=test-token`

Debug with verbose output:

```bash
# Use DEBUG environment variable for verbose output
DEBUG=* npx tsx scripts/generate-mcp-har.ts
```

### Container Permission Issues

If you get permission errors with Docker:

```bash
# On Linux with SELinux, add :Z flag
docker run --rm -v $(pwd):/opt/rapidast/work:Z ...

# Alternative: Copy results after scan
docker run --name rapidast-scan ...
docker cp rapidast-scan:/opt/rapidast/results ./results
docker rm rapidast-scan
```

### No Scan Results Found

If workflow completes but no results:

1. Check RapiDAST logs for errors
2. Verify HAR file was generated: `ls -lh mcp-requests.har`
3. Verify HAR file has entries: `jq '.log.entries | length' mcp-requests.har`
4. Check results directory exists: `ls -R results/`

## Security Considerations

⚠️ **Important**: The mock AAP server is for testing only and should never be used in production.

The mock server:

- Does not validate tokens
- Always returns the same user data
- Should only be used in controlled test environments
- Is not suitable for testing authentication mechanisms themselves

For real security testing of authentication, use a real AAP instance.

## Further Reading

- [RapiDAST Implementation Journey](./rapidast-implementation-journey.md) - Complete evolution and technical decisions
- [RapiDAST Repository](https://github.com/RedHatProductSecurity/rapidast)
- [RapiDAST Configuration](https://github.com/RedHatProductSecurity/rapidast/tree/development/config)
- [OWASP ZAP](https://www.zaproxy.org/)
- [HAR Format Specification](http://www.softwareishard.com/blog/har-12-spec/)
