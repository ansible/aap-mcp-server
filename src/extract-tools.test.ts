import { describe, it, expect, vi } from "vitest";
import {
  extractToolsFromApi,
  generateInputSchemaAndDetails,
  AAPOperationObject,
  normalizeBoolean,
  shouldIncludeOperationForMcp,
  clampNumericConstraints,
  mapOpenApiSchemaToJsonSchema,
} from "./extract-tools.js";
import type { OpenAPIV3 } from "openapi-types";

describe("AAPOperationObject", () => {
  it("should initialize with x-ai-description when provided", () => {
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": "Test AI description",
      summary: "Test summary",
      description: "Test description",
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation["x-ai-description"]).toBe("Test AI description");
    expect(aapOperation.operationId).toBe("test_operation");
    expect(aapOperation.summary).toBe("Test summary");
    expect(aapOperation.description).toBe("Test description");
    expect(aapOperation.deprecated).toBe(false);
  });

  it("should default x-ai-description to empty string when missing", () => {
    const rawOperation = {
      operationId: "test_operation",
      summary: "Test summary",
      description: "Test description",
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation["x-ai-description"]).toBe("");
    expect(aapOperation.operationId).toBe("test_operation");
    expect(aapOperation.deprecated).toBe(false);
  });

  it("should default x-ai-description to empty string when null", () => {
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": null,
      summary: "Test summary",
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation["x-ai-description"]).toBe("");
    expect(aapOperation.operationId).toBe("test_operation");
  });

  it("should default x-ai-description to empty string when undefined", () => {
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": undefined,
      summary: "Test summary",
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation["x-ai-description"]).toBe("");
    expect(aapOperation.operationId).toBe("test_operation");
  });

  it("should preserve empty string x-ai-description", () => {
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": "",
      summary: "Test summary",
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation["x-ai-description"]).toBe("");
    expect(aapOperation.operationId).toBe("test_operation");
  });

  it("should always default deprecated to false", () => {
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": "Test description",
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation.deprecated).toBe(false);
  });

  it("should preserve deprecated value from raw operation", () => {
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": "Test description",
      deprecated: true,
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation.deprecated).toBe(true);
  });

  it("should preserve deprecated false from raw operation", () => {
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": "Test description",
      deprecated: false,
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation.deprecated).toBe(false);
  });

  it("should preserve all other OpenAPI operation properties", () => {
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": "Test AI description",
      summary: "Test summary",
      description: "Test description",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        content: {
          "application/json": {
            schema: { type: "object" },
          },
        },
      },
      security: [{ bearerAuth: [] }],
      responses: {
        "200": {
          description: "Success",
        },
      },
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation.operationId).toBe("test_operation");
    expect(aapOperation.summary).toBe("Test summary");
    expect(aapOperation.description).toBe("Test description");
    expect(aapOperation.parameters).toEqual(rawOperation.parameters);
    expect(aapOperation.requestBody).toEqual(rawOperation.requestBody);
    expect(aapOperation.security).toEqual(rawOperation.security);
    expect(aapOperation["x-ai-description"]).toBe("Test AI description");
    expect(aapOperation.deprecated).toBe(false);
  });

  it("should handle empty object input", () => {
    const rawOperation = {};

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation["x-ai-description"]).toBe("");
    expect(aapOperation.deprecated).toBe(false);
    expect(aapOperation.operationId).toBeUndefined();
    expect(aapOperation.summary).toBeUndefined();
    expect(aapOperation.description).toBeUndefined();
  });

  it("should handle long x-ai-description values", () => {
    const longDescription = "A".repeat(500);
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": longDescription,
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    expect(aapOperation["x-ai-description"]).toBe(longDescription);
    expect(aapOperation["x-ai-description"]).toHaveLength(500);
  });

  it("should implement OpenAPIV3.OperationObject interface", () => {
    const rawOperation = {
      operationId: "test_operation",
      "x-ai-description": "Test description",
      summary: "Test summary",
      responses: {
        "200": {
          description: "Success",
        },
      },
    };

    const aapOperation = new AAPOperationObject(rawOperation);

    // Type check - should be assignable to OpenAPIV3.OperationObject
    const openApiOperation: OpenAPIV3.OperationObject = aapOperation;
    expect(openApiOperation).toBeDefined();
    expect(openApiOperation.operationId).toBe("test_operation");
  });
});

