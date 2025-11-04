/**
 * Global test setup file
 * This file runs before all tests and sets up the testing environment
 */

import { vi } from "vitest";

// Mock environment variables for testing
process.env.NODE_ENV = "test";
process.env.BASE_URL = "https://test.example.com";
process.env.BEARER_TOKEN = "test-token";
process.env.RECORD_API_QUERIES = "false";
process.env.ENABLE_UI = "true";
process.env.IGNORE_CERTIFICATE_ERRORS = "true";

// Global mocks
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: {
      readdir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      access: vi.fn(),
    },
  };
});

// Mock yaml module
vi.mock("js-yaml", () => ({
  load: vi.fn(),
  dump: vi.fn(),
}));

// Mock dotenv
vi.mock("dotenv", () => ({
  config: vi.fn(),
}));

// Mock express
vi.mock("express", () => {
  const mockApp = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    listen: vi.fn(),
  };

  const express = vi.fn(() => mockApp);
  express.json = vi.fn();

  return {
    default: express,
  };
});

// Mock CORS
vi.mock("cors", () => ({
  default: vi.fn(),
}));

// Suppress console.log during tests unless explicitly needed
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeEach(() => {
  console.log = vi.fn();
  console.error = vi.fn();
  console.warn = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});
