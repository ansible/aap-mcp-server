#!/usr/bin/env node
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const BEARER_TOKEN = 'test-token';

// Initialize session first
function initSession() {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' }
      }
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/mcp/developer_testing',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = http.request(options, (res) => {
      const sessionId = res.headers['mcp-session-id'];
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(sessionId));
    });

    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

// Get tools list
function getTools(sessionId) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/mcp/developer_testing',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'Mcp-Session-Id': sessionId,
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        // Parse SSE format
        const lines = body.split('\n');
        const dataLine = lines.find(l => l.startsWith('data: '));
        if (dataLine) {
          const json = JSON.parse(dataLine.substring(6));
          resolve(json.tools || json.result?.tools || []);
        } else {
          resolve([]);
        }
      });
    });

    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

async function main() {
  try {
    const sessionId = await initSession();
    console.log(`Session ID: ${sessionId}\n`);

    const tools = await getTools(sessionId);
    console.log(`Total tools: ${tools.length}\n`);
    console.log('Tool names:');
    tools.forEach((tool, i) => {
      console.log(`${i + 1}. ${tool.name}`);
    });
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
