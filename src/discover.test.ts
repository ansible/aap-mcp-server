import { describe, it, expect, vi } from "vitest";
import type { AAPMcpToolDefinition } from "./openapi-loader.js";
import { TOOLSET_DESCRIPTIONS, handleDiscoverTool } from "./discover.js";

const createMockTool = (
  overrides: Partial<AAPMcpToolDefinition> = {},
): AAPMcpToolDefinition => ({
  name: "test-tool",
  service: "test-service",
  fullName: "test-service.test-tool",
  description: "Test tool description",
  inputSchema: { type: "object", properties: { id: { type: "string" } } },
  pathTemplate: "/test/path",
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

describe("handleDiscoverTool", () => {
  const mockExecuteToolRequest = vi.fn();

  const mockToolsets: Record<string, AAPMcpToolDefinition[]> = {
    all: [],
    discover: [],
    job_management: [
      createMockTool({ name: "launch_job", description: "Launch a job" }),
      createMockTool({ name: "list_jobs", description: "List jobs" }),
    ],
    inventory_management: [
      createMockTool({
        name: "list_inventories",
        description: "List inventories",
      }),
    ],
  };

  describe("discover without toolset_name", () => {
    it("should list all toolsets except all and discover", async () => {
      const result = await handleDiscoverTool(
        "discover",
        {},
        mockToolsets,
        mockExecuteToolRequest,
      );

      const toolsets = JSON.parse(result.content[0].text);
      expect(toolsets).toHaveLength(2);

      const names = toolsets.map((t: any) => t.name);
      expect(names).toContain("job_management");
      expect(names).toContain("inventory_management");
      expect(names).not.toContain("all");
      expect(names).not.toContain("discover");
    });

    it("should include descriptions, endpoints, and tool counts", async () => {
      const result = await handleDiscoverTool(
        "discover",
        {},
        mockToolsets,
        mockExecuteToolRequest,
      );

      const toolsets = JSON.parse(result.content[0].text);
      const jobMgmt = toolsets.find((t: any) => t.name === "job_management");
      expect(jobMgmt.tool_count).toBe(2);
      expect(jobMgmt.description).toBe(TOOLSET_DESCRIPTIONS["job_management"]);
      expect(jobMgmt.endpoint).toBe("/mcp/job_management");
    });

    it("should use empty string for toolsets without descriptions", async () => {
      const toolsets = {
        ...mockToolsets,
        custom_toolset: [createMockTool({ name: "custom_tool" })],
      };
      const result = await handleDiscoverTool(
        "discover",
        {},
        toolsets,
        mockExecuteToolRequest,
      );

      const parsed = JSON.parse(result.content[0].text);
      const custom = parsed.find((t: any) => t.name === "custom_toolset");
      expect(custom.description).toBe("");
    });
  });

  describe("discover with toolset_name", () => {
    it("should return full tool definitions for a valid toolset", async () => {
      const result = await handleDiscoverTool(
        "discover",
        { toolset_name: "job_management" },
        mockToolsets,
        mockExecuteToolRequest,
      );

      const tools = JSON.parse(result.content[0].text);
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("launch_job");
      expect(tools[0].description).toBe("Launch a job");
      expect(tools[0].inputSchema).toBeDefined();
    });

    it("should throw for unknown, all, or discover toolset", async () => {
      await expect(
        handleDiscoverTool(
          "discover",
          { toolset_name: "nonexistent" },
          mockToolsets,
          mockExecuteToolRequest,
        ),
      ).rejects.toThrow("Unknown toolset: nonexistent");

      await expect(
        handleDiscoverTool(
          "discover",
          { toolset_name: "all" },
          mockToolsets,
          mockExecuteToolRequest,
        ),
      ).rejects.toThrow("Unknown toolset: all");

      await expect(
        handleDiscoverTool(
          "discover",
          { toolset_name: "discover" },
          mockToolsets,
          mockExecuteToolRequest,
        ),
      ).rejects.toThrow("Unknown toolset: discover");
    });
  });

  describe("call_tool", () => {
    it("should execute a tool via executeToolRequest", async () => {
      const expectedResult = {
        content: [{ type: "text", text: '{"result": "success"}' }],
      };
      mockExecuteToolRequest.mockResolvedValue(expectedResult);

      const result = await handleDiscoverTool(
        "call_tool",
        {
          toolset_name: "job_management",
          tool_name: "launch_job",
          arguments: { job_id: 42 },
        },
        mockToolsets,
        mockExecuteToolRequest,
      );

      expect(result).toBe(expectedResult);
      expect(mockExecuteToolRequest).toHaveBeenCalledWith(
        mockToolsets.job_management[0],
        { job_id: 42 },
      );
    });

    it("should default arguments to empty object when not provided", async () => {
      mockExecuteToolRequest.mockResolvedValue({
        content: [{ type: "text", text: "{}" }],
      });

      await handleDiscoverTool(
        "call_tool",
        { toolset_name: "job_management", tool_name: "launch_job" },
        mockToolsets,
        mockExecuteToolRequest,
      );

      expect(mockExecuteToolRequest).toHaveBeenCalledWith(
        mockToolsets.job_management[0],
        {},
      );
    });

    it("should throw for unknown toolset or tool", async () => {
      await expect(
        handleDiscoverTool(
          "call_tool",
          { toolset_name: "nonexistent", tool_name: "x", arguments: {} },
          mockToolsets,
          mockExecuteToolRequest,
        ),
      ).rejects.toThrow("Unknown toolset: nonexistent");

      await expect(
        handleDiscoverTool(
          "call_tool",
          {
            toolset_name: "job_management",
            tool_name: "nonexistent_tool",
            arguments: {},
          },
          mockToolsets,
          mockExecuteToolRequest,
        ),
      ).rejects.toThrow(
        "Unknown tool: nonexistent_tool in toolset job_management",
      );
    });
  });

  it("should throw for unrecognized discover tool names", async () => {
    await expect(
      handleDiscoverTool(
        "unknown_tool",
        {},
        mockToolsets,
        mockExecuteToolRequest,
      ),
    ).rejects.toThrow("Unknown discover tool: unknown_tool");
  });
});
