/**
 * Phone Channel Adapter
 *
 * Handles inbound and outbound voice calls and SMS via Telnyx webhooks.
 * Routes conversations through agent.chat() with voice context.
 * Supports outbound calls triggered from WhatsApp/Telegram via !call or /call.
 *
 * @requires TELNYX_API_KEY - For call control and SMS
 * @requires TELNYX_CONNECTION_ID - Connection for call routing
 * @requires TELNYX_WEBHOOK_HOST - Public URL for Telnyx to reach webhooks (e.g. ngrok URL)
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

const log = createLogger("channel:phone");

const TELNYX_API = "https://api.telnyx.com/v2";

let agentInstance: Agent | null = null;
let phonePort = 4006;

// Track active calls with direction and cross-channel origin
const activeCalls = new Map<string, {
  callControlId: string;
  from: string;
  to: string;
  status: string;
  startedAt: number;
  direction: "inbound" | "outbound";
  requestedBy?: string; // WhatsApp JID or Telegram userId that triggered the call
}>();

function getApiKey(): string {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error("TELNYX_API_KEY not set");
  return key;
}

async function telnyxAction(callControlId: string, action: string, body: Record<string, unknown> = {}): Promise<void> {
  const res = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/${action}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    log.error("Telnyx action %s failed: %s %s", action, res.status, text);
  }
}

/**
 * Answer an incoming call.
 */
async function answerCall(callControlId: string): Promise<void> {
  await telnyxAction(callControlId, "answer", {});
}

/**
 * Speak text to the caller using Telnyx built-in TTS, then gather speech.
 */
async function speakAndGather(callControlId: string, text: string): Promise<void> {
  // Truncate to Telnyx limit
  const truncated = text.length > 3000 ? text.slice(0, 2997) + "..." : text;

  await telnyxAction(callControlId, "gather_using_speak", {
    payload: truncated,
    language: "en-US",
    voice: "female",
    // Speech recognition settings
    minimum_digits: 0,
    maximum_digits: 0, // 0 = speech only, no DTMF
    timeout_millis: 10000,
    inter_digit_timeout_millis: 5000,
  });
}

/**
 * Speak text to the caller (no gather -- for final responses).
 */
async function speakToCall(callControlId: string, text: string): Promise<void> {
  const truncated = text.length > 3000 ? text.slice(0, 2997) + "..." : text;

  await telnyxAction(callControlId, "speak", {
    payload: truncated,
    language: "en-US",
    voice: "female",
  });
}

/**
 * Send an SMS via Telnyx.
 */
