import { renderHeader, getHeaderStyles } from "../header.js";

interface LogsEntry {
  timestamp: string;
  toolName: string;
  return_code: number;
  endpoint: string;
  payload?: Record<string, unknown>;
  userAgent?: string;
}

interface LogsData {
  lastEntries: LogsEntry[];
  totalRequests: number;
  statusCodeFilter?: string;
  toolFilter?: string;
  userAgentFilter?: string;
  statusCodeSummary: Record<number, number>;
  toolSummary: Record<string, number>;
  userAgentSummary: Record<string, number>;
  logEntriesSizeLimit: number;
}

export const renderLogs = (data: LogsData): string => {
  const {
    lastEntries,
    totalRequests,
    statusCodeFilter,
    toolFilter,
    userAgentFilter,
    statusCodeSummary,
    toolSummary,
    userAgentSummary,
    logEntriesSizeLimit,
  } = data;

  // Helper function to format timestamp for display
  const formatTimestamp = (timestamp: string): string => {
    return new Date(timestamp).toLocaleString();
  };

  // Helper function to get status color
  const getStatusColor = (code: number): string => {
    if (code >= 200 && code < 300) return "#28a745"; // green
    if (code >= 300 && code < 400) return "#ffc107"; // yellow
    if (code >= 400 && code < 500) return "#fd7e14"; // orange
    if (code >= 500) return "#dc3545"; // red
    return "#6c757d"; // gray
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Request Logs - AAP MCP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1820px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        ${getHeaderStyles()}
        .summary {
            background-color: #e3f2fd;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        .summary h2 {
            margin-top: 0;
            color: #1976d2;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 15px;
        }
        .summary-card {
            background-color: white;
            padding: 15px;
            border-radius: 5px;
            border: 1px solid #e9ecef;
        }
        .summary-card h4 {
            margin-top: 0;
            color: #495057;
        }
        .code-summary, .tool-summary {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .code-entry, .tool-entry {
            padding: 4px 8px;
            background-color: #f8f9fa;
            border-radius: 4px;
            font-size: 0.8em;
            border-left: 3px solid #6c757d;
        }
        .code-entry:hover, .tool-entry:hover {
            background-color: #e9ecef;
            cursor: pointer;
        }
        .logs-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 0.9em;
        }
        .logs-table th, .logs-table td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        .logs-table th {
            background-color: #007acc;
            color: white;
            font-weight: bold;
            position: sticky;
            top: 0;
        }
        .logs-table tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        .logs-table tr:hover {
            background-color: #e6f3ff;
        }
        .tool-link {
            color: #007acc;
            text-decoration: none;
        }
        .tool-link:hover {
            text-decoration: underline;
        }
        .method-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.7em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .method-get { background-color: #28a745; color: white; }
        .method-post { background-color: #007bff; color: white; }
        .method-put { background-color: #ffc107; color: black; }
        .method-patch { background-color: #6f42c1; color: white; }
        .method-delete { background-color: #dc3545; color: white; }
        .status-code {
            font-weight: bold;
            padding: 2px 6px;
            border-radius: 3px;
        }
        .endpoint {
            font-family: monospace;
            font-size: 0.8em;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .user-agent {
            font-size: 0.8em;
            color: #6c757d;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .timestamp {
            font-size: 0.8em;
            white-space: nowrap;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Request Logs<span style="color: #6c757d; font-size: 0.7em; margin-left: 15px;">Last ${logEntriesSizeLimit.toLocaleString()} requests</span></h1>

        ${renderHeader()}

        <div class="summary">
            <h2>Log Summary</h2>
            <p>Showing the last requests${statusCodeFilter || toolFilter || userAgentFilter ? ` out of ${lastEntries.length} filtered results` : ""} from ${totalRequests.toLocaleString()} total logged requests.${statusCodeFilter ? ` <strong>Filtered by status code: ${statusCodeFilter}</strong>` : ""}${toolFilter ? ` <strong>Filtered by tool: ${toolFilter}</strong>` : ""}${userAgentFilter ? ` <strong>Filtered by user-agent: ${userAgentFilter}</strong>` : ""}</p>

            ${
              statusCodeFilter
                ? `
            <div style="margin: 20px 0; padding: 15px; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px;">
                <strong>Filtering by status code: ${statusCodeFilter}</strong>
                <a href="/logs${toolFilter || userAgentFilter ? `?${toolFilter ? `tool=${encodeURIComponent(toolFilter)}` : ""}${toolFilter && userAgentFilter ? "&" : ""}${userAgentFilter ? `user_agent=${encodeURIComponent(userAgentFilter)}` : ""}` : ""}" style="margin-left: 15px; padding: 5px 15px; background-color: #6c757d; color: white; text-decoration: none; border-radius: 4px;">Clear Status Filter</a>
            </div>
            `
                : ""
            }

            ${
              toolFilter
                ? `
            <div style="margin: 20px 0; padding: 15px; background-color: #d1ecf1; border: 1px solid #bee5eb; border-radius: 5px;">
                <strong>Filtering by tool: ${toolFilter}</strong>
                <a href="/logs${statusCodeFilter || userAgentFilter ? `?${statusCodeFilter ? `status_code=${statusCodeFilter}` : ""}${statusCodeFilter && userAgentFilter ? "&" : ""}${userAgentFilter ? `user_agent=${encodeURIComponent(userAgentFilter)}` : ""}` : ""}" style="margin-left: 15px; padding: 5px 15px; background-color: #6c757d; color: white; text-decoration: none; border-radius: 4px;">Clear Tool Filter</a>
            </div>
            `
                : ""
            }

            ${
              userAgentFilter
                ? `
            <div style="margin: 20px 0; padding: 15px; background-color: #e2e3e5; border: 1px solid #d6d8db; border-radius: 5px;">
                <strong>Filtering by user-agent: ${userAgentFilter}</strong>
                <a href="/logs${statusCodeFilter || toolFilter ? `?${statusCodeFilter ? `status_code=${statusCodeFilter}` : ""}${statusCodeFilter && toolFilter ? "&" : ""}${toolFilter ? `tool=${encodeURIComponent(toolFilter)}` : ""}` : ""}" style="margin-left: 15px; padding: 5px 15px; background-color: #6c757d; color: white; text-decoration: none; border-radius: 4px;">Clear User-Agent Filter</a>
            </div>
            `
                : ""
            }

            <div class="summary-grid">
                <div class="summary-card">
                    <h4>Status Codes</h4>
                    <div class="code-summary">
                        ${Object.entries(statusCodeSummary)
                          .sort(([, a], [, b]) => b - a)
                          .map(
                            ([code, count]) => `
                        <a href="/logs?status_code=${code}" class="code-entry" style="border-left-color: ${getStatusColor(Number(code))}; text-decoration: none; color: inherit; display: block; transition: background-color 0.2s ease;">
                            ${code}: ${count}
                        </a>
                        `,
                          )
                          .join("")}
                    </div>
                </div>

                <div class="summary-card">
                    <h4>Most Used Tools</h4>
                    <div class="tool-summary">
                        ${Object.entries(toolSummary)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 8)
                          .map(
                            ([tool, count]) => `
                        <a href="/logs?tool=${encodeURIComponent(tool)}" class="tool-entry" style="text-decoration: none; color: inherit; display: block; transition: background-color 0.2s ease;">
                            ${tool}: ${count}
                        </a>
                        `,
                          )
                          .join("")}
                    </div>
                </div>

                <div class="summary-card">
                    <h4>User Agents</h4>
                    <div class="tool-summary">
                        ${Object.entries(userAgentSummary)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 8)
                          .map(
                            ([userAgent, count]) => `
                        <a href="/logs?user_agent=${encodeURIComponent(userAgent)}" class="tool-entry" style="text-decoration: none; color: inherit; display: block; transition: background-color 0.2s ease;">
                            ${userAgent}: ${count}
                        </a>
                        `,
                          )
                          .join("")}
                    </div>
                </div>
            </div>
        </div>

        <table class="logs-table">
            <thead>
                <tr>
                    <th>Timestamp</th>
                    <th>Tool</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Endpoint</th>
                    <th>User Agent</th>
                </tr>
            </thead>
            <tbody>
                ${lastEntries
                  .map(
                    (entry) => `
                <tr>
                    <td class="timestamp">${formatTimestamp(entry.timestamp)}</td>
                    <td>
                        <a href="/tools/${encodeURIComponent(entry.toolName)}" class="tool-link">${entry.toolName}</a>
                    </td>
                    <td>
                        <span class="method-badge method-${(entry.payload?.method || "unknown").toLowerCase()}">${entry.payload?.method || "N/A"}</span>
                    </td>
                    <td>
                        <span class="status-code" style="color: ${getStatusColor(entry.return_code)};">
                            ${entry.return_code}
                        </span>
                    </td>
                    <td class="endpoint">${entry.endpoint}</td>
                    <td class="user-agent">${entry.userAgent || "N/A"}</td>
                </tr>
                `,
                  )
                  .join("")}
            </tbody>
        </table>
    </div>
</body>
</html>`;
};

export type { LogsEntry, LogsData };
