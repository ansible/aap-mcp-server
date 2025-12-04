# MCP Security Scanning

This repository includes automated security scanning for all MCP server endpoints using the [MCP Security Scanner](https://github.com/sidhpurwala-huzaifa/mcp-security-scanner).

## Overview

The security scan runs automatically and tests all configured toolsets against a comprehensive security checklist covering authentication, authorization, transport security, tool safety, resource access control, and more.

## When Scans Run

The security scan runs:

- **Daily** at 2 AM UTC via scheduled cron job
- **On-demand** via manual workflow dispatch

## How It Works

### 1. Dynamic Endpoint Discovery

The workflow automatically discovers all MCP endpoints from your `aap-mcp.sample.yaml` configuration file:

```yaml
toolsets:
  job_management:
    - controller.job_templates_launch_create
    ...
  inventory_management:
    - controller.inventories_list
    ...
```

Each toolset becomes a separate security scan job, allowing for:

- Parallel execution for faster results
- Independent results per endpoint
- Easy identification of which endpoints have issues

### 2. Test Environment Setup

For each endpoint, the workflow:

1. Starts a mock AAP server (on port 8080)
2. Starts the MCP server (on port 3000)
3. Configures authentication with a test token
4. Verifies both servers are healthy

### 3. Security Scanning

The [MCP Security Scanner](https://github.com/sidhpurwala-huzaifa/mcp-security-scanner) performs comprehensive security tests based on the [MCP Security Checklist](https://github.com/sidhpurwala-huzaifa/mcp-security-scanner/blob/main/src/mcp_scanner/scanner_specs.schema).

The scanner tests multiple security categories including:

- Transport security (TLS, origin validation, session handling)
- Authentication and authorization
- Tool safety and input validation
- Resource access control
- Known vulnerability patterns

For the complete list of security checks and their criteria, see the [Scanner Specification Schema](https://github.com/sidhpurwala-huzaifa/mcp-security-scanner/blob/main/src/mcp_scanner/scanner_specs.schema).

### 4. Enhanced Reporting

The workflow enriches scan results with detailed context from the scanner's specification schema, providing:

- **What was detected**: Description of the security issue
- **Test steps**: Detailed explanation of what was tested
- **Pass criteria**: What would make the test pass
- **Fail criteria**: What makes the test fail
- **Actual result**: What the scanner observed
- **Remediation**: Step-by-step guidance to fix the issue
- **References**: Links to relevant documentation

## Viewing Results

### GitHub Actions Summary

Each scan job provides a detailed summary visible in the GitHub Actions UI:

#### Summary Section

- Counts by severity (Critical, High, Medium, Low)
- Pass/fail statistics
- Overall status indicator

#### Failed Security Checks Section

For each failed check, you'll see:

- **Severity emoji** (🔴 Critical, 🟠 High, 🟡 Medium, 🔵 Low, ⚪ Info)
- **Check ID and title**
- **Category** (transport, authz, tools, resources, etc.)
- **What was detected**: Description of the security issue being tested
- **Test steps**: Detailed explanation of what the scanner did
- **Pass criteria**: What would make the test pass
- **Fail criteria**: What makes the test fail
- **Actual result**: What the scanner observed in your server
- **Remediation**: Step-by-step guidance to fix the issue

#### Full Scan Results (Collapsible)

All checks (passed and failed) sorted by severity, with enriched context.

### Downloadable Artifacts

Each scan produces downloadable artifacts containing:

- **JSON report**: Machine-readable scan results
- Named as: `mcp-security-scan-results-{toolset_name}`
- Retained for 30 days

## Understanding Scan Results

### Severity Levels

Results are categorized by severity with color-coded indicators:

- 🔴 **Critical**: Severe security vulnerabilities requiring immediate attention
- 🟠 **High**: Significant security issues that should be addressed promptly
- 🟡 **Medium**: Moderate security concerns
- 🔵 **Low**: Minor security improvements
- ⚪ **Info**: Informational findings

### Result Interpretation

- **✅ Passed**: The security check passed successfully
- **❌ Failed**: A security issue was detected

## Running Scans Manually

### Via GitHub Actions UI

1. Navigate to **Actions** tab in GitHub
2. Select **MCP Security Scan** workflow
3. Click **Run workflow**
4. Select branch and click **Run workflow**

### Locally (for development)

```bash
# 1. Start mock AAP server
npx tsx scripts/mock-aap-server.ts &

# 2. Start MCP server
export BASE_URL=http://localhost:8080
export BEARER_TOKEN_OAUTH2_AUTHENTICATION=test-token
export MCP_PORT=3000
npm start &

# 3. Install and run scanner
git clone https://github.com/sidhpurwala-huzaifa/mcp-security-scanner.git /tmp/mcp-scanner
cd /tmp/mcp-scanner
pip install -r requirements.txt
pip install -e .

# 4. Run scan
mcp-scan scan \
  --url http://localhost:3000/mcp/job_management \
  --transport http \
  --auth-type bearer \
  --auth-token test-token \
  --format json \
  --output scan-report.json
```

## Addressing Findings

### Priority Approach

1. **Fix Critical findings first** (🔴)
   - These represent severe vulnerabilities
   - Often authentication or authorization bypasses

2. **Address High severity issues** (🟠)
   - Significant security weaknesses
   - May allow unauthorized access or data exposure

3. **Review Medium and Low findings** (🟡 🔵)
   - Security hardening opportunities
   - Defense-in-depth improvements

### Testing Fixes

After implementing fixes:

1. Run the scan locally to verify the fix
2. Push changes and trigger the workflow manually
3. Review the updated scan results
4. Ensure the previously failed check now passes

## Configuration

### Adding New Toolsets

When you add a new toolset to `aap-mcp.sample.yaml`, it will automatically be included in security scans:

```yaml
toolsets:
  # Existing toolsets...

  # New toolset - will be scanned automatically
  custom_workflows:
    - controller.workflow_job_templates_list
    - controller.workflow_jobs_create
```

### Excluding Toolsets from Scans

To exclude a toolset from scanning, comment it out in `aap-mcp.sample.yaml`:

```yaml
toolsets:
  job_management:
    - controller.jobs_list

  # This toolset will not be scanned
  # experimental_features:
  #   - controller.experimental_tool
```

## Troubleshooting

### Scan Failures

If the entire scan job fails (not just individual checks):

1. **Check server startup**: Review "Wait for MCP server" step logs
2. **Verify dependencies**: Ensure mock server and MCP server are running
3. **Review logs**: Check "Display scan summary" step for errors

### Missing Results

If scan results don't appear in the summary:

1. **Check JSON report generation**: Look for `scan-report.json` in artifacts
2. **Review jq parsing**: Errors in summary generation step may indicate JSON structure issues
3. **Verify spec schema**: Ensure scanner spec schema was copied correctly

### Simplified Results Warning

If you see a warning message like:

> ⚠️ **Note**: Unable to load scanner specification schema for detailed context enrichment.

This means the workflow couldn't load the enhanced test details from the scanner's specification schema. The results will still show:

- Severity and category
- Pass/fail status
- Details from the scan
- Remediation steps

But won't include:

- "What was detected" descriptions
- Detailed test steps
- Pass/fail criteria

**Cause**: The scanner's specification file structure may have changed or the file wasn't found.

**Impact**: Results are still valid and actionable, just less detailed.

**Solution**: Check the scanner installation step logs. If this persists, results are still usable - refer to the [Scanner Specification](https://github.com/sidhpurwala-huzaifa/mcp-security-scanner/blob/main/src/mcp_scanner/scanner_specs.schema) for full test details.

### False Positives

If a check fails but you believe it's incorrect:

1. Review the **Test steps** to understand what was tested
2. Check the **Actual result** to see what the scanner observed
3. Compare against **Pass criteria** and **Fail criteria**
4. If the test is not applicable to your setup, document why in your security review

## References

- [MCP Security Scanner](https://github.com/sidhpurwala-huzaifa/mcp-security-scanner)
- [MCP Security Checklist](https://github.com/sidhpurwala-huzaifa/mcp-security-scanner/blob/main/src/mcp_scanner/scanner_specs.schema)
- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/concepts/security)
