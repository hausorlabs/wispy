/**
 * Signal Integration
 *
 * Provides messaging access to Signal via the signal-cli REST API.
 * Supports sending messages, listing contacts, and reading incoming messages.
 *
 * @requires SIGNAL_CLI_REST_URL - Base URL of the signal-cli-rest-api instance (e.g. http://localhost:8080).
 * @requires SIGNAL_PHONE_NUMBER - The registered Signal phone number in E.164 format.
 * @see https://github.com/bbernhard/signal-cli-rest-api
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const DEFAULT_API_BASE = "http://localhost:8080";

export default class SignalIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "signal",
    name: "Signal",
    category: "chat",
    version: "1.0.0",
    description: "Send messages, list contacts, and read messages via Signal.",
    auth: {
      type: "api-key",
      envVars: ["SIGNAL_CLI_REST_URL", "SIGNAL_PHONE_NUMBER"],
    },
    tools: [
      {
        name: "signal_send_message",
        description: "Send a text message to a Signal recipient.",
        parameters: {
          type: "object",
          properties: {
            recipient: { type: "string", description: "Recipient phone number in E.164 format (e.g. +1234567890)." },
            message: { type: "string", description: "Message text to send." },
          },
          required: ["recipient", "message"],
        },
      },
      {
        name: "signal_list_contacts",
        description: "List all known Signal contacts for the registered number.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "signal_read_messages",
        description: "Read pending incoming Signal messages.",
        parameters: {
          type: "object",
          properties: {
            timeout: { type: "number", description: "Timeout in seconds to wait for messages (default 1).", default: 1 },
          },
        },
      },
    ],
  };

  private async getCreds() {
    const creds = await this.getCredentials<{ SIGNAL_CLI_REST_URL: string; SIGNAL_PHONE_NUMBER: string }>();
    if (!creds?.SIGNAL_CLI_REST_URL || !creds?.SIGNAL_PHONE_NUMBER) {
      throw new Error("Missing SIGNAL_CLI_REST_URL or SIGNAL_PHONE_NUMBER");
    }
    return {
      apiBase: creds.SIGNAL_CLI_REST_URL.replace(/\/+$/, "") || DEFAULT_API_BASE,
      phone: creds.SIGNAL_PHONE_NUMBER,
    };
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "signal_send_message":
          return await this.sendMessage(args.recipient as string, args.message as string);
        case "signal_list_contacts":
          return await this.listContacts();
        case "signal_read_messages":
          return await this.readMessages((args.timeout as number) ?? 1);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Signal error: ${(err as Error).message}`);
    }
  }

  private async sendMessage(recipient: string, message: string): Promise<ToolResult> {
    const { apiBase, phone } = await this.getCreds();

    const res = await fetch(`${apiBase}/v2/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        number: phone,
        recipients: [recipient],
      }),
    });

    if (!res.ok) return this.error(`Failed to send message: ${res.status} ${await res.text()}`);
    const data = await res.json() as any;
    return this.ok(`Message sent to ${recipient}`, { timestamp: data.timestamp });
  }

  private async listContacts(): Promise<ToolResult> {
    const { apiBase, phone } = await this.getCreds();
    const encoded = encodeURIComponent(phone);

    const res = await fetch(`${apiBase}/v1/contacts/${encoded}`);
    if (!res.ok) return this.error(`Failed to list contacts: ${res.status}`);

    const contacts = await res.json() as any[];
    const summary = contacts
      .map((c: any) => `${c.name || "Unknown"} (${c.number || c.uuid || "?"})`)
      .join("\n");
    return this.ok(summary || "No contacts found.", { count: contacts.length });
  }

  private async readMessages(timeout: number): Promise<ToolResult> {
    const { apiBase, phone } = await this.getCreds();
    const encoded = encodeURIComponent(phone);
    const secs = Math.min(Math.max(Math.round(timeout), 0), 30);

    const res = await fetch(`${apiBase}/v1/receive/${encoded}?timeout=${secs}`);
    if (!res.ok) return this.error(`Failed to read messages: ${res.status}`);

    const messages = await res.json() as any[];
    if (!messages.length) return this.ok("No new messages.", { count: 0 });

    const summary = messages
      .filter((m: any) => m.envelope?.dataMessage)
      .map((m: any) => {
        const source = m.envelope.sourceNumber ?? m.envelope.sourceName ?? "unknown";
        const text = m.envelope.dataMessage.message ?? "";
        return `[${source}] ${text}`;
      })
      .join("\n");
    return this.ok(summary || "No text messages in response.", { count: messages.length });
  }
}
