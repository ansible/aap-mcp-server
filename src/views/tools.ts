import { AAPMcpToolDefinition } from "../openapi-loader.js";
import { renderHeader, getHeaderStyles } from "../header.js";

interface ToolWithSuccessRate extends AAPMcpToolDefinition {
  successRate: string;
  logCount: number;
}

interface ToolsListData {
  tools: ToolWithSuccessRate[];
}

export const renderToolsList = (data: ToolsListData): string => {
  const { tools } = data;

  const toolRows = tools
    .map(
      (tool) => `
    <tr data-name="${tool.fullName}" data-size="${tool.size}" data-service="${tool.service || "unknown"}" data-success-rate="${tool.successRate === "N/A" ? -1 : parseFloat(tool.successRate)}">
      <td><a href="/tools/${encodeURIComponent(tool.fullName)}" style="color: #007acc; text-decoration: none;">${tool.fullName}</a></td>
      <td>${tool.size}</td>
      <td><span class="service-${tool.service || "unknown"}">${tool.service || "unknown"}</span></td>
      <td><span class="success-rate ${tool.successRate === "N/A" ? "no-data" : parseFloat(tool.successRate) >= 90 ? "excellent" : parseFloat(tool.successRate) >= 70 ? "good" : "poor"}">${tool.successRate}</span></td>
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
    <title>AAP MCP Tools List</title>
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
        .stats {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
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
        code {
            background-color: #f4f4f4;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: monospace;
        }
        .service-eda { background-color: #e3f2fd; padding: 3px 6px; border-radius: 3px; }
        .service-controller { background-color: #f3e5f5; padding: 3px 6px; border-radius: 3px; }
        .service-gateway { background-color: #e8f5e8; padding: 3px 6px; border-radius: 3px; }
        .service-galaxy { background-color: #fff3e0; padding: 3px 6px; border-radius: 3px; }
        .service-unknown { background-color: #ffebee; padding: 3px 6px; border-radius: 3px; }
        .service-operator { background-color: #e1f5fe; padding: 3px 6px; border-radius: 3px; }
        .actions {
            margin-bottom: 20px;
        }
        .btn {
            background-color: #007acc;
            color: white;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
        }
        .btn:hover {
            background-color: #005a9e;
        }
        .success-rate {
            font-weight: bold;
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
        }
        .success-rate.excellent {
            background-color: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .success-rate.good {
            background-color: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        .success-rate.poor {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .success-rate.no-data {
            background-color: #e2e3e5;
            color: #6c757d;
            border: 1px solid #ced4da;
        }
        .sortable {
            cursor: pointer;
            user-select: none;
            position: relative;
        }
        .sortable:hover {
            background-color: #f8f9fa;
        }
        .sort-indicator {
            margin-left: 5px;
            color: #6c757d;
            font-size: 0.8em;
        }
        .sortable.asc .sort-indicator {
            color: #007acc;
        }
        .sortable.asc .sort-indicator::after {
            content: ' ↑';
        }
        .sortable.desc .sort-indicator {
            color: #007acc;
        }
        .sortable.desc .sort-indicator::after {
            content: ' ↓';
        }
        ${getHeaderStyles()}
    </style>
</head>
<body>
    <div class="container">
        <h1>AAP MCP Tools List</h1>

        ${renderHeader()}

        <div class="stats">
            <strong>Total Tools:</strong> ${tools.length}<br>
            <strong>Total Size:</strong> ${tools.reduce((sum, tool) => sum + (tool.size || 0), 0).toLocaleString()} characters
        </div>

        <div class="actions">
            <a href="/export/tools/csv" class="btn">Download CSV</a>
        </div>

        <table>
            <thead>
                <tr>
                    <th class="sortable" data-column="name">
                        Tool Name <span class="sort-indicator">⇅</span>
                    </th>
                    <th class="sortable" data-column="size">
                        Size (chars) <span class="sort-indicator">⇅</span>
                    </th>
                    <th class="sortable" data-column="service">
                        Service <span class="sort-indicator">⇅</span>
                    </th>
                    <th class="sortable" data-column="successRate">
                        Success Rate <span class="sort-indicator">⇅</span>
                    </th>
                </tr>
            </thead>
            <tbody>
                ${toolRows}
            </tbody>
        </table>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const table = document.querySelector('table tbody');
            const headers = document.querySelectorAll('th.sortable');
            let currentSort = { column: null, direction: 'asc' };

            // Read URL parameters on page load
            function readUrlParams() {
                const urlParams = new URLSearchParams(window.location.search);
                const sortBy = urlParams.get('sort_by');
                const sortOrder = urlParams.get('sort_order');

                if (sortBy && ['name', 'size', 'service', 'successRate'].includes(sortBy)) {
                    currentSort.column = sortBy;
                    currentSort.direction = sortOrder === 'desc' ? 'desc' : 'asc';

                    // Apply the sorting
                    sortTable(currentSort.column, currentSort.direction);

                    // Update header indicators
                    headers.forEach(h => {
                        h.classList.remove('asc', 'desc');
                        if (h.dataset.column === currentSort.column) {
                            h.classList.add(currentSort.direction);
                        }
                    });
                }
            }

            // Update URL with current sort parameters
            function updateUrl(column, direction) {
                const url = new URL(window.location);
                url.searchParams.set('sort_by', column);
                url.searchParams.set('sort_order', direction);
                window.history.replaceState({}, '', url);
            }

            headers.forEach(header => {
                header.addEventListener('click', function() {
                    const column = this.dataset.column;

                    // Toggle direction if clicking the same column
                    if (currentSort.column === column) {
                        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                    } else {
                        currentSort.direction = 'asc';
                    }
                    currentSort.column = column;

                    // Update header indicators
                    headers.forEach(h => {
                        h.classList.remove('asc', 'desc');
                    });
                    this.classList.add(currentSort.direction);

                    // Sort the table
                    sortTable(column, currentSort.direction);

                    // Update URL
                    updateUrl(column, currentSort.direction);
                });
            });

            function sortTable(column, direction) {
                const rows = Array.from(table.querySelectorAll('tr'));

                rows.sort((a, b) => {
                    let aVal, bVal;

                    switch(column) {
                        case 'name':
                            aVal = a.dataset.name.toLowerCase();
                            bVal = b.dataset.name.toLowerCase();
                            break;
                        case 'size':
                            aVal = parseInt(a.dataset.size) || 0;
                            bVal = parseInt(b.dataset.size) || 0;
                            break;
                        case 'service':
                            aVal = a.dataset.service.toLowerCase();
                            bVal = b.dataset.service.toLowerCase();
                            break;
                        case 'successRate':
                            aVal = parseFloat(a.dataset.successRate) || -1;
                            bVal = parseFloat(b.dataset.successRate) || -1;
                            break;
                        default:
                            return 0;
                    }

                    if (column === 'size' || column === 'successRate') {
                        // Numeric sorting
                        return direction === 'asc' ? aVal - bVal : bVal - aVal;
                    } else {
                        // String sorting
                        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
                        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
                        return 0;
                    }
                });

                // Reorder the table rows
                rows.forEach(row => table.appendChild(row));
            }

            // Initialize sorting from URL parameters
            readUrlParams();
        });
    </script>
</body>
</html>`;
};

export type { ToolWithSuccessRate };
