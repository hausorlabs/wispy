/**
 * Telnyx Integration
 *
 * Carrier-grade telephony -- voice calls, SMS, and phone number management.
 *
 * @requires TELNYX_API_KEY - API key from https://portal.telnyx.com
 * @see https://developers.telnyx.com/docs/api/v2
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.telnyx.com/v2";

export default class TelnyxIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "telnyx",
    name: "Telnyx",
    category: "social",
    version: "1.0.0",
    description: "Telephony -- voice calls, SMS, and phone number management via Telnyx.",
    auth: {
      type: "api-key",
      envVars: ["TELNYX_API_KEY"],
    },
    tools: [
      {
        name: "telnyx_make_call",
        description: "Initiate an outbound voice call.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Destination phone number in E.164 format (e.g. +1234567890)." },
            from: { type: "string", description: "Caller ID phone number in E.164 format. Defaults to TELNYX_FROM_NUMBER env var if omitted." },
            connectionId: { type: "string", description: "Telnyx connection ID. Uses TELNYX_CONNECTION_ID env var if omitted." },
            webhookUrl: { type: "string", description: "URL for call event webhooks." },
          },
          required: ["to"],
        },
      },
      {
        name: "telnyx_send_sms",
        description: "Send an SMS or MMS message.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient phone number in E.164 format." },
            from: { type: "string", description: "Sender phone number in E.164 format (must be a Telnyx number)." },
            text: { type: "string", description: "Message text content." },
            mediaUrl: { type: "string", description: "URL to media file for MMS." },
          },
          required: ["to", "from", "text"],
        },
      },
      {
        name: "telnyx_list_numbers",
        description: "List all phone numbers owned by this account.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max results to return (default: 20)." },
          },
        },
      },
      {
        name: "telnyx_search_numbers",
        description: "Search for available phone numbers to purchase.",
        parameters: {
          type: "object",
          properties: {
            countryCode: { type: "string", description: "ISO country code (e.g. 'US', 'GB', 'KE')." },
            areaCode: { type: "string", description: "Area code to search in." },
            contains: { type: "string", description: "Digits the number should contain." },
            limit: { type: "number", description: "Max results to return (default: 10)." },
          },
        },
      },
      {
        name: "telnyx_buy_number",
        description: "Purchase an available phone number.",
        parameters: {
          type: "object",
          properties: {
            phoneNumber: { type: "string", description: "The phone number to purchase in E.164 format." },
            connectionId: { type: "string", description: "Connection ID to assign. Uses TELNYX_CONNECTION_ID if omitted." },
          },
          required: ["phoneNumber"],
        },
      },
      {
        name: "telnyx_release_number",
        description: "Release (delete) a phone number from your account.",
        parameters: {
          type: "object",
          properties: {
            phoneNumberId: { type: "string", description: "The phone number resource ID to release." },
          },
          required: ["phoneNumberId"],
        },
      },
      {
        name: "telnyx_get_call_status",
        description: "Get the current status of an active call.",
        parameters: {
          type: "object",
          properties: {
            callControlId: { type: "string", description: "The call control ID returned when initiating a call." },
          },
          required: ["callControlId"],
        },
      },
    ],
    capabilities: {
      webhooks: true,
    },
  };

  private getApiKey(): string {
    const key = process.env.TELNYX_API_KEY;
    if (!key) throw new Error("TELNYX_API_KEY not set");
    return key;
  }

  private async api(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${this.getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Telnyx ${res.status}: ${text}`);
    }

    if (res.status === 204) return {};
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "telnyx_make_call": return await this.makeCall(args);
        case "telnyx_send_sms": return await this.sendSms(args);
        case "telnyx_list_numbers": return await this.listNumbers(args);
        case "telnyx_search_numbers": return await this.searchNumbers(args);
        case "telnyx_buy_number": return await this.buyNumber(args);
        case "telnyx_release_number": return await this.releaseNumber(args);
        case "telnyx_get_call_status": return await this.getCallStatus(args);
        default: return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Telnyx error: ${(err as Error).message}`);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.api("GET", "/phone_numbers?page[size]=1");
      return { healthy: true };
    } catch (err) {
      return { healthy: false, message: (err as Error).message };
    }
  }

  private async makeCall(args: Record<string, unknown>): Promise<ToolResult> {
    const connectionId = (args.connectionId as string) || process.env.TELNYX_CONNECTION_ID;
    if (!connectionId) {
      return this.error("No connection ID. Set TELNYX_CONNECTION_ID or pass connectionId parameter.");
    }

    // Default from to TELNYX_FROM_NUMBER so agent doesn't need to guess
    const fromNumber = (args.from as string) || process.env.TELNYX_FROM_NUMBER;
    if (!fromNumber) {
      return this.error("No from number. Set TELNYX_FROM_NUMBER or pass from parameter.");
    }

    const body: Record<string, unknown> = {
      connection_id: connectionId,
      to: args.to,
      from: fromNumber,
    };

    if (args.webhookUrl) {
      body.webhook_url = args.webhookUrl;
    } else {
      // Auto-wire webhook URL so call events route back to the phone adapter
      const host = process.env.TELNYX_WEBHOOK_HOST;
      if (host) {
        const base = host.endsWith("/") ? host.slice(0, -1) : host;
        body.webhook_url = `${base}/webhook/voice`;
      }
    }

    const data = await this.api("POST", "/calls", body);
    const callData = data.data || data;

    return this.ok(
      `Call initiated to ${args.to} from ${fromNumber}`,
      {
        callControlId: callData.call_control_id,
        callLegId: callData.call_leg_id,
        callSessionId: callData.call_session_id,
      }
    );
  }

  private async sendSms(args: Record<string, unknown>): Promise<ToolResult> {
    const body: Record<string, unknown> = {
      to: args.to,
      from: args.from,
      text: args.text,
      type: "SMS",
    };
    if (args.mediaUrl) {
      body.media_urls = [args.mediaUrl];
      body.type = "MMS";
    }

    const data = await this.api("POST", "/messages", body);
    const msgData = data.data || data;

    return this.ok(
      `SMS sent to ${args.to}: "${(args.text as string).slice(0, 50)}${(args.text as string).length > 50 ? "..." : ""}"`,
      { messageId: msgData.id, to: args.to, type: body.type }
    );
  }

  private async listNumbers(args: Record<string, unknown>): Promise<ToolResult> {
    const limit = (args.limit as number) || 20;
    const data = await this.api("GET", `/phone_numbers?page[size]=${limit}`);
    const numbers = data.data || [];

    if (numbers.length === 0) {
      return this.ok("No phone numbers found. Use telnyx_search_numbers and telnyx_buy_number to get one.");
    }

    const list = numbers.map((n: any) =>
      `  [${n.id}] ${n.phone_number} (${n.status}) - ${n.connection_name || "no connection"}`
    ).join("\n");

    return this.ok(`Phone numbers (${numbers.length}):\n${list}`, { count: numbers.length });
  }

  private async searchNumbers(args: Record<string, unknown>): Promise<ToolResult> {
    const params = new URLSearchParams();
    if (args.countryCode) params.set("filter[country_code]", args.countryCode as string);
    if (args.areaCode) params.set("filter[national_destination_code]", args.areaCode as string);
    if (args.contains) params.set("filter[phone_number][contains]", args.contains as string);
    params.set("page[size]", String((args.limit as number) || 10));

    const data = await this.api("GET", `/available_phone_numbers?${params.toString()}`);
    const numbers = data.data || [];

    if (numbers.length === 0) {
      return this.ok("No available numbers found matching your criteria.");
    }

    const list = numbers.map((n: any) =>
      `  ${n.phone_number} (${n.region_information?.[0]?.region_name || n.country_code || "unknown"}) - $${n.cost_information?.monthly_cost || "?"}/mo`
    ).join("\n");

    return this.ok(`Available numbers (${numbers.length}):\n${list}`, { count: numbers.length });
  }

  private async buyNumber(args: Record<string, unknown>): Promise<ToolResult> {
    const connectionId = (args.connectionId as string) || process.env.TELNYX_CONNECTION_ID;

    const body: Record<string, unknown> = {
      phone_numbers: [{ phone_number: args.phoneNumber }],
    };
    if (connectionId) body.connection_id = connectionId;

    const data = await this.api("POST", "/number_orders", body);
    const order = data.data || data;

    return this.ok(
      `Number order placed for ${args.phoneNumber}`,
      { orderId: order.id, status: order.status, phoneNumber: args.phoneNumber }
    );
  }

  private async releaseNumber(args: Record<string, unknown>): Promise<ToolResult> {
    const phoneNumberId = args.phoneNumberId as string;
    await this.api("DELETE", `/phone_numbers/${phoneNumberId}`);
    return this.ok(`Phone number ${phoneNumberId} released.`);
  }

  private async getCallStatus(args: Record<string, unknown>): Promise<ToolResult> {
    const callControlId = args.callControlId as string;

    // Telnyx doesn't have a direct GET /calls/{id} endpoint for call status.
    // Call status is tracked via webhook events. Return what we can.
    try {
      const data = await this.api("GET", `/calls/${callControlId}`);
      const call = data.data || data;
      return this.ok(
        `Call ${callControlId}: ${call.state || call.status || "unknown"}`,
        { callControlId, state: call.state, from: call.from, to: call.to }
      );
    } catch {
      return this.ok(
        `Call status for ${callControlId} is tracked via webhooks. Check your webhook endpoint for real-time updates.`,
        { callControlId, note: "Status is delivered via webhook events" }
      );
    }
  }
}
