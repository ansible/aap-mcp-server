import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";

export const MODERN_VERSION = "2026-07-28";
export const PROTOCOL_VERSION_META_KEY =
  "io.modelcontextprotocol/protocolVersion";
export const CLIENT_CAPABILITIES_META_KEY =
  "io.modelcontextprotocol/clientCapabilities";
export const BEARER_TOKEN = "test-bearer-token";

/** Enough of the AAP API for the server to authenticate and build its tools. */
export const startMockAapServer = (port: number): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const pathname = parseUrl(req.url || "", true).pathname || "";
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === "/api/gateway/v1/me/") {
        if (!req.headers["authorization"]?.startsWith("Bearer ")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "no creds" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              {
                id: 1,
                username: "test-user",
                email: "test@redhat.com",
                is_superuser: true,
                summary_fields: {
                  resource: {
                    ansible_id: "550e8400-e29b-41d4-a716-446655440000",
                  },
                },
              },
            ],
          }),
        );
        return;
      }

      if (pathname.includes("schema") || pathname.includes("openapi")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            openapi: "3.0.0",
            info: { title: "Mock API", version: "1.0.0" },
            paths: {},
          }),
        );
        return;
      }

      if (pathname.startsWith("/api/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ count: 0, results: [] }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
    server.listen(port, () => resolve(server));
  });

/** Pre-2026-07-28 clients are answered over SSE, modern ones over JSON. */
export const parseJsonRpcResponse = async (
  response: Response,
): Promise<any> => {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) throw new Error(`No SSE data frame in response: ${text}`);
    return JSON.parse(dataLine.slice("data:".length).trim());
  }
  return JSON.parse(text);
};

/** Methods whose body param the modern era mirrors into the Mcp-Name header. */
const MCP_NAME_HEADER_SOURCE: Record<string, string> = {
  "resources/read": "uri",
  "tools/call": "name",
};

let nextId = 1;

// The modern transport requires headers and body to agree, so Mcp-Method is
// always sent and Mcp-Name mirrored for the spec methods carrying a target.
export const mcpCall = async (
  baseUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${BEARER_TOKEN}`,
    "mcp-protocol-version": MODERN_VERSION,
    "mcp-method": method,
  };
  const nameSource = MCP_NAME_HEADER_SOURCE[method];
  if (nameSource && typeof params[nameSource] === "string") {
    headers["mcp-name"] = params[nameSource] as string;
  }

  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params: {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });

  return parseJsonRpcResponse(response);
};
