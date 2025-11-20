/**
 * ZAP Session Management Script for MCP Protocol
 *
 * This script adds the MCP session ID header to all outgoing requests
 */

// This function is called for every request
function processMessageToMatchSession(helper) {
    var msg = helper.getMessage();
    var sessionId = helper.getHttpState().getAttribute("mcp-session-id");

    if (sessionId != null && sessionId.length() > 0) {
        // Add the session ID header to the request
        msg.getRequestHeader().setHeader("Mcp-Session-Id", sessionId);
        print("MCP Session: Added session ID to request: " + msg.getRequestHeader().getURI().toString());
    } else {
        print("MCP Session: No session ID available for request: " + msg.getRequestHeader().getURI().toString());
    }
}

// This function extracts the session ID from responses (in case it changes)
function extractWebSession(helper) {
    var msg = helper.getMessage();
    var sessionId = msg.getResponseHeader().getHeader("Mcp-Session-Id");

    if (sessionId != null && sessionId.length() > 0) {
        print("MCP Session: Extracted session ID from response: " + sessionId);
        helper.getHttpState().setAttribute("mcp-session-id", sessionId);
        return sessionId;
    }

    return null;
}

// This function clears the session
function clearWebSessionIdentifiers(helper) {
    print("MCP Session: Clearing session");
    helper.getHttpState().removeAttribute("mcp-session-id");
}
