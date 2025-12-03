import { AAPMcpToolDefinition } from "../openapi-loader.js";
import { getLogIcon } from "./utils.js";
import { renderHeader, getHeaderStyles } from "../header.js";

interface ServiceData {
  name: string;
  displayName: string;
  toolCount: number;
  totalSize: number;
  description: string;
  logCount: number;
}

interface ServicesOverviewData {
  services: ServiceData[];
  allTools: AAPMcpToolDefinition[];
}

interface ServiceToolsData {
  serviceName: string;
  displayName: string;
  serviceTools: AAPMcpToolDefinition[];
  totalSize: number;
  methods: string[];
}

export const renderServicesOverview = (data: ServicesOverviewData): string => {
  const { services, allTools } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Services Overview - AAP MCP</title>
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
        .services-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .service-card {
            border: 2px solid #e9ecef;
            border-radius: 8px;
            padding: 20px;
            text-decoration: none;
            color: inherit;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .service-card:hover {
            border-color: #007acc;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            transform: translateY(-2px);
            text-decoration: none;
            color: inherit;
        }
        .service-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }
        .service-icon {
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
        .service-title {
            font-size: 1.3em;
            font-weight: bold;
            margin: 0;
        }
        .service-description {
            color: #6c757d;
            margin-bottom: 15px;
            line-height: 1.4;
        }
        .service-stats {
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
        .service-eda .service-icon { background-color: #2196f3; }
        .service-controller .service-icon { background-color: #9c27b0; }
        .service-gateway .service-icon { background-color: #4caf50; }
        .service-galaxy .service-icon { background-color: #ff9800; }
        .service-unknown .service-icon { background-color: #f44336; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Services Overview</h1>

        ${renderHeader()}

        <div class="summary">
            <h2>Available Services</h2>
            <p>The AAP MCP system integrates with ${services.length} different services, providing access to ${allTools.length} total tools across the Ansible Automation Platform ecosystem.</p>
        </div>

        <div class="services-grid">
            ${services
              .map(
                (service) => `
            <a href="/services/${service.name}" class="service-card service-${service.name}">
                <div class="service-header">
                    <div class="service-icon">
                        ${service.displayName.charAt(0)}
                    </div>
                    <h3 class="service-title">${service.displayName}</h3>
                </div>
                <p class="service-description">${service.description}</p>
                <div class="service-stats">
                    <div class="stat">
                        <div class="stat-number">${service.toolCount}</div>
                        <div class="stat-label">Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Math.round(service.totalSize / 1000)}K</div>
                        <div class="stat-label">Characters</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${service.logCount}</div>
                        <div class="stat-label">Messages</div>
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

export const renderServiceTools = (data: ServiceToolsData): string => {
  const {
    serviceName: _serviceName,
    displayName,
    serviceTools,
    totalSize,
    methods,
  } = data;

  const toolRows = serviceTools
    .map((tool) => {
      // Calculate log counts by severity
      const logCounts = tool.logs.reduce(
        (counts, log) => {
          const severity = log.severity.toLowerCase();
          counts[severity] = (counts[severity] || 0) + 1;
          return counts;
        },
        {} as Record<string, number>,
      );

      // Generate log badges
      const logBadges = Object.entries(logCounts)
        .map(([severity, count]) => {
          const icon = getLogIcon(severity);
          return `<a href="/tools/${encodeURIComponent(tool.fullName)}" class="log-badge ${severity}">
        <span class="log-icon ${severity}">${icon}</span>
        ${count}
      </a>`;
        })
        .join(" ");

      return `
    <tr>
      <td><a href="/tools/${encodeURIComponent(tool.fullName)}" style="color: #007acc; text-decoration: none;">${tool.fullName}</a></td>
      <td>${tool.size}</td>
      <td><span class="method-${tool.method.toLowerCase()}">${tool.method}</span></td>
      <td class="logs-column">${logBadges || '<span class="no-logs">—</span>'}</td>
    </tr>
    `;
    })
    .join("");

  // Group tools by log messages
  const logGroups: Record<
    string,
    { tools: AAPMcpToolDefinition[]; severity: string; icon: string }
  > = {};

  serviceTools.forEach((tool) => {
    tool.logs.forEach((log) => {
      const key = `${log.severity}:${log.msg}`;
      if (!logGroups[key]) {
        const icon = getLogIcon(log.severity.toLowerCase());
        logGroups[key] = {
          tools: [],
          severity: log.severity,
          icon: icon,
        };
      }
      logGroups[key].tools.push(tool);
    });
  });

  const logsContent =
    Object.keys(logGroups).length > 0
      ? Object.entries(logGroups)
          .map(([key, group]) => {
            const [severity, message] = key.split(":", 2);
            // Create a hash-friendly ID for this log group
            const logId = `log-${severity.toLowerCase()}-${message
              .replace(/[^a-zA-Z0-9]/g, "-")
              .replace(/-+/g, "-")
              .replace(/^-|-$/g, "")}`;
            return `
        <div class="log-group" id="${logId}">
          <div class="log-header">
            <span class="log-icon ${severity.toLowerCase()}">${getLogIcon(severity.toLowerCase())}</span>
            <span class="log-message">${message}</span>
            <span class="log-count">${group.tools.length} tool${group.tools.length !== 1 ? "s" : ""}</span>
            <button class="share-link-btn" onclick="copyShareLink('${logId}')" title="Copy share link">
              <span class="share-icon">🔗</span>
            </button>
          </div>
          <div class="log-tools">
            ${group.tools
              .map(
                (tool) =>
                  `<a href="/tools/${encodeURIComponent(tool.fullName)}" class="tool-link">${tool.fullName}</a>`,
              )
              .join("")}
          </div>
        </div>`;
          })
          .join("")
      : '<div class="no-logs">No logs found for tools in this service.</div>';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${displayName} Service - AAP MCP</title>
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
        .service-badge {
            display: inline-block;
            background-color: #007acc;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            margin-left: 10px;
        }
        ${getHeaderStyles()}

        /* Tabs */
        .tabs {
            display: flex;
            border-bottom: 2px solid #dee2e6;
            margin-bottom: 20px;
        }
        .tab {
            padding: 12px 24px;
            cursor: pointer;
            border: none;
            background: none;
            font-size: 1em;
            color: #6c757d;
            border-bottom: 3px solid transparent;
            transition: all 0.2s ease;
        }
        .tab:hover {
            color: #495057;
            background-color: #f8f9fa;
        }
        .tab.active {
            color: #007acc;
            border-bottom-color: #007acc;
            font-weight: bold;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }

        /* Tools table */
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
        .method-get { background-color: #28a745; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-post { background-color: #007bff; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-put { background-color: #ffc107; color: black; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-patch { background-color: #6f42c1; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-delete { background-color: #dc3545; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .stats {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }

        /* Logs styles */
        .log-group {
            border: 1px solid #dee2e6;
            border-radius: 8px;
            margin-bottom: 16px;
            overflow: hidden;
        }
        .log-header {
            background-color: #f8f9fa;
            padding: 12px 16px;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .share-link-btn {
            background: none;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 4px 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            margin-left: auto;
        }
        .share-link-btn:hover {
            background-color: #e9ecef;
            border-color: #adb5bd;
        }
        .share-icon {
            font-size: 14px;
        }
        .log-group.highlighted {
            border: 2px solid #007acc;
            background-color: #f8f9ff;
        }
        .log-group.highlighted .log-header {
            background-color: #e6f3ff;
        }
        .log-icon {
            font-size: 16px;
        }
        .log-icon.warn {
            color: #856404;
        }
        .log-icon.info {
            color: #0277bd;
        }
        .log-icon.err {
            color: #dc3545;
        }
        .log-message {
            flex: 1;
            font-weight: 500;
            color: #495057;
        }
        .log-count {
            background-color: #007acc;
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: bold;
        }
        .log-tools {
            padding: 16px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .tool-link {
            background-color: #e3f2fd;
            color: #1565c0;
            padding: 6px 12px;
            border-radius: 4px;
            text-decoration: none;
            font-size: 0.9em;
            font-weight: 500;
            transition: all 0.2s ease;
        }
        .tool-link:hover {
            background-color: #bbdefb;
            color: #0d47a1;
            text-decoration: none;
        }
        .no-logs {
            text-align: center;
            color: #6c757d;
            font-style: italic;
            padding: 40px;
        }

        /* Log badges for tools table */
        .logs-column {
            text-align: center;
            padding: 8px;
        }
        .log-badge {
            display: inline-block;
            padding: 4px 8px;
            margin: 2px;
            border-radius: 12px;
            text-decoration: none;
            font-size: 0.85em;
            font-weight: bold;
            transition: all 0.2s ease;
            cursor: pointer;
        }
        .log-badge.warn {
            background-color: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        .log-badge.warn:hover {
            background-color: #ffeaa7;
            color: #533f03;
            text-decoration: none;
        }
        .log-badge.info {
            background-color: #d1ecf1;
            color: #0c5460;
            border: 1px solid #b8daff;
        }
        .log-badge.info:hover {
            background-color: #b8daff;
            color: #004085;
            text-decoration: none;
        }
        .log-badge.err {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .log-badge.err:hover {
            background-color: #f5c6cb;
            color: #491217;
            text-decoration: none;
        }
        .log-icon {
            margin-right: 4px;
        }
        .no-logs {
            color: #6c757d;
            font-style: italic;
        }
    </style>
    <script>
        function showTab(tabName) {
            // Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });

            // Remove active class from all tabs
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });

            // Show selected tab content
            document.getElementById(tabName + '-content').classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
        }

        // Copy share link to clipboard
        function copyShareLink(logId) {
            const url = window.location.origin + window.location.pathname + '#' + logId;
            navigator.clipboard.writeText(url).then(function() {
                // Show temporary feedback
                const button = event.target.closest('.share-link-btn');
                const originalText = button.innerHTML;
                button.innerHTML = '<span style="color: green;">✓ Copied!</span>';
                setTimeout(() => {
                    button.innerHTML = originalText;
                }, 2000);
            }).catch(function() {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = url;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);

                const button = event.target.closest('.share-link-btn');
                const originalText = button.innerHTML;
                button.innerHTML = '<span style="color: green;">✓ Copied!</span>';
                setTimeout(() => {
                    button.innerHTML = originalText;
                }, 2000);
            });
        }

        // Handle URL hash on page load and hash changes
        function handleHash() {
            const hash = window.location.hash.substring(1);
            if (hash && hash.startsWith('log-')) {
                // Switch to logs tab
                showTab('logs');

                // Remove highlighting from all log groups
                document.querySelectorAll('.log-group').forEach(group => {
                    group.classList.remove('highlighted');
                });

                // Highlight the targeted log group
                const targetElement = document.getElementById(hash);
                if (targetElement) {
                    targetElement.classList.add('highlighted');
                    // Scroll to the element after a short delay to ensure tab content is visible
                    setTimeout(() => {
                        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }
            }
        }

        // Show tools tab by default when page loads, unless there's a hash
        document.addEventListener('DOMContentLoaded', function() {
            const hash = window.location.hash;
            if (hash && hash.startsWith('#log-')) {
                handleHash();
            } else if (hash === '#logs') {
                showTab('logs');
            } else {
                showTab('tools');
            }
        });

        // Handle hash changes (when user clicks browser back/forward or manually changes hash)
        window.addEventListener('hashchange', function() {
            const hash = window.location.hash;
            if (hash && hash.startsWith('#log-')) {
                handleHash();
            } else if (hash === '#logs') {
                showTab('logs');
            }
        });
    </script>
</head>
<body>
    <div class="container">
        <h1>${displayName} Service<span class="service-badge">${serviceTools.length} tools</span></h1>

        ${renderHeader()}

        <div class="stats">
            <strong>Service:</strong> ${displayName}<br>
            <strong>Total Tools:</strong> ${serviceTools.length}<br>
            <strong>Total Size:</strong> ${totalSize.toLocaleString()} characters<br>
            <strong>HTTP Methods:</strong> ${methods.join(", ")}
        </div>

        <!-- Tabs -->
        <div class="tabs">
            <button id="tools-tab" class="tab" onclick="showTab('tools')">Tools</button>
            <button id="logs-tab" class="tab" onclick="showTab('logs')">Logs</button>
        </div>

        <!-- Tools Tab Content -->
        <div id="tools-content" class="tab-content">
            <table>
                <thead>
                    <tr>
                        <th>Tool Name</th>
                        <th>Size (chars)</th>
                        <th>HTTP Method</th>
                        <th>Logs</th>
                    </tr>
                </thead>
                <tbody>
                    ${toolRows}
                </tbody>
            </table>
        </div>

        <!-- Logs Tab Content -->
        <div id="logs-content" class="tab-content">
            ${logsContent}
        </div>
    </div>
</body>
</html>`;
};

export type { ServiceData, ServicesOverviewData, ServiceToolsData };