describe("Extract Tools - x-ai-description functionality", () => {
  it("should use x-ai-description when available", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            "x-ai-description": "AI-optimized description for this operation",
            description: "Regular description",
            summary: "Operation summary",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe(
      "AI-optimized description for this operation",
    );

    // Should not have error about missing x-ai-description
    expect(tools[0].logs).not.toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });

  it("should log error when x-ai-description is not available", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            description: "Regular description",
            summary: "Operation summary",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);

    // Should log error about missing x-ai-description
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });

  it("should log error when only summary is available (no x-ai-description)", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            summary: "Operation summary",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);

    // Should log error about missing x-ai-description
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });

  it("should use x-ai-description even when description and summary are available", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            "x-ai-description": "AI-optimized description",
            description: "Regular description",
            summary: "Operation summary",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe("AI-optimized description");

    // Should not have error about missing x-ai-description
    expect(tools[0].logs).not.toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });

  it("should log error for empty x-ai-description and fallback to summary", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            "x-ai-description": "",
            description: "Regular description",
            summary: "Operation summary",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe("Operation summary");

    // Should log error for empty x-ai-description
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });

  it("should accept x-ai-description with whitespace-only content", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            "x-ai-description": "   ",
            description: "Regular description",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe("   ");

    // Should not log error for whitespace-only x-ai-description (it's present)
    expect(tools[0].logs).not.toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });

  it("should work with multiple operations having x-ai-description", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test1": {
          get: {
            operationId: "test_operation_1",
            "x-ai-description": "AI description for operation 1",
            description: "Regular description 1",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
        "/test2": {
          post: {
            operationId: "test_operation_2",
            "x-ai-description": "AI description for operation 2",
            description: "Regular description 2",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(2);

    expect(tools[0].description).toBe("AI description for operation 1");
    expect(tools[0].logs).not.toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });

    expect(tools[1].description).toBe("AI description for operation 2");
    expect(tools[1].logs).not.toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });

  it("should log error when operations lack x-ai-description", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test1": {
          get: {
            operationId: "test_operation_1",
            description: "Regular description 1",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
        "/test2": {
          post: {
            operationId: "test_operation_2",
            "x-ai-description": "AI description for operation 2",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(2);

    // First operation should have error log
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });

    // Second operation should not have error log
    expect(tools[1].logs).not.toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
    expect(tools[1].description).toBe("AI description for operation 2");
  });

  it("should log error when x-ai-description is too long", () => {
    const longDescription = "A".repeat(350); // 350 characters, over the 300 limit
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            "x-ai-description": longDescription,
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe(longDescription);

    // Should log error for x-ai-description being too long
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "x-ai-description is too long (>300 chars)",
    });
  });

  it("should not log error when x-ai-description is exactly 300 characters", () => {
    const exactDescription = "A".repeat(300); // Exactly 300 characters
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            "x-ai-description": exactDescription,
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe(exactDescription);

    // Should not log error for x-ai-description at exactly 300 chars
    expect(tools[0].logs).not.toContainEqual({
      severity: "ERR",
      msg: "x-ai-description is too long (>300 chars)",
    });
  });

  it("should not log error when x-ai-description is just under 300 characters", () => {
    const shortDescription = "A".repeat(299); // 299 characters
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            "x-ai-description": shortDescription,
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe(shortDescription);

    // Should not log error for x-ai-description under 300 chars
    expect(tools[0].logs).not.toContainEqual({
      severity: "ERR",
      msg: "x-ai-description is too long (>300 chars)",
    });
  });

  it("should log error when x-ai-description is just over 300 characters", () => {
    const slightlyLongDescription = "A".repeat(301); // 301 characters
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            "x-ai-description": slightlyLongDescription,
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe(slightlyLongDescription);

    // Should log error for x-ai-description over 300 chars
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "x-ai-description is too long (>300 chars)",
    });
  });

  it("should log both missing and too long errors for operations", () => {
    const longDescription = "A".repeat(350); // Over 300 characters
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test1": {
          get: {
            operationId: "test_operation_1",
            "x-ai-description": "", // Empty description
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
        "/test2": {
          post: {
            operationId: "test_operation_2",
            "x-ai-description": longDescription, // Too long description
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(2);

    // First operation should have error for empty x-ai-description
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });

    // Second operation should have error for too long x-ai-description
    expect(tools[1].logs).toContainEqual({
      severity: "ERR",
      msg: "x-ai-description is too long (>300 chars)",
    });
  });

  it("should fallback to description when both x-ai-description and summary are missing", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            description: "Regular description",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe("Regular description");

    // Should log error for missing x-ai-description
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });

  it("should fallback to empty string when x-ai-description, summary, and description are all missing", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe("");

    // Should log error for missing x-ai-description
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });

  it("should prefer summary over description when x-ai-description is empty", () => {
    const mockSpec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/test": {
          get: {
            operationId: "test_operation",
            "x-ai-description": "",
            summary: "Operation summary",
            description: "Regular description",
            responses: {
              "200": {
                description: "Success",
              },
            },
          },
        },
      },
    };

    const tools = extractToolsFromApi(mockSpec);

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe("Operation summary");

    // Should log error for empty x-ai-description
    expect(tools[0].logs).toContainEqual({
      severity: "ERR",
      msg: "no `x-ai-description` field",
    });
  });
});

