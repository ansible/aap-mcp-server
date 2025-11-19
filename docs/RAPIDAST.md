# RapiDAST Security Scanning

This document describes how to use RapiDAST to perform security scanning of the AAP MCP Server.

## Overview

RapiDAST (Rapid DAST) from Red Hat Product Security is used to scan the MCP server for security vulnerabilities. Since the MCP server requires authentication against AAP endpoints, we use a mock AAP server to enable scanning without requiring a real AAP instance.

RapiDAST runs in an official Red Hat container and uses ZAP (OWASP Zed Attack Proxy) for security scanning.

## Components

### 1. Mock AAP Server (`scripts/mock-aap-server.cjs`)

A minimal HTTP server that mocks essential AAP authentication endpoints:
- `GET /api/gateway/v1/me/` - Returns mock user data for authentication
- `GET /health` - Health check endpoint

### 2. RapiDAST Configuration (`rapidast-config.yml`)

Defines the scan configuration including:
- Target URL (MCP server)
- Authentication method (Bearer token)
- Scanner settings (ZAP)
- Spider configuration for endpoint discovery
- Active and passive scanning options

### 3. GitHub Workflow (`.github/workflows/rapidast.yml`)

Automated security scanning workflow that:
1. Runs in the official Red Hat RapiDAST container (`quay.io/redhatproductsecurity/rapidast:latest`)
2. Starts the mock AAP server
3. Starts the MCP server configured to use the mock AAP
4. Executes `rapidast.py` with the configuration
5. Uploads results as artifacts

## Running Locally

### Prerequisites

- Node.js 18.x or higher
- Docker (for running RapiDAST container)
- curl (for health checks)

### Using Docker (Recommended)

1. Start the mock AAP and MCP servers using the helper script:
```bash
./scripts/run-with-mock-aap.sh
```

2. In another terminal, run RapiDAST in the official container:
```bash
docker run --rm \
  --network host \
  -v $(pwd):/opt/rapidast/work:Z \
  quay.io/redhatproductsecurity/rapidast:latest \
  rapidast.py --config /opt/rapidast/work/rapidast-config.yml
```

3. View the results:
```bash
# Results will be in results/*/*/zap/
open results/*/*/zap/zap-report.html
```

### Manual Setup

If you prefer to run the servers separately:

1. Start the mock AAP server:
```bash
node scripts/mock-aap-server.cjs
# Or specify a custom port:
MOCK_AAP_PORT=9000 node scripts/mock-aap-server.cjs
```

2. In another terminal, start the MCP server:
```bash
BASE_URL=http://localhost:8080 \
BEARER_TOKEN_OAUTH2_AUTHENTICATION=test-token \
npm start
```

3. Run RapiDAST in Docker:
```bash
docker run --rm \
  --network host \
  -v $(pwd):/opt/rapidast/work:Z \
  quay.io/redhatproductsecurity/rapidast:latest \
  rapidast.py --config /opt/rapidast/work/rapidast-config.yml
```

## Running in GitHub Actions

The RapiDAST scan is configured as a manually-triggered workflow:

1. Go to the "Actions" tab in your GitHub repository
2. Select "RapiDAST Security Scan" from the workflows list
3. Click "Run workflow"
4. (Optional) Customize scan policy:
   - **Scan Policy**: Choose between `API-scan-minimal` (default) or `Default-Policy`

The workflow will:
- Build and start the servers in the GitHub Actions environment
- Run the security scan using the official Red Hat RapiDAST container
- Upload results as artifacts
- Display a summary of findings in the workflow run

## Viewing Results

### GitHub Actions

After a workflow run completes:
1. Go to the workflow run page
2. Scroll to the "Artifacts" section
3. Download the "rapidast-results" artifact
4. Extract and view the reports

The artifact contains:
- `results/*/*/zap/zap-report.json` - Detailed JSON report
- `results/*/*/zap/zap-report.html` - Human-readable HTML report
- `results/*/*/zap/zap-report.xml` - XML report for CI/CD integration

### Local Scans

Results are stored in the `results/` directory with the structure:
```
results/
  └── <timestamp>/
      └── <scan-name>/
          └── zap/
              ├── zap-report.json
              ├── zap-report.html
              └── zap-report.xml
```

## Configuration

### Scan Policies

The workflow supports two ZAP scan policies:
- **API-scan-minimal** (default): Fast, minimal scanning suitable for APIs
- **Default-Policy**: Full OWASP ZAP scanning policy (more comprehensive but slower)

### Configuration Schema

The `rapidast-config.yml` file uses Red Hat's official configuration schema (v6) with these main sections:

```yaml
config:
  configVersion: 6  # Schema version

application:
  shortName: "aap-mcp-server"
  url: "http://host.docker.internal:3000"

general:
  authentication:
    type: "http_header"
    parameters:
      name: "Authorization"
      value: "Bearer test-token"

scanners:
  zap:
    apiScan: { ... }
    passiveScan: { ... }
    activeScan: { ... }
    spider: { ... }
```

### Customizing the Configuration

Edit `rapidast-config.yml` to:
- Modify spider duration and seed URLs
- Enable/disable specific ZAP scanning rules
- Change authentication settings
- Adjust active/passive scan policies

See the [RapiDAST configuration documentation](https://github.com/RedHatProductSecurity/rapidast/tree/development/config) for more options.

## Troubleshooting

### Mock AAP Server Won't Start

Check if port 8080 is already in use:
```bash
lsof -i :8080
```

Use a different port:
```bash
MOCK_AAP_PORT=9000 node scripts/mock-aap-server.cjs
```

### MCP Server Authentication Fails

Ensure:
1. Mock AAP server is running and accessible
2. `BASE_URL` environment variable points to the mock AAP server
3. A bearer token is provided (any value works with the mock)

### Docker Networking Issues

If running RapiDAST in Docker and it can't reach the MCP server:

- On Linux: Use `--network host` to share the host's network
- On Mac/Windows: Use `host.docker.internal` instead of `localhost` in the config
- Check that both servers are running: `curl http://localhost:3000/api/v1/health`

### Container Permission Issues

If you get permission errors with Docker:
```bash
# Add :Z flag for SELinux contexts (Linux)
docker run --rm -v $(pwd):/opt/rapidast/work:Z ...

# Or run without volume mount and copy results after
docker run --name rapidast-scan ...
docker cp rapidast-scan:/opt/rapidast/results ./results
docker rm rapidast-scan
```

## Security Considerations

⚠️ **Important**: The mock AAP server is for testing only and should never be used in production. It accepts any bearer token and returns fixed user data.

The mock server:
- Does not validate tokens
- Always returns the same user data
- Should only be used in controlled test environments
- Is not suitable for security testing of authentication mechanisms

## Further Reading

- [RapiDAST Repository](https://github.com/RedHatProductSecurity/rapidast)
- [RapiDAST GitHub Actions Example](https://github.com/RedHatProductSecurity/rapidast/tree/development/examples/github)
- [OWASP ZAP](https://www.zaproxy.org/)
- [DAST Best Practices](https://owasp.org/www-community/controls/Dynamic_Application_Security_Testing)
