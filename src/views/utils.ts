/**
 * Shared utility functions for view rendering
 */

/**
 * Gets the appropriate icon for a log severity level
 * @param severity The log severity level (case-insensitive)
 * @returns The emoji icon for the severity
 */
export const getLogIcon = (severity: string): string => {
  switch (severity.toLowerCase()) {
    case "info":
      return "ℹ️";
    case "warn":
      return "⚠️";
    case "err":
      return "❌";
    default:
      return "📝"; // Default for unknown severity
  }
};
