/**
 * JSON-RPC 2.0 and MCP Error Code Constants
 *
 * This file defines error codes used in AAP MCP Server responses.
 *
 * ## Error Code Ranges
 *
 * ### JSON-RPC 2.0 Standard:
 * - `-32768` to `-32000`: Reserved for pre-defined errors (standard codes)
 *   - `-32700` = Parse error
 *   - `-32600` = Invalid Request
 *   - `-32601` = Method not found
 *   - `-32602` = Invalid params
 *   - `-32603` = Internal error
 * - `-32000` to `-32099`: Reserved for implementation-defined server errors
 *
 * ### MCP Specification Partitioning (2026-07-28):
 * MCP partitions the implementation-defined range as follows:
 * - `-32000` to `-32019`: **Legacy** (SHOULD NOT use in new implementations)
 * - `-32020` to `-32099`: **Reserved for MCP specification**
 *
 * ## References
 * - JSON-RPC 2.0: https://www.jsonrpc.org/specification
 * - MCP Error Codes: https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes
 * - MCP Changelog (Minor #12): https://modelcontextprotocol.io/specification/2026-07-28/changelog#minor-changes
 */

/**
 * JSON-RPC 2.0 standard error codes
 */
export const JsonRpcErrorCode = {
  // Invalid JSON was received by the server
  PARSE_ERROR: -32700,

  /**
   * Invalid Request - The JSON sent is not a valid Request object.
   *
   * Usage: Generic error for requests that cannot be processed. Used for HTTP
   * transport-layer authentication failures (missing/invalid Bearer tokens).
   *
   * Rationale: Auth failures occur at the HTTP layer before MCP protocol processing.
   * While -32600 typically signals malformed JSON-RPC structure, it's the closest
   * standard code for "request cannot be processed due to transport-level issues."
   * Conforms to JSON-RPC error response structure while HTTP 401 status provides
   * the primary authentication failure signal.
   *
   * Note: -32602 (Invalid params) was considered but rejected since authentication
   * tokens are HTTP headers, not JSON-RPC method parameters.
   */
  INVALID_REQUEST: -32600,

  // The method does not exist or is not available
  METHOD_NOT_FOUND: -32601,

  // Invalid method parameter(s) in the JSON-RPC request
  INVALID_PARAMS: -32602,

  // Internal JSON-RPC error (used for unexpected server errors)
  INTERNAL_ERROR: -32603,
} as const;

/**
 * MCP-specific error codes (allocated from -32020 to -32099 range)
 *
 * Note: Currently all errors use standard JSON-RPC codes. MCP spec (2026-07-28)
 * reserves this range for protocol-defined errors but does not define a specific
 * error code for authentication failures.
 */
export const McpErrorCode = {
  // HTTP headers do not match corresponding values in request body (not currently used)
  HEADER_MISMATCH: -32020,
} as const;
