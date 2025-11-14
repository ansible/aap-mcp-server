import { readFileSync } from "fs";
import type { McpToolDefinition } from "openapi-mcp-generator";

// TypeScript interfaces for OpenAPI specification
export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
  [key: string]: unknown;
}

export interface OpenApiParameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  required?: boolean;
  schema?: OpenApiSchema;
  description?: string;
  [key: string]: unknown;
}

export interface OpenApiSchema {
  type?: string;
  format?: string;
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  required?: string[];
  [key: string]: unknown;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<
    string,
    {
      schema?: OpenApiSchema;
      [key: string]: unknown;
    }
  >;
  [key: string]: unknown;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<
      string,
      {
        schema?: OpenApiSchema;
        [key: string]: unknown;
      }
    >;
    [key: string]: unknown;
  };
  responses: Record<string, OpenApiResponse>;
  deprecated?: boolean;
  [key: string]: unknown;
}

export interface OpenApiPath {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
  parameters?: OpenApiParameter[];
  [key: string]: unknown;
}

export interface OpenApiSpec {
  openapi: string;
  info: OpenApiInfo;
  paths: Record<string, OpenApiPath>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
    parameters?: Record<string, OpenApiParameter>;
    responses?: Record<string, OpenApiResponse>;
    [key: string]: unknown;
  };
  servers?: Array<{
    url: string;
    description?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export interface McpToolLogEntry {
  severity: "INFO" | "WARN" | "ERR";
  msg: string;
}

export interface AAPMcpToolDefinition extends McpToolDefinition {
  deprecated: boolean;
  service?: string;
  originalDescription?: string;
  logs: McpToolLogEntry[];
  size: number;
}

export interface OpenApiSpecEntry {
  url: string;
  localPath?: string;
  reformatFunc: (tool: AAPMcpToolDefinition) => AAPMcpToolDefinition | false;
  spec?: OpenApiSpec;
  service?: string;
}

export interface ServiceConfig {
  name: string;
  url?: string;
  local_path?: string;
  enabled?: boolean;
}

export interface DefaultServiceConfig {
  url: string;
  enabled?: boolean;
}

/**
 * Gets default configurations for all supported services
 */
export const getDefaultServiceConfigs = (
  baseUrl: string,
): Record<string, DefaultServiceConfig> => {
  return {
    eda: {
      url: `${baseUrl}/api/eda/v1/openapi.json`,
    },
    gateway: {
      url: `${baseUrl}/api/gateway/v1/docs/schema/`,
    },
    galaxy: {
      url: `${baseUrl}/api/galaxy/v3/openapi.json`,
    },
    controller: {
      url: "https://s3.amazonaws.com/awx-public-ci-files/release_4.6/schema.json",
    },
  };
};

/**
 * Reformat function for EDA tools
 */
export const reformatEdaTool = (
  tool: AAPMcpToolDefinition,
): AAPMcpToolDefinition => {
  tool.name = "eda." + tool.name;
  tool.pathTemplate = "/api/eda/v1" + tool.pathTemplate;
  return tool;
};

/**
 * Reformat function for Gateway tools
 */
export const reformatGatewayTool = (
  tool: AAPMcpToolDefinition,
): AAPMcpToolDefinition | false => {
  tool.name = "gateway." + tool.name;
  if (!tool.deprecated && tool.description?.includes("Legacy")) {
    tool.logs.push({
      severity: "WARN",
      msg: "tool should be marked as deprecated",
    });
  }
  return tool;
};

/**
 * Reformat function for Galaxy tools
 */
export const reformatGalaxyTool = (
  tool: AAPMcpToolDefinition,
): AAPMcpToolDefinition | false => {
  if (tool.pathTemplate?.startsWith("/api/galaxy/_ui")) {
    tool.logs.push({
      severity: "INFO",
      msg: "tool ignored, path starts with /api/galaxy/_ui",
    });
    return false;
  }
  if (!tool.name.startsWith("api_galaxy_v3")) {
    tool.logs.push({
      severity: "INFO",
      msg: "tool ignored, name doesn't start with api_galaxy_v3",
    });
    return false;
  }
  const originalName = tool.name;
  tool.name = tool.name.replace(
    /(api_galaxy_v3_|api_galaxy_|)(.+)/,
    "galaxy.$2",
  );
  if (originalName !== tool.name) {
    tool.logs.push({
      severity: "WARN",
      msg: `tool name rewritten from ${originalName}`,
    });
  }
  if (!tool.deprecated && tool.description?.includes("DEPRECATED")) {
    tool.logs.push({
      severity: "WARN",
      msg: "tool should be marked as deprecated",
    });
  }
  return tool;
};

/**
 * Reformat function for Controller tools
 */
export const reformatControllerTool = (
  tool: AAPMcpToolDefinition,
): AAPMcpToolDefinition => {
  tool.pathTemplate = tool.pathTemplate?.replace(
    "/api/v2",
    "/api/controller/v2",
  );

  // Remove api_ prefix if it exists (backwards compatibility),
  // then always prepend controller.
  tool.name = tool.name.replace(/^api_/, "");
  tool.name = "controller." + tool.name;

  return tool;
};

/**
 * Gets reformat functions for all supported services
 */
export const getReformatFunctions = (): Record<
  string,
  (tool: AAPMcpToolDefinition) => AAPMcpToolDefinition | false
> => {
  return {
    eda: reformatEdaTool,
    gateway: reformatGatewayTool,
    galaxy: reformatGalaxyTool,
    controller: reformatControllerTool,
  };
};

/**
 * Filters enabled services from configuration
 */
export const filterEnabledServices = (
  servicesConfig: ServiceConfig[],
  defaultConfigs: Record<string, DefaultServiceConfig>,
): ServiceConfig[] => {
  return servicesConfig.filter((serviceConfig) => {
    const enabled = serviceConfig.enabled ?? true;
    return enabled && defaultConfigs[serviceConfig.name];
  });
};

/**
 * Builds OpenAPI spec entries from service configuration
 */
export const buildSpecEntries = (
  servicesConfig: ServiceConfig[],
  defaultConfigs: Record<string, DefaultServiceConfig>,
  reformatFunctions: Record<
    string,
    (tool: AAPMcpToolDefinition) => AAPMcpToolDefinition | false
  >,
): OpenApiSpecEntry[] => {
  const enabledServices = filterEnabledServices(servicesConfig, defaultConfigs);

  return enabledServices.map((serviceConfig) => {
    const defaults = defaultConfigs[serviceConfig.name];
    const url = serviceConfig.url || defaults.url;
    return {
      url: url,
      localPath: serviceConfig.local_path,
      reformatFunc: reformatFunctions[serviceConfig.name],
      service: serviceConfig.name,
    };
  });
};

/**
 * Loads a single OpenAPI spec from URL or local file
 */
export const loadSingleSpec = async (
  specEntry: OpenApiSpecEntry,
): Promise<OpenApiSpecEntry> => {
  try {
    // If local_path is set, use it directly instead of fetching from URL
    if (specEntry.localPath) {
      console.log(
        `Loading OpenAPI spec from local file: ${specEntry.localPath}`,
      );
      const localContent = readFileSync(specEntry.localPath, "utf8");
      specEntry.spec = JSON.parse(localContent);
      console.log(
        `Successfully loaded OpenAPI spec from local file: ${specEntry.localPath}`,
      );
    } else {
      console.log(`Fetching OpenAPI spec from: ${specEntry.url}`);
      const response = await fetch(specEntry.url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      specEntry.spec = (await response.json()) as OpenApiSpec;
      console.log(`Successfully loaded OpenAPI spec from: ${specEntry.url}`);
    }
  } catch (error) {
    console.error(
      `Error loading OpenAPI spec from ${specEntry.localPath ? specEntry.localPath : specEntry.url}:`,
      error,
    );
    // Continue with other specs even if this one fails
  }

  return specEntry;
};

/**
 * Load OpenAPI specifications from HTTP URLs with local fallback
 */
export const loadOpenApiSpecs = async (
  servicesConfig: ServiceConfig[],
  baseUrl: string,
): Promise<OpenApiSpecEntry[]> => {
  const defaultConfigs = getDefaultServiceConfigs(baseUrl);
  const reformatFunctions = getReformatFunctions();

  // Build spec entries from configuration
  const enabledServiceNames = servicesConfig.map((s) => s.name);
  const servicesToLoad = enabledServiceNames.length > 0 ? servicesConfig : [];

  const specUrls = buildSpecEntries(
    servicesToLoad,
    defaultConfigs,
    reformatFunctions,
  );

  console.log(
    `Loading OpenAPI specs for services: ${enabledServiceNames.length > 0 ? enabledServiceNames.join(", ") : "all"} (${specUrls.length} specs)`,
  );

  // Load all specs
  const loadedSpecs: OpenApiSpecEntry[] = [];
  for (const specEntry of specUrls) {
    const loadedSpec = await loadSingleSpec(specEntry);
    loadedSpecs.push(loadedSpec);
  }

  console.log(`Number of OpenAPIv3 files loaded=${loadedSpecs.length}`);
  return loadedSpecs;
};
