import express from "express";
import {
  renderDashboard,
  renderToolsList,
  renderToolDetails,
  renderToolsetsOverview,
  renderToolsetTools,
  renderLogs,
  renderServicesOverview,
  renderServiceTools,
  renderEndpointsOverview,
  type ToolWithSuccessRate,
  type ToolDetailsData,
  type ToolsetWithAccess,
  type ToolsetsOverviewData,
  type ToolsetToolsData,
  type LogsData,
  type ServicesOverviewData,
  type ServiceToolsData,
  type DashboardData,
  type EndpointsOverviewData,
  type EndpointData,
} from "./index.js";
import type { AAPMcpToolDefinition } from "../openapi-loader.js";
import type { LogEntry } from "../logger.js";
import { readFileSync, promises as fs } from "fs";
import { join } from "path";

// Helper function to get timestamps
const getTimestamp = (): string => {
  return new Date().toISOString().split(".")[0] + "Z";
};

// Helper function to read log entries for a tool
const getToolLogEntries = async (toolName: string): Promise<LogEntry[]> => {
  const logFile = join(process.cwd(), "logs", `${toolName}.jsonl`);
  try {
    const content = readFileSync(logFile, "utf8");
    const lines = content
      .trim()
      .split("\n")
      .filter((line) => line);
    return lines.map((line) => JSON.parse(line) as LogEntry);
  } catch (_error) {
    // Log file doesn't exist or can't be read
    return [];
  }
};

// Helper function to read all log entries across all tools
const getAllLogEntries = async (): Promise<
  (LogEntry & { toolName: string })[]
> => {
  const logsDir = join(process.cwd(), "logs");
  const allEntries: (LogEntry & { toolName: string })[] = [];

  try {
    const files = await fs.readdir(logsDir);
    const jsonlFiles = files.filter((file) => file.endsWith(".jsonl"));

    for (const file of jsonlFiles) {
      const toolName = file.replace(".jsonl", "");
      const entries = await getToolLogEntries(toolName);

      // Add toolName to each entry
      const entriesWithToolName = entries.map((entry) => ({
        ...entry,
        toolName,
      }));

      allEntries.push(...entriesWithToolName);
    }

    // Sort by timestamp, most recent first
    allEntries.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return allEntries;
  } catch (error) {
    console.error(`${getTimestamp()} Error reading log files:`, error);
    return [];
  }
};

