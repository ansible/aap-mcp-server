import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { createOriginValidationMiddleware } from "../../src/middleware/origin-validation.js";

const GATEWAY = "https://gateway.example.com";
const EXTRA = "https://chatbot.example.com";

/**
 * Invoke the middleware with a fake Express req/res/next and report which path
 * it took (next() = allowed, res.status().json() = rejected).
 */
const run = (allowlist: string[], origin?: string) => {
  const middleware = createOriginValidationMiddleware(allowlist);
  const req = {
    headers: origin === undefined ? {} : { origin },
  } as unknown as Request;

  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Response;
  const next = vi.fn();

  middleware(req, res, next);
  return { next, status, json };
};

describe("createOriginValidationMiddleware", () => {
  it("allows the auto-detected gateway origin (BASE_URL passed by the server)", () => {
    const { next, status } = run([GATEWAY], GATEWAY);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows customer-supplied origins in addition to the gateway (additive)", () => {
    // The server passes [BASE_URL, ...ALLOWED_ORIGINS]; both are accepted.
    expect(run([GATEWAY, EXTRA], GATEWAY).next).toHaveBeenCalledOnce();
    expect(run([GATEWAY, EXTRA], EXTRA).next).toHaveBeenCalledOnce();
  });

  it("normalizes allowlist entries so a trailing slash still matches", () => {
    const { next } = run([`${GATEWAY}/`], GATEWAY);
    expect(next).toHaveBeenCalledOnce();
  });

  it("always allows localhost origins even with an empty allowlist", () => {
    expect(run([], "http://localhost:5173").next).toHaveBeenCalledOnce();
    expect(run([], "http://127.0.0.1:3000").next).toHaveBeenCalledOnce();
  });

  it("allows requests with no Origin header (non-browser clients)", () => {
    const { next, status } = run([GATEWAY], undefined);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects a disallowed origin with 403 and a JSON-RPC error (no id)", () => {
    const { next, status, json } = run([GATEWAY], "https://evil.example.com");
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonrpc: "2.0",
        error: expect.objectContaining({
          message: expect.stringContaining("Origin"),
        }),
        id: null,
      }),
    );
  });

  it("rejects the literal Origin: null (sandboxed/file contexts)", () => {
    const { next, status } = run([GATEWAY], "null");
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
