/*
 * Local fork of extractToolsFromApi from openapi-mcp-generator
 * This allows us to customize the tool extraction logic for AAP specific need
 * License: MIT
 * See: https://github.com/harsha-iiiv/openapi-mcp-generator
 */
import { OpenAPIV3 } from "openapi-types";
import type { JSONSchema7 } from "json-schema";
import type { McpToolDefinition } from "openapi-mcp-generator";

export interface McpToolLogEntry {
  severity: "INFO" | "WARN" | "ERR";
  msg: string;
}

export interface AAPMcpToolDefinition extends McpToolDefinition {
  deprecated: boolean;
  logs: McpToolLogEntry[];
  size?: number;
}

export class AAPOperationObject implements OpenAPIV3.OperationObject {
  public "x-ai-description": string;
  public deprecated: boolean;
  public security?: OpenAPIV3.SecurityRequirementObject[];
  public summary?: string;
  public description?: string;
  public operationId?: string;
  public requestBody?: OpenAPIV3.RequestBodyObject;
  public parameters?: OpenAPIV3.ParameterObject[];
  public responses: OpenAPIV3.ResponsesObject;

  constructor(rawOperation: Partial<OpenAPIV3.OperationObject>) {
    Object.assign(this, rawOperation);
    this.deprecated = rawOperation.deprecated || false;
    this.responses = rawOperation.responses || {};
    this["x-ai-description"] = rawOperation["x-ai-description"] || "";
  }
}

/**
 * Normalize a value to boolean if it looks like a boolean; otherwise undefined.
 */
export function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    return undefined;
  }
  return undefined;
}

/**
 * Determine if an operation should be included in MCP generation based on x-mcp.
 * Precedence: operation > path > root; uses provided default when all undefined.
 */
export function shouldIncludeOperationForMcp(
  api: OpenAPIV3.Document,
  pathItem: OpenAPIV3.PathItemObject,
  operation: AAPOperationObject,
  defaultInclude = true,
): boolean {
  const opRaw = (operation as Record<string, unknown>)["x-mcp"];
  const opVal = normalizeBoolean(opRaw);
  if (typeof opVal !== "undefined") return opVal;
  if (typeof opRaw !== "undefined") {
    console.warn(
      `Invalid x-mcp value on operation '${operation.operationId ?? "[no operationId]"}':`,
      opRaw,
      `-> expected boolean or 'true'/'false'. Falling back to path/root/default.`,
    );
  }
  const pathRaw = (pathItem as Record<string, unknown>)["x-mcp"];
  const pathVal = normalizeBoolean(pathRaw);
  if (typeof pathVal !== "undefined") return pathVal;
  if (typeof pathRaw !== "undefined") {
    console.warn(
      `Invalid x-mcp value on path item:`,
      pathRaw,
      `-> expected boolean or 'true'/'false'. Falling back to root/default.`,
    );
  }
  const rootRaw = (api as Record<string, unknown>)["x-mcp"];
  const rootVal = normalizeBoolean(rootRaw);
  if (typeof rootVal !== "undefined") return rootVal;
  if (typeof rootRaw !== "undefined") {
    console.warn(
      `Invalid x-mcp value at API root:`,
      rootRaw,
      `-> expected boolean or 'true'/'false'. Falling back to defaultInclude=${defaultInclude}.`,
    );
  }
  return defaultInclude;
}

/**
 * Converts a string to TitleCase for operation ID generation
 */
function titleCase(str: string): string {
  // Converts snake_case, kebab-case, or path/parts to TitleCase
  return str
    .toLowerCase()
    .replace(/[-_/](.)/g, (_, char) => char.toUpperCase()) // Handle separators
    .replace(/^{/, "") // Remove leading { from path params
    .replace(/}$/, "") // Remove trailing } from path params
    .replace(/^./, (char) => char.toUpperCase()); // Capitalize first letter
}

/**
 * Generates an operation ID from method and path
 */
function generateOperationId(method: string, path: string): string {
  // Generator: get /users/{userId}/posts -> GetUsersPostsByUserId
  const parts = path.split("/").filter((p) => p); // Split and remove empty parts
  let name = method.toLowerCase(); // Start with method name
  parts.forEach((part, index) => {
    if (part.startsWith("{") && part.endsWith("}")) {
      // Append 'By' + ParamName only for the *last* path parameter segment
      if (index === parts.length - 1) {
        name += "By" + titleCase(part);
      }
      // Potentially include non-terminal params differently if needed, e.g.:
      // else { name += 'With' + titleCase(part); }
    } else {
      // Append the static path part in TitleCase
      name += titleCase(part);
    }
  });
  return name;
}

/**
 * Maps an OpenAPI schema to a JSON Schema with cycle protection.
 */