describe("normalizeBoolean", () => {
  it("should return boolean values as-is", () => {
    expect(normalizeBoolean(true)).toBe(true);
    expect(normalizeBoolean(false)).toBe(false);
  });

  it("should normalize string 'true' variants to true", () => {
    expect(normalizeBoolean("true")).toBe(true);
    expect(normalizeBoolean("TRUE")).toBe(true);
    expect(normalizeBoolean(" true ")).toBe(true);
    expect(normalizeBoolean("1")).toBe(true);
    expect(normalizeBoolean("yes")).toBe(true);
    expect(normalizeBoolean("YES")).toBe(true);
    expect(normalizeBoolean("on")).toBe(true);
    expect(normalizeBoolean("ON")).toBe(true);
  });

  it("should normalize string 'false' variants to false", () => {
    expect(normalizeBoolean("false")).toBe(false);
    expect(normalizeBoolean("FALSE")).toBe(false);
    expect(normalizeBoolean(" false ")).toBe(false);
    expect(normalizeBoolean("0")).toBe(false);
    expect(normalizeBoolean("no")).toBe(false);
    expect(normalizeBoolean("NO")).toBe(false);
    expect(normalizeBoolean("off")).toBe(false);
    expect(normalizeBoolean("OFF")).toBe(false);
  });

  it("should return undefined for unrecognized string values", () => {
    expect(normalizeBoolean("maybe")).toBeUndefined();
    expect(normalizeBoolean("2")).toBeUndefined();
    expect(normalizeBoolean("invalid")).toBeUndefined();
    expect(normalizeBoolean("")).toBeUndefined();
    expect(normalizeBoolean("   ")).toBeUndefined();
  });

  it("should return undefined for non-boolean, non-string values", () => {
    expect(normalizeBoolean(null)).toBeUndefined();
    expect(normalizeBoolean(undefined)).toBeUndefined();
    expect(normalizeBoolean(123)).toBeUndefined();
    expect(normalizeBoolean({})).toBeUndefined();
    expect(normalizeBoolean([])).toBeUndefined();
  });
});

