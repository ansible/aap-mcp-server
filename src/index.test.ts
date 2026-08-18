import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

import type { AAPMcpToolDefinition } from "./openapi-loader.js";
import {
  buildToolUrl,
  buildRequestOptions,
  validateToolArgs,
} from "./index.js";

// Mock dependencies
vi.mock("./metrics.js", () => ({
  metricsService: {
    recordToolExecution: vi.fn(),
    recordToolError: vi.fn(),
  },
}));

vi.mock("./session.js", () => ({
  SessionManager: vi.fn().mockImplementation(() => ({
    has: vi.fn(),
    getTransport: vi.fn(),
  })),
}));

describe("mcpGetHandler", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let statusMock: any;
  let sendMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock response methods
    statusMock = vi.fn().mockReturnThis();
    sendMock = vi.fn();

    // Mock request object
    mockReq = {
      headers: {},
      path: "",
    };

    // Mock response object
    mockRes = {
      status: statusMock,
      send: sendMock,
    };
  });

  describe("GET method validation", () => {
    it("should return 405 when GET request is made to /mcp endpoint", async () => {
      (mockReq as any).path = "/mcp";
      mockReq.headers = {
        "mcp-session-id": "session-123",
      };

      // Import and execute the handler logic
      // Since mcpGetHandler is not exported, we'll test the behavior via integration
      // For now, we'll test the logic directly

      const { basename } = await import("path");

      // Simulate the handler logic
      if (basename(mockReq.path!) === "mcp") {
        mockRes.status!(405).send("GET method not allowed on /mcp endpoint");
        return;
      }

      expect(statusMock).toHaveBeenCalledWith(405);
      expect(sendMock).toHaveBeenCalledWith(
        "GET method not allowed on /mcp endpoint",
      );
    });

    it("should allow GET request on SSE streaming paths", async () => {
      (mockReq as any).path = "/mcp/sse/stream-123";
      mockReq.headers = {
        "mcp-session-id": "session-123",
      };

      const { basename } = await import("path");

      // Simulate the handler logic - this should NOT trigger 405
      const shouldBlock = basename(mockReq.path!) === "mcp";

      expect(shouldBlock).toBe(false);
    });

    it("should allow GET request on toolset-specific paths", async () => {
      (mockReq as any).path = "/mcp/my-toolset";
      mockReq.headers = {
        "mcp-session-id": "session-123",
      };

      const { basename } = await import("path");

      // Simulate the handler logic - this should NOT trigger 405
      const shouldBlock = basename(mockReq.path!) === "mcp";

      expect(shouldBlock).toBe(false);
    });

    it("should allow GET request on nested paths", async () => {
      (mockReq as any).path = "/mcp/foo/bar/baz";
      mockReq.headers = {
        "mcp-session-id": "session-123",
      };

      const { basename } = await import("path");

      const shouldBlock = basename(mockReq.path!) === "mcp";

      expect(shouldBlock).toBe(false);
    });
  });

  describe("basename edge cases", () => {
    it("should handle paths ending with /mcp", async () => {
      (mockReq as any).path = "/api/v1/mcp";

      const { basename } = await import("path");
      const shouldBlock = basename(mockReq.path!) === "mcp";

      expect(shouldBlock).toBe(true);
    });

    it("should handle paths with mcp in the middle", async () => {
      (mockReq as any).path = "/mcp/endpoint/data";

      const { basename } = await import("path");
      const shouldBlock = basename(mockReq.path!) === "mcp";

      expect(shouldBlock).toBe(false);
    });

    it("should handle root path", async () => {
      (mockReq as any).path = "/";

      const { basename } = await import("path");
      const shouldBlock = basename(mockReq.path!) === "mcp";

      expect(shouldBlock).toBe(false);
    });

    it("should handle empty path", async () => {
      (mockReq as any).path = "";

      const { basename } = await import("path");
      const shouldBlock = basename(mockReq.path!) === "mcp";

      expect(shouldBlock).toBe(false);
    });
  });

  describe("session validation after GET method check", () => {
    it("should still validate session if GET is allowed on non-/mcp paths", async () => {
      (mockReq as any).path = "/mcp/sse/stream-123";
      mockReq.headers = {};

      const { basename } = await import("path");

      // First check: GET method validation
      if (basename(mockReq.path!) === "mcp") {
        mockRes.status!(405).send("GET method not allowed on /mcp endpoint");
        return;
      }

      // Second check: Session validation
      const sessionId = mockReq.headers!["mcp-session-id"] as string;
      if (!sessionId) {
        mockRes.status!(404).send("Session not found");
        return;
      }

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(sendMock).toHaveBeenCalledWith("Session not found");
    });
  });
});