export function mapOpenApiSchemaToJsonSchema(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  seen = new WeakSet<object>(),
): JSONSchema7 | boolean {
  // Handle reference objects
  if ("$ref" in schema) {
    console.warn(`Unresolved $ref '${schema.$ref}'.`);
    return { type: "object" };
  }
  // Handle boolean schemas
  if (typeof schema === "boolean") return schema;
  // Detect cycles
  if (seen.has(schema)) {
    console.warn(
      `Cycle detected in schema${(schema as Record<string, unknown>).title ? ` "${(schema as Record<string, unknown>).title}"` : ""}, returning generic object to break recursion.`,
    );
    return { type: "object" };
  }
  seen.add(schema);
  try {
    // Create a copy of the schema to modify
    const jsonSchema: Record<string, unknown> = { ...schema };
    // Convert integer type to number (JSON Schema compatible)
    if (schema.type === "integer") jsonSchema.type = "number";
    // Remove OpenAPI-specific properties that aren't in JSON Schema
    delete jsonSchema.nullable;
    delete jsonSchema.example;
    delete jsonSchema.xml;
    delete jsonSchema.externalDocs;
    delete jsonSchema.deprecated;
    delete jsonSchema.readOnly;
    delete jsonSchema.writeOnly;
    // Handle nullable properties by adding null to the type
    if ((schema as Record<string, unknown>).nullable) {
      if (Array.isArray(jsonSchema.type)) {
        if (!jsonSchema.type.includes("null")) jsonSchema.type.push("null");
      } else if (typeof jsonSchema.type === "string") {
        jsonSchema.type = [jsonSchema.type, "null"];
      } else if (!jsonSchema.type) {
        jsonSchema.type = "null";
      }
    }
    // Recursively process object properties
    if (jsonSchema.type === "object" && jsonSchema.properties) {
      const mappedProps: Record<string, JSONSchema7 | boolean> = {};
      for (const [key, propSchema] of Object.entries(jsonSchema.properties)) {
        if (typeof propSchema === "object" && propSchema !== null) {
          mappedProps[key] = mapOpenApiSchemaToJsonSchema(
            propSchema as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
            seen,
          );
        } else if (typeof propSchema === "boolean") {
          mappedProps[key] = propSchema;
        }
      }
      jsonSchema.properties = mappedProps;
    }
    // Recursively process array items
    if (
      jsonSchema.type === "array" &&
      typeof jsonSchema.items === "object" &&
      jsonSchema.items !== null
    ) {
      jsonSchema.items = mapOpenApiSchemaToJsonSchema(
        jsonSchema.items as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
        seen,
      );
    }
    return jsonSchema;
  } finally {
    seen.delete(schema);
  }
}

/**
 * Generates input schema and extracts parameter details from an operation
 */
