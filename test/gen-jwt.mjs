#!/usr/bin/env node
/**
 * Generate a test JWT signed with the local private key.
 * Used for testing JWT authentication in the MCP server against the mock gateway.
 *
 * Usage:
 *   node test/gen-jwt.mjs
 *   node test/gen-jwt.mjs --username testuser --expires 2h
 */

import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");

const args = process.argv.slice(2);
const usernameIdx = args.indexOf("--username");
const expiresIdx = args.indexOf("--expires");

const username = usernameIdx !== -1 ? args[usernameIdx + 1] : "admin";
const expiresIn = expiresIdx !== -1 ? args[expiresIdx + 1] : "1h";

const privateKey = readFileSync(join(__dirname, "jwt_private.pem"));

const payload = {
  user_data: { username },
  aud: "ansible-services",
  iss: "ansible-issuer",
};

const token = jwt.sign(payload, privateKey, {
  algorithm: "RS256",
  expiresIn,
});

console.error(`Generated JWT for user "${username}" (expires in ${expiresIn}):`);
console.log(token);
