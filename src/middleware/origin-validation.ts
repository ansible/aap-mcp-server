import type { Request, Response, NextFunction } from "express";
import { JsonRpcErrorCode } from "../error-codes.js";

/**
 * Origin header validation middleware — MCP Streamable HTTP spec (MUST):
 * present-and-invalid `Origin` → 403. Browser-only control; missing `Origin`
 * (non-browser clients) and localhost are allowed. Caller supplies the rest of
 * the allowlist (gateway + own origin + extras).
 * https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#security--endpoint
 */

// `new URL()` always brackets IPv6 hosts, so hostname is `[::1]`, never `::1`.
const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Parsed URL, or null if unparseable (e.g. the literal `null`).
const parseOrigin = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

// Allowlist entries are normalized so trailing slashes/paths in config still match.
export const createOriginValidationMiddleware = (allowedOrigins: string[]) => {
  const allowed = new Set(
    allowedOrigins
      .map((entry) => parseOrigin(entry))
      .filter((url): url is URL => url !== null)
      .map((url) => url.origin),
  );

  const isAllowed = (origin: string): boolean => {
    const url = parseOrigin(origin);
    return (
      url !== null &&
      (LOCALHOST_HOSTNAMES.has(url.hostname) || allowed.has(url.origin))
    );
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // Missing Origin (non-browser client) or allowlisted/localhost: pass through.
    if (!origin || isAllowed(origin)) {
      next();
      return;
    }

    // Present-and-invalid: reject per spec (JSON-RPC error, no `id`).
    res.status(403).json({
      jsonrpc: "2.0",
      error: {
        code: JsonRpcErrorCode.INVALID_REQUEST,
        message: "Forbidden: Origin not allowed",
      },
      id: null,
    });
  };
};
