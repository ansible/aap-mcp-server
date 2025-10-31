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

/**
 * Injects analytics scripts into HTML content before closing body tag
 */
export const injectAnalytics = async (html: string, enableAnalytics?: boolean, segmentWriteKey?: string): Promise<string> => {
  if (!enableAnalytics || !segmentWriteKey) {
    return html;
  }

  try {
    // Import analytics functions dynamically to avoid circular imports
    const { getSegmentSnippet, getAnalyticsTrackingCode } = await import('../analytics.js');
    
    const analyticsScripts = `
    ${getSegmentSnippet(segmentWriteKey)}
    ${getAnalyticsTrackingCode()}
`;

    // Insert analytics scripts before closing body tag
    return html.replace('</body>', `${analyticsScripts}</body>`);
  } catch (error) {
    // If analytics module can't be loaded, return HTML unchanged
    console.warn('Failed to load analytics module:', error);
    return html;
  }
};
