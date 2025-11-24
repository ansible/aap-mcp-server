#!/usr/bin/env tsx

/**
 * Enhanced Mock AAP Server for Security Testing
 *
 * This script creates a comprehensive mock of AAP endpoints that returns
 * realistic responses for security scanning. It supports:
 * - Authentication endpoints
 * - Controller API (jobs, workflows, inventories, etc.)
 * - Gateway API (users, RBAC, etc.)
 * - Galaxy API (collections, content)
 * - EDA API (rulebooks, activations)
 *
 * Usage:
 *   tsx scripts/mock-aap-server.ts [port]
 *
 * Environment Variables:
 *   MOCK_AAP_PORT - Port to listen on (default: 8080)
 */

import http from "node:http";
import { parse as parseUrl } from "node:url";

const PORT = process.env.MOCK_AAP_PORT || process.argv[2] || 8080;

// Mock user data returned by /api/gateway/v1/me/
const mockUserData = {
  id: 1,
  username: "test-user",
  email: "test@example.com",
  is_superuser: true,
  is_platform_auditor: false,
  first_name: "Test",
  last_name: "User",
};

interface PaginatedResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: unknown[];
}

interface MockResource {
  id: number;
  type: string;
  url: string;
  created: string;
  modified: string;
  [key: string]: unknown;
}

/**
 * Generate a realistic paginated list response
 */
function generatePaginatedResponse(
  resourceType: string,
  page = 1,
  pageSize = 25,
): PaginatedResponse {
  const results: MockResource[] = [];
  const count = 3; // Return 3 mock items

  for (let i = 1; i <= count; i++) {
    const id = (page - 1) * pageSize + i;
    results.push(generateMockResource(resourceType, id));
  }

  return {
    count: count,
    next: null,
    previous: null,
    results: results,
  };
}

/**
 * Generate a mock resource based on type
 */
function generateMockResource(resourceType: string, id = 1): MockResource {
  const baseResource: MockResource = {
    id: id,
    type: resourceType,
    url: `/api/v2/${resourceType}/${id}/`,
    created: "2024-01-01T00:00:00.000000Z",
    modified: "2024-01-01T00:00:00.000000Z",
  };

  // Resource-specific fields
  const resourceFields: Record<string, Record<string, unknown>> = {
    job: {
      name: `Test Job ${id}`,
      status: "successful",
      started: "2024-01-01T00:00:00.000000Z",
      finished: "2024-01-01T00:01:00.000000Z",
      elapsed: 60.0,
      job_type: "run",
      inventory: id,
      project: id,
      playbook: "site.yml",
    },
    inventory: {
      name: `Test Inventory ${id}`,
      description: `Mock inventory ${id}`,
      organization: id,
      kind: "",
      host_filter: null,
      variables: "---",
      has_active_failures: false,
      total_hosts: 10,
      hosts_with_active_failures: 0,
      total_groups: 2,
      has_inventory_sources: false,
      total_inventory_sources: 0,
      inventory_sources_with_failures: 0,
    },
    project: {
      name: `Test Project ${id}`,
      description: `Mock project ${id}`,
      scm_type: "git",
      scm_url: "https://github.com/ansible/ansible-examples.git",
      scm_branch: "main",
      scm_clean: false,
      scm_delete_on_update: false,
      status: "successful",
      organization: id,
    },
    workflow_job: {
      name: `Test Workflow Job ${id}`,
      status: "successful",
      started: "2024-01-01T00:00:00.000000Z",
      finished: "2024-01-01T00:05:00.000000Z",
      elapsed: 300.0,
      workflow_job_template: id,
    },
    user: {
      username: `user${id}`,
      first_name: `First${id}`,
      last_name: `Last${id}`,
      email: `user${id}@example.com`,
      is_superuser: false,
      is_system_auditor: false,
    },
    organization: {
      name: `Test Organization ${id}`,
      description: `Mock organization ${id}`,
      max_hosts: 0,
      custom_virtualenv: null,
    },
    collection: {
      namespace: `namespace${id}`,
      name: `collection${id}`,
      version: "1.0.0",
      description: `Mock collection ${id}`,
    },
    rulebook: {
      name: `Test Rulebook ${id}`,
      description: `Mock rulebook ${id}`,
      rulesets: "---",
      project: id,
    },
    activation: {
      name: `Test Activation ${id}`,
      description: `Mock activation ${id}`,
      status: "running",
      rulebook: id,
      decision_environment: id,
    },
  };

  return {
    ...baseResource,
    ...(resourceFields[resourceType] || { name: `${resourceType} ${id}` }),
  };
}

/**
 * Extract resource type from URL path
 * /api/controller/v2/jobs/ -> "job"
 * /api/controller/v2/jobs/123/ -> "job"
 */
