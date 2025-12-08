import type { Plugin, Context } from "@segment/analytics-node";
import {
  SessionStartedEvent,
  ToolCalledEvent,
  ServerStatusEvent,
} from "./analytics.js";

/**
 * Validation schemas for different event types
 */
const EVENT_SCHEMAS = {
  mcp_session_started: {
    required: ["sess_id", "process_id", "user_unique_id"],
    optional: ["user_agent", "mcp_tool_set"],
    validators: {
      sess_id: (value: any) => typeof value === "string" && value.length > 0,
      process_id: (value: any) => typeof value === "string" && value.length > 0,
      user_unique_id: (value: any) =>
        typeof value === "string" && value.length > 0,
      user_agent: (value: any) =>
        value === undefined || typeof value === "string",
      mcp_tool_set: (value: any) =>
        value === undefined || typeof value === "string",
    },
  },
  mcp_tool_called: {
    required: [
      "tool_name",
      "mcp_tool_set",
      "user_agent",
      "sess_id",
      "parameter_length",
      "http_status",
      "execution_time_ms",
      "user_unique_id",
    ],
    optional: [],
    validators: {
      tool_name: (value: any) => typeof value === "string" && value.length > 0,
      mcp_tool_set: (value: any) =>
        typeof value === "string" && value.length > 0,
      user_agent: (value: any) => typeof value === "string" && value.length > 0,
      sess_id: (value: any) => typeof value === "string" && value.length > 0,
      parameter_length: (value: any) => typeof value === "number" && value >= 0,
      http_status: (value: any) =>
        typeof value === "number" &&
        (value === 0 || (value >= 100 && value < 600)),
      execution_time_ms: (value: any) =>
        typeof value === "number" && value >= 0,
      user_unique_id: (value: any) =>
        typeof value === "string" && value.length > 0,
    },
  },
  mcp_server_status: {
    required: [
      "process_id",
      "health_status",
      "active_sessions",
      "uptime_seconds",
      "server_version",
      "container_version",
      "read_only_mode",
    ],
    optional: [],
    validators: {
      process_id: (value: any) => typeof value === "string" && value.length > 0,
      health_status: (value: any) =>
        typeof value === "string" &&
        ["healthy", "degraded", "unhealthy"].includes(value),
      active_sessions: (value: any) => typeof value === "number" && value >= 0,
      uptime_seconds: (value: any) => typeof value === "number" && value >= 0,
      server_version: (value: any) =>
        typeof value === "string" && value.length > 0,
      container_version: (value: any) =>
        typeof value === "string" && value.length > 0,
      read_only_mode: (value: any) => typeof value === "boolean",
    },
  },
} as const;

/**
 * Configuration options for the validation plugin
 */
interface ValidationPluginConfig {
  /** Whether to drop invalid events or just log warnings */
  dropInvalidEvents?: boolean;
  /** Custom logger function (defaults to console.error) */
  logger?: (message: string, data?: any) => void;
  /** Whether to log validation successes (defaults to false) */
  logSuccess?: boolean;
}

/**
 * Validation error details
 */
interface ValidationError {
  field: string;
  issue: string;
  value?: any;
}

/**
 * Validates an event against its schema
 * @param eventName Name of the event type
 * @param properties Event properties to validate
 * @returns Array of validation errors (empty if valid)
 */
function validateEvent(eventName: string, properties: any): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check if we have a schema for this event type
  const schema = EVENT_SCHEMAS[eventName as keyof typeof EVENT_SCHEMAS];
  if (!schema) {
    errors.push({
      field: "event",
      issue: `Unknown event type: ${eventName}`,
    });
    return errors;
  }

  // Check if properties is an object
  if (!properties || typeof properties !== "object") {
    errors.push({
      field: "properties",
      issue: "Properties must be a non-null object",
      value: properties,
    });
    return errors;
  }

  // Validate required fields
  for (const field of schema.required) {
    if (!(field in properties)) {
      errors.push({
        field,
        issue: "Required field is missing",
      });
      continue;
    }

    const validator = (schema.validators as any)[field];
    if (validator && !validator(properties[field])) {
      errors.push({
        field,
        issue: "Field value is invalid",
        value: properties[field],
      });
    }
  }

  // Validate optional fields (if present)
  for (const field of schema.optional) {
    if (field in properties) {
      const validator = (schema.validators as any)[field];
      if (validator && !validator(properties[field])) {
        errors.push({
          field,
          issue: "Optional field value is invalid",
          value: properties[field],
        });
      }
    }
  }

  // Check for unexpected fields
  const allowedFields = [...schema.required, ...schema.optional] as string[];
  for (const field in properties) {
    if (!allowedFields.includes(field)) {
      errors.push({
        field,
        issue: "Unexpected field found",
        value: properties[field],
      });
    }
  }

  return errors;
}

/**
 * Creates a validation enrichment plugin for Analytics events
 *
 * This plugin validates event structure against predefined schemas,
 * ensuring data integrity before events are sent to Segment.
 *
 * @param config Configuration options for the plugin
 * @returns Analytics plugin for event validation
 */
export function createValidationPlugin(
  config: ValidationPluginConfig = {},
): Plugin {
  const {
    dropInvalidEvents = false,
    logger = console.error,
    logSuccess = false,
  } = config;

  return {
    name: "Analytics Event Validation",
    type: "before",
    version: "1.0.0",
    isLoaded: () => true,
    load: () => Promise.resolve(),

    track: (ctx: Context) => {
      const { event } = ctx;

      if (!event || !event.event || !event.properties) {
        logger("Analytics Validation: Invalid event structure", { event });
        return dropInvalidEvents ? ctx.cancel() : ctx;
      }

      const errors = validateEvent(event.event, event.properties);

      if (errors.length > 0) {
        const errorMessage = `Analytics Validation: Event "${event.event}" failed validation`;
        logger(errorMessage, {
          errors,
          event: {
            name: event.event,
            properties: event.properties,
          },
        });

        if (dropInvalidEvents) {
          return ctx.cancel();
        }
      } else if (logSuccess) {
        logger(
          `Analytics Validation: Event "${event.event}" passed validation`,
        );
      }

      return ctx;
    },

    identify: (ctx: Context) => {
      // For identify events, we just pass through since we don't have specific validation
      return ctx;
    },

    group: (ctx: Context) => {
      // For group events, we just pass through since we don't have specific validation
      return ctx;
    },

    page: (ctx: Context) => {
      // For page events, we just pass through since we don't have specific validation
      return ctx;
    },

    screen: (ctx: Context) => {
      // For screen events, we just pass through since we don't have specific validation
      return ctx;
    },

    alias: (ctx: Context) => {
      // For alias events, we just pass through since we don't have specific validation
      return ctx;
    },
  };
}

/**
 * Type-safe event validation functions for external use
 */
export const validateSessionStartedEvent = (
  properties: any,
): properties is SessionStartedEvent => {
  const errors = validateEvent("mcp_session_started", properties);
  return errors.length === 0;
};

export const validateToolCalledEvent = (
  properties: any,
): properties is ToolCalledEvent => {
  const errors = validateEvent("mcp_tool_called", properties);
  return errors.length === 0;
};

export const validateServerStatusEvent = (
  properties: any,
): properties is ServerStatusEvent => {
  const errors = validateEvent("mcp_server_status", properties);
  return errors.length === 0;
};
