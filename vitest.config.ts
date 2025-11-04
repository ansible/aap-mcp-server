import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Enable globals like describe, it, expect
    globals: true,

    // Test environment
    environment: "node",

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/__tests__/**",
        "src/types.ts",
        "node_modules/",
        "dist/",
        "coverage/",
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },

    // Test files patterns
    include: ["src/**/*.{test,spec}.{js,ts}", "tests/**/*.{test,spec}.{js,ts}"],

    // Test timeout
    testTimeout: 10000,

    // Watch options
    watch: false,

    // Mock options
    clearMocks: true,
    restoreMocks: true,

    // Reporter options
    reporter: ["verbose", "json", "html"],
    outputFile: {
      json: "./test-results.json",
      html: "./test-results.html",
    },
  },

  // Resolve options for imports
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
