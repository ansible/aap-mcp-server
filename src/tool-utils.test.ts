import { describe, it, expect } from "vitest";
import {
  extractToolNameAfterPrefix,
  findToolByExternalName,
} from "./tool-utils.js";
import type { AAPMcpToolDefinition } from "./openapi-loader.js";

describe("extractToolNameAfterPrefix", () => {
  it("should extract tool name after period for controller prefix", () => {
    expect(extractToolNameAfterPrefix("controller.jobs_list")).toBe(
      "jobs_list",
    );
  });

  it("should extract tool name after period for gateway prefix", () => {
    expect(extractToolNameAfterPrefix("gateway.teams_list")).toBe("teams_list");
  });

  it("should extract tool name after period for eda prefix", () => {
    expect(extractToolNameAfterPrefix("eda.activation_instances_list")).toBe(
      "activation_instances_list",
    );
  });

  it("should extract tool name after period for galaxy prefix", () => {
    expect(extractToolNameAfterPrefix("galaxy.collections_create")).toBe(
      "collections_create",
    );
  });

  it("should return original name if no period exists", () => {
    expect(extractToolNameAfterPrefix("jobs_list")).toBe("jobs_list");
    expect(extractToolNameAfterPrefix("some_tool_name")).toBe("some_tool_name");
  });

  it("should handle names with multiple periods", () => {
    expect(extractToolNameAfterPrefix("controller.api.jobs_list")).toBe(
      "api.jobs_list",
    );
  });

  it("should handle empty string", () => {
    expect(extractToolNameAfterPrefix("")).toBe("");
  });

  it("should handle name with only a period", () => {
    // No match since there's nothing after the period, returns original
    expect(extractToolNameAfterPrefix(".")).toBe(".");
  });

  it("should handle name ending with period", () => {
    // No match since there's nothing after the period, returns original
    expect(extractToolNameAfterPrefix("controller.")).toBe("controller.");
  });
});

describe("findToolByExternalName", () => {
  const createMockTool = (
    name: string,
    description = "Test description",
  ): AAPMcpToolDefinition => ({
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {},
    },
    pathTemplate: "/test/path",
    method: "GET",
    parameters: [] as any,
    executionParameters: {} as any,
    securityRequirements: [] as any,
    operationId: "test-op",
    deprecated: false,
    logs: [],
    size: 100,
  });

  it("should find tool by exact name match", () => {
    const tools: AAPMcpToolDefinition[] = [
      createMockTool("jobs_list"),
      createMockTool("teams_list"),
      createMockTool("inventories_list"),
    ];

    const result = findToolByExternalName("teams_list", tools);

    expect(result).toBeDefined();
    expect(result?.name).toBe("teams_list");
  });

  it("should return undefined when tool not found", () => {
    const tools: AAPMcpToolDefinition[] = [
      createMockTool("jobs_list"),
      createMockTool("teams_list"),
    ];

    const result = findToolByExternalName("nonexistent_tool", tools);

    expect(result).toBeUndefined();
  });

  it("should return first match when multiple tools have same name", () => {
    const tools: AAPMcpToolDefinition[] = [
      createMockTool("jobs_list", "First description"),
      createMockTool("jobs_list", "Second description"),
    ];

    const result = findToolByExternalName("jobs_list", tools);

    expect(result).toBeDefined();
    expect(result?.description).toBe("First description");
  });

  it("should handle empty tools array", () => {
    const result = findToolByExternalName("jobs_list", []);

    expect(result).toBeUndefined();
  });

  it("should be case-sensitive", () => {
    const tools: AAPMcpToolDefinition[] = [createMockTool("jobs_list")];

    const result = findToolByExternalName("Jobs_List", tools);

    expect(result).toBeUndefined();
  });

  it("should handle tools with special characters in names", () => {
    const tools: AAPMcpToolDefinition[] = [
      createMockTool("job-templates_list"),
      createMockTool("workflow_jobs_123"),
    ];

    const result1 = findToolByExternalName("job-templates_list", tools);
    const result2 = findToolByExternalName("workflow_jobs_123", tools);

    expect(result1?.name).toBe("job-templates_list");
    expect(result2?.name).toBe("workflow_jobs_123");
  });
});
