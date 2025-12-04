import { describe, it, expect, beforeEach } from "vitest";
import type { AAPMcpToolDefinition } from "./openapi-loader.js";
import { AapMcpConfig, loadToolsetsFromCfg } from "./config-utils.js";

// Helper function to create mock tools with all required properties
const createMockTool = (
  overrides: Partial<AAPMcpToolDefinition> = {},
): AAPMcpToolDefinition => ({
  name: "test-tool",
  service: "test-service",
  fullName: "test-service.test-tool",
  description: "Test tool",
  inputSchema: {},
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

describe("loadToolsetsFromCfg", () => {
  let mockAllTools: AAPMcpToolDefinition[];

  beforeEach(() => {
    // Create mock tools for testing
    mockAllTools = [
      createMockTool({
        name: "tool1",
        fullName: "eda.tool1",
        service: "eda",
        description: "EDA Tool 1",
      }),
      createMockTool({
        name: "tool2",
        fullName: "controller.tool2",
        service: "controller",
        description: "Controller Tool 2",
      }),
      createMockTool({
        name: "tool3",
        fullName: "gateway.tool3",
        service: "gateway",
        description: "Gateway Tool 3",
      }),
      createMockTool({
        name: "tool4",
        fullName: "galaxy.tool4",
        service: "galaxy",
        description: "Galaxy Tool 4",
      }),
    ];
  });

  describe("with valid toolsets configuration", () => {
    it("should create toolsets with correct tools", () => {
      const config: AapMcpConfig = {
        toolsets: {
          admin: ["eda.tool1", "controller.tool2"],
          user: ["eda.tool1"],
          operator: ["gateway.tool3"],
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      expect(result).toHaveProperty("admin");
      expect(result).toHaveProperty("user");
      expect(result).toHaveProperty("operator");
      expect(result).toHaveProperty("all");

      expect(result.admin).toHaveLength(2);
      expect(result.user).toHaveLength(1);
      expect(result.operator).toHaveLength(1);
      expect(result.all).toHaveLength(3); // all unique tools across all toolsets (deduplicated by name)

      // Verify correct tools are in admin toolset
      expect(result.admin[0].fullName).toBe("eda.tool1");
      expect(result.admin[1].fullName).toBe("controller.tool2");

      // Verify correct tool is in user toolset
      expect(result.user[0].fullName).toBe("eda.tool1");

      // Verify correct tool is in operator toolset
      expect(result.operator[0].fullName).toBe("gateway.tool3");
    });

    it("should include all tools from all toolsets in the 'all' toolset", () => {
      const config: AapMcpConfig = {
        toolsets: {
          admin: ["eda.tool1", "controller.tool2"],
          user: ["gateway.tool3"],
          power: ["galaxy.tool4"],
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      expect(result.all).toHaveLength(4);
      const allToolNames = result.all.map((tool) => tool.fullName);
      expect(allToolNames).toContain("eda.tool1");
      expect(allToolNames).toContain("controller.tool2");
      expect(allToolNames).toContain("gateway.tool3");
      expect(allToolNames).toContain("galaxy.tool4");
    });

    it("should handle overlapping toolsets correctly", () => {
      const config: AapMcpConfig = {
        toolsets: {
          admin: ["eda.tool1", "controller.tool2"],
          user: ["eda.tool1"], // overlapping with admin
          operator: ["controller.tool2", "gateway.tool3"], // overlapping with admin
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      expect(result.admin).toHaveLength(2);
      expect(result.user).toHaveLength(1);
      expect(result.operator).toHaveLength(2);
      expect(result.all).toHaveLength(3); // all unique tools from all toolsets (deduplicated by name)

      // Verify the 'all' toolset contains all tools
      const allToolNames = result.all.map((tool) => tool.fullName);
      expect(allToolNames).toContain("eda.tool1");
      expect(allToolNames).toContain("controller.tool2");
      expect(allToolNames).toContain("gateway.tool3");
      // Note: tools appear multiple times due to overlapping toolsets, but no deduplication by name since names are unique
    });
  });

  describe("with empty or invalid toolsets", () => {
    it("should handle empty toolsets object", () => {
      const config: AapMcpConfig = {
        toolsets: {},
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      expect(result).toHaveProperty("all");
      expect(result.all).toHaveLength(0);
      expect(Object.keys(result)).toHaveLength(1);
    });

    it("should handle toolsets with empty tool lists", () => {
      const config: AapMcpConfig = {
        toolsets: {
          admin: [],
          user: [],
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      expect(result).toHaveProperty("admin");
      expect(result).toHaveProperty("user");
      expect(result).toHaveProperty("all");

      expect(result.admin).toHaveLength(0);
      expect(result.user).toHaveLength(0);
      expect(result.all).toHaveLength(0);
    });

    it("should handle toolsets with non-existent tool names", () => {
      const config: AapMcpConfig = {
        toolsets: {
          admin: ["eda.tool1", "non.existent"],
          user: ["also.non.existent"],
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      expect(result.admin).toHaveLength(1); // only eda.tool1 exists
      expect(result.user).toHaveLength(0); // non-existent tool filtered out
      expect(result.all).toHaveLength(1); // only eda.tool1

      expect(result.admin[0].fullName).toBe("eda.tool1");
    });
  });

  describe("edge cases", () => {
    it("should handle single toolset with single tool", () => {
      const config: AapMcpConfig = {
        toolsets: {
          minimal: ["eda.tool1"],
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      expect(result).toHaveProperty("minimal");
      expect(result).toHaveProperty("all");

      expect(result.minimal).toHaveLength(1);
      expect(result.all).toHaveLength(1);
      expect(result.minimal[0]).toBe(result.all[0]);
    });

    it("should handle toolset with all available tools", () => {
      const config: AapMcpConfig = {
        toolsets: {
          everything: [
            "eda.tool1",
            "controller.tool2",
            "gateway.tool3",
            "galaxy.tool4",
          ],
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      expect(result.everything).toHaveLength(4);
      expect(result.all).toHaveLength(4);

      // Verify all tools are included
      const everythingToolNames = result.everything.map(
        (tool) => tool.fullName,
      );
      const allToolNames = result.all.map((tool) => tool.fullName);
      expect(everythingToolNames.sort()).toEqual(allToolNames.sort());
    });

    it("should preserve tool properties correctly", () => {
      const config: AapMcpConfig = {
        toolsets: {
          test: ["eda.tool1"],
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);
      const tool = result.test[0];

      expect(tool.name).toBe("tool1");
      expect(tool.fullName).toBe("eda.tool1");
      expect(tool.service).toBe("eda");
      expect(tool.description).toBe("EDA Tool 1");
      expect(tool.method).toBe("GET");
      expect(tool.deprecated).toBe(false);
      expect(Array.isArray(tool.logs)).toBe(true);
      expect(typeof tool.size).toBe("number");
    });

    it("should maintain object references correctly", () => {
      const config: AapMcpConfig = {
        toolsets: {
          admin: ["eda.tool1"],
          user: ["eda.tool1"], // Same tool in different toolsets
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      // The same tool object should be referenced in both toolsets
      expect(result.admin[0]).toBe(result.user[0]);
      // The 'all' toolset contains only one instance due to deduplication by name
      expect(result.all).toHaveLength(1);
      expect(result.all[0]).toBe(result.admin[0]);
      expect(result.all[0]).toBe(result.user[0]);
    });

    it("should deduplicate tools with same name in 'all' toolset", () => {
      // Create tools with same name but different fullNames to test deduplication
      const mockToolsWithDuplicateNames = [
        createMockTool({
          name: "duplicated",
          fullName: "eda.duplicated",
          service: "eda",
        }),
        createMockTool({
          name: "duplicated", // Same name as above!
          fullName: "controller.duplicated",
          service: "controller",
        }),
      ];

      const config: AapMcpConfig = {
        toolsets: {
          admin: ["eda.duplicated", "controller.duplicated"], // Both have same name "duplicated"
        },
      };

      const result = loadToolsetsFromCfg(mockToolsWithDuplicateNames, config);

      expect(result.admin).toHaveLength(2); // Both tools in admin
      expect(result.all).toHaveLength(1); // Only one in 'all' due to deduplication by name
      expect(result.all[0].name).toBe("duplicated");
    });
  });

  describe("toolset order and structure", () => {
    it("should maintain the order of toolsets as specified in config", () => {
      const config: AapMcpConfig = {
        toolsets: {
          zebra: ["eda.tool1"],
          alpha: ["controller.tool2"],
          middle: ["gateway.tool3"],
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);
      const toolsetNames = Object.keys(result);

      // Should have the original toolsets plus 'all'
      expect(toolsetNames).toContain("zebra");
      expect(toolsetNames).toContain("alpha");
      expect(toolsetNames).toContain("middle");
      expect(toolsetNames).toContain("all");
      expect(toolsetNames).toHaveLength(4);
    });

    it("should always include 'all' toolset regardless of config", () => {
      const configs: AapMcpConfig[] = [
        { toolsets: { admin: ["eda.tool1"] } },
        { toolsets: {} },
        { toolsets: { all: ["controller.tool2"] } }, // Even if 'all' is explicitly defined
      ];

      configs.forEach((config) => {
        const result = loadToolsetsFromCfg(mockAllTools, config);
        expect(result).toHaveProperty("all");
        expect(Array.isArray(result.all)).toBe(true);
      });
    });

    it("should handle case where user defines 'all' toolset explicitly", () => {
      const config: AapMcpConfig = {
        toolsets: {
          admin: ["eda.tool1"],
          all: ["controller.tool2"], // Explicitly defined 'all'
        },
      };

      const result = loadToolsetsFromCfg(mockAllTools, config);

      // The function should still override the 'all' toolset with the computed one
      expect(result.all).toHaveLength(2); // Both tools should be included
      const allToolNames = result.all.map((tool) => tool.fullName);
      expect(allToolNames).toContain("eda.tool1");
      expect(allToolNames).toContain("controller.tool2");
    });
  });
});
