/**
 * Microsoft Teams Integration
 *
 * Sends messages and adaptive cards to Teams channels via Incoming Webhooks.
 * This uses the simple webhook connector approach -- no Azure AD or Bot Framework
 * registration required. Create a webhook in Teams channel settings to get the URL.
 *
 * @requires MSTEAMS_WEBHOOK_URL - Incoming Webhook URL from the Teams channel connector.
 * @see https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
 */

import { Integration, type IntegrationManifest, type ToolResult } from "../base.js";

export default class MSTeamsIntegration extends Integration {
  readonly manifest: IntegrationManifest = {
    id: "msteams",
    name: "Microsoft Teams",
    category: "chat",
    version: "1.0.0",
    description: "Send messages and adaptive cards to Microsoft Teams channels via webhooks.",
    auth: {
      type: "token",
      envVars: ["MSTEAMS_WEBHOOK_URL"],
    },
    tools: [
      {
        name: "teams_send",
        description: "Send a plain text message to a Teams channel via the configured webhook.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Message text to send. Supports basic Markdown." },
            title: { type: "string", description: "Optional bold title displayed above the message." },
          },
          required: ["text"],
        },
      },
      {
        name: "teams_card",
        description: "Send an Adaptive Card to a Teams channel. Useful for structured data, status updates, or interactive content.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Card title." },
            body: { type: "string", description: "Main body text of the card." },
            facts: {
              type: "array",
              description: "Key-value facts displayed in a table layout, e.g. [{\"name\":\"Status\",\"value\":\"OK\"}].",
              items: {
                type: "object",
                description: "A fact with name and value.",
              },
            },
            buttonText: { type: "string", description: "Optional action button label." },
            buttonUrl: { type: "string", description: "URL opened when the action button is clicked." },
          },
          required: ["title", "body"],
        },
      },
    ],
  };

  private async getWebhookUrl(): Promise<string> {
    const creds = await this.getCredentials<{ MSTEAMS_WEBHOOK_URL: string }>();
    if (!creds?.MSTEAMS_WEBHOOK_URL) throw new Error("Missing MSTEAMS_WEBHOOK_URL");
    return creds.MSTEAMS_WEBHOOK_URL;
  }

  private async postToWebhook(payload: Record<string, unknown>): Promise<void> {
    const url = await this.getWebhookUrl();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Webhook POST failed (${res.status}): ${body}`);
    }
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case "teams_send":
          return await this.sendMessage(args.text as string, args.title as string | undefined);
        case "teams_card":
          return await this.sendCard(
            args.title as string,
            args.body as string,
            args.facts as Array<{ name: string; value: string }> | undefined,
            args.buttonText as string | undefined,
            args.buttonUrl as string | undefined,
          );
        default:
          return this.error(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.error(`Teams error: ${(err as Error).message}`);
    }
  }

  private async sendMessage(text: string, title?: string): Promise<ToolResult> {
    const payload: Record<string, unknown> = { text };
    if (title) payload.title = title;

    await this.postToWebhook(payload);
    return this.ok(`Message sent to Teams channel.${title ? ` Title: "${title}"` : ""}`);
  }

  private async sendCard(
    title: string,
    body: string,
    facts?: Array<{ name: string; value: string }>,
    buttonText?: string,
    buttonUrl?: string,
  ): Promise<ToolResult> {
    const cardBody: Record<string, unknown>[] = [
      { type: "TextBlock", size: "Medium", weight: "Bolder", text: title },
      { type: "TextBlock", text: body, wrap: true },
    ];

    if (facts?.length) {
      cardBody.push({
        type: "FactSet",
        facts: facts.map((f) => ({ title: f.name, value: f.value })),
      });
    }

    const actions: Record<string, unknown>[] = [];
    if (buttonText && buttonUrl) {
      actions.push({ type: "Action.OpenUrl", title: buttonText, url: buttonUrl });
    }

    const card = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: cardBody,
            ...(actions.length ? { actions } : {}),
          },
        },
      ],
    };

    await this.postToWebhook(card);
    return this.ok(`Adaptive card "${title}" sent to Teams channel.`, {
      factsCount: facts?.length ?? 0,
      hasButton: !!(buttonText && buttonUrl),
    });
  }
}
