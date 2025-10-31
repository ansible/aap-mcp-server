import { promises as fs } from "fs";
import { join } from "path";
import { metricsService } from "./metrics.js";

export interface LogEntry {
	timestamp: string;
	endpoint: string;
	payload: any;
	response: any;
	return_code: number;
}

export interface Tool {
	name: string;
	service?: string;
	category?: string;
	[key: string]: any;
}

export class ToolLogger {
	private logDir: string;

	constructor(logDir: string = "logs") {
		this.logDir = logDir;
		this.ensureLogDir();
	}

	private async ensureLogDir(): Promise<void> {
		try {
			await fs.mkdir(this.logDir, { recursive: true });
		} catch (error) {
			console.error("Failed to create log directory:", error);
		}
	}

	async logToolAccess(
		tool: Tool,
		endpoint: string,
		payload: any,
		response: any,
		returnCode: number,
		startTime?: number,
		sessionId?: string,
		userAgent?: string
	): Promise<void> {
		const logEntry: LogEntry = {
			timestamp: new Date().toISOString(),
			endpoint,
			payload,
			response,
			return_code: returnCode,
		};

		const logFile = join(this.logDir, `${tool.name}.jsonl`);

		try {
			await fs.appendFile(logFile, JSON.stringify(logEntry) + "\n");
		} catch (error) {
			console.error(`Failed to write to log file ${logFile}:`, error);
		}
		// Record metrics
		const duration = startTime ? (Date.now() - startTime) / 1000 : 0;
		const status = returnCode >= 200 && returnCode < 400 ? "success" : "error";
		const service = tool.service || "unknown";
		const category = tool.category || "uncategorized";

		// Prometheus metrics
		metricsService.recordToolExecution(
			tool.name,
			service,
			category,
			status,
			duration
		);
		metricsService.recordApiCall(service, endpoint, "POST", returnCode);

		if (status === "error") {
			const errorType =
				returnCode >= 400 && returnCode < 500 ? "client_error" : "server_error";
			metricsService.recordToolError(tool.name, service, category, errorType);
		}
	}
}
