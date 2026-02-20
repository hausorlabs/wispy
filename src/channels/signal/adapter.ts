/**
 * Signal Channel Adapter for Wispy
 *
 * Integrates with Signal via the signal-cli-rest-api Docker container.
 * Polls the REST API for incoming messages and sends replies via the
 * /v2/send endpoint.
 *
 * Environment variables:
 *   SIGNAL_CLI_URL       - Base URL of the signal-cli-rest-api (default: http://localhost:8080)
 *   SIGNAL_PHONE_NUMBER  - Registered Signal phone number (e.g. +1234567890)
 */

import {
  registerChannel,
  updateChannelStatus,
  registerChannelDispatcher,
  broadcastChannelEvent,
} from "../dock.js";
import { createLogger } from "../../infra/logger.js";

const log = createLogger("channel:signal");

export interface SignalChannelConfig {
  apiUrl: string;
  phoneNumber: string;
  pollIntervalMs?: number;
  maxMessageLength?: number;
}

type OnMessageFn = (
  chatId: string,
  text: string,
  meta?: Record<string, unknown>,
) => Promise<string>;

export async function startSignalChannel(
  config: SignalChannelConfig,
  onMessage: OnMessageFn,
): Promise<{ shutdown: () => Promise<void> }> {
  const pollInterval = config.pollIntervalMs ?? 2_000;
  const maxLen = config.maxMessageLength ?? 4_000;
  const apiBase = config.apiUrl.replace(/\/+$/, "");

  const capabilities = {
    text: true,
    media: true,
    voice: false,
    buttons: false,
    reactions: true,
    groups: true,
    threads: false,
  };

  registerChannel({
    name: "signal",
    type: "chat",
    capabilities,
    status: "connecting",
  });

  let running = true;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Send a text message to a Signal recipient (phone number or group ID).
   */
  async function sendMessage(recipient: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(`${apiBase}/v2/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: config.phoneNumber,
          recipients: [recipient],
          message: text,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        log.error("Signal send failed (%d): %s", res.status, err);
        return false;
      }
      return true;
    } catch (err) {
      log.error("Signal send error: %s", err);
      return false;
    }
  }

  /**
   * Send an image attachment via Signal.
   */
  async function sendImage(recipient: string, imagePath: string, caption?: string): Promise<boolean> {
    try {
      const fs = await import("node:fs");
      const imageData = fs.readFileSync(imagePath);
      const base64 = imageData.toString("base64");

      const res = await fetch(`${apiBase}/v2/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: config.phoneNumber,
          recipients: [recipient],
          message: caption || "",
          base64_attachments: [base64],
        }),
      });
      return res.ok;
    } catch (err) {
      log.error("Signal image send error: %s", err);
      return false;
    }
  }

  /**
   * Poll the signal-cli-rest-api /v1/receive endpoint for incoming messages.
   */
  async function pollMessages(): Promise<void> {
    while (running) {
      try {
        const url = `${apiBase}/v1/receive/${encodeURIComponent(config.phoneNumber)}`;
        const res = await fetch(url, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
          log.error("Signal receive failed (%d): %s", res.status, await res.text());
          await sleep(pollInterval * 2);
          continue;
        }

        const messages: any[] = await res.json();

        for (const envelope of messages) {
          const dataMessage = envelope?.envelope?.dataMessage;
          if (!dataMessage) continue;

          const text = (dataMessage.message || "").trim();
          if (!text) continue;

          const sender = envelope.envelope.source as string;
          const groupId = dataMessage.groupInfo?.groupId as string | undefined;
          const chatId = groupId || sender;
          const timestamp = envelope.envelope.timestamp;

          broadcastChannelEvent({
            type: "message",
            source: "signal",
            data: {
              text,
              userId: sender,
              chatId,
              groupId: groupId || null,
              timestamp,
            },
            timestamp: new Date().toISOString(),
          });

          // Process asynchronously to keep polling
          onMessage(chatId, text, {
            userId: sender,
            chatId,
            groupId,
            timestamp,
          })
            .then(async (response) => {
              const chunks = splitMessage(response, maxLen);
              for (const chunk of chunks) {
                await sendMessage(chatId, chunk);
              }
            })
            .catch((err) => {
              log.error("Error processing Signal message from %s: %s", sender, err);
              sendMessage(chatId, "Something went wrong while processing your message.").catch(() => {});
            });
        }
      } catch (err) {
        if (!running) break;
        log.error("Signal poll error: %s", err);
      }

      // Wait before next poll
      if (running) {
        await sleep(pollInterval);
      }
    }
  }

  // Verify connectivity by checking the API health
  try {
    const healthRes = await fetch(`${apiBase}/v1/about`);
    if (!healthRes.ok) {
      throw new Error(`signal-cli-rest-api not reachable at ${apiBase} (status ${healthRes.status})`);
    }
    log.info("Signal channel connected via %s as %s", apiBase, config.phoneNumber);
    updateChannelStatus("signal", "connected");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Failed to connect Signal channel: %s", msg);
    updateChannelStatus("signal", "error", msg);
    return {
      shutdown: async () => {
        running = false;
      },
    };
  }

  // Start polling in background
  pollMessages().catch((err) => {
    log.error("Signal poll loop crashed: %s", err);
    updateChannelStatus("signal", "error", String(err));
  });

  // Register dispatcher for cross-channel messaging
  registerChannelDispatcher("signal", {
    sendMessage,
    sendImage,
  });

  return {
    shutdown: async () => {
      log.info("Shutting down Signal channel...");
      running = false;
      if (pollTimer) clearTimeout(pollTimer);
      updateChannelStatus("signal", "disconnected");
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

/**
 * Quick-start helper using environment variables.
 */
export async function startSignalFromEnv(
  onMessage: OnMessageFn,
): Promise<{ shutdown: () => Promise<void> } | null> {
  const apiUrl = process.env.SIGNAL_CLI_URL || "http://localhost:8080";
  const phoneNumber = process.env.SIGNAL_PHONE_NUMBER;

  if (!phoneNumber) {
    log.info("Signal: SIGNAL_PHONE_NUMBER not set -- skipping");
    return null;
  }

  return startSignalChannel({ apiUrl, phoneNumber }, onMessage);
}

export default { startSignalChannel, startSignalFromEnv };
