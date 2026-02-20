/**
 * Calendly Integration
 *
 * Provides access to Calendly scheduling -- list scheduled events, get event
 * details, and list available times for event types via the Calendly API v2.
 *
 * @requires CALENDLY_API_KEY - Personal access token from https://calendly.com/integrations/api_webhooks
 * @see https://developer.calendly.com/api-docs
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.calendly.com";

export default class CalendlyIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "calendly",
    name: "Calendly",
    category: "productivity",
    version: "1.0.0",
    description: "List events, get event details, and check available times in Calendly.",
    auth: {
      type: "api-key",
      envVars: ["CALENDLY_API_KEY"],
    },
    tools: [
      {
        name: "calendly_list_events",
        description: "List scheduled events for the authenticated user.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              description: "Filter by event status.",
              enum: ["active", "canceled"],
              default: "active",
            },
            count: {
              type: "number",
              description: "Max number of events to return (default 20, max 100).",
              default: 20,
            },
            minStartTime: {
              type: "string",
              description: "Only events starting at or after this ISO 8601 timestamp (optional).",
            },
            maxStartTime: {
              type: "string",
              description: "Only events starting before this ISO 8601 timestamp (optional).",
            },
          },
        },
      },
      {
        name: "calendly_get_event",
        description: "Get details of a specific scheduled event.",
        parameters: {
          type: "object",
          properties: {
            eventId: { type: "string", description: "Event UUID (the last segment of the event URI)." },
          },
          required: ["eventId"],
        },
      },
      {
        name: "calendly_list_available_times",
        description: "List available time slots for a specific event type.",
        parameters: {
          type: "object",
          properties: {
            eventTypeId: {
              type: "string",
              description: "Event type UUID (the last segment of the event type URI).",
            },
            startTime: {
              type: "string",
              description: "Start of availability window in ISO 8601 format.",
            },
            endTime: {
              type: "string",
              description: "End of availability window in ISO 8601 format.",
            },
          },
          required: ["eventTypeId", "startTime", "endTime"],
        },
      },
    ],
  };

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const creds = await this.getCredentials<{ CALENDLY_API_KEY: string }>();
    if (!creds?.CALENDLY_API_KEY) throw new Error("Missing CALENDLY_API_KEY");

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${creds.CALENDLY_API_KEY}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) throw new Error(`Calendly ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Resolve the current user's URI (needed by most Calendly endpoints). */
  private async getCurrentUserUri(): Promise<string> {
    const data = await this.request("/users/me");
    return data.resource.uri;
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "calendly_list_events":
          return await this.listEvents(args);
        case "calendly_get_event":
          return await this.getEvent(args.eventId as string);
        case "calendly_list_available_times":
          return await this.listAvailableTimes(
            args.eventTypeId as string,
            args.startTime as string,
            args.endTime as string,
          );
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Calendly error: ${(err as Error).message}`);
    }
  }

  private async listEvents(args: Record<string, unknown>): Promise<ToolResult> {
    const userUri = await this.getCurrentUserUri();
    const params = new URLSearchParams({ user: userUri });

    const status = (args.status as string) ?? "active";
    params.set("status", status);
    params.set("count", String(Math.min(Number(args.count ?? 20), 100)));

    if (args.minStartTime) params.set("min_start_time", args.minStartTime as string);
    if (args.maxStartTime) params.set("max_start_time", args.maxStartTime as string);

    const data = await this.request(`/scheduled_events?${params.toString()}`);
    const events = data.collection ?? [];

    const summary = events
      .map((e: any) => {
        const start = new Date(e.start_time).toLocaleString();
        const end = new Date(e.end_time).toLocaleString();
        const id = e.uri.split("/").pop();
        return `[${e.status}] ${e.name} | ${start} - ${end} (${id})`;
      })
      .join("\n");

    return this.ok(summary || "No events found.", { count: events.length });
  }

  private async getEvent(eventId: string): Promise<ToolResult> {
    const data = await this.request(`/scheduled_events/${eventId}`);
    const e = data.resource;

    const start = new Date(e.start_time).toLocaleString();
    const end = new Date(e.end_time).toLocaleString();

    // Fetch invitees for this event
    const inviteeData = await this.request(`/scheduled_events/${eventId}/invitees`);
    const invitees = (inviteeData.collection ?? [])
      .map((inv: any) => `  - ${inv.name ?? "Unknown"} <${inv.email}>`)
      .join("\n");

    const output = [
      `Event: ${e.name}`,
      `Status: ${e.status}`,
      `Time: ${start} - ${end}`,
      `Location: ${e.location?.location ?? "Not specified"}`,
      invitees ? `Invitees:\n${invitees}` : "Invitees: None",
    ].join("\n");

    return this.ok(output, {
      eventId,
      status: e.status,
      startTime: e.start_time,
      endTime: e.end_time,
    });
  }

  private async listAvailableTimes(
    eventTypeId: string,
    startTime: string,
    endTime: string,
  ): Promise<ToolResult> {
    const eventTypeUri = `${API_BASE}/event_types/${eventTypeId}`;
    const params = new URLSearchParams({
      event_type: eventTypeUri,
      start_time: startTime,
      end_time: endTime,
    });

    const data = await this.request(`/event_type_available_times?${params.toString()}`);
    const slots = data.collection ?? [];

    const summary = slots
      .map((slot: any) => {
        const status = slot.status === "available" ? "open" : slot.status;
        const time = new Date(slot.start_time).toLocaleString();
        return `[${status}] ${time}`;
      })
      .join("\n");

    return this.ok(summary || "No available times found.", {
      count: slots.length,
      eventTypeId,
    });
  }
}
