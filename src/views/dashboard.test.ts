import { describe, it, expect } from "vitest";
import { renderDashboard, type DashboardData } from "./dashboard";

describe("Dashboard View", () => {
  const mockDashboardData: DashboardData = {
    allTools: [
      {
        name: "tool1",
        service: "eda",
        size: 100,
        method: "GET",
        pathTemplate: "/test1",
        inputSchema: {},
        description: "Test tool 1",
        logs: [],
        parameters: [],
        executionParameters: [],
        securityRequirements: [],
        operationId: "test1",
        deprecated: false,
      },
      {
        name: "tool2",
        service: "controller",
        size: 200,
        method: "POST",
        pathTemplate: "/test2",
        inputSchema: {},
        description: "Test tool 2",
        logs: [],
        parameters: [],
        executionParameters: [],
        securityRequirements: [],
        operationId: "test2",
        deprecated: false,
      },
      {
        name: "tool3",
        service: "gateway",
        size: 300,
        method: "GET",
        pathTemplate: "/test3",
        inputSchema: {},
        description: "Test tool 3",
        logs: [],
        parameters: [],
        executionParameters: [],
        securityRequirements: [],
        operationId: "test3",
        deprecated: false,
      },
    ],
    allCategories: {
      admin: ["tool1", "tool2"],
      user: ["tool1"],
      operator: ["tool3"],
    },
    recordApiQueries: true,
    allowWriteOperations: true,
  };

  it("should render HTML dashboard", () => {
    const html = renderDashboard(mockDashboardData);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>AAP MCP Dashboard</title>");
    expect(html).toContain("</html>");
  });

  it("should include total tools count", () => {
    const html = renderDashboard(mockDashboardData);

    expect(html).toContain("3"); // Should show 3 total tools
  });

  it("should include categories count", () => {
    const html = renderDashboard(mockDashboardData);

    expect(html).toContain("3"); // Should show 3 categories
  });

  it("should include service information", () => {
    const html = renderDashboard(mockDashboardData);

    expect(html).toContain("eda");
    expect(html).toContain("controller");
    expect(html).toContain("gateway");
  });

  it("should show API query recording status when enabled", () => {
    const html = renderDashboard(mockDashboardData);

    expect(html).toContain("View Request Logs");
  });

  it("should handle API query recording disabled", () => {
    const dataWithNoLogging: DashboardData = {
      ...mockDashboardData,
      recordApiQueries: false,
    };

    const html = renderDashboard(dataWithNoLogging);

    expect(html).not.toContain("View Request Logs");
  });

  it("should handle empty tools array", () => {
    const emptyData: DashboardData = {
      allTools: [],
      allCategories: {},
      recordApiQueries: false,
      allowWriteOperations: false,
    };

    const html = renderDashboard(emptyData);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("0"); // Should show 0 tools
  });

  it("should calculate total size correctly", () => {
    const html = renderDashboard(mockDashboardData);

    // Total size should be 100 + 200 + 300 = 600, displayed as 1K (rounded 600/1000)
    expect(html).toContain("1K");
  });

  it("should include navigation links", () => {
    const html = renderDashboard(mockDashboardData);

    expect(html).toContain('href="/tools"');
    expect(html).toContain('href="/category"');
    expect(html).toContain('href="/services"');
  });

  it("should be valid HTML structure", () => {
    const html = renderDashboard(mockDashboardData);

    // Basic HTML structure validation
    expect(html).toMatch(/<!DOCTYPE html>/);
    expect(html).toMatch(/<html[^>]*>/);
    expect(html).toMatch(/<head[^>]*>/);
    expect(html).toMatch(/<\/head>/);
    expect(html).toMatch(/<body[^>]*>/);
    expect(html).toMatch(/<\/body>/);
    expect(html).toMatch(/<\/html>/);
  });
});
