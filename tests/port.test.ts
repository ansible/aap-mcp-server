import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveMcpPort, DEFAULT_MCP_PORT } from "../src/port.js";

describe("resolveMcpPort", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns the default when unset", () => {
    expect(resolveMcpPort(undefined)).toBe(DEFAULT_MCP_PORT);
    expect(resolveMcpPort("")).toBe(DEFAULT_MCP_PORT);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("parses a valid numeric port", () => {
    expect(resolveMcpPort("3000")).toBe(3000);
    expect(resolveMcpPort("8080")).toBe(8080);
    expect(resolveMcpPort("1")).toBe(1);
    expect(resolveMcpPort("65535")).toBe(65535);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // AAP-90657: Kubernetes service links inject MCP_PORT=tcp://<ip>:<port>
  // when a Service named "mcp" exists in the namespace.
  it("rejects a Kubernetes service-link connection string and warns", () => {
    expect(resolveMcpPort("tcp://172.30.47.233:8086")).toBe(DEFAULT_MCP_PORT);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("rejects non-integer and out-of-range values", () => {
    for (const bad of ["abc", "3000abc", "30.5", "0", "-1", "65536", "99999"]) {
      expect(resolveMcpPort(bad)).toBe(DEFAULT_MCP_PORT);
    }
  });
});
