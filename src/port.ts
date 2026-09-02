export const DEFAULT_MCP_PORT = 3000;

/**
 * Resolve the MCP server listen port from a raw environment value.
 *
 * MCP_PORT is vulnerable to Kubernetes "service links": when a Service named
 * "mcp" exists in the namespace, the kubelet injects MCP_PORT=tcp://<ip>:<port>
 * into every pod, clobbering our intended numeric value. Binding on that string
 * leaves nothing listening on the default port, so the NGINX sidecar returns a
 * 502. Accept only a valid TCP port number and fall back to the default for
 * anything else (a connection string, a non-integer, an out-of-range value).
 *
 * See AAP-90657.
 */
export const resolveMcpPort = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") {
    return DEFAULT_MCP_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(
      `Ignoring invalid MCP_PORT value "${raw}"; falling back to ${DEFAULT_MCP_PORT}. ` +
        `A Kubernetes Service named "mcp" can inject a colliding MCP_PORT via service links.`,
    );
    return DEFAULT_MCP_PORT;
  }
  return port;
};
