/**
 * Slack Channel Adapter for Wispy
 *
 * Integrates with Slack via @slack/bolt Socket Mode to provide
 * bidirectional messaging between Slack workspaces and the Wispy agent.
 *
 * Environment variables:
 *   SLACK_BOT_TOKEN        - Bot User OAuth Token (xoxb-...)
 *   SLACK_SIGNING_SECRET   - Signing secret for request verification
 *   SLACK_APP_TOKEN        - App-level token for Socket Mode (xapp-...)
 */

import {
  registerChannel,
  updateChannelStatus,
  registerChannelDispatcher,
  broadcastChannelEvent,
} from "../dock.js";
import { createLogger } from "../../infra/logger.js";

const log = createLogger("channel:slack");

export interface SlackChannelConfig {
  botToken: string;
  signingSecret: string;
  appToken: string;
  ignoreBots?: boolean;
  allowedChannels?: string[];
  maxMessageLength?: number;
}

type OnMessageFn = (
  chatId: string,
  text: string,
  meta?: Record<string, unknown>,
) => Promise<string>;

/**
 * Split a long response into Slack-safe chunks (max 4000 chars per block).
 */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt === -1 || splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

export async function startSlackChannel(
  config: SlackChannelConfig,
  onMessage: OnMessageFn,
): Promise<{ shutdown: () => Promise<void> }> {
  const ignoreBots = config.ignoreBots ?? true;
  const maxLen = config.maxMessageLength ?? 3900;

  const capabilities = {
    text: true,
    media: true,
    voice: false,
    buttons: true,
    reactions: true,
    groups: true,
    threads: true,
  };

  registerChannel({
    name: "slack",
    type: "chat",
    capabilities,
    status: "connecting",
  });

  let appRef: any = null;

  try {
    const { App } = await import("@slack/bolt" as string);

    const app = new App({
      token: config.botToken,
      signingSecret: config.signingSecret,
      appToken: config.appToken,
      socketMode: true,
    });
    appRef = app;

    // Handle direct messages and @mentions
    app.event("message", async ({ event, say }: { event: any; say: any }) => {
      try {
        const msg = event as any;

        // Skip bot messages to avoid loops
        if (ignoreBots && (msg.bot_id || msg.subtype === "bot_message")) return;

        // Filter channels if configured
        if (config.allowedChannels?.length && !config.allowedChannels.includes(msg.channel)) return;

        const userText = (msg.text || "").trim();
        if (!userText) return;

        const channelId = msg.channel as string;
        const userId = msg.user as string;
        const threadTs = msg.thread_ts || msg.ts;

        broadcastChannelEvent({
          type: "message",
          source: "slack",
          data: {
            text: userText,
            userId,
            channelId,
            threadTs,
          },
          timestamp: new Date().toISOString(),
        });

        const response = await onMessage(channelId, userText, {
          userId,
          channelId,
          threadTs,
          channelType: msg.channel_type,
        });

        const chunks = splitMessage(response, maxLen);
        for (const chunk of chunks) {
          await say({ text: chunk, thread_ts: threadTs });
        }
      } catch (err) {
        log.error("Error handling Slack message: %s", err);
        try {
          await say("Something went wrong while processing your message.");
        } catch { /* noop */ }
      }
    });

    // Handle app_mention events (when bot is @mentioned in channels)
    app.event("app_mention", async ({ event, say }: { event: any; say: any }) => {
      try {
        // Strip the bot mention from the text
        const rawText = (event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
        if (!rawText) return;

        const channelId = event.channel;
        const userId = event.user;
        const threadTs = event.thread_ts || event.ts;

        broadcastChannelEvent({
          type: "message",
          source: "slack",
          data: {
            text: rawText,
            userId,
            channelId,
            isMention: true,
          },
          timestamp: new Date().toISOString(),
        });

        const response = await onMessage(channelId, rawText, {
          userId,
          channelId,
          threadTs,
          isMention: true,
        });

        const chunks = splitMessage(response, maxLen);
        for (const chunk of chunks) {
          await say({ text: chunk, thread_ts: threadTs });
        }
      } catch (err) {
        log.error("Error handling Slack mention: %s", err);
      }
    });

    await app.start();
    updateChannelStatus("slack", "connected");
    log.info("Slack channel connected via Socket Mode");

    // Register dispatcher for cross-channel messaging
    registerChannelDispatcher("slack", {
      sendMessage: async (channelId: string, text: string) => {
        try {
          await app.client.chat.postMessage({
            token: config.botToken,
            channel: channelId,
            text,
          });
          return true;
        } catch (err) {
          log.error("Failed to send Slack message: %s", err);
          return false;
        }
      },
      sendImage: async (channelId: string, imagePath: string, caption?: string) => {
        try {
          const fs = await import("node:fs");
          await app.client.files.uploadV2({
            token: config.botToken,
            channel_id: channelId,
            file: fs.createReadStream(imagePath),
            initial_comment: caption,
          });
          return true;
        } catch (err) {
          log.error("Failed to send Slack image: %s", err);
          return false;
        }
      },
    });

    return {
      shutdown: async () => {
        log.info("Shutting down Slack channel...");
        updateChannelStatus("slack", "disconnected");
        await app.stop();
        appRef = null;
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Failed to start Slack channel: %s", msg);
    updateChannelStatus("slack", "error", msg);
    return {
      shutdown: async () => {},
    };
  }
}

/**
 * Quick-start helper using environment variables.
 */
export async function startSlackFromEnv(
  onMessage: OnMessageFn,
): Promise<{ shutdown: () => Promise<void> } | null> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!botToken || !signingSecret || !appToken) {
    log.info("Slack: missing SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, or SLACK_APP_TOKEN -- skipping");
    return null;
  }

  return startSlackChannel({ botToken, signingSecret, appToken }, onMessage);
}

export default { startSlackChannel, startSlackFromEnv };
