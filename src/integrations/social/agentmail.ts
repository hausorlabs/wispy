/**
 * Agentmail Integration
 *
 * AI-native email for agents -- create inboxes, send/receive emails, thread management.
 *
 * @requires AGENTMAIL_API_KEY - API key from https://agentmail.to
 * @see https://docs.agentmail.to
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

const API_BASE = "https://api.agentmail.to/v0";

export default class AgentmailIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "agentmail",
    name: "Agentmail",
    category: "social",
    version: "1.0.0",
    description: "AI-native email -- create inboxes, send/receive, thread management via Agentmail.",
    auth: {
      type: "api-key",
      envVars: ["AGENTMAIL_API_KEY"],
    },
    tools: [
      {
        name: "agentmail_create_inbox",
        description: "Create a new email inbox for the agent. Returns the inbox ID and email address.",
        parameters: {
          type: "object",
          properties: {
            username: { type: "string", description: "Local part of email (e.g. 'support'). Auto-generated if omitted." },
            domain: { type: "string", description: "Custom domain. Uses default agentmail domain if omitted." },
          },
        },
      },
      {
        name: "agentmail_send_email",
        description: "Send an email from an agent inbox.",
        parameters: {
          type: "object",
          properties: {
            from: { type: "string", description: "Sender email address (must be an agent inbox)." },
            to: { type: "string", description: "Recipient email address." },
            subject: { type: "string", description: "Email subject line." },
            body: { type: "string", description: "Plain text email body." },
            html: { type: "string", description: "Optional HTML email body." },
            inboxId: { type: "string", description: "Inbox ID to send from (resolved from 'from' if omitted)." },
          },
          required: ["from", "to", "subject", "body"],
        },
      },
      {
        name: "agentmail_list_emails",
        description: "List emails in an inbox.",
        parameters: {
          type: "object",
          properties: {
            inboxId: { type: "string", description: "The inbox ID to list emails from." },
            limit: { type: "number", description: "Max number of emails to return (default: 20)." },
          },
          required: ["inboxId"],
        },
      },
      {
        name: "agentmail_get_email",
        description: "Get the full content of a specific email.",
        parameters: {
          type: "object",
          properties: {
            inboxId: { type: "string", description: "The inbox ID." },
            messageId: { type: "string", description: "The message ID to retrieve." },
          },
          required: ["inboxId", "messageId"],
        },
      },
      {
        name: "agentmail_reply",
        description: "Reply to an existing email thread.",
        parameters: {
          type: "object",
          properties: {
            inboxId: { type: "string", description: "The inbox ID." },
            messageId: { type: "string", description: "The message ID to reply to." },
            body: { type: "string", description: "Plain text reply body." },
            html: { type: "string", description: "Optional HTML reply body." },
          },
          required: ["inboxId", "messageId", "body"],
        },
      },
      {
        name: "agentmail_list_inboxes",
        description: "List all agent email inboxes.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max number of inboxes to return (default: 20)." },
          },
        },
      },
      {
        name: "agentmail_delete_inbox",
        description: "Delete an email inbox and all its messages.",
        parameters: {
          type: "object",
          properties: {
            inboxId: { type: "string", description: "The inbox ID to delete." },
          },
          required: ["inboxId"],
        },
      },
    ],
    capabilities: {
      webhooks: true,
    },
  };

  private getApiKey(): string {
    const key = process.env.AGENTMAIL_API_KEY;
    if (!key) throw new Error("AGENTMAIL_API_KEY not set");
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
      throw new Error(`Agentmail ${res.status}: ${text}`);
    }

    // DELETE returns 204 with no body
    if (res.status === 204) return {};
    return res.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "agentmail_create_inbox": return await this.createInbox(args);
        case "agentmail_send_email": return await this.sendEmail(args);
        case "agentmail_list_emails": return await this.listEmails(args);
        case "agentmail_get_email": return await this.getEmail(args);
        case "agentmail_reply": return await this.replyToEmail(args);
        case "agentmail_list_inboxes": return await this.listInboxes(args);
        case "agentmail_delete_inbox": return await this.deleteInbox(args);
        default: return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Agentmail error: ${(err as Error).message}`);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.api("GET", "/inboxes?limit=1");
      return { healthy: true };
    } catch (err) {
      return { healthy: false, message: (err as Error).message };
    }
  }

  private async createInbox(args: Record<string, unknown>): Promise<ToolResult> {
    const body: Record<string, unknown> = {};
    if (args.username) body.username = args.username;
    if (args.domain) body.domain = args.domain;

    const data = await this.api("POST", "/inboxes", body);
    return this.ok(
      `Inbox created: ${data.email || data.address || data.id}`,
      { inboxId: data.id, email: data.email || data.address }
    );
  }

  private async sendEmail(args: Record<string, unknown>): Promise<ToolResult> {
    const inboxId = args.inboxId as string;
    const body: Record<string, unknown> = {
      from: args.from,
      to: args.to,
      subject: args.subject,
      body: args.body,
    };
    if (args.html) body.html = args.html;

    // If inboxId is provided, use it; otherwise try to resolve from 'from' address
    const path = inboxId
      ? `/inboxes/${inboxId}/messages`
      : "/messages";

    const data = await this.api("POST", path, body);
    return this.ok(
      `Email sent to ${args.to}: "${args.subject}"`,
      { messageId: data.id, to: args.to, subject: args.subject }
    );
  }

  private async listEmails(args: Record<string, unknown>): Promise<ToolResult> {
    const inboxId = args.inboxId as string;
    const limit = (args.limit as number) || 20;
    const data = await this.api("GET", `/inboxes/${inboxId}/messages?limit=${limit}`);

    const messages = Array.isArray(data) ? data : (data.messages || data.data || []);
    if (messages.length === 0) {
      return this.ok("No emails found in this inbox.");
    }

    const list = messages.map((m: any) =>
      `  [${m.id}] From: ${m.from || "unknown"} | Subject: ${m.subject || "(no subject)"} | ${m.created_at || m.date || ""}`
    ).join("\n");

    return this.ok(`Emails in inbox (${messages.length}):\n${list}`, { count: messages.length });
  }

  private async getEmail(args: Record<string, unknown>): Promise<ToolResult> {
    const { inboxId, messageId } = args as { inboxId: string; messageId: string };
    const data = await this.api("GET", `/inboxes/${inboxId}/messages/${messageId}`);

    return this.ok(
      `From: ${data.from || "unknown"}\nTo: ${data.to || "unknown"}\nSubject: ${data.subject || "(no subject)"}\nDate: ${data.created_at || data.date || ""}\n\n${data.body || data.text || ""}`,
      { messageId: data.id, from: data.from, subject: data.subject }
    );
  }

  private async replyToEmail(args: Record<string, unknown>): Promise<ToolResult> {
    const { inboxId, messageId, body: replyBody, html } = args as {
      inboxId: string;
      messageId: string;
      body: string;
      html?: string;
    };

    const payload: Record<string, unknown> = { body: replyBody };
    if (html) payload.html = html;

    const data = await this.api("POST", `/inboxes/${inboxId}/messages/${messageId}/reply`, payload);
    return this.ok(
      `Reply sent to thread ${messageId}`,
      { messageId: data.id, inReplyTo: messageId }
    );
  }

  private async listInboxes(args: Record<string, unknown>): Promise<ToolResult> {
    const limit = (args.limit as number) || 20;
    const data = await this.api("GET", `/inboxes?limit=${limit}`);

    const inboxes = Array.isArray(data) ? data : (data.inboxes || data.data || []);
    if (inboxes.length === 0) {
      return this.ok("No inboxes found. Use agentmail_create_inbox to create one.");
    }

    const list = inboxes.map((i: any) =>
      `  [${i.id}] ${i.email || i.address || "unknown"} (${i.status || "active"})`
    ).join("\n");

    return this.ok(`Inboxes (${inboxes.length}):\n${list}`, { count: inboxes.length });
  }

  private async deleteInbox(args: Record<string, unknown>): Promise<ToolResult> {
    const inboxId = args.inboxId as string;
    await this.api("DELETE", `/inboxes/${inboxId}`);
    return this.ok(`Inbox ${inboxId} deleted.`);
  }
}
