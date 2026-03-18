import type { AAPMcpToolDefinition, ServiceConfig } from "./openapi-loader.js";

export interface OidcConfig {
  enabled: boolean;
  issuer_url: string;
  client_id: string;
  client_secret?: string;
  scopes?: string[];
  audience?: string;
  required_scopes?: string[];
}

export interface AapMcpConfig {
  record_api_queries?: boolean;
  "ignore-certificate-errors"?: boolean;
  enable_metrics?: boolean;
  allow_write_operations?: boolean;
  base_url?: string;
  session_timeout?: number;
  services?: ServiceConfig[];
  toolsets: Record<string, string[]>;
  analytics_key?: string;
  oidc?: OidcConfig;
}

/**
 * Handle duplicate tool names within a toolset by renaming them to include
 * the service name with a hyphen separator (e.g., "controller-settings_list").
 *
 * @param tools - Array of tools to process
 * @returns Array of tools with duplicates renamed
 */
const handleDuplicateNames = (
  tools: AAPMcpToolDefinition[],
): AAPMcpToolDefinition[] => {
  // Group tools by name
  const nameGroups = new Map<string, AAPMcpToolDefinition[]>();

  tools.forEach((tool) => {
    const existing = nameGroups.get(tool.name) || [];
    existing.push(tool);
    nameGroups.set(tool.name, existing);
  });

  // Find duplicates and rename them
  nameGroups.forEach((group, name) => {
    if (group.length > 1) {
      // Multiple tools with the same name - need to rename
      group.forEach((tool) => {
        if (tool.service) {
          tool.name = `${tool.service}-${name}`;
        }
      });
    }
  });

  return tools;
};

/**
 * Load toolsets from configuration, creating the 'all' toolset that contains
 * all tools from all configured toolsets with deduplication by tool name.
 *
 * When duplicate tool names are found within a toolset, they are renamed to
 * include the service name with a hyphen (e.g., "controller-settings_list").
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
    ([name, cfgToolList]) => {
      const filteredTools = allTools.filter((t) =>
        cfgToolList.includes(t.fullName),
      );
      // Handle duplicate names within this toolset
      return [name, handleDuplicateNames(filteredTools)];
    },
  );

  const allListWithDup = entries
    .map((e) => e[1])
    .flat() as AAPMcpToolDefinition[];

  const allList = allListWithDup.reduce((acc: AAPMcpToolDefinition[], e) => {
    const existingToolsByName: string[] = acc.map((t) => t.name);
    if (!existingToolsByName.includes(e.name)) acc.push(e);
    return acc;
  }, [] as AAPMcpToolDefinition[]);

  // Handle duplicates in the "all" toolset as well
  const allListWithoutDuplicates = handleDuplicateNames(allList);

  // Inject the "all" toolset
  const allToolsets = Object.fromEntries([
    ...entries,
    ...[["all", allListWithoutDuplicates]],
  ]);

  return allToolsets;
};
