import type { AAPMcpToolDefinition, ServiceConfig } from "./openapi-loader.js";

export interface AapMcpConfig {
  record_api_queries?: boolean;
  "ignore-certificate-errors"?: boolean;
  enable_ui?: boolean;
  enable_metrics?: boolean;
  allow_write_operations?: boolean;
  base_url?: string;
  session_timeout?: number;
  services?: ServiceConfig[];
  toolsets: Record<string, string[]>;
  analytics_key?: string;
}

/**
 * Load toolsets from configuration, creating the 'all' toolset that contains
 * all tools from all configured toolsets with deduplication by tool name.
 *
 * @param allTools - Array of all available tools
 * @param localConfig - Configuration object containing toolsets
 * @returns Record of toolset names to arrays of tool definitions
 */
export const loadToolsetsFromCfg = (
  allTools: AAPMcpToolDefinition[],
  localConfig: AapMcpConfig,
): Record<string, AAPMcpToolDefinition[]> => {
  const entries = Object.entries(localConfig.toolsets).map(
    ([name, cfgToolList]) => [
      name,
      allTools.filter((t) => cfgToolList.includes(t.fullName)),
    ],
  );

  const allListWithDup = entries
    .map((e) => e[1])
    .flat() as AAPMcpToolDefinition[];

  const allList = allListWithDup.reduce((acc: AAPMcpToolDefinition[], e) => {
    const existingToolsByName: string[] = acc.map((t) => t.name);
    if (!existingToolsByName.includes(e.name)) acc.push(e);
    return acc;
  }, [] as AAPMcpToolDefinition[]);

  // Inject the "all" toolset
  const allToolsets = Object.fromEntries([...entries, ...[["all", allList]]]);

  return allToolsets;
};
