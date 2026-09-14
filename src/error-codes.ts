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
  /**
   * Parse error
   * Invalid JSON was received by the server.
   */
  PARSE_ERROR: -32700,

  /**
   * Invalid Request
   * The JSON sent is not a valid Request object.
   *
   * Used in AAP MCP Server for:
   * - HTTP transport-layer authentication failures (401)
   * - Missing or invalid Bearer token
   *
   * Rationale: Authentication failures occur at the HTTP transport layer,
   * before MCP protocol processing. The request cannot be processed because
   * it lacks valid authentication credentials at the transport level.
   * While not a perfect semantic match (this code is typically for malformed
   * JSON-RPC requests), it is the closest standard error code available.
   * The HTTP 401 status is the primary authentication failure signal;
   * this error code provides structured error details in the response body.
   *
   * Alternative considered: -32602 (Invalid params) was rejected because
   * authentication tokens are HTTP headers, not JSON-RPC method parameters.
   *
   * See: AAP-90954 (Error Code Migration & Cleanup)
   */
  INVALID_REQUEST: -32600,

  /**
   * Method not found
   * The method does not exist or is not available.
   */
  METHOD_NOT_FOUND: -32601,

  /**
   * Invalid params
   * Invalid method parameter(s) in the JSON-RPC request.
   */
  INVALID_PARAMS: -32602,

  /**
   * Internal error
   * Internal JSON-RPC error.
   *
   * Used in AAP MCP Server for:
   * - Unexpected server errors (500)
   * - Unhandled exceptions during request processing
   */
  INTERNAL_ERROR: -32603,
} as const;

/**
 * MCP-specific error codes (allocated from -32020 to -32099 range)
 *
 * Currently, AAP MCP Server does not use any MCP-specific error codes.
 * All errors use standard JSON-RPC codes from the JsonRpcErrorCode enum.
 *
 * Note: The MCP specification reserves this range for protocol-defined errors.
 * As of 2026-07-28, the spec does not define a specific error code for
 * authentication failures, which is why we use the standard -32600 code.
 */
export const McpErrorCode = {
  /**
   * Header mismatch (defined by MCP spec)
   * The HTTP headers do not match the corresponding values in the request body.
   *
   * Not currently used by AAP MCP Server, but included for reference.
   */
  HEADER_MISMATCH: -32020,
} as const;
