/**
 * Zoho Email Integration
 *
 * Send and list emails via the Zoho Mail REST API.
 * Uses OAuth2 refresh tokens for authentication.
 *
 * @requires ZOHO_CLIENT_ID - OAuth2 client ID from Zoho API Console.
 * @requires ZOHO_CLIENT_SECRET - OAuth2 client secret.
 * @requires ZOHO_REFRESH_TOKEN - OAuth2 refresh token (obtained via consent flow).
 * @requires ZOHO_ACCOUNT_ID - Zoho Mail account ID (from mail.zoho.com settings).
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";
import { readFileSync, existsSync } from "fs";
import { basename } from "path";

interface ZohoTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export default class ZohoEmailIntegration extends Integration {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  readonly manifest: IntegrationManifest = {
    id: "zoho-email",
    name: "Zoho Mail",
    category: "social",
    version: "1.0.0",
    description: "Send and list emails via Zoho Mail API with file attachment support.",
    auth: {
      type: "oauth2",
      scopes: ["ZohoMail.messages.ALL", "ZohoMail.accounts.READ"],
      authUrl: "https://accounts.zoho.com/oauth/v2/auth",
      tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
      envVars: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ACCOUNT_ID"],
    },
    tools: [
      {
        name: "zoho_send_email",
        description: "Send an email via Zoho Mail with optional file attachments.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject line" },
            body: { type: "string", description: "Email body (plain text or HTML)" },
            cc: { type: "string", description: "CC recipients (comma-separated)" },
            attachments: { type: "string", description: "Comma-separated file paths to attach" },
            isHtml: { type: "boolean", description: "Send body as HTML (default: false)" },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "zoho_list_emails",
        description: "List recent emails from Zoho inbox.",
        parameters: {
          type: "object",
          properties: {
            folder: { type: "string", description: "Folder: inbox, sent, drafts (default: inbox)" },
            limit: { type: "number", description: "Number of emails to retrieve (default: 10, max: 50)" },
          },
        },
      },
    ],
  };

  private getEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`${key} environment variable not set`);
    return val;
  }

  private async refreshAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const clientId = this.getEnv("ZOHO_CLIENT_ID");
    const clientSecret = this.getEnv("ZOHO_CLIENT_SECRET");
    const refreshToken = this.getEnv("ZOHO_REFRESH_TOKEN");

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    const resp = await fetch("https://accounts.zoho.com/oauth/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!resp.ok) {
      throw new Error(`Zoho token refresh failed: ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as ZohoTokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken;
  }

  private async zohoRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    const token = await this.refreshAccessToken();
    const accountId = this.getEnv("ZOHO_ACCOUNT_ID");
    const url = `https://mail.zoho.com/api/accounts/${accountId}${path}`;

    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      throw new Error(`Zoho API error: ${resp.status} ${await resp.text()}`);
    }

    return resp.json();
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "zoho_send_email":
          return await this.sendEmail(args);
        case "zoho_list_emails":
          return await this.listEmails(args);
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Zoho error: ${(err as Error).message}`);
    }
  }

  private async sendEmail(args: Record<string, unknown>): Promise<ToolResult> {
    const to = String(args.to || "");
    const subject = String(args.subject || "");
    const body = String(args.body || "");
    const cc = args.cc ? String(args.cc) : undefined;
    const isHtml = Boolean(args.isHtml);
    const attachmentPaths = args.attachments
      ? String(args.attachments).split(",").map((p) => p.trim()).filter(Boolean)
      : [];

    if (!to || !subject || !body) {
      return this.error("to, subject, and body are required");
    }

    // Upload attachments first if any
    const attachIds: string[] = [];
    for (const filePath of attachmentPaths) {
      if (!existsSync(filePath)) {
        return this.error(`Attachment not found: ${filePath}`);
      }
      try {
        const token = await this.refreshAccessToken();
        const accountId = this.getEnv("ZOHO_ACCOUNT_ID");
        const fileData = readFileSync(filePath);
        const fileName = basename(filePath);

        const formData = new FormData();
        formData.append("attach", new Blob([fileData]), fileName);

        const resp = await fetch(
          `https://mail.zoho.com/api/accounts/${accountId}/messages/attachments`,
          {
            method: "POST",
            headers: { Authorization: `Zoho-oauthtoken ${token}` },
            body: formData,
          }
        );

        if (resp.ok) {
          const result = (await resp.json()) as any;
          if (result.data?.attachId) {
            attachIds.push(result.data.attachId);
          }
        }
      } catch {
        // Continue without this attachment
      }
    }

    const emailPayload: Record<string, unknown> = {
      fromAddress: process.env.ZOHO_FROM_ADDRESS || process.env.SMTP_USER || "",
      toAddress: to,
      subject,
      content: body,
      mailFormat: isHtml ? "html" : "plaintext",
    };

    if (cc) emailPayload.ccAddress = cc;
    if (attachIds.length > 0) emailPayload.attachments = attachIds.map((id) => ({ storeName: id }));

    await this.zohoRequest("POST", "/messages", emailPayload);

    const attachInfo = attachIds.length > 0 ? ` with ${attachIds.length} attachment(s)` : "";
    return { success: true, output: `Email sent to ${to}${attachInfo}` };
  }

  private async listEmails(args: Record<string, unknown>): Promise<ToolResult> {
    const folder = String(args.folder || "inbox");
    const limit = Math.min(Number(args.limit) || 10, 50);

    const folderMap: Record<string, string> = {
      inbox: "inbox",
      sent: "sentmailbox",
      drafts: "drafts",
    };
    const folderId = folderMap[folder] || "inbox";

    const data = (await this.zohoRequest("GET", `/messages/view?folderId=${folderId}&limit=${limit}`)) as any;

    if (!data?.data?.length) {
      return { success: true, output: `No emails found in ${folder}` };
    }

    const emails = data.data.map((msg: any, i: number) => {
      const from = msg.fromAddress || msg.sender || "Unknown";
      const subj = msg.subject || "(no subject)";
      const date = msg.receivedTime
        ? new Date(Number(msg.receivedTime)).toLocaleString()
        : "";
      return `${i + 1}. ${subj}\n   From: ${from}\n   Date: ${date}`;
    });

    return { success: true, output: `${folder} (${emails.length} emails):\n\n${emails.join("\n\n")}` };
  }

  protected override error(msg: string): ToolResult {
    return { success: false, output: "", error: msg };
  }
}