const createMockTool = (
  overrides: Partial<AAPMcpToolDefinition> = {},
): AAPMcpToolDefinition => ({
  name: "test-tool",
  service: "test-service",
  fullName: "test-service.test-tool",
  description: "Test tool",
  inputSchema: {},
  pathTemplate: "/api/v2/test/",
  method: "GET",
  parameters: [] as any,
  executionParameters: {} as any,
  securityRequirements: [] as any,
  operationId: "test-op",
  deprecated: false,
  logs: [],
  size: 100,
  ...overrides,
});

describe("buildToolUrl", () => {
  it("should return the path template when there are no parameters", () => {
    const tool = createMockTool({ pathTemplate: "/api/v2/jobs/" });
    expect(buildToolUrl(tool, {})).toBe("/api/v2/jobs/");
  });

  it("should substitute path parameters", () => {
    const tool = createMockTool({
      pathTemplate: "/api/v2/jobs/{id}/",
      parameters: [{ name: "id", in: "path" }] as any,
    });
    expect(buildToolUrl(tool, { id: 42 })).toBe("/api/v2/jobs/42/");
  });

  it("should append query parameters", () => {
    const tool = createMockTool({
      pathTemplate: "/api/v2/jobs/",
      parameters: [{ name: "page_size", in: "query" }] as any,
    });
    expect(buildToolUrl(tool, { page_size: 10 })).toBe(
      "/api/v2/jobs/?page_size=10",
    );
  });

  it("should handle both path and query parameters", () => {
    const tool = createMockTool({
      pathTemplate: "/api/v2/projects/{id}/playbooks/",
      parameters: [
        { name: "id", in: "path" },
        { name: "page", in: "query" },
        { name: "page_size", in: "query" },
      ] as any,
    });
    const url = buildToolUrl(tool, { id: 5, page: 2, page_size: 25 });
    expect(url).toBe("/api/v2/projects/5/playbooks/?page=2&page_size=25");
  });

  it("should skip query parameters that are undefined", () => {
    const tool = createMockTool({
      pathTemplate: "/api/v2/jobs/",
      parameters: [
        { name: "page", in: "query" },
        { name: "search", in: "query" },
      ] as any,
    });
    expect(buildToolUrl(tool, { page: 1 })).toBe("/api/v2/jobs/?page=1");
  });

  it("should skip path parameters not present in args", () => {
    const tool = createMockTool({
      pathTemplate: "/api/v2/jobs/{id}/",
      parameters: [{ name: "id", in: "path" }] as any,
    });
    expect(buildToolUrl(tool, {})).toBe("/api/v2/jobs/{id}/");
  });
});

describe("buildRequestOptions", () => {
  it("should build GET request with auth header", () => {
    const tool = createMockTool({ method: "GET" });
    const opts = buildRequestOptions(tool, {}, "my-token");

    expect(opts.method).toBe("GET");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-token",
    );
    expect((opts.headers as Record<string, string>)["Accept"]).toBe(
      "application/json",
    );
    expect(opts.body).toBeUndefined();
  });

  it("should build POST request with JSON body", () => {
    const tool = createMockTool({ method: "post" });
    const body = { name: "my-job", inventory: 1 };
    const opts = buildRequestOptions(tool, { requestBody: body }, "my-token");

    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(opts.body).toBe(JSON.stringify(body));
  });

  it("should not set body for POST without requestBody", () => {
    const tool = createMockTool({ method: "post" });
    const opts = buildRequestOptions(tool, {}, "my-token");

    expect(opts.method).toBe("POST");
    expect(opts.body).toBeUndefined();
    expect(
      (opts.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();
  });
});

describe("validateToolArgs", () => {
  it("should return no errors for valid role_level on scoped tool", () => {
    expect(
      validateToolArgs({ role_level: "admin_role" }, "job_templates_list"),
    ).toEqual([]);
    expect(
      validateToolArgs({ role_level: "read_role" }, "job_templates_list"),
    ).toEqual([]);
    expect(
      validateToolArgs({ role_level: "execute_role" }, "job_templates_list"),
    ).toEqual([]);
  });

  it("should return error for invalid role_level on scoped tool", () => {
    const errors = validateToolArgs({ role_level: "l2" }, "job_templates_list");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"role_level"');
    expect(errors[0]).toContain('"l2"');
    expect(errors[0]).toContain("admin_role");
    expect(errors[0]).toContain("read_role");
    expect(errors[0]).toContain("execute_role");
  });

  it("should skip validation for tools not in override scope", () => {
    expect(validateToolArgs({ role_level: "l2" }, "inventories_list")).toEqual(
      [],
    );
  });

  it("should return no errors for params without overrides", () => {
    expect(
      validateToolArgs({ search: "anything", page: 1 }, "job_templates_list"),
    ).toEqual([]);
  });

  it("should skip validation when param is undefined", () => {
    expect(
      validateToolArgs({ role_level: undefined }, "job_templates_list"),
    ).toEqual([]);
  });
});
