/**
 * ZAP Standalone Script - MCP Request Generator
 *
 * This script makes proper JSON-RPC requests to MCP endpoints
 * so ZAP's passive scanners can analyze the responses.
 *
 * Unlike the spider which sends GET requests, this script sends
 * POST requests with proper JSON-RPC 2.0 payloads and session headers.
 */

// Get script variables
var ScriptVars = org.zaproxy.zap.extension.script.ScriptVars;
var sessionId = ScriptVars.getGlobalVar('mcpSessionId');

if (!sessionId || sessionId === 'MCP_SESSION_ID_PLACEHOLDER') {
    print('[ERROR] No valid MCP session ID found. Please run pre-authentication first.');
} else {
    print('[INFO] Using MCP session ID: ' + sessionId);

    // Import required ZAP classes
    var HttpRequestHeader = org.parosproxy.paros.network.HttpRequestHeader;
    var HttpMessage = org.parosproxy.paros.network.HttpMessage;
    var HttpSender = org.parosproxy.paros.network.HttpSender;
    var Model = org.parosproxy.paros.model.Model;
    var URI = org.apache.commons.httpclient.URI;

    // Base URL for MCP server
    var baseUrl = 'http://localhost:3000';

    // MCP endpoints and methods to test
    var testCases = [
        { endpoint: '/mcp/developer_testing', method: 'tools/list', params: {} },
        { endpoint: '/mcp/developer_testing', method: 'initialize', params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'ZAP-Security-Scanner', version: '1.0.0' }
        }}
    ];

    print('========================================');
    print('MCP Request Generator Starting');
    print('========================================');

    // Create HTTP sender
    var connectionParam = Model.getSingleton().getOptionsParam().getConnectionParam();
    var sender = new HttpSender(connectionParam, true, HttpSender.MANUAL_REQUEST_INITIATOR);

    // Send each test request
    for (var i = 0; i < testCases.length; i++) {
        var testCase = testCases[i];
        var url = baseUrl + testCase.endpoint;
        var requestId = 100 + i;

        print('\n[' + i + '] Sending ' + testCase.method + ' to ' + url);

        try {
            // Create JSON-RPC request body
            var requestBody = JSON.stringify({
                jsonrpc: '2.0',
                id: requestId,
                method: testCase.method,
                params: testCase.params
            });

            // Create HTTP message
            var msg = new HttpMessage();
            var uri = new URI(url, true);

            // Create and configure request header
            var requestHeader = new HttpRequestHeader('POST', uri, 'HTTP/1.1');
            requestHeader.setHeader('Host', uri.getHost());
            requestHeader.setHeader('Content-Type', 'application/json');
            requestHeader.setHeader('Accept', 'application/json, text/event-stream');
            requestHeader.setHeader('Mcp-Session-Id', sessionId);
            requestHeader.setHeader('User-Agent', 'ZAP-MCP-Scanner/1.0.0');
            requestHeader.setContentLength(requestBody.length());

            msg.setRequestHeader(requestHeader);
            msg.setRequestBody(requestBody);

            // Send the request
            sender.sendAndReceive(msg);

            // Log response
            var statusCode = msg.getResponseHeader().getStatusCode();
            print('    Response: HTTP ' + statusCode);

            if (statusCode !== 200) {
                var responseBody = msg.getResponseBody().toString();
                var preview = responseBody.substring(0, Math.min(200, responseBody.length()));
                print('    [WARN] Unexpected status. Response: ' + preview);
            }

            // Small delay between requests
            java.lang.Thread.sleep(100);

        } catch (e) {
            print('    [ERROR] Request failed: ' + e);
        }
    }

    print('\n========================================');
    print('MCP Request Generator Completed');
    print('Sent ' + testCases.length + ' requests');
    print('========================================');
}
