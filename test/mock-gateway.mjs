#!/usr/bin/env node
/**
 * Mock AAP Gateway for JWT authentication testing.
 *
 * This server does two things:
 *   1. Serves test/jwt_public.pem at /api/gateway/v1/jwt_key/ so the MCP server
 *      can validate JWTs signed with test/jwt_private.pem.
 *   2. Proxies all other requests to a real aap-dev instance, swapping the
 *      auth header: if the MCP server sends the correct X-DAB-JW-TOKEN header,
 *      the mock swaps it for a real Bearer token before forwarding. If it sends
 *      the wrong Authorization: Bearer <JWT>, the mock logs the error and
 *      forwards as-is (which will 401 at aap-dev).
 *
 * Usage:
 *   node test/mock-gateway.mjs
 *
 * Environment (set in test/.env or export manually):
 *   AAP_URL   - URL of the real aap-dev instance (default: http://localhost:44927)
 *   AAP_TOKEN - Real API token for proxying requests to aap-dev
 */

import { createServer } from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from test/ directory
const envPath = join(__dirname, ".env");
try {
  const envContents = readFileSync(envPath, "utf-8");
  for (const line of envContents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length) process.env[key] = rest.join("=");
  }
} catch {
  // .env is optional; fall back to environment variables
}

const PUBLIC_KEY = readFileSync(join(__dirname, "jwt_public.pem"), "utf-8");
const AAP_URL = process.env.AAP_URL || "http://localhost:44927";
const AAP_TOKEN = process.env.AAP_TOKEN;

if (!AAP_TOKEN) {
  console.error("ERROR: AAP_TOKEN is not set. Set it in test/.env or as an env var.");
  process.exit(1);
}

const PORT = 3001;

console.log(`Mock gateway starting on http://localhost:${PORT}`);
console.log(`Proxying to: ${AAP_URL}`);
console.log(`Public key: ${join(__dirname, "jwt_public.pem")}`);

createServer(async (req, res) => {
  const url = req.url || "/";

  // Serve the test public key for JWT validation
  // jwt-validator.ts expects JSON with a "public_key" field, not raw PEM
  if (url === "/api/gateway/v1/jwt_key/") {
    console.log(`[jwt_key] Serving public key`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ public_key: PUBLIC_KEY }));
    return;
  }

  // Collect request body
  const bodyChunks = [];
  for await (const chunk of req) bodyChunks.push(chunk);
  const body = Buffer.concat(bodyChunks);

  // Build outbound headers — copy incoming, then swap auth
  const outboundHeaders = { ...req.headers };
  delete outboundHeaders["host"]; // let fetch set the correct host

  if (outboundHeaders["x-dab-jw-token"]) {
    console.log(`[proxy] ✓ ${req.method} ${url} — X-DAB-JW-TOKEN received, swapping to Bearer`);
    delete outboundHeaders["x-dab-jw-token"];
    outboundHeaders["authorization"] = `Bearer ${AAP_TOKEN}`;
  } else if (outboundHeaders["authorization"]?.startsWith("Bearer ")) {
    const value = outboundHeaders["authorization"].slice(7);
    // Detect if the Bearer value looks like a JWT (three dot-separated base64 parts)
    const looksLikeJWT = value.split(".").length === 3;
    if (looksLikeJWT) {
      console.log(`[proxy] ✗ ${req.method} ${url} — Authorization: Bearer <JWT> received (wrong header!), forwarding as-is`);
      // Forward as-is — aap-dev will 401, which is expected for the broken case
    } else {
      console.log(`[proxy] ${req.method} ${url} — Authorization: Bearer <token> (real token), forwarding as-is`);
    }
  } else {
    console.log(`[proxy] ${req.method} ${url} — no auth header`);
  }

  // Proxy to real aap-dev
  try {
    const response = await fetch(`${AAP_URL}${url}`, {
      method: req.method,
      headers: outboundHeaders,
      body: body.length > 0 ? body : undefined,
    });

    const responseBody = await response.arrayBuffer();
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    console.log(`[proxy] → ${response.status} ${url}`);
    res.writeHead(response.status, responseHeaders);
    res.end(Buffer.from(responseBody));
  } catch (err) {
    console.error(`[proxy] Error proxying ${url}:`, err.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: "Proxy error", message: err.message }));
  }
}).listen(PORT, () => {
  console.log(`\nReady. Configure MCP server with BASE_URL=http://localhost:${PORT}\n`);
});