export function generateInputSchemaAndDetails(
  operation: AAPOperationObject,
  pathParameters?: (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[],
): {
  inputSchema: JSONSchema7 | boolean;
  parameters: OpenAPIV3.ParameterObject[];
  requestBodyContentType?: string;
} {
  const properties: { [key: string]: JSONSchema7 | boolean } = {};
  const required: string[] = [];

  // Process parameters - merge path parameters with operation parameters
  const operationParameters: OpenAPIV3.ParameterObject[] = Array.isArray(
    operation.parameters,
  )
    ? operation.parameters.map((p) => p as OpenAPIV3.ParameterObject)
    : [];

  const pathParametersResolved: OpenAPIV3.ParameterObject[] = Array.isArray(
    pathParameters,
  )
    ? pathParameters.map((p) => p as OpenAPIV3.ParameterObject)
    : [];

  // Combine path parameters and operation parameters
  // Operation parameters override path parameters if they have the same name/location
  const allParameters: OpenAPIV3.ParameterObject[] = [];

  operationParameters.concat(pathParametersResolved).forEach((opParam) => {
    const existingIndex = allParameters.findIndex(
      (pathParam) =>
        pathParam.name === opParam.name && pathParam.in === opParam.in,
    );
    if (existingIndex >= 0) {
      // Override path parameter with operation parameter
      allParameters[existingIndex] = opParam;
    } else {
      // Add new operation parameter
      allParameters.push(opParam);
    }
  });

  allParameters.forEach((param) => {
    if (!param.name || !param.schema) return;

    const paramSchema = mapOpenApiSchemaToJsonSchema(
      param.schema as OpenAPIV3.SchemaObject,
    );
    if (typeof paramSchema === "object") {
      paramSchema.description = param.description || paramSchema.description;
    }

    properties[param.name] = paramSchema;
    if (param.required) required.push(param.name);
  });

  // Process request body (if present)
  let requestBodyContentType: string | undefined = undefined;

  if (operation.requestBody) {
    const opRequestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
    const jsonContent = opRequestBody.content?.["application/json"];
    const firstContent = opRequestBody.content
      ? Object.entries(opRequestBody.content)[0]
      : undefined;

    if (jsonContent?.schema) {
      requestBodyContentType = "application/json";
      const bodySchema = mapOpenApiSchemaToJsonSchema(
        jsonContent.schema as OpenAPIV3.SchemaObject,
      );

      if (typeof bodySchema === "object") {
        bodySchema.description =
          opRequestBody.description ||
          bodySchema.description ||
          "The JSON request body.";
      }

      properties["requestBody"] = bodySchema;
      if (opRequestBody.required) required.push("requestBody");
    } else if (firstContent) {
      const [contentType] = firstContent;
      requestBodyContentType = contentType;

      properties["requestBody"] = {
        type: "string",
        description:
          opRequestBody.description ||
          `Request body (content type: ${contentType})`,
      };

      if (opRequestBody.required) required.push("requestBody");
    }
  }

  // Combine everything into a JSON Schema
  const inputSchema: JSONSchema7 = {
    type: "object",
    properties,
    ...(required.length > 0 && { required }),
  };

  return { inputSchema, parameters: allParameters, requestBodyContentType };
}

/**
 * Extracts tool definitions from an OpenAPI document
 * This is a local fork of the extractToolsFromApi function from openapi-mcp-generator
 *
 * @param api OpenAPI document
 * @param defaultInclude Whether to include operations by default when x-mcp is not specified
 * @returns Array of MCP tool definitions
 */
export function extractToolsFromApi(
  api: OpenAPIV3.Document,
  defaultInclude = true,
): AAPMcpToolDefinition[] {
  const tools: AAPMcpToolDefinition[] = [];
  const usedNames = new Set<string>();
  const globalSecurity = api.security || [];

  if (!api.paths) return tools;

  for (const [path, pathItem] of Object.entries(api.paths)) {
    if (!pathItem) continue;

    for (const method of Object.values(OpenAPIV3.HttpMethods)) {
      if (!pathItem[method]) continue;
      const operation = new AAPOperationObject(pathItem[method]);
      const logs: McpToolLogEntry[] = [];

      // Apply x-mcp filtering, precedence: operation > path > root
      try {
        if (
          !shouldIncludeOperationForMcp(
            api,
            pathItem,
            operation,
            defaultInclude,
          )
        ) {
          continue;
        }
      } catch (error) {
        const loc = operation.operationId || `${method} ${path}`;
        const extVal =
          (operation as Record<string, unknown>)["x-mcp"] ??
          (pathItem as Record<string, unknown>)["x-mcp"] ??
          (api as Record<string, unknown>)["x-mcp"];
        let extPreview: string;
        try {
          extPreview = JSON.stringify(extVal);
        } catch {
          extPreview = String(extVal);
        }
        console.warn(
          `Error evaluating x-mcp extension for operation ${loc} (x-mcp=${extPreview}):`,
          error,
        );
        if (!defaultInclude) {
          continue;
        }
      }

      if (!operation.operationId) {
        logs.push({ severity: "WARN", msg: "no operationId key available" });
      }

      // Generate a unique name for the tool
      const originalBaseName =
        operation.operationId || generateOperationId(method, path);
      if (!originalBaseName) continue;

      // Sanitize the name to be MCP-compatible (only a-z, 0-9, _, -)
      let nameCandidate = originalBaseName
        .replace(/\./g, "_")
        .replace(/[^a-z0-9_-]/gi, "_");
      let counter = 1;
      while (usedNames.has(nameCandidate)) {
        nameCandidate = `${nameCandidate}_${counter++}`;
      }
      if (originalBaseName !== nameCandidate) {
        logs.push({
          severity: "WARN",
          msg: `name was transformed from ${originalBaseName}`,
        });
      }
      usedNames.add(nameCandidate);

      if (!operation.description) {
        logs.push({
          severity: "WARN",
          msg: "no description in OpenAPI schema",
        });
      }
      if (!operation.summary) {
        logs.push({ severity: "INFO", msg: "no summary in OpenAPI schema" });
      }

      if (operation["x-ai-description"].length === 0) {
        logs.push({ severity: "ERR", msg: "no `x-ai-description` field" });
      }
      if (operation["x-ai-description"].length > 300) {
        logs.push({
          severity: "ERR",
          msg: "x-ai-description is too long (>300 chars)",
        });
      }

      // Get or create a description
      const description =
        operation["x-ai-description"] ||
        operation.summary ||
        (operation.description
          ? operation.description?.trim().split("\n\n")[0]
          : "");

      // Generate input schema and extract parameters
      const { inputSchema, parameters, requestBodyContentType } =
        generateInputSchemaAndDetails(operation, pathItem.parameters);

      if (typeof inputSchema === "object" && inputSchema.properties) {
        const propertiesEntries = Object.entries(inputSchema.properties).map(
          (value) => value[1],
        );
        const missingDescriptions = propertiesEntries.filter(
          (p: JSONSchema7 | boolean) => p && typeof p === "object" && !(p as JSONSchema7).description,
        );
        if (missingDescriptions.length) {
          logs.push({
            severity: "ERR",
            msg: "has parameter(s) with no `description` key",
          });
        }
      }

      // Extract parameter details for execution
      const executionParameters = parameters.map((p) => ({
        name: p.name,
        in: p.in,
      }));

      // Determine security requirements
      const securityRequirements =
        operation.security === null
          ? globalSecurity
          : operation.security || globalSecurity;

      // Create the tool definition
      tools.push({
        name: nameCandidate,
        description,
        inputSchema,
        method,
        pathTemplate: path,
        parameters,
        executionParameters,
        requestBodyContentType,
        securityRequirements,
        operationId: originalBaseName,
        deprecated: operation.deprecated,
        logs: logs,
      });
    }
  }
  return tools;
}
