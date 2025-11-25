import { AAPMcpToolDefinition } from "../openapi-loader.js";
import { renderHeader, getHeaderStyles } from "../header.js";

interface ToolsetData {
  name: string;
  displayName: string;
  description: string;
  tools: AAPMcpToolDefinition[];
  color: string;
  toolCount: number;
  totalSize: number;
}

interface ToolsetsOverviewData {
  toolsets: ToolsetData[];
  allTools: AAPMcpToolDefinition[];
}

interface ToolsetToolsData {
  toolsetName: string;
  displayName: string;
  filteredTools: AAPMcpToolDefinition[];
  totalSize: number;
  allToolsets: Record<string, string[]>;
}

export const renderToolsetsOverview = (data: ToolsetsOverviewData): string => {
  const { toolsets } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Toolsets Overview - AAP MCP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1300px;
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
        }
        ${getHeaderStyles()}
        .toolset-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .toolset-card {
            border: 2px solid #e9ecef;
            border-radius: 8px;
            padding: 20px;
            text-decoration: none;
            color: inherit;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .toolset-card:hover {
            border-color: #007acc;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            transform: translateY(-2px);
            text-decoration: none;
            color: inherit;
        }
        .toolset-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }
        .toolset-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            margin-right: 15px;
            font-size: 1.2em;
        }
        .toolset-title {
            font-size: 1.3em;
            font-weight: bold;
            margin: 0;
        }
        .toolset-description {
            color: #6c757d;
            margin-bottom: 15px;
            line-height: 1.4;
        }
        .toolset-stats {
            display: flex;
            justify-content: space-between;
            background-color: #f8f9fa;
            padding: 10px;
            border-radius: 5px;
        }
        .stat {
            text-align: center;
        }
        .stat-number {
            font-size: 1.2em;
            font-weight: bold;
            color: #333;
        }
        .stat-label {
            font-size: 0.8em;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Toolsets Overview</h1>

        ${renderHeader()}

        <div class="summary">
            <h2>System Summary</h2>
            <p>The AAP MCP system uses toolsets to control tool access based on user permissions. Each toolset provides a different level of access to the available tools.</p>
        </div>

        <div class="toolset-grid">
            ${toolsets
              .map(
                (toolset) => `
            <a href="/toolset/${toolset.name}" class="toolset-card">
                <div class="toolset-header">
                    <div class="toolset-icon" style="background-color: ${toolset.color};">
                        ${toolset.displayName.charAt(0)}
                    </div>
                    <h3 class="toolset-title">${toolset.displayName}</h3>
                </div>
                <p class="toolset-description">${toolset.description}</p>
                <div class="toolset-stats">
                    <div class="stat">
                        <div class="stat-number">${toolset.toolCount}</div>
                        <div class="stat-label">Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${toolset.totalSize.toLocaleString()}</div>
                        <div class="stat-label">Characters</div>
                    </div>
                </div>
            </a>
            `,
              )
              .join("")}
        </div>
    </div>
</body>
</html>`;
};

export const renderToolsetTools = (data: ToolsetToolsData): string => {
  const { toolsetName, displayName, filteredTools, totalSize, allToolsets } =
    data;

  const toolRows = filteredTools
    .map(
      (tool) => `
    <tr>
      <td><a href="/tools/${encodeURIComponent(tool.name)}" style="color: #007acc; text-decoration: none;">${tool.name}</a></td>
      <td>${tool.size}</td>
      <td><span class="service-${tool.service || "unknown"}">${tool.service || "unknown"}</span></td>
    </tr>
  `,
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${displayName} Toolset Tools - AAP MCP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1560px;
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
        }
        .toolset-badge {
            display: inline-block;
            background-color: #007acc;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            margin-left: 10px;
        }
        ${getHeaderStyles()}
        .toolset-nav {
            margin-bottom: 20px;
            padding: 15px 0;
            border-bottom: 1px solid #dee2e6;
        }
        .toolset-nav-link {
            background-color: #6c757d;
            color: white;
            padding: 6px 12px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
            font-size: 0.9em;
        }
        .toolset-nav-link:hover {
            background-color: #5a6268;
        }
        .toolset-nav-link.active {
            background-color: #007acc;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #007acc;
            color: white;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f2f2f2;
        }
        tr:hover {
            background-color: #e6f3ff;
        }
        .service-eda { background-color: #e3f2fd; padding: 3px 6px; border-radius: 3px; }
        .service-controller { background-color: #f3e5f5; padding: 3px 6px; border-radius: 3px; }
        .service-gateway { background-color: #e8f5e8; padding: 3px 6px; border-radius: 3px; }
        .service-galaxy { background-color: #fff3e0; padding: 3px 6px; border-radius: 3px; }
        .service-unknown { background-color: #ffebee; padding: 3px 6px; border-radius: 3px; }
        .stats {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .empty-state {
            text-align: center;
            color: #6c757d;
            padding: 40px;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${displayName} Toolset Tools<span class="toolset-badge">${filteredTools.length} tools</span></h1>

        ${renderHeader()}

        <div class="toolset-nav">
            ${Object.keys(allToolsets)
              .map(
                (name) => `
            <a href="/toolset/${name}" class="toolset-nav-link ${toolsetName === name ? "active" : ""}">${name.charAt(0).toUpperCase() + name.slice(1)}</a>
            `,
              )
              .join("")}
        </div>

        <div class="stats">
            <strong>Toolset:</strong> ${displayName}<br>
            <strong>Available Tools:</strong> ${filteredTools.length}<br>
            <strong>Total Size:</strong> ${totalSize.toLocaleString()} characters
        </div>

        ${
          filteredTools.length === 0
            ? `
        <div class="empty-state">
            <p>No tools are available for the ${displayName} toolset.</p>
        </div>
        `
            : `
        <table>
            <thead>
                <tr>
                    <th>Tool Name</th>
                    <th>Size (chars)</th>
                    <th>Service</th>
                </tr>
            </thead>
            <tbody>
                ${toolRows}
            </tbody>
        </table>
        `
        }
    </div>
</body>
</html>`;
};

export type { ToolsetData, ToolsetsOverviewData, ToolsetToolsData };
