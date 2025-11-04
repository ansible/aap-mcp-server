import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";

// Mock the fs module
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Helper function to create mock tools with all required properties
const createMockTool = (
  overrides: Partial<AAPMcpToolDefinition> = {},
): AAPMcpToolDefinition => ({
  name: "test-tool",
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

// Import after mocking
import {
  getDefaultServiceConfigs,
  reformatEdaTool,
  reformatGatewayTool,
  reformatGalaxyTool,
  reformatControllerTool,
  getReformatFunctions,
  filterEnabledServices,
  buildSpecEntries,
  loadSingleSpec,
  loadOpenApiSpecs,
  type AAPMcpToolDefinition,
  type ServiceConfig,
  type DefaultServiceConfig,
  type OpenApiSpecEntry,
} from "./openapi-loader";

describe("OpenAPI Loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("getDefaultServiceConfigs", () => {
    it("should return default configurations for all services", () => {
      const baseUrl = "https://example.com";
      const configs = getDefaultServiceConfigs(baseUrl);

      expect(configs).toEqual({
        eda: {
          url: "https://example.com/api/eda/v1/openapi.json",
        },
        gateway: {
          url: "https://example.com/api/gateway/v1/docs/schema/",
        },
        galaxy: {
          url: "https://example.com/api/galaxy/v3/openapi.json",
        },
        controller: {
          url: "https://s3.amazonaws.com/awx-public-ci-files/release_4.6/schema.json",
        },
      });
    });

    it("should handle different base URLs", () => {
      const baseUrl = "https://localhost:8080";
      const configs = getDefaultServiceConfigs(baseUrl);

      expect(configs.eda.url).toBe(
        "https://localhost:8080/api/eda/v1/openapi.json",
      );
      expect(configs.gateway.url).toBe(
        "https://localhost:8080/api/gateway/v1/docs/schema/",
      );
      expect(configs.galaxy.url).toBe(
        "https://localhost:8080/api/galaxy/v3/openapi.json",
      );
      expect(configs.controller.url).toBe(
        "https://s3.amazonaws.com/awx-public-ci-files/release_4.6/schema.json",
      );
    });
  });

  describe("reformatEdaTool", () => {
    it("should add eda prefix and update path template", () => {
      const mockTool = createMockTool();

      const result = reformatEdaTool(mockTool);

      expect(result.name).toBe("eda.test-tool");
      expect(result.pathTemplate).toBe("/api/eda/v1/test/path");
    });
  });

  describe("reformatGatewayTool", () => {
    it("should add gateway prefix and trim description", () => {
      const mockTool = createMockTool({
        description: "Test tool description\n\nExtra details",
      });

      const result = reformatGatewayTool(mockTool);

      expect(result).toBeTruthy();
      if (result) {
        expect(result.name).toBe("gateway.test-tool");
        expect(result.description).toBe("Test tool description");
      }
    });

    it("should filter out legacy tools", () => {
      const mockTool = createMockTool({
        name: "legacy-tool",
        description: "Legacy tool description",
      });

      const result = reformatGatewayTool(mockTool);

      expect(result).toBeTruthy();
      if (result) {
        expect(result.logs).toContainEqual({
          severity: "WARN",
          msg: "tool should be marked as deprecated",
        });
      }
    });

    it("should handle tools without description", () => {
      const mockTool = createMockTool({
        description: undefined,
      });

      const result = reformatGatewayTool(mockTool);

      expect(result).toBeTruthy();
      if (result) {
        expect(result.name).toBe("gateway.test-tool");
      }
    });
  });

  describe("reformatGalaxyTool", () => {
    it("should filter out UI tools", () => {
      const mockTool = createMockTool({
        name: "api_galaxy_v3_ui_tool",
        pathTemplate: "/api/galaxy/_ui/test",
      });

      const result = reformatGalaxyTool(mockTool);

      expect(result).toBe(false);
    });

    it("should filter out non-v3 tools", () => {
      const mockTool = createMockTool({
        name: "api_galaxy_v2_tool",
      });

      const result = reformatGalaxyTool(mockTool);

      expect(result).toBe(false);
      expect(mockTool.logs).toContainEqual({
        severity: "INFO",
        msg: "tool ignored, name doesn't start with api_galaxy_v3",
      });
    });

    it("should rename v3 tools correctly", () => {
      const mockTool = createMockTool({
        name: "api_galaxy_v3_collections_create",
      });

      const result = reformatGalaxyTool(mockTool);

      expect(result).toBeTruthy();
      if (result) {
        expect(result.name).toBe("galaxy.collections_create");
      }
    });
  });

  describe("reformatControllerTool", () => {
    it("should update path template and name", () => {
      const mockTool = createMockTool({
        name: "api_jobs_list",
        pathTemplate: "/api/v2/jobs/",
        description: "List jobs\n\nExtra details",
      });

      const result = reformatControllerTool(mockTool);

      expect(result.name).toBe("controller.jobs_list");
      expect(result.pathTemplate).toBe("/api/controller/v2/jobs/");
      expect(result.description).toBe("List jobs");
    });

    it("should handle tools without path template", () => {
      const mockTool = createMockTool({
        name: "api_test_tool",
        pathTemplate: undefined,
      });

      const result = reformatControllerTool(mockTool);

      expect(result.name).toBe("controller.test_tool");
    });
  });

  describe("getReformatFunctions", () => {
    it("should return all reformat functions", () => {
      const functions = getReformatFunctions();

      expect(functions).toHaveProperty("eda");
      expect(functions).toHaveProperty("gateway");
      expect(functions).toHaveProperty("galaxy");
      expect(functions).toHaveProperty("controller");
      expect(typeof functions.eda).toBe("function");
      expect(typeof functions.gateway).toBe("function");
      expect(typeof functions.galaxy).toBe("function");
      expect(typeof functions.controller).toBe("function");
    });
  });

  describe("filterEnabledServices", () => {
    const mockDefaultConfigs: Record<string, DefaultServiceConfig> = {
      eda: { url: "http://example.com/eda" },
      gateway: { url: "http://example.com/gateway" },
      controller: { url: "http://example.com/controller" },
    };

    it("should filter enabled services", () => {
      const servicesConfig: ServiceConfig[] = [
        { name: "eda", enabled: true },
        { name: "gateway", enabled: false },
        { name: "controller" }, // defaults to enabled
      ];

      const result = filterEnabledServices(servicesConfig, mockDefaultConfigs);

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toEqual(["eda", "controller"]);
    });

    it("should filter out services not in default configs", () => {
      const servicesConfig: ServiceConfig[] = [
        { name: "eda", enabled: true },
        { name: "unknown" as any, enabled: true },
      ];

      const result = filterEnabledServices(servicesConfig, mockDefaultConfigs);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("eda");
    });
  });

  describe("buildSpecEntries", () => {
    const mockDefaultConfigs: Record<string, DefaultServiceConfig> = {
      eda: { url: "http://example.com/eda" },
      gateway: { url: "http://example.com/gateway" },
    };

    const mockReformatFunctions = {
      eda: vi.fn(),
      gateway: vi.fn(),
    };

    it("should build spec entries correctly", () => {
      const servicesConfig: ServiceConfig[] = [
        { name: "eda", url: "http://custom.com/eda" },
        { name: "gateway", local_path: "/path/to/spec.json" },
      ];

      const result = buildSpecEntries(
        servicesConfig,
        mockDefaultConfigs,
        mockReformatFunctions,
      );

      expect(result).toHaveLength(2);

      expect(result[0]).toEqual({
        url: "http://custom.com/eda",
        localPath: undefined,
        reformatFunc: mockReformatFunctions.eda,
        service: "eda",
      });

      expect(result[1]).toEqual({
        url: "http://example.com/gateway",
        localPath: "/path/to/spec.json",
        reformatFunc: mockReformatFunctions.gateway,
        service: "gateway",
      });
    });

    it("should use default URLs when not specified", () => {
      const servicesConfig: ServiceConfig[] = [{ name: "eda" }];

      const result = buildSpecEntries(
        servicesConfig,
        mockDefaultConfigs,
        mockReformatFunctions,
      );

      expect(result[0].url).toBe("http://example.com/eda");
    });
  });

  describe("loadSingleSpec", () => {
    it("should load spec from local file", async () => {
      const mockSpec = { openapi: "3.0.0", info: { title: "Test API" } };
      const mockReadFileSync = vi.mocked(readFileSync);
      mockReadFileSync.mockReturnValue(JSON.stringify(mockSpec));

      const specEntry: OpenApiSpecEntry = {
        url: "http://example.com",
        localPath: "/path/to/spec.json",
        reformatFunc: vi.fn(),
        service: "test",
      };

      const result = await loadSingleSpec(specEntry);

      expect(mockReadFileSync).toHaveBeenCalledWith(
        "/path/to/spec.json",
        "utf8",
      );
      expect(result.spec).toEqual(mockSpec);
    });

    it("should load spec from URL", async () => {
      const mockSpec = { openapi: "3.0.0", info: { title: "Test API" } };
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSpec),
      } as Response);

      const specEntry: OpenApiSpecEntry = {
        url: "http://example.com/spec.json",
        reformatFunc: vi.fn(),
        service: "test",
      };

      const result = await loadSingleSpec(specEntry);

      expect(mockFetch).toHaveBeenCalledWith("http://example.com/spec.json", {
        headers: { Accept: "application/json" },
      });
      expect(result.spec).toEqual(mockSpec);
    });

    it("should handle fetch errors gracefully", async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const specEntry: OpenApiSpecEntry = {
        url: "http://example.com/spec.json",
        reformatFunc: vi.fn(),
        service: "test",
      };

      const result = await loadSingleSpec(specEntry);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error loading OpenAPI spec"),
        expect.any(Error),
      );
      expect(result.spec).toBeUndefined();
    });

    it("should handle file read errors gracefully", async () => {
      const mockReadFileSync = vi.mocked(readFileSync);
      mockReadFileSync.mockImplementation(() => {
        throw new Error("File not found");
      });

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const specEntry: OpenApiSpecEntry = {
        url: "http://example.com",
        localPath: "/nonexistent/spec.json",
        reformatFunc: vi.fn(),
        service: "test",
      };

      const result = await loadSingleSpec(specEntry);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error loading OpenAPI spec"),
        expect.any(Error),
      );
      expect(result.spec).toBeUndefined();
    });
  });

  describe("loadOpenApiSpecs", () => {
    it("should load specs for all configured services", async () => {
      const mockSpec1 = { openapi: "3.0.0", info: { title: "EDA API" } };
      const mockSpec2 = { openapi: "3.0.0", info: { title: "Gateway API" } };

      const mockFetch = vi.mocked(fetch);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSpec1),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSpec2),
        } as Response);

      const servicesConfig: ServiceConfig[] = [
        { name: "eda" },
        { name: "gateway" },
      ];

      const result = await loadOpenApiSpecs(
        servicesConfig,
        "https://example.com",
      );

      expect(result).toHaveLength(2);
      expect(result[0].service).toBe("eda");
      expect(result[0].spec).toEqual(mockSpec1);
      expect(result[1].service).toBe("gateway");
      expect(result[1].spec).toEqual(mockSpec2);
    });

    it("should handle empty services config", async () => {
      const result = await loadOpenApiSpecs([], "https://example.com");

      expect(result).toHaveLength(0);
    });

    it("should filter disabled services", async () => {
      const servicesConfig: ServiceConfig[] = [
        { name: "eda", enabled: true },
        { name: "gateway", enabled: false },
      ];

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ openapi: "3.0.0" }),
      } as Response);

      const result = await loadOpenApiSpecs(
        servicesConfig,
        "https://example.com",
      );

      expect(result).toHaveLength(1);
      expect(result[0].service).toBe("eda");
    });
  });
});
