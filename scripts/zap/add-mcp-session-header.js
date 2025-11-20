/**
 * ZAP HTTP Sender Script - Add MCP Session ID Header
 *
 * This script intercepts all outgoing HTTP requests from ZAP
 * and adds the Mcp-Session-Id header to enable authenticated scanning.
 *
 * The session ID is stored as a global variable by the automation framework.
 */

function sendingRequest(msg, initiator, helper) {
  // Get the MCP session ID from global variable
  var sessionId = org.zaproxy.zap.extension.script.ScriptVars.getGlobalVar('mcpSessionId');

  if (sessionId != null && sessionId != '') {
    // Add the Mcp-Session-Id header to the request
    msg.getRequestHeader().setHeader('Mcp-Session-Id', sessionId);

    // Also ensure we have the Accept header for MCP endpoints
    var uri = msg.getRequestHeader().getURI().toString();
    if (uri.indexOf('/mcp') !== -1) {
      msg.getRequestHeader().setHeader('Accept', 'application/json, text/event-stream');
      msg.getRequestHeader().setHeader('Content-Type', 'application/json');
    }
  }
}

function responseReceived(msg, initiator, helper) {
  // No action needed on response
}
