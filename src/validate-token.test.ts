import { describe, it, expect, vi, beforeEach } from "vitest";

// index.ts reads aap-mcp.yaml from cwd at import time; mock fs so the module
// loads with a minimal valid config (no services -> no spec fetches).
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    readFileSync: vi.fn(() => "toolsets: {}\nservices: []\n"),
    writeFileSync: vi.fn(),
  };
});

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
  return { default: express };
});

vi.mock("cors", () => ({ default: vi.fn() }));
vi.mock("dotenv", () => ({ config: vi.fn() }));

import { validateToken } from "./index.js";

describe("validateToken", () => {
  const makeResponse = (status: number, body: unknown = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("accepts a valid token via the gateway identity endpoint", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      makeResponse(200, { results: [{ email: "a@b.c" }] }),
    );

    await expect(validateToken("good-token")).resolves.toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as any).mock.calls[0][0]).toContain(
      "/api/gateway/v1/me/",
    );
  });

  it("falls back to the controller identity endpoint only on gateway 404", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(makeResponse(404))
      .mockResolvedValueOnce(makeResponse(200, { results: [{}] }));

    await expect(validateToken("good-token")).resolves.toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as any).mock.calls[1][0]).toContain("/api/v2/me/");
  });

  it("does not fall back on gateway 401", async () => {
    (global.fetch as any).mockResolvedValueOnce(makeResponse(401));

    await expect(validateToken("bad-token")).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects when both gateway and controller identity endpoints 404", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(makeResponse(404))
      .mockResolvedValueOnce(makeResponse(404));

    await expect(validateToken("any-token")).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
