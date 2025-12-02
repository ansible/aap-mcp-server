/**
 * Utility functions for tool name manipulation and lookup
 */

import type { AAPMcpToolDefinition } from "./openapi-loader.js";

/**
 * Extract part after the period from a tool name
 * Examples: "controller.jobs_list" -> "jobs_list", "jobs_list" -> "jobs_list"
 */
export const extractToolNameAfterPrefix = (name: string): string => {
  const match = name.match(/\.(.+)$/);
  return match ? match[1] : name;
};

/**
 * Find a tool by its external name (without service prefix)
 * This handles the case where MCP client calls a tool using the short name
 */
export const findToolByExternalName = (
  externalName: string,
  availableTools: AAPMcpToolDefinition[],
): AAPMcpToolDefinition | undefined => {
  return availableTools.find((tool) => tool.name === externalName);
};