async function sendSms(to: string, from: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`${TELNYX_API}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, from, text, type: "SMS" }),
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error("SMS send failed: %s %s", res.status, errText);
      return false;
    }
    return true;
  } catch (err) {
    log.error({ err }, "SMS send error");
    return false;
  }
}

/**
 * Get the webhook URL for Telnyx to send call events back to this adapter.
 */
export function getWebhookUrl(): string | undefined {
  const host = process.env.TELNYX_WEBHOOK_HOST;
  if (!host) return undefined;
  const base = host.endsWith("/") ? host.slice(0, -1) : host;
  return `${base}/webhook/voice`;
}

/**
 * Get the port the phone channel is listening on.
 */
export function getPhonePort(): number {
  return phonePort;
}

/**
 * Place an outbound call via Telnyx.
 * Used by !call (WhatsApp) and /call (Telegram) commands.
 */
export async function makeOutboundCall(
  to: string,
  from?: string,
  requestedBy?: string
): Promise<{ success: boolean; callControlId?: string; error?: string }> {
  try {
    const apiKey = getApiKey();
    const connectionId = process.env.TELNYX_CONNECTION_ID;
    if (!connectionId) {
      return { success: false, error: "TELNYX_CONNECTION_ID not set" };
    }

    const fromNumber = from || process.env.TELNYX_FROM_NUMBER;
    if (!fromNumber) {
      return { success: false, error: "No from number. Set TELNYX_FROM_NUMBER in .env" };
    }

    const body: Record<string, unknown> = {
      connection_id: connectionId,
      to,
      from: fromNumber,
    };

    // Wire webhook URL so Telnyx sends call events back to this adapter
    const webhookUrl = getWebhookUrl();
    if (webhookUrl) {
      body.webhook_url = webhookUrl;
    } else {
      log.warn("TELNYX_WEBHOOK_HOST not set -- outbound call events may not route back");
    }

    const res = await fetch(`${TELNYX_API}/calls`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error("Outbound call failed: %s %s", res.status, errText);
      return { success: false, error: `Telnyx ${res.status}: ${errText}` };
    }

    const data = await res.json() as { data?: { call_control_id?: string } };
    const callControlId = data.data?.call_control_id;

    if (callControlId) {
      // Pre-register in activeCalls so call.initiated knows this is outbound
      activeCalls.set(callControlId, {
        callControlId,
        from: fromNumber,
        to,
        status: "initiating",
        startedAt: Date.now(),
        direction: "outbound",
        requestedBy,
      });
      log.info("Outbound call placed to %s (callControlId: %s, requestedBy: %s)", to, callControlId, requestedBy || "agent");
    }

    return { success: true, callControlId };
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ err }, "makeOutboundCall error");
    return { success: false, error: msg };
  }
}

/**
 * Start the phone channel adapter.
 *
 * Creates an Express server for Telnyx voice and SMS webhooks.
 */
export function startPhoneChannel(
  agent: Agent,
  runtimeDir: string,
  port = 4006
): void {
  agentInstance = agent;
  phonePort = port;

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      channel: "phone",
      activeCalls: activeCalls.size,
      webhookUrl: getWebhookUrl() || "not configured",
    });
  });

  // Telnyx voice event webhook
  app.post("/webhook/voice", async (req, res) => {
    // Acknowledge immediately -- Telnyx requires fast response
    res.json({ ok: true });

    try {
      const event = req.body?.data;
      if (!event) return;

      const eventType = event.event_type;
      const payload = event.payload || {};
      const callControlId = payload.call_control_id;
      const from = payload.from || "";
      const to = payload.to || "";

      switch (eventType) {
        case "call.initiated": {
          const existing = activeCalls.get(callControlId);
          if (existing && existing.direction === "outbound") {
            // Outbound call we placed -- already tracked, just update status
            log.info("Outbound call ringing: %s -> %s", existing.from, existing.to);
            existing.status = "ringing";
          } else {
            // Inbound call
            log.info("Inbound call from %s to %s", from, to);
            activeCalls.set(callControlId, {
              callControlId,
              from,
              to,
              status: "ringing",
              startedAt: Date.now(),
              direction: "inbound",
            });
            // Answer inbound calls automatically
            await answerCall(callControlId);
          }
          break;
        }

        case "call.answered": {
          log.info("Call answered: %s", callControlId);
          const call = activeCalls.get(callControlId);
          if (call) {
            call.status = "active";

            if (call.direction === "outbound") {
              // Outbound: different greeting
              await speakAndGather(
                callControlId,
                "Hi, this is Wispy AI calling on behalf of my owner. How can I help you?"
              );

              // Notify the requesting channel that the call connected
              if (call.requestedBy) {
                broadcastChannelEvent({
                  type: "notification",
                  source: "phone",
                  data: {
                    message: `Call connected with ${call.to}`,
                    to: call.to,
                    direction: "outbound",
                    requestedBy: call.requestedBy,
                  },
                  timestamp: new Date().toISOString(),
                });
              }
            } else {
              // Inbound: standard greeting
              await speakAndGather(
                callControlId,
                "Hello! I'm your Wispy AI assistant. How can I help you today?"
              );
            }
          }
          break;
        }

        case "call.gather.ended": {
          // Telnyx transcribed the caller's speech
          const transcript = payload.speech?.result || payload.digits || "";

          if (transcript && agentInstance) {
            log.info("Caller said: %s", transcript);

            const call = activeCalls.get(callControlId);
            const callerId = call?.direction === "outbound" ? call.to : from;

            // Inject conversational voice prompt for natural phone responses
            const { getVoicePromptAddendum } = await import("../../ai/prompts.js");
            const voiceContext = `${getVoicePromptAddendum()}\n\n[Phone call - keep responses concise and conversational]\n\n${transcript}`;

            // Process with agent
            const response = await agentInstance.chat(
              voiceContext,
              callerId,
              "phone",
              "main"
            );

            if (response.text) {
              // Speak the response and gather more
              await speakAndGather(callControlId, response.text);
            } else {
              // No response, keep listening
              await speakAndGather(
                callControlId,
                "I'm still here. What else can I help you with?"
              );
            }
          } else {
            // No speech detected, try again
            await speakAndGather(
              callControlId,
              "I didn't catch that. Could you repeat?"
            );
          }
          break;
        }

        case "call.speak.ended": {
          // TTS finished -- if this was a standalone speak (not gather), start gathering
          // Only gather if we didn't use gather_using_speak
          break;
        }

        case "call.hangup": {
          log.info("Call ended: %s (from %s)", callControlId, from);
          const call = activeCalls.get(callControlId);
          if (call) {
            const duration = Math.round((Date.now() - call.startedAt) / 1000);
            log.info("Call duration: %ds (direction: %s)", duration, call.direction);

            const dirLabel = call.direction === "outbound" ? "Outbound call" : "Inbound call";
            const peer = call.direction === "outbound" ? call.to : from;

            broadcastChannelEvent({
              type: "notification",
              source: "phone",
              data: {
                message: `${dirLabel} ended with ${peer} (${duration}s)`,
                from: call.from,
                to: call.to,
                duration,
                direction: call.direction,
                requestedBy: call.requestedBy,
              },
              timestamp: new Date().toISOString(),
            });
          }
          activeCalls.delete(callControlId);
          break;
        }

        default:
          log.debug("Unhandled voice event: %s", eventType);
      }
    } catch (err) {
      log.error({ err }, "Voice webhook error");
    }
  });

  // Telnyx SMS webhook
  app.post("/webhook/sms", async (req, res) => {
    res.json({ ok: true });

    try {
      const event = req.body?.data;
      if (!event) return;

      if (event.event_type === "message.received") {
        const payload = event.payload || {};
        const from = payload.from?.phone_number || "";
        const to = payload.to?.[0]?.phone_number || "";
        const text = payload.text || "";

        if (from && text && agentInstance) {
          log.info("Inbound SMS from %s: %s", from, text.slice(0, 100));

          const response = await agentInstance.chat(
            text,
            from,
            "phone-sms",
            "main"
          );

          if (response.text && to) {
            const sent = await sendSms(from, to, response.text);
            if (sent) {
              broadcastChannelEvent({
                type: "notification",
                source: "phone",
                data: { message: `SMS reply sent to ${from}` },
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }
    } catch (err) {
      log.error({ err }, "SMS webhook error");
    }
  });

  app.listen(port, () => {
    log.info("Phone channel listening on port %d", port);
    log.info("Voice webhook: http://localhost:%d/webhook/voice", port);
    log.info("SMS webhook: http://localhost:%d/webhook/sms", port);
    const wh = getWebhookUrl();
    if (wh) {
      log.info("Telnyx webhook URL: %s", wh);
    } else {
      log.warn("TELNYX_WEBHOOK_HOST not set -- outbound calls won't receive events");
    }

    registerChannel({
      name: "phone",
      type: "phone",
      capabilities: {
        text: true,
        media: false,
        voice: true,
        buttons: false,
        reactions: false,
        groups: false,
        threads: false,
      },
      status: "connected",
      connectedAt: new Date().toISOString(),
    });

    registerChannelDispatcher("phone", {
      sendMessage: async (phoneNumber: string, text: string) => {
        // Send as SMS -- need a 'from' number
        const fromNumber = process.env.TELNYX_FROM_NUMBER || "";
        if (fromNumber) {
          return sendSms(phoneNumber, fromNumber, text);
        }
        log.warn("Cannot send SMS: TELNYX_FROM_NUMBER not set");
        return false;
      },
      sendImage: async (_chatId: string, _imagePath: string, _caption?: string) => {
        return false; // Phone channel doesn't support image sending
      },
    });
  });
}
