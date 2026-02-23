/**
 * Email Channel Adapter
 *
 * Routes inbound emails from Agentmail webhooks to agent.chat().
 * Registers "email" channel with the ChannelDock.
 *
 * @requires AGENTMAIL_API_KEY - For sending replies via Agentmail
 */

import express from "express";
import {
  registerChannel,
  updateChannelStatus,
  registerChannelDispatcher,
  broadcastChannelEvent,
} from "../dock.js";
import type { Agent } from "../../core/agent.js";
import { createLogger } from "../../infra/logger.js";

const log = createLogger("channel:email");

let agentInstance: Agent | null = null;

/**
 * Send an email reply via Agentmail API.
 */
async function sendEmailReply(to: string, subject: string, body: string): Promise<boolean> {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    log.warn("Cannot send email: AGENTMAIL_API_KEY not set");
    return false;
  }

  try {
    const res = await fetch("https://api.agentmail.to/v0/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, subject, body }),
    });

    if (!res.ok) {
      const text = await res.text();
      log.error("Failed to send email: %s %s", res.status, text);
      return false;
    }

    return true;
  } catch (err) {
    log.error({ err }, "Email send error");
    return false;
  }
}

/**
 * Start the email channel adapter.
 *
 * Creates an Express server that listens for Agentmail webhook events
 * and routes inbound emails to agent.chat().
 */
export function startEmailChannel(
  agent: Agent,
  runtimeDir: string,
  port = 4005
): void {
  agentInstance = agent;

  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", channel: "email" });
  });

  // Agentmail webhook endpoint for inbound emails
  app.post("/webhook/email", async (req, res) => {
    try {
      const payload = req.body;

      // Extract email fields -- Agentmail webhook payload
      const from = payload.from || payload.sender || payload.from_email || "";
      const subject = payload.subject || "(no subject)";
      const body = payload.body || payload.text || payload.plain || "";
      const html = payload.html || "";
      const inboxId = payload.inbox_id || payload.inboxId || "";
      const messageId = payload.message_id || payload.messageId || payload.id || "";

      if (!from) {
        res.status(400).json({ error: "Missing sender" });
        return;
      }

      log.info("Inbound email from %s: %s", from, subject);

      // Format email context for the agent
      const emailContext = [
        `[EMAIL from ${from}]`,
        `Subject: ${subject}`,
        `Message-ID: ${messageId}`,
        `Inbox: ${inboxId}`,
        "",
        body || "(empty body)",
      ].join("\n");

      // Route to agent
      const response = await agent.chat(emailContext, from, "email", "main");

      // Auto-reply if agent generated a response
      if (response.text) {
        const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
        const sent = await sendEmailReply(from, replySubject, response.text);

        if (sent) {
          broadcastChannelEvent({
            type: "notification",
            source: "email",
            data: { message: `Email reply sent to ${from}`, subject: replySubject },
            timestamp: new Date().toISOString(),
          });
        }
      }

      res.json({ ok: true, replied: !!response.text });
    } catch (err) {
      log.error({ err }, "Email webhook error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.listen(port, () => {
    log.info("Email channel listening on port %d", port);
    log.info("Webhook URL: http://localhost:%d/webhook/email", port);

    registerChannel({
      name: "email",
      type: "email",
      capabilities: {
        text: true,
        media: false,
        voice: false,
        buttons: false,
        reactions: false,
        groups: false,
        threads: true,
      },
      status: "connected",
      connectedAt: new Date().toISOString(),
    });

    registerChannelDispatcher("email", {
      sendMessage: async (chatId: string, text: string) => {
        return sendEmailReply(chatId, "Wispy Agent", text);
      },
      sendImage: async (_chatId: string, _imagePath: string, _caption?: string) => {
        return false; // Email attachments not yet supported via dispatcher
      },
    });
  });
}
