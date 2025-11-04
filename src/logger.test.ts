import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";

// Mock the fs module
vi.mock("fs", () => ({
  promises: {
    mkdir: vi.fn(),
    appendFile: vi.fn(),
  },
}));

// Import after mocking
import { ToolLogger, type Tool } from "./logger";

describe("ToolLogger", () => {
  let logger: ToolLogger;
  const mockLogDir = "test-logs";

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new ToolLogger(mockLogDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create logger with log directory", () => {
      expect(logger).toBeInstanceOf(ToolLogger);
    });

    it("should use default logs directory when not specified", () => {
      const defaultLogger = new ToolLogger();
      expect(defaultLogger).toBeInstanceOf(ToolLogger);
    });
  });

  describe("logToolAccess", () => {
    const mockTool: Tool = {
      name: "test-tool",
      service: "eda",
    };

    const mockPayload = { test: "data" };
    const mockResponse = { success: true };
    const mockEndpoint = "/test/endpoint";
    const mockReturnCode = 200;

    it("should log tool access successfully", async () => {
      const mockAppendFile = vi.mocked(fs.appendFile);
      mockAppendFile.mockResolvedValue(undefined);

      await logger.logToolAccess(
        mockTool,
        mockEndpoint,
        mockPayload,
        mockResponse,
        mockReturnCode,
      );

      expect(mockAppendFile).toHaveBeenCalledWith(
        join(mockLogDir, `${mockTool.name}.jsonl`),
        expect.stringContaining('"endpoint":"/test/endpoint"'),
      );
      expect(mockAppendFile).toHaveBeenCalledWith(
        join(mockLogDir, `${mockTool.name}.jsonl`),
        expect.stringContaining('"return_code":200'),
      );
    });

    it("should include timestamp in log entry", async () => {
      const mockAppendFile = vi.mocked(fs.appendFile);
      mockAppendFile.mockResolvedValue(undefined);

      await logger.logToolAccess(
        mockTool,
        mockEndpoint,
        mockPayload,
        mockResponse,
        mockReturnCode,
      );

      const logContent = mockAppendFile.mock.calls[0][1] as string;
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry).toHaveProperty("timestamp");
      expect(new Date(logEntry.timestamp)).toBeInstanceOf(Date);
    });

    it("should handle logging errors gracefully", async () => {
      const mockAppendFile = vi.mocked(fs.appendFile);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mockAppendFile.mockRejectedValue(new Error("Write failed"));

      await logger.logToolAccess(
        mockTool,
        mockEndpoint,
        mockPayload,
        mockResponse,
        mockReturnCode,
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write to log file"),
        expect.any(Error),
      );
    });

    it("should create correct log file path", async () => {
      const mockAppendFile = vi.mocked(fs.appendFile);
      mockAppendFile.mockResolvedValue(undefined);

      await logger.logToolAccess(
        mockTool,
        mockEndpoint,
        mockPayload,
        mockResponse,
        mockReturnCode,
      );

      expect(mockAppendFile).toHaveBeenCalledWith(
        join(mockLogDir, `${mockTool.name}.jsonl`),
        expect.any(String),
      );
    });

    it("should log all provided data", async () => {
      const mockAppendFile = vi.mocked(fs.appendFile);
      mockAppendFile.mockResolvedValue(undefined);

      await logger.logToolAccess(
        mockTool,
        mockEndpoint,
        mockPayload,
        mockResponse,
        mockReturnCode,
      );

      const logContent = mockAppendFile.mock.calls[0][1] as string;
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry).toMatchObject({
        endpoint: mockEndpoint,
        payload: mockPayload,
        response: mockResponse,
        return_code: mockReturnCode,
      });
    });
  });

  describe("ensureLogDir", () => {
    it("should create log directory on initialization", async () => {
      const mockMkdir = vi.mocked(fs.mkdir);
      mockMkdir.mockResolvedValue(undefined);

      new ToolLogger(mockLogDir);

      expect(mockMkdir).toHaveBeenCalledWith(mockLogDir, { recursive: true });
    });

    it("should handle directory creation errors gracefully", async () => {
      const mockMkdir = vi.mocked(fs.mkdir);
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mockMkdir.mockRejectedValue(new Error("Permission denied"));

      const logger = new ToolLogger(mockLogDir);

      // Wait for the async ensureLogDir to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to create log directory:",
        expect.any(Error),
      );
    });
  });
});
