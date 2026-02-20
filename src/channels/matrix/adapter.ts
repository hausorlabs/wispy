/**
 * Matrix Channel Adapter for Wispy
 *
 * Integrates with any Matrix homeserver via the client-server API using
 * native fetch (no SDK dependency). Long-polls the /sync endpoint for
 * incoming messages and sends replies via the room send endpoint.
 *
 * Environment variables:
 *   MATRIX_HOMESERVER    - Homeserver base URL (e.g. https://matrix.org)
 *   MATRIX_ACCESS_TOKEN  - Access token for the bot account
 *   MATRIX_USER_ID       - Full Matrix user ID (e.g. @wispy:matrix.org)
 */

import {
  registerChannel,
  updateChannelStatus,
  registerChannelDispatcher,
  broadcastChannelEvent,
} from "../dock.js";
import { createLogger } from "../../infra/logger.js";

const log = createLogger("channel:matrix");

export interface MatrixChannelConfig {
  homeserver: string;
  accessToken: string;
  userId: string;
  allowedRooms?: string[];
  syncTimeoutMs?: number;
  maxMessageLength?: number;
}

type OnMessageFn = (
  chatId: string,
  text: string,
  meta?: Record<string, unknown>,
) => Promise<string>;

/**
 * Generate a unique transaction ID for idempotent Matrix sends.
 */
function txnId(): string {
  return `wispy_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function startMatrixChannel(
  config: MatrixChannelConfig,
  onMessage: OnMessageFn,
): Promise<{ shutdown: () => Promise<void> }> {
  const syncTimeout = config.syncTimeoutMs ?? 30_000;
  const maxLen = config.maxMessageLength ?? 16_000;

  const capabilities = {
    text: true,
    media: true,
    voice: false,
    buttons: false,
    reactions: true,
    groups: true,
    threads: true,
  };

  registerChannel({
    name: "matrix",
    type: "chat",
    capabilities,
    status: "connecting",
  });

  const baseUrl = config.homeserver.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
  };

  let running = true;
  let nextBatch: string | undefined;

  /**
   * Send a text message to a Matrix room.
   */
  async function sendMessage(roomId: string, text: string): Promise<boolean> {
    const url = `${baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId()}`;
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          msgtype: "m.text",
          body: text,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        log.error("Matrix send failed (%d): %s", res.status, err);
        return false;
      }
      return true;
    } catch (err) {
      log.error("Matrix send error: %s", err);
      return false;
    }
  }

  /**
   * Send an image to a Matrix room (requires pre-uploaded mxc:// URI).
   */
  async function sendImage(roomId: string, mxcUrl: string, caption?: string): Promise<boolean> {
    const url = `${baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId()}`;
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          msgtype: "m.image",
          body: caption || "image",
          url: mxcUrl,
        }),
      });
      return res.ok;
    } catch (err) {
      log.error("Matrix image send error: %s", err);
      return false;
    }
  }

  /**
   * Process timeline events from a /sync response.
   */
  function processEvents(syncData: any): void {
    const rooms = syncData.rooms?.join;
    if (!rooms) return;

    for (const [roomId, roomData] of Object.entries(rooms) as [string, any][]) {
      // Filter rooms if configured
      if (config.allowedRooms?.length && !config.allowedRooms.includes(roomId)) continue;

      const events = roomData.timeline?.events;
      if (!events || !Array.isArray(events)) continue;

      for (const event of events) {
        // Only process text messages, ignore our own
        if (event.type !== "m.room.message") continue;
        if (event.sender === config.userId) continue;

        const content = event.content;
        if (!content || content.msgtype !== "m.text") continue;

        const text = (content.body || "").trim();
        if (!text) continue;

        broadcastChannelEvent({
          type: "message",
          source: "matrix",
          data: {
            text,
            userId: event.sender,
            roomId,
            eventId: event.event_id,
          },
          timestamp: new Date().toISOString(),
        });

        // Process asynchronously to not block the sync loop
        onMessage(roomId, text, {
          userId: event.sender,
          roomId,
          eventId: event.event_id,
          originServerTs: event.origin_server_ts,
        })
          .then(async (response) => {
            // Split long responses
            if (response.length <= maxLen) {
              await sendMessage(roomId, response);
            } else {
              const chunks = splitMessage(response, maxLen);
              for (const chunk of chunks) {
                await sendMessage(roomId, chunk);
              }
            }
          })
          .catch((err) => {
            log.error("Error processing Matrix message from %s: %s", event.sender, err);
            sendMessage(roomId, "Something went wrong while processing your message.").catch(() => {});
          });
      }
    }
  }

  /**
   * Main sync loop -- long-polls the homeserver for new events.
   */
  async function syncLoop(): Promise<void> {
    // Perform an initial sync to get the next_batch token (skip historical messages)
    try {
      const initUrl = `${baseUrl}/_matrix/client/v3/sync?timeout=0&filter={"room":{"timeline":{"limit":0}}}`;
      const initRes = await fetch(initUrl, { headers });
      if (initRes.ok) {
        const initData = await initRes.json();
        nextBatch = initData.next_batch;
        log.info("Matrix initial sync complete, batch token acquired");
      } else {
        log.error("Matrix initial sync failed (%d)", initRes.status);
      }
    } catch (err) {
      log.error("Matrix initial sync error: %s", err);
    }

    while (running) {
      try {
        let syncUrl = `${baseUrl}/_matrix/client/v3/sync?timeout=${syncTimeout}`;
        if (nextBatch) {
          syncUrl += `&since=${encodeURIComponent(nextBatch)}`;
        }

        const res = await fetch(syncUrl, { headers });

        if (!res.ok) {
          log.error("Matrix sync error (%d): %s", res.status, await res.text());
          // Back off on error
          await sleep(5_000);
          continue;
        }

        const data = await res.json();
        nextBatch = data.next_batch;
        processEvents(data);
      } catch (err) {
        if (!running) break;
        log.error("Matrix sync loop error: %s", err);
        await sleep(5_000);
      }
    }
  }

  // Start sync in background
  try {
    updateChannelStatus("matrix", "connected");
    log.info("Matrix channel connected to %s as %s", baseUrl, config.userId);

    // Fire-and-forget the sync loop
    syncLoop().catch((err) => {
      log.error("Matrix sync loop crashed: %s", err);
      updateChannelStatus("matrix", "error", String(err));
    });

    // Register dispatcher for cross-channel messaging
    registerChannelDispatcher("matrix", {
      sendMessage,
      sendImage,
    });

    return {
      shutdown: async () => {
        log.info("Shutting down Matrix channel...");
        running = false;
        updateChannelStatus("matrix", "disconnected");
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Failed to start Matrix channel: %s", msg);
    updateChannelStatus("matrix", "error", msg);
    return {
      shutdown: async () => {
        running = false;
      },
    };
  }
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
export async function startMatrixFromEnv(
  onMessage: OnMessageFn,
): Promise<{ shutdown: () => Promise<void> } | null> {
  const homeserver = process.env.MATRIX_HOMESERVER;
  const accessToken = process.env.MATRIX_ACCESS_TOKEN;
  const userId = process.env.MATRIX_USER_ID;

  if (!homeserver || !accessToken || !userId) {
    log.info("Matrix: missing MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN, or MATRIX_USER_ID -- skipping");
    return null;
  }

  return startMatrixChannel({ homeserver, accessToken, userId }, onMessage);
}

export default { startMatrixChannel, startMatrixFromEnv };
