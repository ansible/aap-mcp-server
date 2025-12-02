import { AAPMcpToolDefinition } from "../openapi-loader.js";
import { renderHeader, getHeaderStyles } from "../header.js";
import { getLogIcon } from "./utils.js";

export interface DashboardData {
  allTools: AAPMcpToolDefinition[];
  allToolsets: Record<string, AAPMcpToolDefinition[]>;
  recordApiQueries: boolean;
  allowWriteOperations: boolean;
}

export const renderDashboard = (data: DashboardData): string => {
  const { allTools, allToolsets, recordApiQueries, allowWriteOperations } =
    data;

  // Calculate summary statistics
  const totalSize = allTools.reduce((sum, tool) => sum + (tool.size || 0), 0);

  // Calculate toolset statistics dynamically
  const toolsetStats: Record<
    string,
    { tools: AAPMcpToolDefinition[]; size: number }
  > = {};
  for (const [toolsetName, toolsetTools] of Object.entries(allToolsets)) {
    const tools = allTools.filter((tool) =>
      toolsetTools.map((t) => t.fullName).includes(tool.fullName),
    );
    toolsetStats[toolsetName] = {
      tools,
      size: tools.reduce((sum, tool) => sum + (tool.size || 0), 0),
    };
  }

  // Count tools by service and calculate log statistics
  const serviceStats = allTools.reduce(
    (acc, tool) => {
      const service = tool.service || "unknown";
      if (!acc[service]) {
        acc[service] = {
          toolCount: 0,
          logs: { err: 0, warn: 0, info: 0 },
        };
      }
      acc[service].toolCount++;

      // Count logs by severity for this tool
      tool.logs.forEach((log) => {
        const severity = log.severity.toLowerCase() as "err" | "warn" | "info";
        if (severity === "err" || severity === "warn" || severity === "info") {
          acc[service].logs[severity]++;
        }
      });

      return acc;
    },
    {} as Record<
      string,
      { toolCount: number; logs: { err: number; warn: number; info: number } }
    >,
  );

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AAP MCP Dashboard</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            max-width: 1560px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
        }
        .header h1 {
            font-size: 3em;
            margin: 0;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .header p {
            font-size: 1.2em;
            opacity: 0.9;
            margin: 10px 0;
        }
        .main-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 30px;
            margin-bottom: 40px;
        }
        .card {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 40px rgba(0,0,0,0.3);
        }
        .card-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
        }
        .card-icon {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.5em;
            font-weight: bold;
            margin-right: 20px;
        }
        .tools-icon { background: linear-gradient(45deg, #007acc, #0056b3); }
        .toolsets-icon { background: linear-gradient(45deg, #28a745, #1e7e34); }
        .card-title {
            font-size: 1.8em;
            font-weight: bold;
            color: #333;
            margin: 0;
        }
        .card-description {
            color: #666;
            margin-bottom: 25px;
            line-height: 1.6;
        }
        .card-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }
        .stat {
            text-align: center;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .stat-number {
            font-size: 1.5em;
            font-weight: bold;
            color: #333;
        }
        .stat-label {
            font-size: 0.8em;
            color: #666;
            text-transform: uppercase;
            margin-top: 5px;
        }
        .btn {
            display: inline-block;
            background: linear-gradient(45deg, #007acc, #0056b3);
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 25px;
            font-weight: bold;
            transition: all 0.3s ease;
            text-align: center;
        }
        .btn:hover {
            background: linear-gradient(45deg, #0056b3, #004085);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,123,204,0.4);
            text-decoration: none;
            color: white;
        }
        .btn-toolsets {
            background: linear-gradient(45deg, #28a745, #1e7e34);
        }
        .btn-toolsets:hover {
            background: linear-gradient(45deg, #1e7e34, #155724);
            box-shadow: 0 5px 15px rgba(40,167,69,0.4);
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        .summary-card {
            background: rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 20px;
            color: white;
            text-align: center;
        }
        .summary-card h3 {
            margin-top: 0;
            font-size: 1.1em;
            opacity: 0.9;
        }
        .summary-number {
            font-size: 2em;
            font-weight: bold;
            margin: 10px 0;
        }
        .service-stats {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            justify-content: center;
        }
        .service-badge {
            padding: 5px 12px;
            border-radius: 15px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .service-eda { background: #2196f3; color: white; }
        .service-controller { background: #9c27b0; color: white; }
        .service-gateway { background: #4caf50; color: white; }
        .service-galaxy { background: #ff9800; color: white; }
        .service-unknown { background: #f44336; color: white; }

        /* Service log display styles */
        .services-with-logs {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .service-detail {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f1f1f1;
        }
        .service-detail:last-child {
            border-bottom: none;
        }
        .service-logs {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .log-count {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 0.8em;
            font-weight: bold;
            text-decoration: none;
        }
        .log-count.clickable {
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid transparent;
        }
        .log-count.clickable:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            text-decoration: none;
        }
        .log-count.err {
            background-color: #f8d7da;
            color: #721c24;
        }
        .log-count.err.clickable:hover {
            background-color: #f5c6cb;
            color: #491217;
            border-color: #f1b0b7;
        }
        .log-count.warn {
            background-color: #fff3cd;
            color: #856404;
        }
        .log-count.warn.clickable:hover {
            background-color: #ffeaa7;
            color: #533f03;
            border-color: #ffe08a;
        }
        .log-count.info {
            background-color: #d1ecf1;
            color: #0c5460;
        }
        .log-count.info.clickable:hover {
            background-color: #b8daff;
            color: #004085;
            border-color: #9fcdff;
        }
        .no-logs {
            font-size: 0.8em;
            color: #6c757d;
            font-style: italic;
        }

        ${getHeaderStyles()}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>AAP MCP Dashboard</h1>
            <p>Ansible Automation Platform Model Context Protocol Interface</p>
        </div>

        ${renderHeader()}

        <div class="summary-grid">
            <div class="summary-card">
                <h3>Total Tools</h3>
                <div class="summary-number">${allTools.length}</div>
            </div>
            <div class="summary-card">
                <h3>Total Size</h3>
                <div class="summary-number">${Math.round(totalSize / 1000)}K</div>
                <small>characters</small>
            </div>
            <div class="summary-card">
                <h3>Services</h3>
                <div class="summary-number">${Object.keys(serviceStats).length}</div>
            </div>
            <div class="summary-card">
                Write Operations: <div class="summary-number">${allowWriteOperations ? "ENABLED" : "DISABLED"}</div>
            </div>
        </div>

        <div class="main-grid">
            <div class="card">
                <div class="card-header">
                    <div class="card-icon tools-icon">🔧</div>
                    <h2 class="card-title">Tools</h2>
                </div>
                <p class="card-description">
                    Browse and explore all available MCP tools. Each tool provides access to specific AAP functionality across different services including EDA, Controller, Gateway, and Galaxy.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">${allTools.length}</div>
                        <div class="stat-label">Total Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Object.keys(serviceStats).length}</div>
                        <div class="stat-label">Services</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Math.round(totalSize / 1000)}K</div>
                        <div class="stat-label">Characters</div>
                    </div>
                </div>
                <div class="service-stats">
                    ${Object.entries(serviceStats)
                      .map(
                        ([service, stats]) =>
                          `<span class="service-badge service-${service}">${service}: ${stats.toolCount}</span>`,
                      )
                      .join("")}
                </div>
                <br><br>
                <a href="/tools" class="btn">Browse All Tools</a>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon" style="background: linear-gradient(45deg, #ff6b6b, #ee5a24);">🏗️</div>
                    <h2 class="card-title">Services</h2>
                </div>
                <p class="card-description">
                    Explore the different AAP services that provide the tools. Each service represents a different component of the Ansible Automation Platform ecosystem.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">${Object.keys(serviceStats).length}</div>
                        <div class="stat-label">Services</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Object.values(serviceStats).reduce((sum, s) => sum + s.toolCount, 0)}</div>
                        <div class="stat-label">Total Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Object.values(serviceStats).reduce((sum, s) => sum + s.logs.err, 0)}</div>
                        <div class="stat-label">${getLogIcon("err")} Errors</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Object.values(serviceStats).reduce((sum, s) => sum + s.logs.warn, 0)}</div>
                        <div class="stat-label">${getLogIcon("warn")} Warnings</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Object.values(serviceStats).reduce((sum, s) => sum + s.logs.info, 0)}</div>
                        <div class="stat-label">${getLogIcon("info")} Info</div>
                    </div>
                </div>
                <div class="services-with-logs">
                    ${Object.entries(serviceStats)
                      .map(([service, stats]) => {
                        const hasLogs =
                          stats.logs.err > 0 ||
                          stats.logs.warn > 0 ||
                          stats.logs.info > 0;
                        return `
                          <div class="service-detail">
                            <span class="service-badge service-${service}">${service}: ${stats.toolCount} tools</span>
                            ${
                              hasLogs
                                ? `
                              <div class="service-logs">
                                ${stats.logs.err > 0 ? `<a href="/services/${service}#logs" class="log-count err clickable">${getLogIcon("err")} ${stats.logs.err}</a>` : ""}
                                ${stats.logs.warn > 0 ? `<a href="/services/${service}#logs" class="log-count warn clickable">${getLogIcon("warn")} ${stats.logs.warn}</a>` : ""}
                                ${stats.logs.info > 0 ? `<a href="/services/${service}#logs" class="log-count info clickable">${getLogIcon("info")} ${stats.logs.info}</a>` : ""}
                              </div>
                            `
                                : '<div class="service-logs"><span class="no-logs">No messages</span></div>'
                            }
                          </div>`;
                      })
                      .join("")}
                </div>
                <br><br>
                <a href="/services" class="btn" style="background: linear-gradient(45deg, #ff6b6b, #ee5a24);">Explore Services</a>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon toolsets-icon">👥</div>
                    <h2 class="card-title">Toolsets</h2>
                </div>
                <p class="card-description">
                    Understand the different user toolsets and their tool access levels. Toolsets control which tools are available based on user permissions and authentication status.
                </p>
                <div class="card-stats">
                    ${Object.entries(toolsetStats)
                      .map(
                        ([toolsetName, stats]) => `
                    <div class="stat">
                        <div class="stat-number">${stats.tools.length} tools</div>
                        <div class="stat-label">${toolsetName.charAt(0).toUpperCase() + toolsetName.slice(1)}</div>
                    </div>
                    `,
                      )
                      .join("")}
                </div>
                <br>
                <a href="/toolset" class="btn btn-toolsets">Explore Toolsets</a>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon" style="background: linear-gradient(45deg, #ffc107, #e67e22);">🔗</div>
                    <h2 class="card-title">API Endpoints</h2>
                </div>
                <p class="card-description">
                    Browse all API endpoints organized by service. View HTTP methods, paths, and descriptions for each endpoint across the AAP platform services.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">${allTools.length}</div>
                        <div class="stat-label">Endpoints</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Object.keys(serviceStats).length}</div>
                        <div class="stat-label">Services</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${[...new Set(allTools.map((t) => t.method.toUpperCase()))].length}</div>
                        <div class="stat-label">HTTP Methods</div>
                    </div>
                </div>
                <br>
                <a href="/endpoints" class="btn" style="background: linear-gradient(45deg, #ffc107, #e67e22);">View API Endpoints</a>
            </div>

            ${
              recordApiQueries
                ? `
            <div class="card">
                <div class="card-header">
                    <div class="card-icon" style="background: linear-gradient(45deg, #17a2b8, #138496);">📊</div>
                    <h2 class="card-title">Request Logs</h2>
                </div>
                <p class="card-description">
                    View detailed logs of API requests made through the MCP interface. Monitor tool usage, response codes, and client information for debugging and analytics.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">1000</div>
                        <div class="stat-label">Recent Requests</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">Live</div>
                        <div class="stat-label">Real-time</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">JSONL</div>
                        <div class="stat-label">Format</div>
                    </div>
                </div>
                <br>
                <a href="/logs" class="btn" style="background: linear-gradient(45deg, #17a2b8, #138496);">View Request Logs</a>
            </div>
            `
                : ""
            }
        </div>
    </div>
</body>
</html>`;
};
