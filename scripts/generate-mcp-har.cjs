#!/usr/bin/env node

/**
 * Generate HAR file with proper MCP JSON-RPC requests
 *
 * This script:
 * 1. Initializes an MCP session
 * 2. Makes various MCP POST requests with proper JSON-RPC format
 * 3. Exports all requests/responses to a HAR file for ZAP to import
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BEARER_TOKEN = process.env.BEARER_TOKEN_OAUTH2_AUTHENTICATION || 'test-token';
const OUTPUT_FILE = process.argv[2] || 'mcp-requests.har';

// HAR file structure
const har = {
  log: {
    version: '1.2',
    creator: {
      name: 'MCP HAR Generator',
      version: '1.0.0'
    },
    entries: []
  }
};

let mcpSessionId = null;

/**
 * Make an HTTP POST request and capture it in HAR format
 */
function makeRequest(endpoint, jsonrpcRequest) {
  return new Promise((resolve, reject) => {
    const startTime = new Date();

    const requestBody = JSON.stringify(jsonrpcRequest);
    const url = new URL(endpoint, BASE_URL);

    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'Content-Length': Buffer.byteLength(requestBody),
        'User-Agent': 'MCP-HAR-Generator/1.0.0'
      }
    };

    // Add session header if we have one
    if (mcpSessionId) {
      options.headers['Mcp-Session-Id'] = mcpSessionId;
    }

    const req = http.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        const endTime = new Date();
        const duration = endTime - startTime;

        // Capture session ID from response
        if (res.headers['mcp-session-id']) {
          mcpSessionId = res.headers['mcp-session-id'];
          console.log(`[INFO] Captured MCP Session ID: ${mcpSessionId}`);
        }

        // Create HAR entry
        const harEntry = {
          startedDateTime: startTime.toISOString(),
          time: duration,
          request: {
            method: 'POST',
            url: url.href,
            httpVersion: 'HTTP/1.1',
            headers: Object.entries(options.headers).map(([name, value]) => ({
              name,
              value: String(value)
            })),
            queryString: [],
            postData: {
              mimeType: 'application/json',
              text: requestBody
            },
            headersSize: -1,
            bodySize: Buffer.byteLength(requestBody)
          },
          response: {
            status: res.statusCode,
            statusText: res.statusMessage,
            httpVersion: 'HTTP/1.1',
            headers: Object.entries(res.headers).map(([name, value]) => ({
              name,
              value: String(value)
            })),
            content: {
              size: Buffer.byteLength(responseBody),
              mimeType: res.headers['content-type'] || 'application/json',
              text: responseBody
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: Buffer.byteLength(responseBody)
          },
          cache: {},
          timings: {
            send: 0,
            wait: duration,
            receive: 0
          }
        };

        har.log.entries.push(harEntry);

        console.log(`[INFO] ${jsonrpcRequest.method} -> HTTP ${res.statusCode}`);

        resolve({ statusCode: res.statusCode, body: responseBody, headers: res.headers });
      });
    });

    req.on('error', (error) => {
      console.error(`[ERROR] Request failed: ${error.message}`);
      reject(error);
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Generate MCP requests for security scanning
 * Tests all MCP endpoint categories to ensure comprehensive coverage
 */
async function generateMcpRequests() {
  console.log('========================================');
  console.log('MCP HAR Generator Starting');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log('========================================\n');

  // All MCP endpoint categories from aap-mcp.yaml
  const categories = [
    { name: 'job_management', tool: 'controller__jobs_list', params: {} },
    { name: 'inventory_management', tool: 'controller__inventories_list', params: {} },
    { name: 'system_monitoring', tool: 'controller__instance_groups_list', params: {} },
    { name: 'user_management', tool: 'gateway__teams_list', params: {} },
    { name: 'security_compliance', tool: 'controller__credentials_list', params: {} },
    { name: 'platform_configuration', tool: 'controller__settings_list', params: {} },
    { name: 'developer_testing', tool: 'controller__jobs_list', params: {} }
  ];

  try {
    let requestId = 1;

    console.log(`Testing ${categories.length} MCP endpoint categories\n`);

    for (const category of categories) {
      const endpoint = `/mcp/${category.name}`;

      console.log(`[${category.name}] Testing endpoint: ${endpoint}`);

      // 1. Initialize session for this endpoint
      console.log(`  [${requestId}] Initialize session...`);
      await makeRequest(endpoint, {
        jsonrpc: '2.0',
        id: requestId++,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'ZAP-Security-Scanner',
            version: '1.0.0'
          }
        }
      });

      // 2. List tools for this endpoint
      console.log(`  [${requestId}] List tools...`);
      await makeRequest(endpoint, {
        jsonrpc: '2.0',
        id: requestId++,
        method: 'tools/list',
        params: {}
      });

      // 3. Call a representative tool for this category
      console.log(`  [${requestId}] Call tool: ${category.tool}...`);
      await makeRequest(endpoint, {
        jsonrpc: '2.0',
        id: requestId++,
        method: 'tools/call',
        params: {
          name: category.tool,
          arguments: category.params
        }
      });

      console.log('');
    }

    // Save HAR file
    console.log(`[INFO] Saving HAR file to ${OUTPUT_FILE}...`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(har, null, 2));
    console.log(`[SUCCESS] HAR file saved with ${har.log.entries.length} entries`);

    console.log('\n========================================');
    console.log('MCP HAR Generator Completed');
    console.log(`Tested ${categories.length} endpoint categories`);
    console.log(`Generated ${har.log.entries.length} HTTP requests`);
    console.log('========================================');

    return 0;
  } catch (error) {
    console.error(`\n[ERROR] Failed to generate HAR: ${error.message}`);
    console.error(error.stack);
    return 1;
  }
}

// Run the generator
generateMcpRequests()
  .then(code => process.exit(code))
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
