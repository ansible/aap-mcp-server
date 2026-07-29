import type { AAPMcpToolDefinition } from "./openapi-loader.js";

export const TOOLSET_DESCRIPTIONS: Record<string, string> = {
  job_management:
    "Launch, monitor, and manage jobs, job templates, workflows, and schedules",
  inventory_management:
    "Manage inventories, hosts, groups, and inventory sources",
  system_monitoring: "Monitor instances, instance groups, and system health",
  user_management: "Manage users, teams, organizations, and role-based access",
  security_compliance:
    "Manage credentials, credential types, and audit activity streams",
  platform_configuration:
    "Configure platform settings, execution environments, and notifications",
  content_discovery:
    "Search Ansible collections, execution environments, and AI-assisted content",
};

export const DISCOVER_TOOLS = [
  {
    name: "discover",
    description:
      "Discover available tools. Without a toolset_name, returns all toolsets with descriptions. With a toolset_name, returns that toolset's full tool definitions including input schemas.",
    inputSchema: {
      type: "object" as const,
      properties: {
        toolset_name: {
          type: "string",
          description:
            "Optional: name of a specific toolset to get full tool definitions for. Omit to list all available toolsets.",
        },
      },
      required: [],
    },
  },
  {
    name: "call_tool",
    description: "Execute a tool from a specific toolset",
    inputSchema: {
      type: "object" as const,
      properties: {
        toolset_name: {
          type: "string",
          description: "Name of the toolset containing the tool",
        },
        tool_name: {
          type: "string",
          description: "Name of the tool to call",
        },
        arguments: {
          type: "object",
          description: "Arguments to pass to the tool",
        },
      },
      required: ["toolset_name", "tool_name", "arguments"],
    },
  },
];

type ToolCallResult = { content: Array<{ type: string; text: string }> };

export const handleDiscoverTool = async (
  name: string,
  args: Record<string, unknown>,
  allToolsets: Record<string, AAPMcpToolDefinition[]>,
  executeToolRequest: (
    tool: AAPMcpToolDefinition,
    args: Record<string, unknown>,
  ) => Promise<ToolCallResult>,
): Promise<ToolCallResult> => {
  switch (name) {
    case "discover": {
      const toolsetName = args.toolset_name as string | undefined;

      if (!toolsetName) {
        const toolsets = Object.entries(allToolsets)
          .filter(([n]) => n !== "all" && n !== "discover")
          .map(([n, tools]) => ({
            name: n,
            description: TOOLSET_DESCRIPTIONS[n] ?? "",
            endpoint: `/mcp/${n}`,
            tool_count: tools.length,
          }));
        return {
          content: [{ type: "text", text: JSON.stringify(toolsets, null, 2) }],
        };
      }

      const toolsetTools = allToolsets[toolsetName];
      if (
        !toolsetTools ||
        toolsetName === "all" ||
        toolsetName === "discover"
      ) {
        throw new Error(`Unknown toolset: ${toolsetName}`);
      }
      const tools = toolsetTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(tools, null, 2) }],
      };
    }
    case "call_tool": {
      const toolsetName = args.toolset_name as string;
      const toolName = args.tool_name as string;
      const toolArgs = (args.arguments as Record<string, unknown>) || {};

      const toolsetTools = allToolsets[toolsetName];
      if (
        !toolsetTools ||
        toolsetName === "all" ||
        toolsetName === "discover"
      ) {
        throw new Error(`Unknown toolset: ${toolsetName}`);
      }

      const tool = toolsetTools.find((t) => t.name === toolName);
      if (!tool) {
        throw new Error(`Unknown tool: ${toolName} in toolset ${toolsetName}`);
      }

      return executeToolRequest(tool, toolArgs);
    }
    default:
      throw new Error(`Unknown discover tool: ${name}`);
  }
};
