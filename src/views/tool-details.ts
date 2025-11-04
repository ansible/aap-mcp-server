import { AAPMcpToolDefinition } from "../openapi-loader.js";
import { getLogIcon } from "./utils.js";
import { renderHeader, getHeaderStyles } from "../header.js";

interface LogEntry {
  timestamp: string;
  return_code: number;
  endpoint: string;
  response?: any;
}

interface CategoryWithAccess {
  name: string;
  displayName: string;
  color: string;
}

interface ToolDetailsData {
  tool: AAPMcpToolDefinition;
  logEntries: LogEntry[];
  last10Calls: LogEntry[];
  errorCodeSummary: Record<number, number>;
  chartData: { success: number; error: number };
  categoriesWithAccess: CategoryWithAccess[];
}

export const renderToolDetails = (data: ToolDetailsData): string => {
  const {
    tool,
    logEntries,
    last10Calls,
    errorCodeSummary,
    chartData,
    categoriesWithAccess,
  } = data;

  // Helper function to format timestamp for display
  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  // Helper function to get status color
  const getStatusColor = (code: number) => {
    if (code >= 200 && code < 300) return "#28a745"; // green
    if (code >= 300 && code < 400) return "#ffc107"; // yellow
    if (code >= 400 && code < 500) return "#fd7e14"; // orange
    if (code >= 500) return "#dc3545"; // red
    return "#6c757d"; // gray
  };

  // Helper function to get status text
  const getStatusText = (code: number) => {
    if (code >= 200 && code < 300) return "Success";
    if (code >= 300 && code < 400) return "Redirect";
    if (code >= 400 && code < 500) return "Client Error";
    if (code >= 500) return "Server Error";
    return "Unknown";
  };

  // Format the input schema for display
  const formatSchema = (schema: any, level = 0): string => {
    if (!schema) return "No schema defined";

    const indent = "  ".repeat(level);
    let result = "";

    if (schema.type === "object" && schema.properties) {
      result += "{\n";
      for (const [key, value] of Object.entries(schema.properties)) {
        const prop = value as any;
        const required = schema.required?.includes(key) ? " (required)" : "";
        result += `${indent}  "${key}"${required}: `;
        if (prop.type === "object") {
          result += formatSchema(prop, level + 1);
        } else {
          result += `${prop.type || "any"}`;
          if (prop.description) result += ` // ${prop.description}`;
        }
        result += "\n";
      }
      result += `${indent}}`;
    } else {
      result = JSON.stringify(schema, null, 2);
    }

    return result;
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${tool.name} - Tool Details</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
            line-height: 1.6;
        }
        .container {
            max-width: 1300px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        .tool-header {
            display: flex;
            align-items: center;
            margin-bottom: 30px;
        }
        .service-badge {
            background-color: #007acc;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            margin-left: 15px;
        }
        .service-eda { background-color: #2196f3; }
        .service-controller { background-color: #9c27b0; }
        .service-gateway { background-color: #4caf50; }
        .service-galaxy { background-color: #ff9800; }
        .service-unknown { background-color: #f44336; }
        ${getHeaderStyles()}
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .info-card {
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #007acc;
        }
        .info-card h3 {
            margin-top: 0;
            color: #333;
            font-size: 1.1em;
        }
        .info-value {
            font-family: monospace;
            background-color: #e9ecef;
            padding: 8px;
            border-radius: 4px;
            word-break: break-all;
        }
        .description-section {
            background-color: #e3f2fd;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .description-section h2 {
            margin-top: 0;
            color: #1976d2;
        }
        .schema-section {
            background-color: #f5f5f5;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .schema-section h2 {
            margin-top: 0;
            color: #333;
        }
        .schema-code {
            background-color: #2d3748;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            white-space: pre;
            font-size: 0.9em;
        }
        .categories-section {
            background-color: #f0f9ff;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .categories-section h2 {
            margin-top: 0;
            color: #0369a1;
        }
        .category-badges {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .category-badge {
            padding: 8px 16px;
            border-radius: 20px;
            color: white;
            text-decoration: none;
            font-weight: bold;
            transition: opacity 0.3s ease;
        }
        .category-badge:hover {
            opacity: 0.8;
            text-decoration: none;
            color: white;
        }
        .no-categories {
            color: #6c757d;
            font-style: italic;
        }
        .method-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .method-get { background-color: #28a745; color: white; }
        .method-post { background-color: #007bff; color: white; }
        .method-put { background-color: #ffc107; color: black; }
        .method-patch { background-color: #6f42c1; color: white; }
        .method-delete { background-color: #dc3545; color: white; }
        .stats-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 20px;
            margin-top: 15px;
        }
        .chart-container {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 30px;
            margin-bottom: 20px;
        }
        .chart-wrapper {
            flex: 0 0 300px;
            height: 300px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .chart-title {
            font-size: 1.1em;
            font-weight: bold;
            margin-bottom: 15px;
            color: #333;
        }
        .chart-canvas {
            width: 250px !important;
            height: 250px !important;
        }
        .stats-details {
            flex: 1;
        }
        .stat-card {
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e9ecef;
        }
        .stat-card h4 {
            margin-top: 0;
            color: #495057;
        }
        .code-summary {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .code-entry {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background-color: white;
            border-radius: 4px;
            gap: 10px;
        }
        .code-number {
            font-weight: bold;
            font-family: monospace;
            min-width: 40px;
        }
        .code-text {
            flex: 1;
            color: #6c757d;
        }
        .code-count {
            font-size: 0.9em;
            color: #495057;
        }
        .calls-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .call-entry {
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 15px;
            background-color: white;
        }
        .call-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .call-timestamp {
            font-size: 0.9em;
            color: #6c757d;
        }
        .call-status {
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: bold;
        }
        .call-endpoint {
            font-family: monospace;
            background-color: #f8f9fa;
            padding: 8px;
            border-radius: 4px;
            word-break: break-all;
            font-size: 0.9em;
        }
        .call-error {
            margin-top: 8px;
            padding: 8px;
            background-color: #f8d7da;
            color: #721c24;
            border-radius: 4px;
            font-size: 0.9em;
        }
        .deprecation-warning {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 30px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .deprecation-icon {
            font-size: 1.5em;
        }
        .tool-logs-section {
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .tool-logs-section h2 {
            margin-top: 0;
            color: #495057;
        }
        .log-entries {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .log-entry {
            display: flex;
            align-items: center;
            padding: 12px;
            background-color: white;
            border-radius: 6px;
            border: 1px solid #dee2e6;
            gap: 12px;
        }
        .log-severity-icon {
            font-size: 16px;
            min-width: 20px;
        }
        .log-severity-icon.warn {
            color: #856404;
        }
        .log-severity-icon.info {
            color: #0277bd;
        }
        .log-severity-icon.err {
            color: #dc3545;
        }
        .log-message-text {
            flex: 1;
            color: #495057;
            font-size: 0.95em;
        }
        .log-severity-badge {
            font-size: 0.8em;
            padding: 4px 8px;
            border-radius: 12px;
            font-weight: 500;
            text-transform: uppercase;
        }
        .log-severity-badge.warn {
            background-color: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        .log-severity-badge.info {
            background-color: #e1f5fe;
            color: #0277bd;
            border: 1px solid #81d4fa;
        }
        .log-severity-badge.err {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .no-logs {
            color: #6c757d;
            font-style: italic;
            text-align: center;
            padding: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        ${renderHeader()}

        <div class="tool-header">
            <h1>${tool.name}</h1>
            <span class="service-badge service-${tool.service || "unknown"}">${tool.service || "unknown"}</span>
        </div>

        ${
          tool.deprecated
            ? `
        <div class="deprecation-warning">
            <span class="deprecation-icon">⚠️</span>
            <div>
                <strong>Deprecation Warning:</strong> This endpoint is deprecated.
            </div>
        </div>
        `
            : ""
        }

        ${
          tool.logs && tool.logs.length > 0
            ? `
        <div class="tool-logs-section">
            <h2>Messages</h2>
            <div class="log-entries">
                ${tool.logs
                  .map((log) => {
                    const icon = getLogIcon(log.severity);
                    return `
                    <div class="log-entry">
                        <span class="log-severity-icon ${log.severity.toLowerCase()}">${icon}</span>
                        <span class="log-message-text">${log.msg}</span>
                        <span class="log-severity-badge ${log.severity.toLowerCase()}">${log.severity}</span>
                    </div>
                    `;
                  })
                  .join("")}
            </div>
        </div>
        `
            : ""
        }

        <div class="schema-section">
            <h2>Usage Statistics</h2>
            ${
              logEntries.length > 0
                ? `
            <p><strong>Total Calls:</strong> ${logEntries.length}</p>
            <div class="chart-container">
                <div class="chart-wrapper">
                    <div class="chart-title">Success vs Error Rate</div>
                    <canvas id="statusChart" class="chart-canvas"></canvas>
                </div>
                <div class="stats-details">
                    <div class="stats-grid">
                        <div class="stat-card">
                            <h4>Response Codes</h4>
                            <div class="code-summary">
                                ${Object.entries(errorCodeSummary)
                                  .map(
                                    ([code, count]) => `
                                <div class="code-entry" style="border-left: 4px solid ${getStatusColor(Number(code))};">
                                    <span class="code-number">${code}</span>
                                    <span class="code-text">${getStatusText(Number(code))}</span>
                                    <span class="code-count">${count} calls</span>
                                </div>
                                `,
                                  )
                                  .join("")}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            `
                : "<p><em>No usage data available</em></p>"
            }
        </div>

        ${
          last10Calls.length > 0
            ? `
        <div class="schema-section">
            <h2>Recent Calls (Last 10)</h2>
            <div class="calls-list">
                ${last10Calls
                  .map(
                    (entry) => `
                <div class="call-entry">
                    <div class="call-header">
                        <span class="call-timestamp">${formatTimestamp(entry.timestamp)}</span>
                        <span class="call-status" style="background-color: ${getStatusColor(entry.return_code)};">
                            ${entry.return_code} ${getStatusText(entry.return_code)}
                        </span>
                    </div>
                    <div class="call-endpoint">${entry.endpoint}</div>
                    ${
                      entry.response &&
                      typeof entry.response === "object" &&
                      entry.response.error
                        ? `
                    <div class="call-error">Error: ${entry.response.error}</div>
                    `
                        : ""
                    }
                </div>
                `,
                  )
                  .join("")}
            </div>
        </div>
        `
            : ""
        }

        ${
          tool.description
            ? `
        <div class="description-section">
            <h2>Description</h2>
            <p>${tool.description}</p>
        </div>
        `
            : ""
        }

        <div class="info-grid">
            <div class="info-card">
                <h3>HTTP Method</h3>
                <div>
                    <span class="method-badge method-${tool.method.toLowerCase()}">${tool.method.toUpperCase()}</span>
                </div>
            </div>

            <div class="info-card">
                <h3>Path Template</h3>
                <div class="info-value">${tool.pathTemplate}</div>
            </div>

            <div class="info-card">
                <h3>Tool Size</h3>
                <div class="info-value">${tool.size.toLocaleString()} characters</div>
            </div>

            <div class="info-card">
                <h3>Service</h3>
                <div class="info-value">${tool.service || "unknown"}</div>
            </div>
        </div>

        <div class="categories-section">
            <h2>Available to Categories</h2>
            ${
              categoriesWithAccess.length > 0
                ? `
            <div class="category-badges">
                ${categoriesWithAccess
                  .map(
                    (category) => `
                <a href="/category/${category.name}" class="category-badge" style="background-color: ${category.color};">
                    ${category.displayName}
                </a>
                `,
                  )
                  .join("")}
            </div>
            `
                : '<p class="no-categories">This tool is not available to any category.</p>'
            }
        </div>

        ${
          tool.inputSchema
            ? `
        <div class="schema-section">
            <h2>Input Schema</h2>
            <div class="schema-code">${formatSchema(tool.inputSchema)}</div>
        </div>
        `
            : ""
        }

        ${
          tool.parameters && tool.parameters.length > 0
            ? `
        <div class="schema-section">
            <h2>Parameters</h2>
            <div class="schema-code">${JSON.stringify(tool.parameters, null, 2)}</div>
        </div>
        `
            : ""
        }
    </div>

    ${
      logEntries.length > 0
        ? `
    <script>
        // Create pie chart for success vs error distribution
        const ctx = document.getElementById('statusChart').getContext('2d');
        const chartData = {
            labels: ['Success (2xx)', 'Errors (non-2xx)'],
            datasets: [{
                data: [${chartData.success}, ${chartData.error}],
                backgroundColor: [
                    '#28a745', // Green for success
                    '#dc3545'  // Red for errors
                ],
                borderColor: [
                    '#1e7e34',
                    '#c82333'
                ],
                borderWidth: 2
            }]
        };

        const config = {
            type: 'pie',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            usePointStyle: true,
                            font: {
                                size: 12
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return context.label + ': ' + context.parsed + ' (' + percentage + '%)';
                            }
                        }
                    }
                }
            }
        };

        new Chart(ctx, config);
    </script>
    `
        : ""
    }
</body>
</html>`;
};

export type { LogEntry, CategoryWithAccess, ToolDetailsData };
