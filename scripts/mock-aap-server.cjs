#!/usr/bin/env node

/**
 * Mock AAP Server for Testing
 *
 * This script creates a minimal mock of AAP endpoints needed for
 * authentication and testing. It's designed to be used in CI/CD
 * pipelines and local testing without requiring a real AAP instance.
 *
 * Usage:
 *   node scripts/mock-aap-server.js [port]
 *
 * Environment Variables:
 *   MOCK_AAP_PORT - Port to listen on (default: 8080)
 */

const http = require('http');

const PORT = process.env.MOCK_AAP_PORT || process.argv[2] || 8080;

// Mock user data returned by /api/gateway/v1/me/
const mockUserData = {
  id: 1,
  username: "test-user",
  email: "test@example.com",
  is_superuser: true,
  is_platform_auditor: false,
  first_name: "Test",
  last_name: "User"
};

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const logPrefix = `[${new Date().toISOString()}] ${req.method} ${req.url}`;

  // Mock /api/gateway/v1/me/ endpoint
  if (req.url === '/api/gateway/v1/me/') {
    console.log(`${logPrefix} - Returning mock user data`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockUserData));
    return;
  }

  // Mock health check endpoint
  if (req.url === '/health' || req.url === '/api/health/') {
    console.log(`${logPrefix} - Health check OK`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'mock-aap' }));
    return;
  }

  // Return 404 for any other endpoint
  console.log(`${logPrefix} - Not found`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not Found',
    message: `Mock AAP server does not implement ${req.url}`,
    available_endpoints: [
      '/api/gateway/v1/me/',
      '/health'
    ]
  }));
});

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('Mock AAP Server Started');
  console.log('='.repeat(60));
  console.log(`Listening on: http://localhost:${PORT}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  • GET  /api/gateway/v1/me/  - Mock user authentication`);
  console.log(`  • GET  /health              - Health check`);
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('Mock AAP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('Mock AAP server closed');
    process.exit(0);
  });
});
