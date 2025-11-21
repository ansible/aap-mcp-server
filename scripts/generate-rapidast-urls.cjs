#!/usr/bin/env node

/**
 * Generate RapiDAST seed URLs from MCP server configuration
 *
 * This script reads the aap-mcp.yaml configuration and generates
 * a list of all API endpoints that should be scanned by RapiDAST.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const CONFIG_FILE = process.env.CONFIG_FILE || 'aap-mcp.yaml';
const OUTPUT_FILE = process.env.OUTPUT_FILE || 'rapidast-urls.txt';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function generateUrls() {
  // Read the configuration file
  let config;
  try {
    const configPath = path.join(process.cwd(), CONFIG_FILE);
    const configContent = fs.readFileSync(configPath, 'utf8');
    config = yaml.parse(configContent);
  } catch (error) {
    console.error(`Error reading config file ${CONFIG_FILE}:`, error.message);
    process.exit(1);
  }

  const urls = new Set();

  // Production-only endpoints
  // Health check endpoint (always available in production)
  urls.add(`${BASE_URL}/api/v1/health`);

  // Main MCP endpoint (primary production endpoint)
  urls.add(`${BASE_URL}/mcp`);

  // Category-based MCP endpoints (production API routes)
  if (config.categories) {
    Object.keys(config.categories).forEach(category => {
      if (config.categories[category].enabled !== false) {
        // Both MCP endpoint formats for each category
        urls.add(`${BASE_URL}/${category}/mcp`);
        urls.add(`${BASE_URL}/mcp/${category}`);
      }
    });
  }

  // Note: Excluding informational/UI endpoints that are not available in production:
  // - /tools, /tools/:name
  // - /services, /services/:name
  // - /category, /category/:name
  // - /endpoints
  // These are development/documentation endpoints only

  return Array.from(urls).sort();
}

// Generate URLs
const urls = generateUrls();

// Write to file
const outputPath = path.join(process.cwd(), OUTPUT_FILE);
fs.writeFileSync(outputPath, urls.join('\n') + '\n', 'utf8');

console.log(`Generated ${urls.length} URLs for RapiDAST scanning`);
console.log(`URLs written to: ${outputPath}`);
console.log('\nSample URLs:');
urls.slice(0, 10).forEach(url => console.log(`  ${url}`));
if (urls.length > 10) {
  console.log(`  ... and ${urls.length - 10} more`);
}