function extractResourceType(pathname: string): string | null {
  const patterns = [
    /\/api\/controller\/v2\/([^/]+)/,
    /\/api\/v2\/([^/]+)/,
    /\/api\/gateway\/v1\/([^/]+)/,
    /\/api\/galaxy\/v3\/([^/]+)/,
    /\/api\/eda\/v1\/([^/]+)/,
  ];

  for (const pattern of patterns) {
    const match = pathname.match(pattern);
    if (match) {
      // Remove trailing 's' for resource type (jobs -> job)
      let resourceType = match[1];
      if (resourceType.endsWith("s") && !resourceType.endsWith("ss")) {
        resourceType = resourceType.slice(0, -1);
      }
      return resourceType;
    }
  }
  return null;
}

/**
 * Check if URL is a detail endpoint (has an ID)
 */
function isDetailEndpoint(pathname: string): boolean {
  return /\/\d+\/?$/.test(pathname);
}

/**
 * Extract ID from detail endpoint
 */
function extractId(pathname: string): number {
  const match = pathname.match(/\/(\d+)\/?$/);
  return match ? parseInt(match[1], 10) : 1;
}

const server = http.createServer(
  (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = parseUrl(req.url || "", true);
    const pathname = parsedUrl.pathname || "";
    const logPrefix = `[${new Date().toISOString()}] ${req.method} ${pathname}`;

    // ===== Authentication Endpoints =====

    // Mock /api/gateway/v1/me/ endpoint
    if (pathname === "/api/gateway/v1/me/") {
      console.log(`${logPrefix} - Returning mock user data`);
      res.writeHead(200, { "Content-Type": "application/json" });
      // MCP server expects results array format
      res.end(JSON.stringify({ results: [mockUserData] }));
      return;
    }

    // ===== Health Check Endpoints =====

    if (pathname === "/health" || pathname === "/api/health/") {
      console.log(`${logPrefix} - Health check OK`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "mock-aap" }));
      return;
    }

    // ===== Generic AAP API Endpoints =====

    const resourceType = extractResourceType(pathname);
    if (resourceType) {
      // Handle different HTTP methods
      if (req.method === "GET") {
        if (isDetailEndpoint(pathname)) {
          // Detail view - return single resource
          const id = extractId(pathname);
          console.log(
            `${logPrefix} - Returning mock ${resourceType} detail (id=${id})`,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(generateMockResource(resourceType, id)));
        } else {
          // List view - return paginated results
          const page = parseInt((parsedUrl.query.page as string) || "1", 10);
          const pageSize = parseInt(
            (parsedUrl.query.page_size as string) || "25",
            10,
          );
          console.log(
            `${logPrefix} - Returning mock ${resourceType} list (page=${page})`,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              generatePaginatedResponse(resourceType, page, pageSize),
            ),
          );
        }
        return;
      }

      if (req.method === "POST") {
        // Create - return 201 with created resource
        console.log(`${logPrefix} - Mock creating ${resourceType}`);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(generateMockResource(resourceType, 999)));
        return;
      }

      if (req.method === "PATCH" || req.method === "PUT") {
        // Update - return 200 with updated resource
        const id = extractId(pathname);
        console.log(`${logPrefix} - Mock updating ${resourceType} (id=${id})`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(generateMockResource(resourceType, id)));
        return;
      }

      if (req.method === "DELETE") {
        // Delete - return 204 No Content
        const id = extractId(pathname);
        console.log(`${logPrefix} - Mock deleting ${resourceType} (id=${id})`);
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // ===== Root API Endpoints =====

    if (
      pathname === "/api/" ||
      pathname === "/api/v2/" ||
      pathname === "/api/controller/v2/"
    ) {
      console.log(`${logPrefix} - Returning root API response`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          current_version: "/api/v2/",
          available_versions: {
            v2: "/api/v2/",
          },
          description: "Mock AAP API",
        }),
      );
      return;
    }

    // ===== Fallback =====

    console.log(
      `${logPrefix} - Not implemented (returning 200 with empty result)`,
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        detail: "Mock endpoint - functionality not implemented",
        results: [],
      }),
    );
  },
);

server.listen(Number(PORT), () => {
  console.log("=".repeat(60));
  console.log("Enhanced Mock AAP Server Started");
  console.log("=".repeat(60));
  console.log(`Listening on: http://localhost:${PORT}`);
  console.log("");
  console.log("Supported AAP Services:");
  console.log("  • Controller API - /api/controller/v2/*");
  console.log("  • Gateway API    - /api/gateway/v1/*");
  console.log("  • Galaxy API     - /api/galaxy/v3/*");
  console.log("  • EDA API        - /api/eda/v1/*");
  console.log("");
  console.log("Key Features:");
  console.log("  • Realistic paginated list responses");
  console.log("  • Individual resource detail views");
  console.log("  • Full REST support (GET, POST, PATCH, DELETE)");
  console.log("  • User authentication via /api/gateway/v1/me/");
  console.log("");
  console.log("Press Ctrl+C to stop");
  console.log("=".repeat(60));
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM, shutting down gracefully...");
  server.close(() => {
    console.log("Mock AAP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("\nReceived SIGINT, shutting down gracefully...");
  server.close(() => {
    console.log("Mock AAP server closed");
    process.exit(0);
  });
});
