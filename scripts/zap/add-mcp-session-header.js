/**
 * ZAP HttpSender Script - Add MCP Session Header
 *
 * This script adds the Mcp-Session-Id header to all requests in scope
 * made by ZAP during security scanning.
 *
 * The session ID is stored as a global variable by the pre-authentication step
 * and retrieved here to be injected into every request.
 */

var HttpSender = Java.type("org.parosproxy.paros.network.HttpSender");
var ScriptVars = Java.type("org.zaproxy.zap.extension.script.ScriptVars");

function logger(message) {
    print('[add-mcp-session-header] ' + message);
}

function sendingRequest(msg, initiator, helper) {
    // Get the MCP session ID from global variables
    var sessionId = ScriptVars.getGlobalVar("mcpSessionId");

    // Add Mcp-Session-Id header to all requests in scope
    if (msg.isInScope() && sessionId && sessionId !== 'MCP_SESSION_ID_PLACEHOLDER') {
        logger("Adding Mcp-Session-Id header: " + sessionId);
        msg.getRequestHeader().setHeader("Mcp-Session-Id", sessionId);
    }

    return msg;
}

function responseReceived(msg, initiator, helper) {
    // No action needed on response
}
