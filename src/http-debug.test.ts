import { describe, it, expect } from "vitest";
import { describeInboundAuth, extractMcpRpcMethod } from "./http-debug.js";

describe("describeInboundAuth", () => {
  it("reports missing auth", () => {
    expect(describeInboundAuth(undefined)).toBe("missing");
  });

  it("reports empty bearer token", () => {
    expect(describeInboundAuth("Bearer ")).toBe("Bearer(empty)");
  });

  it("reports bearer token length without exposing value", () => {
    expect(describeInboundAuth("Bearer secret-token")).toBe("Bearer(12 chars)");
  });

  it("reports non-bearer schemes", () => {
    expect(describeInboundAuth("Basic dXNlcjpwYXNz")).toBe("present(Basic)");
  });
});

describe("extractMcpRpcMethod", () => {
  it("extracts jsonrpc method from request body", () => {
    expect(
      extractMcpRpcMethod({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
      }),
    ).toBe("initialize");
  });

  it("returns undefined for non-object bodies", () => {
    expect(extractMcpRpcMethod(null)).toBeUndefined();
    expect(extractMcpRpcMethod("initialize")).toBeUndefined();
  });
});