describe("shouldIncludeOperationForMcp", () => {
  const createMockPathItem = (xMcp?: any): OpenAPIV3.PathItemObject =>
    ({
      "x-mcp": xMcp,
    }) as any;

  const createMockOperation = (xMcp?: any): AAPOperationObject => {
    const op = new AAPOperationObject({
      operationId: "test_op",
      responses: { "200": { description: "OK" } },
    });
    if (xMcp !== undefined) {
      (op as any)["x-mcp"] = xMcp;
    }
    return op;
  };

  const createMockApi = (xMcp?: any): OpenAPIV3.Document =>
    ({
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {},
      "x-mcp": xMcp,
    }) as any;

  it("should use operation-level x-mcp when present", () => {
    const api = createMockApi();
    const pathItem = createMockPathItem();
    const operation = createMockOperation(true);

    expect(shouldIncludeOperationForMcp(api, pathItem, operation)).toBe(true);

    const operationFalse = createMockOperation(false);
    expect(shouldIncludeOperationForMcp(api, pathItem, operationFalse)).toBe(
      false,
    );
  });

  it("should fall back to path-level x-mcp when operation-level is undefined", () => {
    const api = createMockApi();
    const pathItem = createMockPathItem(true);
    const operation = createMockOperation();

    expect(shouldIncludeOperationForMcp(api, pathItem, operation)).toBe(true);

    const pathItemFalse = createMockPathItem(false);
    expect(shouldIncludeOperationForMcp(api, pathItemFalse, operation)).toBe(
      false,
    );
  });

  it("should fall back to root-level x-mcp when path and operation are undefined", () => {
    const api = createMockApi(true);
    const pathItem = createMockPathItem();
    const operation = createMockOperation();

    expect(shouldIncludeOperationForMcp(api, pathItem, operation)).toBe(true);

    const apiFalse = createMockApi(false);
    expect(shouldIncludeOperationForMcp(apiFalse, pathItem, operation)).toBe(
      false,
    );
  });

  it("should use default value when all levels are undefined", () => {
    const api = createMockApi();
    const pathItem = createMockPathItem();
    const operation = createMockOperation();

    // Default is true
    expect(shouldIncludeOperationForMcp(api, pathItem, operation)).toBe(true);

    // Explicit default false
    expect(shouldIncludeOperationForMcp(api, pathItem, operation, false)).toBe(
      false,
    );
  });

  it("should handle string values using normalizeBoolean", () => {
    const api = createMockApi();
    const pathItem = createMockPathItem();
    const operation = createMockOperation("true");

    expect(shouldIncludeOperationForMcp(api, pathItem, operation)).toBe(true);

    const operationStringFalse = createMockOperation("false");
    expect(
      shouldIncludeOperationForMcp(api, pathItem, operationStringFalse),
    ).toBe(false);
  });

  it("should warn and fall back for invalid operation-level values", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const api = createMockApi();
    const pathItem = createMockPathItem(true);
    const operation = createMockOperation("invalid");

    expect(shouldIncludeOperationForMcp(api, pathItem, operation)).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid x-mcp value on operation"),
      expect.anything(),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });

  it("should warn and fall back for invalid path-level values", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const api = createMockApi(false);
    const pathItem = createMockPathItem("invalid");
    const operation = createMockOperation();

    expect(shouldIncludeOperationForMcp(api, pathItem, operation)).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid x-mcp value on path item"),
      expect.anything(),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });

  it("should warn and use default for invalid root-level values", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const api = createMockApi("invalid");
    const pathItem = createMockPathItem();
    const operation = createMockOperation();

    expect(shouldIncludeOperationForMcp(api, pathItem, operation, false)).toBe(
      false,
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid x-mcp value at API root"),
      expect.anything(),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });
});

describe("Default page_size in tool extraction", () => {
  const createSpecWithPageSize = (pageSizeDefault?: number) => {
    const pageSizeParam: any = {
      name: "page_size",
      in: "query",
      schema: { type: "integer" },
      description: "Number of results per page",
    };
    if (pageSizeDefault !== undefined) {
      pageSizeParam.schema.default = pageSizeDefault;
    }
    return {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/items": {
          get: {
            operationId: "items_list",
            "x-ai-description": "List items",
            parameters: [pageSizeParam],
            responses: { "200": { description: "Success" } },
          },
        },
      },
    };
  };

  it("should set page_size default when not present in OpenAPI schema", () => {
    const spec = createSpecWithPageSize();
    const tools = extractToolsFromApi(spec, true, 10);

    expect(tools).toHaveLength(1);
    const schema = tools[0].inputSchema as any;
    expect(schema.properties.page_size.default).toBe(10);
  });

  it("should preserve existing OpenAPI schema default", () => {
    const spec = createSpecWithPageSize(25);
    const tools = extractToolsFromApi(spec, true, 10);

    expect(tools).toHaveLength(1);
    const schema = tools[0].inputSchema as any;
    expect(schema.properties.page_size.default).toBe(25);
  });

  it("should not set default when defaultPageSize is not provided", () => {
    const spec = createSpecWithPageSize();
    const tools = extractToolsFromApi(spec, true);

    expect(tools).toHaveLength(1);
    const schema = tools[0].inputSchema as any;
    expect(schema.properties.page_size.default).toBeUndefined();
  });

  it("should not affect tools without page_size parameter", () => {
    const spec: any = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/items/{id}": {
          get: {
            operationId: "items_retrieve",
            "x-ai-description": "Retrieve item",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "integer" },
                description: "Item ID",
              },
            ],
            responses: { "200": { description: "Success" } },
          },
        },
      },
    };

    const tools = extractToolsFromApi(spec, true, 10);
    expect(tools).toHaveLength(1);
    const schema = tools[0].inputSchema as any;
    expect(schema.properties.id).toBeDefined();
    expect(schema.properties.page_size).toBeUndefined();
  });

  it("should apply different defaultPageSize values", () => {
    const spec = createSpecWithPageSize();

    const tools50 = extractToolsFromApi(spec, true, 50);
    expect((tools50[0].inputSchema as any).properties.page_size.default).toBe(
      50,
    );

    const tools100 = extractToolsFromApi(spec, true, 100);
    expect((tools100[0].inputSchema as any).properties.page_size.default).toBe(
      100,
    );
  });

  it("should only apply to query parameters named page_size", () => {
    const spec: any = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/items/{page_size}": {
          get: {
            operationId: "items_by_page",
            "x-ai-description": "List items by page size",
            parameters: [
              {
                name: "page_size",
                in: "path",
                required: true,
                schema: { type: "integer" },
                description: "Page size in path",
              },
            ],
            responses: { "200": { description: "Success" } },
          },
        },
      },
    };

    const tools = extractToolsFromApi(spec, true, 10);
    expect(tools).toHaveLength(1);
    const schema = tools[0].inputSchema as any;
    expect(schema.properties.page_size.default).toBeUndefined();
  });
});

