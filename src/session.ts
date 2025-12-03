import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { metricsService } from "./metrics.js";

// Helper function to get timestamps
const getTimestamp = (): string => {
  return new Date().toISOString().split(".")[0] + "Z";
};

// TypeScript interfaces
export interface SessionData {
  [sessionId: string]: {
    token: string;
    userAgent: string;
    toolset: string;
    transport: StreamableHTTPServerTransport;
    timeout: NodeJS.Timeout;
  };
}

// Session management class to encapsulate all sessionData operations
export class SessionManager {
  private sessions: SessionData = {};
  private readonly SESSION_TIMEOUT: number; // in seconds

  constructor(sessionTimeoutSeconds: number = 120) {
    this.SESSION_TIMEOUT = sessionTimeoutSeconds;
  }

  // Store session data
  store(
    sessionId: string,
    token: string,
    userAgent: string,
    toolset: string,
    transport: StreamableHTTPServerTransport,
  ): void {
    if (this.has(sessionId)) {
      clearTimeout(this.sessions[sessionId].timeout);
    } else {
      metricsService.incrementActiveSessions();
    }

    // Create timeout that will delete the session after SESSION_TIMEOUT seconds
    const timeout = setTimeout(() => {
      console.log(
        `${getTimestamp()} Session ${sessionId} timed out, removing from active sessions`,
      );
      metricsService.incrementSessionTimeouts();
      this.delete(sessionId);
    }, this.SESSION_TIMEOUT * 1000);

    this.sessions[sessionId] = {
      token,
      userAgent,
      toolset,
      transport,
      timeout,
    };
    console.log(
      `${getTimestamp()} Stored session data for ${sessionId}: userAgent=${userAgent}, toolset=${toolset}, active_session(s)=${this.getActiveCount()}`,
    );
  }

  // Reset session timeout (extends session lifetime)
  private resetTimeout(sessionId: string): void {
    const session = this.sessions[sessionId];
    if (!session) return;

    // Clear existing timeout
    clearTimeout(session.timeout);

    // Create new timeout
    const timeout = setTimeout(() => {
      console.log(
        `${getTimestamp()} Session ${sessionId} timed out, removing from active sessions`,
      );
      metricsService.incrementSessionTimeouts();
      this.delete(sessionId);
    }, this.SESSION_TIMEOUT * 1000);

    // Update timeout in session data
    session.timeout = timeout;
  }

  // Get session data
  get(sessionId: string) {
    const session = this.sessions[sessionId];
    if (session) {
      this.resetTimeout(sessionId);
      // Return session data without the timeout property
      const { timeout, ...sessionData } = session;
      return sessionData;
    }
    return undefined;
  }

  // Check if session exists
  has(sessionId: string): boolean {
    const exists = sessionId in this.sessions;
    if (exists) {
      this.resetTimeout(sessionId);
    }
    return exists;
  }

  // Delete session data
  delete(sessionId: string): void {
    if (this.sessions[sessionId]) {
      // Clear the timeout to prevent memory leaks
      clearTimeout(this.sessions[sessionId].timeout);
      delete this.sessions[sessionId];
      console.log(
        `${getTimestamp()} Removed session data for terminated session`,
      );
      metricsService.decrementActiveSessions();
    }
  }

  // Get all session IDs for iteration
  getAllSessionIds(): string[] {
    return Object.keys(this.sessions);
  }

  // Get count of active sessions
  getActiveCount(): number {
    return Object.keys(this.sessions).length;
  }

  // Convenient getters for specific properties
  getToken(sessionId: string): string | undefined {
    const session = this.sessions[sessionId];
    if (session) {
      this.resetTimeout(sessionId);
      return session.token;
    }
    return undefined;
  }

  getToolset(sessionId: string): string {
    const session = this.sessions[sessionId];
    if (!session) {
      throw new Error("Invalid or missing session ID");
    }
    this.resetTimeout(sessionId);
    return session.toolset;
  }

  getUserAgent(sessionId: string): string | undefined {
    const session = this.sessions[sessionId];
    if (session) {
      this.resetTimeout(sessionId);
      return session.userAgent;
    }
    return undefined;
  }

  getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
    const session = this.sessions[sessionId];
    if (session) {
      this.resetTimeout(sessionId);
      return session.transport;
    }
    return undefined;
  }

  // Close all sessions (for graceful shutdown)
  async closeAllSessions(): Promise<void> {
    for (const sessionId of this.getAllSessionIds()) {
      try {
        console.log(`${getTimestamp()} Closing transport during shutdown`);
        const transport = this.getTransport(sessionId);
        if (transport) {
          await transport.close();
        }
      } catch (error) {
        console.error(`${getTimestamp()} Error closing transport:`, error);
      }
      // Always delete session data even if transport close fails
      this.delete(sessionId);
    }
  }
}