// Generate dynamic color for toolset based on name
const getToolsetColor = (toolsetName: string): string => {
  const colors = [
    "#6c757d",
    "#28a745",
    "#dc3545",
    "#17a2b8",
    "#007acc",
    "#ff9800",
    "#9c27b0",
    "#4caf50",
  ];
  const hash = toolsetName
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

// Filter tools based on toolset
const filterToolsByToolset = (
  tools: AAPMcpToolDefinition[],
  toolset: string[],
): AAPMcpToolDefinition[] => {
  return tools.filter((tool) => toolset.includes(tool.name));
};

// Configure web UI routes
export const configureWebUIRoutes = (
  app: express.Application,
  allTools: AAPMcpToolDefinition[],
  allToolsets: Record<string, AAPMcpToolDefinition[]>,
  recordApiQueries: boolean,
  allowWriteOperations: boolean,
  logEntriesSizeLimit: number,
): void => {
  // Tool list HTML endpoint
  app.get("/tools", async (req, res) => {
    try {
      // Calculate success rates for all tools
      const toolsWithSuccessRates: ToolWithSuccessRate[] = await Promise.all(
        allTools.map(async (tool) => {
          const logEntries = await getToolLogEntries(tool.name);
          let successRate = "N/A";

          if (logEntries.length > 0) {
            const successCount = logEntries.filter(
              (entry) => entry.return_code >= 200 && entry.return_code < 300,
            ).length;
            const successPercentage = (successCount / logEntries.length) * 100;
            successRate = `${successPercentage.toFixed(1)}%`;
          }

          return {
            ...tool,
            successRate,
            logCount: logEntries.length,
          };
        }),
      );

      // Use the view function to render the HTML
      const htmlContent = renderToolsList({ tools: toolsWithSuccessRates });

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error(
        `${getTimestamp()} Error generating HTML tool list:`,
        error,
      );
      res.status(500).json({
        error: "Failed to generate tool list HTML",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Individual tool details endpoint
  app.get("/tools/:fullName", async (req, res) => {
    try {
      const toolFullName = req.params.fullName;

      // Find the tool
      const tool = allTools.find((t) => t.fullName === toolFullName);
      if (!tool) {
        return res.status(404).json({
          error: "Tool not found",
          message: `Tool '${toolFullName}' does not exist`,
        });
      }

      // Get log entries for this tool
      const logEntries = await getToolLogEntries(toolFullName);
      const last10Calls = logEntries.slice(-10).reverse(); // Get last 10, most recent first

      // Calculate error code summary
      const errorCodeSummary = logEntries.reduce(
        (acc, entry) => {
          const code = entry.return_code;
          acc[code] = (acc[code] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>,
      );

      // Calculate success vs error statistics for pie chart
      const chartData = logEntries.reduce(
        (acc, entry) => {
          const code = entry.return_code;
          if (code >= 200 && code < 300) {
            acc.success += 1;
          } else {
            acc.error += 1;
          }
          return acc;
        },
        { success: 0, error: 0 },
      );

      // Check which toolsets have access to this tool
      const toolsetsWithAccess: ToolsetWithAccess[] = [];
      for (const [toolsetName, toolsetTools] of Object.entries(allToolsets)) {
        if (toolsetTools.map((t) => t.fullName).includes(toolFullName)) {
          toolsetsWithAccess.push({
            name: toolsetName,
            displayName:
              toolsetName.charAt(0).toUpperCase() + toolsetName.slice(1),
            color: getToolsetColor(toolsetName),
          });
        }
      }

      // Prepare data for the view
      const toolDetailsData: ToolDetailsData = {
        tool,
        logEntries,
        last10Calls,
        errorCodeSummary,
        chartData,
        toolsetsWithAccess,
      };

      // Use the view function to render the HTML
      const htmlContent = renderToolDetails(toolDetailsData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error(`${getTimestamp()} Error generating tool details:`, error);
      res.status(500).json({
        error: "Failed to generate tool details",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Tool list CSV endpoint
  app.get("/export/tools/csv", (req, res) => {
    try {
      // Generate CSV content
      const csvHeader =
        "Tool name,size (characters),description,path template,service\n";
      const csvRows = allTools
        .map(
          (tool) =>
            `${tool.name},${tool.size},"${tool.description?.replace(/"/g, '""') || ""}",${tool.pathTemplate},${tool.service || "unknown"}`,
        )
        .join("\n");
      const csvContent = csvHeader + csvRows;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="tool_list.csv"',
      );
      res.send(csvContent);
    } catch (error) {
      console.error(`${getTimestamp()} Error generating CSV tool list:`, error);
      res.status(500).json({
        error: "Failed to generate tool list CSV",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Toolset overview endpoint
  app.get("/toolset", (req, res) => {
    try {
      // Calculate stats for each toolset
      const toolsets = Object.entries(allToolsets).map(
        ([toolsetName, toolsetTools]) => ({
          name: toolsetName,
          displayName:
            toolsetName.charAt(0).toUpperCase() + toolsetName.slice(1),
          description: `${toolsetName.charAt(0).toUpperCase() + toolsetName.slice(1)} toolset with specific tool access`,
          tools: toolsetTools,
          color: getToolsetColor(toolsetName),
          toolCount: 0, // Will be calculated below
          totalSize: 0, // Will be calculated below
        }),
      );

      // Calculate sizes and add to toolset data
      const toolsetStats = toolsets.map((toolset) => ({
        ...toolset,
        toolCount: toolset.tools.length,
        totalSize: toolset.tools.reduce(
          (sum, tool) => sum + (tool.size || 0),
          0,
        ),
      }));

      // Prepare data for the view
      const toolsetsOverviewData: ToolsetsOverviewData = {
        toolsets: toolsetStats,
        allTools,
      };

      // Use the view function to render the HTML
      const htmlContent = renderToolsetsOverview(toolsetsOverviewData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error(
        `${getTimestamp()} Error generating toolset overview:`,
        error,
      );
      res.status(500).json({
        error: "Failed to generate toolset overview",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Toolset tools endpoint
  app.get("/toolset/:name", (req, res) => {
    try {
      const toolsetName = req.params.name.toLowerCase();

      const displayName =
        toolsetName.charAt(0).toUpperCase() + toolsetName.slice(1);

      // Filter tools based on toolset
      const filteredTools = allToolsets[toolsetName];

      // Calculate total size
      const totalSize = filteredTools.reduce(
        (sum, tool) => sum + (tool.size || 0),
        0,
      );

      // Prepare data for the view
      const toolsetToolsData: ToolsetToolsData = {
        toolsetName: toolsetName,
        displayName,
        filteredTools,
        totalSize,
        allToolsets: allToolsets,
      };

      // Use the view function to render the HTML
      const htmlContent = renderToolsetTools(toolsetToolsData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error(
        `${getTimestamp()} Error generating toolset tool list:`,
        error,
      );
      res.status(500).json({
        error: "Failed to generate toolset tool list",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Logs overview endpoint
  app.get("/logs", async (req, res) => {
    try {
      if (!recordApiQueries) {
        return res.status(404).json({
          error: "Logging disabled",
          message:
            "API query recording is disabled. Enable it in aap-mcp.yaml to view logs.",
        });
      }

      // Get all log entries
      const allEntries = await getAllLogEntries();
      let lastEntries = allEntries.slice(0, logEntriesSizeLimit);

      // Apply status code filter if provided
      const statusCodeFilter = req.query.status_code as string;
      if (statusCodeFilter) {
        const filterCode = parseInt(statusCodeFilter, 10);
        if (!isNaN(filterCode)) {
          lastEntries = lastEntries.filter(
            (entry) => entry.return_code === filterCode,
          );
        }
      }

      // Apply tool filter if provided
      const toolFilter = req.query.tool as string;
      if (toolFilter) {
        lastEntries = lastEntries.filter(
          (entry) => entry.toolName === toolFilter,
        );
      }

      // Apply user-agent filter if provided
      const userAgentFilter = req.query.user_agent as string;
      if (userAgentFilter) {
        lastEntries = lastEntries.filter((entry) => {
          const entryUserAgent = entry.payload?.userAgent || "unknown";
          return entryUserAgent
            .toLowerCase()
            .includes(userAgentFilter.toLowerCase());
        });
      }

      const totalRequests = allEntries.length;
      const statusCodeSummary = lastEntries.reduce(
        (acc, entry) => {
          const code = entry.return_code;
          acc[code] = (acc[code] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>,
      );

      const toolSummary = lastEntries.reduce(
        (acc, entry) => {
          acc[entry.toolName] = (acc[entry.toolName] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const userAgentSummary = lastEntries.reduce(
        (acc, entry) => {
          const userAgent = entry.payload?.userAgent || "unknown";
          acc[userAgent] = (acc[userAgent] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      // Transform log entries to match the view interface
      const transformedEntries = lastEntries.map((entry) => ({
        timestamp: entry.timestamp,
        toolName: entry.toolName,
        return_code: entry.return_code,
        endpoint: entry.endpoint,
        payload: entry.payload,
        userAgent: entry.payload?.userAgent || "unknown",
      }));

      // Prepare data for the view
      const logsData: LogsData = {
        lastEntries: transformedEntries,
        totalRequests,
        statusCodeFilter,
        toolFilter,
        userAgentFilter,
        statusCodeSummary,
        toolSummary,
        userAgentSummary,
        logEntriesSizeLimit,
      };

      // Use the view function to render the HTML
      const htmlContent = renderLogs(logsData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error(`${getTimestamp()} Error generating logs overview:`, error);
      res.status(500).json({
        error: "Failed to generate logs overview",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Services overview endpoint
  app.get("/services", (req, res) => {
    try {
      // Group tools by service
      const serviceGroups = allTools.reduce(
        (acc, tool) => {
          const service = tool.service || "unknown";
          if (!acc[service]) {
            acc[service] = [];
          }
          acc[service].push(tool);
          return acc;
        },
        {} as Record<string, AAPMcpToolDefinition[]>,
      );

      // Prepare service data for the view
      const services = Object.entries(serviceGroups).map(
        ([serviceName, tools]) => ({
          name: serviceName,
          displayName:
            serviceName.charAt(0).toUpperCase() + serviceName.slice(1),
          toolCount: tools.length,
          totalSize: tools.reduce((sum, tool) => sum + (tool.size || 0), 0),
          logCount: tools.reduce(
            (sum, tool) => sum + (tool.logs?.length || 0),
            0,
          ),
          description: `${serviceName.charAt(0).toUpperCase() + serviceName.slice(1)} service providing ${tools.length} tools for automation and management tasks.`,
        }),
      );

      // Prepare data for the view
      const servicesOverviewData: ServicesOverviewData = {
        services,
        allTools,
      };

      // Use the view function to render the HTML
      const htmlContent = renderServicesOverview(servicesOverviewData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error(
        `${getTimestamp()} Error generating services overview:`,
        error,
      );
      res.status(500).json({
        error: "Failed to generate services overview",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/services/:name", (req, res) => {
    try {
      const serviceName = req.params.name.toLowerCase();

      // Filter tools by service
      const serviceTools = allTools.filter(
        (tool) => (tool.service || "unknown") === serviceName,
      );

      if (serviceTools.length === 0) {
        return res.status(404).json({
          error: "Service not found",
          message: `Service '${req.params.name}' does not exist or has no tools`,
        });
      }

      const displayName =
        serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
      const totalSize = serviceTools.reduce(
        (sum, tool) => sum + (tool.size || 0),
        0,
      );
      const methods = [...new Set(serviceTools.map((tool) => tool.method))];

      // Prepare data for the view
      const serviceToolsData: ServiceToolsData = {
        serviceName,
        displayName,
        serviceTools,
        totalSize,
        methods,
      };

      // Use the view function to render the HTML
      const htmlContent = renderServiceTools(serviceToolsData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error(
        `${getTimestamp()} Error generating service tools list:`,
        error,
      );
      res.status(500).json({
        error: "Failed to generate service tools list",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // API endpoints overview
  app.get("/endpoints", (req, res) => {
    try {
      // Get toolset filter from query parameter
      const toolsetFilter = req.query.toolset as string | undefined;

      // Filter tools by toolset if specified
      let toolsToDisplay = allTools;
      if (toolsetFilter && allToolsets[toolsetFilter]) {
        toolsToDisplay = allToolsets[toolsetFilter];
      }

      // Helper function to find toolsets for a tool
      const getToolsetsForTool = (toolName: string): string[] => {
        const toolsets: string[] = [];
        for (const [toolsetName, toolsetTools] of Object.entries(allToolsets)) {
          if (toolsetTools.map((t) => t.fullName).includes(toolName)) {
            toolsets.push(toolsetName);
          }
        }
        return toolsets;
      };

      // Group endpoints by service
      const endpointsByService = toolsToDisplay.reduce(
        (acc, tool) => {
          const service = tool.service || "unknown";
          if (!acc[service]) {
            acc[service] = [];
          }

          const toolsets = getToolsetsForTool(tool.fullName);

          acc[service].push({
            path: tool.pathTemplate,
            method: tool.method.toUpperCase(),
            name: tool.fullName,
            description: tool.description,
            toolName: tool.fullName,
            toolsets,
            logs: tool.logs || [],
          });

          return acc;
        },
        {} as Record<string, EndpointData[]>,
      );

      // Sort endpoints within each service by path
      Object.keys(endpointsByService).forEach((service) => {
        endpointsByService[service].sort((a, b) =>
          a.path.localeCompare(b.path),
        );
      });

      // Prepare data for the view
      const endpointsOverviewData: EndpointsOverviewData = {
        allTools: toolsToDisplay,
        endpointsByService,
        allToolsets,
        selectedToolset: toolsetFilter,
      };

      // Use the view function to render the HTML
      const htmlContent = renderEndpointsOverview(endpointsOverviewData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error(
        `${getTimestamp()} Error generating endpoints overview:`,
        error,
      );
      res.status(500).json({
        error: "Failed to generate endpoints overview",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Root endpoint - dashboard
  app.get("/", async (req, res) => {
    try {
      // Prepare data for the dashboard view
      const dashboardData: DashboardData = {
        allTools,
        allToolsets,
        recordApiQueries,
        allowWriteOperations,
      };

      // Use the view function to render the HTML
      const htmlContent = renderDashboard(dashboardData);

      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error(`${getTimestamp()} Error generating dashboard:`, error);
      res.status(500).json({
        error: "Failed to generate dashboard",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
