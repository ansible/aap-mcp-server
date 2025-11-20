/**
 * ZAP Authentication Script for MCP Protocol
 *
 * This script handles MCP session initialization by:
 * 1. Sending an MCP initialization request
 * 2. Extracting the session ID from response headers
 * 3. Making the session ID available for subsequent requests
 */

// The authenticate function is called to perform authentication
function authenticate(helper, paramsValues, credentials) {
    var HttpRequestHeader = Java.type('org.parosproxy.paros.network.HttpRequestHeader');
    var HttpHeader = Java.type('org.parosproxy.paros.network.HttpHeader');
    var URI = Java.type('org.apache.commons.httpclient.URI');

    // Get the target URL from parameters
    var loginUrl = paramsValues.get("Login URL");
    var bearerToken = credentials.getParam("token");

    print("MCP Authentication: Starting session initialization for " + loginUrl);

    // Create the MCP initialization request body
    var initRequest = JSON.stringify({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "ZAP-Security-Scanner",
                "version": "1.0.0"
            }
        }
    });

    // Create HTTP message
    var msg = helper.prepareMessage();

    // Set request line
    var requestHeader = new HttpRequestHeader(
        HttpRequestHeader.POST + " " + loginUrl + " " + HttpHeader.HTTP11
    );
    msg.setRequestHeader(requestHeader);

    // Set headers - MCP requires both application/json and text/event-stream
    msg.getRequestHeader().setHeader("Content-Type", "application/json");
    msg.getRequestHeader().setHeader("Authorization", "Bearer " + bearerToken);
    msg.getRequestHeader().setHeader("Accept", "application/json, text/event-stream");

    // Set body
    msg.setRequestBody(initRequest);
    msg.getRequestHeader().setContentLength(msg.getRequestBody().length());

    print("MCP Authentication: Sending initialization request");

    // Send the message
    helper.sendAndReceive(msg);

    // Get the session ID from response headers
    var sessionId = msg.getResponseHeader().getHeader("Mcp-Session-Id");

    if (sessionId != null && sessionId.length() > 0) {
        print("MCP Authentication: Successfully obtained session ID: " + sessionId);

        // Store the session ID in the session so it can be used by the session management script
        var session = helper.getCorrespondingHttpState();
        session.setAttribute("mcp-session-id", sessionId);

        return msg;
    } else {
        print("MCP Authentication: Failed to obtain session ID");
        print("Response status: " + msg.getResponseHeader().getStatusCode());
        print("Response body: " + msg.getResponseBody().toString());
        return null;
    }
}

// Required function - gets parameter names
function getRequiredParamsNames() {
    return ["Login URL"];
}

// Required function - gets credential parameter names
function getCredentialsParamsNames() {
    return ["token"];
}

// Optional function - gets optional parameter names
function getOptionalParamsNames() {
    return [];
}
