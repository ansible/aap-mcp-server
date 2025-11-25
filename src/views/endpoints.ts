import { AAPMcpToolDefinition } from "../openapi-loader.js";
import { McpToolLogEntry } from "../extract-tools.js";
import { getLogIcon } from "./utils.js";
import { renderHeader, getHeaderStyles } from "../header.js";

export interface EndpointData {
  path: string;
  method: string;
  name: string;
  description: string;
  toolName?: string;
  toolsets: string[];
  logs: McpToolLogEntry[];
}

export interface EndpointsOverviewData {
  allTools: AAPMcpToolDefinition[];
  endpointsByService: Record<string, EndpointData[]>;
  allToolsets?: Record<string, string[]>;
  selectedToolset?: string;
}

export const renderEndpointsOverview = (
  data: EndpointsOverviewData,
): string => {
  const { allTools, endpointsByService, allToolsets, selectedToolset } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AAP API Endpoints Overview</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f8f9fa;
            color: #333;
        }
        .container { max-width: 1560px; margin: 0 auto; }
        h1 { color: #2c3e50; margin-bottom: 30px; }
        h2 {
            color: #34495e;
            border-bottom: 2px solid #3498db;
            padding-bottom: 10px;
            margin-top: 40px;
        }
        .service-section {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .endpoint {
            display: grid;
            grid-template-columns: 80px 1fr 1fr 150px 120px 180px;
            align-items: center;
            padding: 12px;
            border-bottom: 1px solid #ecf0f1;
            gap: 15px;
        }
        .endpoint:last-child { border-bottom: none; }
        .method {
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 12px;
            text-align: center;
            min-width: 60px;
        }
        .method.GET { background-color: #3498db; color: white; }
        .method.POST { background-color: #2ecc71; color: white; }
        .method.PUT { background-color: #f39c12; color: white; }
        .method.DELETE { background-color: #e74c3c; color: white; }
        .method.PATCH { background-color: #9b59b6; color: white; }
        .path {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            background-color: #f8f9fa;
            padding: 4px 8px;
            border-radius: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .description {
            color: #7f8c8d;
            font-size: 14px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .tool-name {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            background-color: #e3f2fd;
            color: #1565c0;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            text-align: center;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .tool-name.empty {
            background-color: #f5f5f5;
            color: #9e9e9e;
            font-style: italic;
        }
        .endpoint-header {
            display: grid;
            grid-template-columns: 80px 1fr 1fr 150px 120px 180px;
            align-items: center;
            padding: 12px;
            gap: 15px;
            background-color: #f8f9fa;
            border-bottom: 2px solid #dee2e6;
            font-weight: bold;
            color: #495057;
        }
        .sortable-header {
            cursor: pointer;
            user-select: none;
            transition: background-color 0.2s;
            padding: 4px 8px;
            border-radius: 4px;
            position: relative;
        }
        .sortable-header:hover {
            background-color: #e9ecef;
        }
        .sort-indicator {
            font-size: 10px;
            margin-left: 5px;
            opacity: 0.5;
        }
        .sort-indicator.active {
            opacity: 1;
        }
        .toolsets {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            overflow: hidden;
        }
        .toolset-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 16px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 11px;
            font-weight: 600;
            text-decoration: none;
            white-space: nowrap;
            transition: all 0.2s ease;
            border: 1px solid transparent;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .toolset-admin {
            background-color: #fee2e2;
            color: #dc2626;
            border-color: #fecaca;
        }
        .toolset-user {
            background-color: #dcfce7;
            color: #16a34a;
            border-color: #bbf7d0;
        }
        .toolset-anonymous {
            background-color: #f1f5f9;
            color: #475569;
            border-color: #e2e8f0;
        }
        .toolset-unknown {
            background-color: #fef3c7;
            color: #d97706;
            border-color: #fde68a;
        }
        .toolset-system_monitoring {
            background-color: #dbeafe;
            color: #2563eb;
            border-color: #bfdbfe;
        }
        .toolset-job_management {
            background-color: #f3e8ff;
            color: #7c3aed;
            border-color: #e9d5ff;
        }
        .toolset-credential_management {
            background-color: #fdf4ff;
            color: #c026d3;
            border-color: #f5d0fe;
        }
        .toolset-badge:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            text-decoration: none;
        }
        .toolset-admin:hover {
            background-color: #fca5a5;
            border-color: #f87171;
        }
        .toolset-user:hover {
            background-color: #86efac;
            border-color: #4ade80;
        }
        .toolset-anonymous:hover {
            background-color: #cbd5e1;
            border-color: #94a3b8;
        }
        .toolset-unknown:hover {
            background-color: #fcd34d;
            border-color: #fbbf24;
        }
        .toolset-system_monitoring:hover {
            background-color: #93c5fd;
            border-color: #60a5fa;
        }
        .toolset-job_management:hover {
            background-color: #c4b5fd;
            border-color: #a78bfa;
        }
        .toolset-credential_management:hover {
            background-color: #f0abfc;
            border-color: #e879f9;
        }
        .logs {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 4px;
            align-items: center;
            padding: 2px;
        }
        .log-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            border-radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 11px;
            font-weight: 500;
            text-decoration: none;
            white-space: nowrap;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin: 2px 0;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .log-badge:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
            text-decoration: none;
        }
        .log-badge.info {
            background-color: #e1f5fe;
            color: #0277bd;
            border: 1px solid #81d4fa;
        }
        .log-badge.info:hover {
            background-color: #bbdefb;
            color: #01579b;
            border-color: #4fc3f7;
        }
        .log-badge.warn {
            background-color: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        .log-badge.warn:hover {
            background-color: #fff176;
            color: #f57f17;
            border-color: #ffcc02;
        }
        .log-badge.err {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .log-badge.err:hover {
            background-color: #f5c6cb;
            color: #491217;
            border-color: #dc3545;
        }
        .log-badge.empty {
            background-color: #f8f9fa;
            color: #6c757d;
            border: 1px solid #dee2e6;
            font-style: italic;
        }
        .log-icon {
            font-size: 12px;
            font-weight: bold;
        }
        .log-icon.info {
            color: #0288d1;
        }
        .log-icon.warn {
            color: #f57c00;
        }
        .tool-name-link {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            background-color: #e3f2fd;
            color: #1565c0;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            text-align: center;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-decoration: none;
            transition: all 0.2s ease;
        }
        .tool-name-link:hover {
            background-color: #bbdefb;
            color: #0d47a1;
            text-decoration: none;
            transform: translateY(-1px);
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .stat-card-clickable {
            text-decoration: none;
            color: inherit;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .stat-card-clickable:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 12px rgba(0,0,0,0.15);
            text-decoration: none;
            color: inherit;
        }
        .stat-card-clickable:hover .stat-number {
            color: #2980b9;
        }
        .stat-number { font-size: 2em; font-weight: bold; color: #3498db; }
        .stat-label { color: #7f8c8d; margin-top: 5px; }
        .back-link {
            background-color: #3498db;
            color: white;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 5px;
            display: inline-block;
            margin-bottom: 20px;
        }
        .back-link:hover { background-color: #2980b9; }
        .filter-section {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .filter-section label {
            font-weight: bold;
            color: #2c3e50;
        }
        .filter-section select {
            padding: 8px 12px;
            border: 1px solid #bdc3c7;
            border-radius: 5px;
            font-size: 14px;
            background-color: white;
            cursor: pointer;
            min-width: 200px;
        }
        .filter-section select:hover {
            border-color: #3498db;
        }
        .filter-section button {
            padding: 8px 16px;
            background-color: #e74c3c;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
        }
        .filter-section button:hover {
            background-color: #c0392b;
        }
        ${getHeaderStyles()}
    </style>
    <script>
        let currentSort = { column: null, direction: 'asc' };

        function sortTable(column, serviceSection) {
            const rows = Array.from(serviceSection.querySelectorAll('.endpoint'));

            // Toggle sort direction if clicking the same column
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }

            // Update sort indicators
            const indicators = serviceSection.querySelectorAll('.sort-indicator');
            indicators.forEach(indicator => {
                indicator.textContent = '↕';
                indicator.classList.remove('active');
            });

            const activeIndicator = serviceSection.querySelector('[data-column="' + column + '"] .sort-indicator');
            if (activeIndicator) {
                activeIndicator.textContent = currentSort.direction === 'asc' ? '↑' : '↓';
                activeIndicator.classList.add('active');
            }

            // Sort rows
            rows.sort((a, b) => {
                let aVal, bVal;

                switch (column) {
                    case 'method':
                        aVal = a.children[0].textContent;
                        bVal = b.children[0].textContent;
                        break;
                    case 'path':
                        aVal = a.children[1].textContent;
                        bVal = b.children[1].textContent;
                        break;
                    case 'description':
                        aVal = a.children[2].textContent;
                        bVal = b.children[2].textContent;
                        break;
                    case 'tool':
                        aVal = a.children[3].textContent;
                        bVal = b.children[3].textContent;
                        break;
                    case 'toolsets':
                        aVal = a.children[4].textContent;
                        bVal = b.children[4].textContent;
                        break;
                    case 'logs':
                        aVal = a.children[5].textContent;
                        bVal = b.children[5].textContent;
                        break;
                    default:
                        return 0;
                }

                if (currentSort.direction === 'asc') {
                    return aVal.localeCompare(bVal);
                } else {
                    return bVal.localeCompare(aVal);
                }
            });

            // Re-insert sorted rows
            const header = serviceSection.querySelector('.endpoint-header');
            rows.forEach(row => {
                serviceSection.insertBefore(row, null);
            });
        }

        function setupSorting() {
            document.querySelectorAll('.service-section').forEach(section => {
                section.querySelectorAll('.sortable-header').forEach(header => {
                    header.addEventListener('click', () => {
                        const column = header.getAttribute('data-column');
                        sortTable(column, section);
                    });
                });
            });
        }

        document.addEventListener('DOMContentLoaded', setupSorting);

        function filterByToolset(toolset) {
            const url = new URL(window.location);
            if (toolset) {
                url.searchParams.set('toolset', toolset);
            } else {
                url.searchParams.delete('toolset');
            }
            window.location.href = url.toString();
        }

        function clearFilter() {
            const url = new URL(window.location);
            url.searchParams.delete('toolset');
            window.location.href = url.toString();
        }
    </script>
</head>
<body>
    <div class="container">
        <h1>AAP API Endpoints Overview</h1>

        ${renderHeader()}

        ${
          allToolsets
            ? `
        <div class="filter-section">
            <label for="toolset-filter">Filter by Toolset:</label>
            <select id="toolset-filter" onchange="filterByToolset(this.value)">
                <option value="">All Toolsets</option>
                ${Object.keys(allToolsets)
                  .map(
                    (toolset) => `
                    <option value="${toolset}" ${selectedToolset === toolset ? "selected" : ""}>
                        ${toolset
                          .split("_")
                          .map(
                            (word) =>
                              word.charAt(0).toUpperCase() + word.slice(1),
                          )
                          .join(" ")}
                    </option>
                `,
                  )
                  .join("")}
            </select>
            ${selectedToolset ? '<button onclick="clearFilter()">Clear Filter</button>' : ""}
        </div>
        `
            : ""
        }

        <div class="stats">
            <div class="stat-card">
                <div class="stat-number">${allTools.length}</div>
                <div class="stat-label">Total Endpoints</div>
            </div>
            <a href="/services" class="stat-card stat-card-clickable">
                <div class="stat-number">${Object.keys(endpointsByService).length}</div>
                <div class="stat-label">Services</div>
            </a>
            <a href="/tools" class="stat-card stat-card-clickable">
                <div class="stat-number">${
                  Object.values(endpointsByService)
                    .flat()
                    .filter((e) => e.toolName).length
                }</div>
                <div class="stat-label">Tools</div>
            </a>
        </div>

        ${Object.entries(endpointsByService)
          .map(([service, endpoints]) => {
            const displayName =
              service.charAt(0).toUpperCase() + service.slice(1);
            return `
        <div class="service-section">
            <h2>${displayName} Service (${endpoints.length} endpoints)</h2>
            <div class="endpoint-header">
                <span class="sortable-header" data-column="method">Method <span class="sort-indicator">↕</span></span>
                <span class="sortable-header" data-column="path">Path <span class="sort-indicator">↕</span></span>
                <span class="sortable-header" data-column="description">Description <span class="sort-indicator">↕</span></span>
                <span class="sortable-header" data-column="tool">Tool Name <span class="sort-indicator">↕</span></span>
                <span class="sortable-header" data-column="toolsets">Toolsets <span class="sort-indicator">↕</span></span>
                <span class="sortable-header" data-column="logs">Logs <span class="sort-indicator">↕</span></span>
            </div>
            ${endpoints
              .map((endpoint) => {
                const toolsetsHtml =
                  endpoint.toolsets.length > 0
                    ? endpoint.toolsets
                        .map(
                          (cat) =>
                            `<a href="/toolset/${cat}" class="toolset-badge toolset-${cat}">${cat}</a>`,
                        )
                        .join("")
                    : "";

                const toolLink = endpoint.toolName
                  ? `<a href="/tools/${endpoint.toolName}" class="tool-name-link">${endpoint.toolName}</a>`
                  : "N/A";

                // Count log entries by severity
                const logCounts = endpoint.logs.reduce(
                  (counts, log) => {
                    const severity = log.severity.toLowerCase();
                    counts[severity] = (counts[severity] || 0) + 1;
                    return counts;
                  },
                  {} as Record<string, number>,
                );

                const logsHtml = Object.entries(logCounts)
                  .map(([severity, count]) => {
                    const icon = getLogIcon(severity.toUpperCase());
                    return `<a href="/tools/${encodeURIComponent(endpoint.name)}" class="log-badge ${severity}">
                      <span class="log-icon ${severity}">${icon}</span>
                      ${count}
                    </a>`;
                  })
                  .join(" ");

                return `
            <div class="endpoint">
                <span class="method ${endpoint.method}">${endpoint.method}</span>
                <span class="path">${endpoint.path}</span>
                <span class="description">${endpoint.description || "No description available"}</span>
                <span class="tool-name${!endpoint.toolName ? " empty" : ""}">${toolLink}</span>
                <span class="toolsets">${toolsetsHtml}</span>
                <span class="logs">${logsHtml}</span>
            </div>`;
              })
              .join("")}
        </div>`;
          })
          .join("")}
    </div>
</body>
</html>`;
};
