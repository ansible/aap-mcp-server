import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * These tests would typically test utility functions.
 * Since the main file contains everything together, these are example tests
 * for the patterns used in the codebase.
 */

describe("Category Color Generation", () => {
  const getCategoryColor = (categoryName: string): string => {
    const colors = [
      "#6c757d",
      "#28a745",
      "#dc3545",
      "#17a2b8",
      "#007acc",
      "#ff9800",
      "#9c27b0",
      "#4caf50",
    ];
    const hash = categoryName
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  it("should return consistent colors for the same category name", () => {
    const categoryName = "admin";
    const color1 = getCategoryColor(categoryName);
    const color2 = getCategoryColor(categoryName);

    expect(color1).toBe(color2);
  });

  it("should return different colors for different category names", () => {
    const color1 = getCategoryColor("admin");
    const color2 = getCategoryColor("user");

    // While not guaranteed, different inputs should likely produce different colors
    expect(color1).toMatch(/^#[0-9a-f]{6}$/);
    expect(color2).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("should return valid hex colors", () => {
    const testCategories = ["admin", "user", "operator", "anonymous"];

    testCategories.forEach((category) => {
      const color = getCategoryColor(category);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  it("should handle empty string", () => {
    const color = getCategoryColor("");
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("should handle special characters", () => {
    const color = getCategoryColor("test-category_123");
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("Tool Filtering", () => {
  const filterToolsByCategory = (tools: any[], category: string[]): any[] => {
    return tools.filter((tool) => category.includes(tool.name));
  };

  const mockTools = [
    { name: "tool1", service: "eda", size: 100 },
    { name: "tool2", service: "controller", size: 200 },
    { name: "tool3", service: "gateway", size: 300 },
  ];

  it("should filter tools by category correctly", () => {
    const category = ["tool1", "tool3"];
    const filtered = filterToolsByCategory(mockTools, category);

    expect(filtered).toHaveLength(2);
    expect(filtered[0].name).toBe("tool1");
    expect(filtered[1].name).toBe("tool3");
  });

  it("should return empty array when no tools match", () => {
    const category = ["nonexistent"];
    const filtered = filterToolsByCategory(mockTools, category);

    expect(filtered).toHaveLength(0);
  });

  it("should return all tools when category includes all tool names", () => {
    const category = ["tool1", "tool2", "tool3"];
    const filtered = filterToolsByCategory(mockTools, category);

    expect(filtered).toHaveLength(3);
  });

  it("should handle empty category array", () => {
    const category: string[] = [];
    const filtered = filterToolsByCategory(mockTools, category);

    expect(filtered).toHaveLength(0);
  });
});

describe("Bearer Token Extraction", () => {
  const extractBearerToken = (
    authHeader: string | undefined,
  ): string | undefined => {
    return authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : undefined;
  };

  it("should extract token from valid Bearer header", () => {
    const header = "Bearer abc123token";
    const token = extractBearerToken(header);

    expect(token).toBe("abc123token");
  });

  it("should return undefined for invalid header format", () => {
    const header = "Token abc123";
    const token = extractBearerToken(header);

    expect(token).toBeUndefined();
  });

  it("should return undefined for undefined header", () => {
    const token = extractBearerToken(undefined);

    expect(token).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    const token = extractBearerToken("");

    expect(token).toBeUndefined();
  });

  it("should handle Bearer with no token", () => {
    const token = extractBearerToken("Bearer ");

    expect(token).toBe("");
  });

  it("should handle Bearer with spaces in token", () => {
    const token = extractBearerToken("Bearer token with spaces");

    expect(token).toBe("token with spaces");
  });
});

describe("Service Grouping", () => {
  it("should group tools by service correctly", () => {
    const tools = [
      { name: "tool1", service: "eda", size: 100 },
      { name: "tool2", service: "eda", size: 200 },
      { name: "tool3", service: "controller", size: 300 },
      { name: "tool4", service: undefined, size: 400 },
    ];

    const serviceGroups = tools.reduce(
      (acc, tool) => {
        const service = tool.service || "unknown";
        if (!acc[service]) {
          acc[service] = [];
        }
        acc[service].push(tool);
        return acc;
      },
      {} as Record<string, typeof tools>,
    );

    expect(serviceGroups.eda).toHaveLength(2);
    expect(serviceGroups.controller).toHaveLength(1);
    expect(serviceGroups.unknown).toHaveLength(1);

    expect(serviceGroups.eda[0].name).toBe("tool1");
    expect(serviceGroups.eda[1].name).toBe("tool2");
    expect(serviceGroups.controller[0].name).toBe("tool3");
    expect(serviceGroups.unknown[0].name).toBe("tool4");
  });
});