describe("generateInputSchemaAndDetails with defaultPageSize", () => {
  it("should set page_size default on query parameter", () => {
    const operation = new AAPOperationObject({
      operationId: "test_list",
      parameters: [
        {
          name: "page_size",
          in: "query",
          schema: { type: "integer" },
          description: "Page size",
        },
      ],
      responses: { "200": { description: "OK" } },
    });

    const { inputSchema } = generateInputSchemaAndDetails(
      operation,
      undefined,
      15,
    );

    expect((inputSchema as any).properties.page_size.default).toBe(15);
  });

  it("should not override existing default", () => {
    const operation = new AAPOperationObject({
      operationId: "test_list",
      parameters: [
        {
          name: "page_size",
          in: "query",
          schema: { type: "integer", default: 25 },
          description: "Page size",
        },
      ],
      responses: { "200": { description: "OK" } },
    });

    const { inputSchema } = generateInputSchemaAndDetails(
      operation,
      undefined,
      15,
    );

    expect((inputSchema as any).properties.page_size.default).toBe(25);
  });

  it("should not set default when defaultPageSize is undefined", () => {
    const operation = new AAPOperationObject({
      operationId: "test_list",
      parameters: [
        {
          name: "page_size",
          in: "query",
          schema: { type: "integer" },
          description: "Page size",
        },
      ],
      responses: { "200": { description: "OK" } },
    });

    const { inputSchema } = generateInputSchemaAndDetails(operation);

    expect((inputSchema as any).properties.page_size.default).toBeUndefined();
  });
});

describe("clampNumericConstraints", () => {
  it("should clamp int64-max to Number.MAX_SAFE_INTEGER", () => {
    const schema: Record<string, any> = {
      type: "number",
      maximum: Number.MAX_SAFE_INTEGER + 10,
      minimum: -(Number.MAX_SAFE_INTEGER + 10),
    };
    clampNumericConstraints(schema);
    expect(schema.maximum).toBe(Number.MAX_SAFE_INTEGER);
    expect(schema.minimum).toBe(-Number.MAX_SAFE_INTEGER);
  });

  it("should not modify values within safe range", () => {
    const schema: Record<string, any> = {
      type: "number",
      maximum: 200,
      minimum: 0,
      maxLength: 255,
    };
    clampNumericConstraints(schema);
    expect(schema.maximum).toBe(200);
    expect(schema.minimum).toBe(0);
    expect(schema.maxLength).toBe(255);
  });

  it("should skip non-numeric keys", () => {
    const schema: Record<string, any> = {
      type: "number",
      maximum: "not a number",
    };
    clampNumericConstraints(schema);
    expect(schema.maximum).toBe("not a number");
  });
});

describe("mapOpenApiSchemaToJsonSchema", () => {
  it("should clamp int64-max in nested properties", () => {
    const schema = {
      type: "object" as const,
      properties: {
        forks: {
          type: "integer" as const,
          maximum: Number.MAX_SAFE_INTEGER + 10,
          minimum: 0,
        },
        timeout: {
          type: "integer" as const,
          maximum: Number.MAX_SAFE_INTEGER + 10,
          minimum: -(Number.MAX_SAFE_INTEGER + 10),
        },
      },
    };
    const result = mapOpenApiSchemaToJsonSchema(schema) as any;
    expect(result.properties.forks.maximum).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.properties.forks.minimum).toBe(0);
    expect(result.properties.timeout.maximum).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.properties.timeout.minimum).toBe(-Number.MAX_SAFE_INTEGER);
  });
});
