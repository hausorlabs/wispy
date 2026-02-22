/**
 * WhatsApp Adapter
 * Full integration using Baileys with Marathon Mode support
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  WASocket,
  BaileysEventMap,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import qrcode from "qrcode-terminal";
import {
  registerChannel,
  updateChannelStatus,
  registerChannelDispatcher,
  broadcastChannelEvent,
} from "../dock.js";
import { isPaired, pairUser } from "../../security/auth.js";
import type { Agent } from "../../core/agent.js";
import { createLogger } from "../../infra/logger.js";
import { MarathonService, formatDuration } from "../../marathon/service.js";
import { getPlanProgress } from "../../marathon/planner.js";
import type { MarathonState } from "../../marathon/types.js";

const log = createLogger("whatsapp");

// Global instances
let sockInstance: WASocket | null = null;
let marathonService: MarathonService | null = null;
let agentInstance: Agent | null = null;
let apiKeyInstance: string | null = null;
let runtimeDirInstance: string = "";

// Per-user voice reply preference (default: OFF, toggle with !voice)
const voiceReplyEnabled = new Map<string, boolean>();

/**
 * Send a message to a specific JID (for notifications)
 */
export async function sendWhatsAppMessage(jid: string, message: string): Promise<boolean> {
  if (!sockInstance) {
    log.warn("WhatsApp not connected, cannot send notification");
    return false;
  }
  try {
    await sockInstance.sendMessage(jid, { text: message });
    return true;
  } catch (err) {
    log.error({ err }, "Failed to send WhatsApp message");
    return false;
  }
}

/**
 * Send a voice note to a specific JID.
 * Accepts an audio Buffer. Sends as push-to-talk voice note.
 */
export async function sendWhatsAppVoice(
  jid: string,
  audioBuffer: Buffer,
  mimetype: string = "audio/ogg; codecs=opus"
): Promise<boolean> {
  if (!sockInstance) {
    log.warn("WhatsApp not connected, cannot send voice");
    return false;
  }
  try {
    await sockInstance.sendMessage(jid, {
      audio: audioBuffer,
      mimetype,
      ptt: true,
    });
    return true;
  } catch (err) {
    log.error({ err }, "Failed to send WhatsApp voice note");
    return false;
  }
}

/**
 * Format marathon status for WhatsApp
 */
function formatStatusForWhatsApp(state: MarathonState): string {
  const progress = getPlanProgress(state.plan);

  const statusEmoji: Record<string, string> = {
    planning: "📋",
    executing: "⚡",
    verifying: "🔍",
    paused: "⏸️",
    completed: "✅",
    failed: "❌",
    waiting_human: "👤",
  };

  let msg = `${statusEmoji[state.status] || "❓"} *Marathon Status*\n\n`;
  msg += `*Goal:* ${state.plan.goal}\n`;
  msg += `*Status:* ${state.status.toUpperCase()}\n`;
  msg += `*Progress:* ${progress.completed}/${progress.total} (${progress.percentage}%)\n`;
  msg += `*ETA:* ${formatDuration(progress.estimatedRemainingMinutes)}\n\n`;

  msg += `*Milestones:*\n`;
  for (const m of state.plan.milestones) {
    const icons: Record<string, string> = {
      pending: "⏳",
      in_progress: "🔄",
      completed: "✅",
      failed: "❌",
      skipped: "⏭️",
    };
    msg += `${icons[m.status] || "❓"} ${m.title}\n`;
  }

  if (state.logs.length > 0) {
    msg += `\n*Latest:* ${state.logs[state.logs.length - 1].message}`;
  }

  return msg;
}

/**
 * Format marathon list for WhatsApp
 */
function formatMarathonList(marathons: MarathonState[]): string {
  if (marathons.length === 0) {
    return "📭 No marathons found. Start one with:\n!marathon Build a React todo app";
  }

  let msg = "🏃 *Your Marathons*\n\n";

  for (const m of marathons.slice(0, 5)) {
    const statusEmoji: Record<string, string> = {
      planning: "📋",
      executing: "⚡",
      paused: "⏸️",
      completed: "✅",
      failed: "❌",
    };
    const progress = getPlanProgress(m.plan);
    msg += `${statusEmoji[m.status] || "❓"} *${m.plan.goal.slice(0, 40)}*${m.plan.goal.length > 40 ? "..." : ""}\n`;
    msg += `   ID: ${m.id} | ${progress.percentage}%\n\n`;
  }

  return msg;
}

/**
 * Process incoming message commands
 */
async function processCommand(
  sock: WASocket,
  jid: string,
  text: string,
  runtimeDir: string,
  options?: { isVoice?: boolean }
): Promise<void> {
  const senderId = jid.replace(/@s\.whatsapp\.net$/, "");

  // Check if user is paired
  if (!isPaired(runtimeDir, "whatsapp", senderId)) {
    // Auto-pair on first message
    pairUser(runtimeDir, "whatsapp", senderId);
    await sock.sendMessage(jid, {
      text: `☁️ *Welcome to Wispy!*\n\nYour autonomous AI companion.\n\n*Chat Commands:*\nJust send any message to chat!\n!voice - Toggle voice replies\n!call +number - Make a phone call\n\n*Marathon Commands:*\n!marathon <goal> - Start autonomous task\n!status - Check marathon progress\n!pause - Pause current marathon\n!resume - Resume paused marathon\n!abort - Stop current marathon\n!list - View all marathons\n\n*Example:*\n!marathon Build a React calculator app`,
    });
    return;
  }

  // Command handling
  const lowerText = text.toLowerCase().trim();

  // !marathon <goal> - Start a new marathon
  if (lowerText.startsWith("!marathon ")) {
    const goal = text.replace(/^!marathon\s*/i, "").trim();

    if (!goal) {
      await sock.sendMessage(jid, {
        text: "🎯 Please provide a goal!\n\n*Usage:* !marathon <your goal>\n\n*Examples:*\n• !marathon Build a React todo app\n• !marathon Create a REST API with Node.js",
      });
      return;
    }

    if (!agentInstance || !apiKeyInstance) {
      await sock.sendMessage(jid, { text: "❌ Agent not properly initialized. Please restart Wispy." });
      return;
    }

    await sock.sendMessage(jid, {
      text: `🏃 *Starting Marathon*\n\n*Goal:* ${goal}\n\nPlanning with ultra thinking... This may take a moment.`,
    });

    try {
      marathonService!.start(goal, agentInstance, apiKeyInstance, {
        notifications: {
          enabled: true,
          channels: { whatsapp: { jid } },
          notifyOn: {
            milestoneComplete: true,
            milestoneFailure: true,
            humanInputNeeded: true,
            marathonComplete: true,
            dailySummary: false,
          },
        },
      }).then(async (finalState) => {
        const result = marathonService!.getResult(finalState.id);
        if (result?.success) {
          await sendWhatsAppMessage(
            jid,
            `🎉 *Marathon Completed!*\n\n*Goal:* ${finalState.plan.goal}\n*Milestones:* ${result.completedMilestones}/${result.totalMilestones}\n*Time:* ${formatDuration(result.totalTime)}${result.artifacts.length > 0 ? `\n\n*Artifacts:*\n${result.artifacts.map(a => `• ${a}`).join("\n")}` : ""}`
          );
        } else {
          await sendWhatsAppMessage(
            jid,
            `❌ *Marathon Failed*\n\n*Goal:* ${finalState.plan.goal}\n*Completed:* ${result?.completedMilestones || 0}/${result?.totalMilestones || 0}\n\nUse !status for details.`
          );
        }
      }).catch(async (err) => {
        log.error({ err }, "Marathon execution error");
        await sendWhatsAppMessage(jid, `❌ Marathon error: ${err.message}`);
      });

      await sock.sendMessage(jid, {
        text: `✅ Marathon started!\n\nI'll notify you on progress. Use !status to check anytime.`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ err }, "Failed to start marathon");
      await sock.sendMessage(jid, { text: `❌ Failed to start marathon: ${errMsg}` });
    }
    return;
  }

  // !status - Get current marathon status
  if (lowerText === "!status") {
    const state = marathonService!.getStatus();
    if (!state) {
      await sock.sendMessage(jid, { text: "📭 No active marathon.\n\nStart one with:\n!marathon <your goal>" });
      return;
    }
    await sock.sendMessage(jid, { text: formatStatusForWhatsApp(state) });
    return;
  }

  // !pause - Pause active marathon
  if (lowerText === "!pause") {
    marathonService!.pause();
    await sock.sendMessage(jid, { text: "⏸️ Marathon paused.\n\nUse !resume to continue." });
    return;
  }

  // !resume - Resume paused marathon
  if (lowerText === "!resume") {
    const state = marathonService!.getStatus();
    if (!state) {
      await sock.sendMessage(jid, { text: "📭 No marathon to resume." });
      return;
    }
    if (state.status !== "paused") {
      await sock.sendMessage(jid, { text: `Marathon is ${state.status}, not paused.` });
      return;
    }
    if (!agentInstance || !apiKeyInstance) {
      await sock.sendMessage(jid, { text: "❌ Agent not properly initialized." });
      return;
    }

    await sock.sendMessage(jid, { text: "▶️ Resuming marathon..." });

    try {
      marathonService!.resume(state.id, agentInstance, apiKeyInstance)
        .then(async (finalState) => {
          const result = marathonService!.getResult(finalState.id);
          await sendWhatsAppMessage(
            jid,
            result?.success
              ? `🎉 *Marathon Completed!*\n\n${finalState.plan.goal}`
              : `❌ *Marathon ended*\n\nStatus: ${finalState.status}`
          );
        })
        .catch(async (err) => {
          await sendWhatsAppMessage(jid, `❌ Error: ${err.message}`);
        });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await sock.sendMessage(jid, { text: `❌ Failed to resume: ${errMsg}` });
    }
    return;
  }

  // !abort - Stop current marathon
  if (lowerText === "!abort") {
    marathonService!.abort();
    await sock.sendMessage(jid, { text: "🛑 Marathon aborted." });
    return;
  }

  // !list - List all marathons
  if (lowerText === "!list") {
    const marathons = marathonService!.listMarathons();
    await sock.sendMessage(jid, { text: formatMarathonList(marathons) });
    return;
  }

  // !help - Show help
  if (lowerText === "!help") {
    await sock.sendMessage(jid, {
      text: `☁️ *Wispy Help*\n\n*Chat:* Just send any message!\n!voice - Toggle voice replies\n!call +number - Make a phone call\n\n*Marathon Commands:*\n!marathon <goal> - Start autonomous task\n!status - Check marathon progress\n!pause - Pause current marathon\n!resume - Resume paused marathon\n!abort - Stop current marathon\n!list - View all marathons\n!help - Show this help\n\n*Example:*\n!marathon Build a blog with Next.js`,
    });
    return;
  }

  // !voice - Toggle voice replies
  if (lowerText === "!voice") {
    const currentSetting = voiceReplyEnabled.get(senderId) ?? false;
    const newSetting = !currentSetting;
    voiceReplyEnabled.set(senderId, newSetting);

    if (newSetting) {
      await sock.sendMessage(jid, {
        text: "🎤 *Voice Replies: ON*\n\nI'll respond with voice messages when you send voice notes!\n\nSend !voice again to turn off.",
      });
    } else {
      await sock.sendMessage(jid, {
        text: "📝 *Voice Replies: OFF*\n\nI'll respond with text only.\n\nSend !voice to turn voice replies back on.",
      });
    }
    return;
  }

  // !call <number> - Place an outbound phone call
  if (lowerText.startsWith("!call ")) {
    const phoneNumber = text.replace(/^!call\s*/i, "").trim();
    if (!phoneNumber.match(/^\+\d{7,15}$/)) {
      await sock.sendMessage(jid, { text: "Please use E.164 format: !call +1234567890" });
      return;
    }
    if (!process.env.TELNYX_API_KEY) {
      await sock.sendMessage(jid, { text: "Phone calls require TELNYX_API_KEY. Set it in your .env file." });
      return;
    }
    await sock.sendMessage(jid, { text: `Calling ${phoneNumber}...` });
    const { makeOutboundCall } = await import("../phone/adapter.js");
    const result = await makeOutboundCall(phoneNumber, undefined, jid);
    if (!result.success) {
      await sock.sendMessage(jid, { text: `Call failed: ${result.error}` });
    }
    return;
  }

  // Regular chat message
  if (!text.startsWith("!")) {
    const isVoiceInput = options?.isVoice === true;
    try {
      // Send typing indicator
      await sock.presenceSubscribe(jid);
      await sock.sendPresenceUpdate("composing", jid);

      // Inject conversational voice prompt if response will be voice
      const userVoiceEnabled = voiceReplyEnabled.get(senderId) ?? false;
      const shouldReplyVoice = userVoiceEnabled && isVoiceInput;

      let messageToSend = text;
      if (shouldReplyVoice) {
        const { getVoicePromptAddendum } = await import("../../ai/prompts.js");
        messageToSend = `${getVoicePromptAddendum()}\n\n${text}`;
      }

      const result = await agentInstance!.chat(messageToSend, senderId, "whatsapp", "main");

      await sock.sendPresenceUpdate("paused", jid);

      const responseText = result.text || "...";

      // Voice reply path
      if (shouldReplyVoice && responseText.length < 500) {
        try {
          const { generateElevenLabsBuffer } = await import("../../cli/voice/tts.js");

          // Try ElevenLabs buffer directly (no file I/O for WhatsApp)
          const voiceBuffer = await generateElevenLabsBuffer(responseText);

          if (voiceBuffer) {
            await sendWhatsAppVoice(jid, voiceBuffer, "audio/mpeg");
            await sock.sendMessage(jid, { text: responseText });
            return;
          }

          // Fallback: Gemini TTS (returns file path)
          const { generateVoiceWithGemini } = await import("../../cli/voice/tts.js");
          const { join } = await import("path");
          const voiceDir = join(runtimeDirInstance || runtimeDir, "voice-output");
          const audioPath = await generateVoiceWithGemini(responseText, voiceDir);

          if (audioPath) {
            const { readFileSync, unlinkSync } = await import("fs");
            const audioFileBuffer = readFileSync(audioPath);
            await sendWhatsAppVoice(jid, audioFileBuffer, "audio/ogg; codecs=opus");
            await sock.sendMessage(jid, { text: responseText });
            try { unlinkSync(audioPath); } catch {}
            return;
          }
        } catch (voiceErr) {
          log.debug("Voice reply failed, falling back to text: %s", voiceErr);
        }
      }

      // Text reply (default path)
      await sock.sendMessage(jid, { text: responseText });
    } catch (err) {
      log.error({ err }, "WhatsApp chat error");
      await sock.sendMessage(jid, { text: "Sorry, something went wrong. Please try again." });
    }
  }
}

export async function startWhatsApp(agent: Agent, runtimeDir: string, apiKey?: string): Promise<WASocket> {
  const authDir = resolve(runtimeDir, "whatsapp-auth");

  // Ensure auth directory exists
  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true });
  }

  // Store global instances
  agentInstance = agent;
  apiKeyInstance = apiKey || process.env.GEMINI_API_KEY || "";
  runtimeDirInstance = runtimeDir;
  marathonService = new MarathonService(runtimeDir);

  // Use multi-file auth state
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  async function connectToWhatsApp() {
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, log as any),
      },
      printQRInTerminal: false,
      logger: log as any,
      browser: ["Wispy", "Chrome", "1.0.0"],
    });

    sockInstance = sock;

    // Handle connection updates
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("\n📱 Scan this QR code with WhatsApp:\n");
        qrcode.generate(qr, { small: true });
        console.log("\nWaiting for scan...\n");
        updateChannelStatus("whatsapp", "connecting", "Waiting for QR scan");
      }

      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        log.warn({ reason }, "WhatsApp connection closed");
        updateChannelStatus("whatsapp", "disconnected", String(reason));

        if (shouldReconnect) {
          log.info("Reconnecting to WhatsApp...");
          setTimeout(() => connectToWhatsApp(), 5000);
        } else {
          log.warn("Logged out from WhatsApp. Please scan QR code again.");
        }
      } else if (connection === "open") {
        log.info("Connected to WhatsApp!");
        updateChannelStatus("whatsapp", "connected");

        registerChannel({
          name: "whatsapp",
          type: "whatsapp",
          capabilities: {
            text: true,
            media: true,
            voice: true,
            buttons: true,
            reactions: true,
            groups: true,
            threads: false,
          },
          status: "connected",
          connectedAt: new Date().toISOString(),
        });

        // Register cross-channel dispatcher
        registerChannelDispatcher("whatsapp", {
          sendMessage: sendWhatsAppMessage,
          sendImage: async () => false,
        });

        console.log("\n✅ WhatsApp connected successfully!\n");
      }
    });

    // Save credentials on update
    sock.ev.on("creds.update", saveCreds);

    // Handle incoming messages
    sock.ev.on("messages.upsert", async (m) => {
      const msg = m.messages[0];

      // Skip if not a new message or from ourselves
      if (!msg.message || msg.key.fromMe) return;

      const jid = msg.key.remoteJid;
      if (!jid) return;

      // ── Voice message handling ──────────────────────────
      if (msg.message.audioMessage) {
        try {
          log.info({ from: jid }, "Received WhatsApp voice message");

          // Download audio buffer from WhatsApp servers
          const audioBuffer = await downloadMediaMessage(
            msg,
            "buffer",
            {}
          ) as Buffer;

          // Convert to base64 for Gemini transcription
          const audioBase64 = audioBuffer.toString("base64");

          // Transcribe with Gemini (same pattern as Telegram adapter)
          const { getClient } = await import("../../ai/gemini.js");
          const ai = getClient();

          const transcribeResult = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/ogg",
                    data: audioBase64,
                  },
                },
                { text: "Transcribe this voice message exactly. Return only the transcription, nothing else." },
              ],
            }],
          });

          const transcription = transcribeResult.text?.trim() || "";

          if (!transcription) {
            await sock.sendMessage(jid, { text: "Sorry, I couldn't understand the voice message. Please try again." });
            return;
          }

          log.info({ from: jid, transcription: transcription.slice(0, 50) }, "Transcribed voice message");

          // Broadcast voice event to other channels
          broadcastChannelEvent({
            type: "message",
            source: "whatsapp",
            data: { text: transcription, userId: jid.replace(/@s\.whatsapp\.net$/, ""), isVoice: true },
            timestamp: new Date().toISOString(),
          });

          // Route through processCommand with voice flag
          await processCommand(sock, jid, transcription, runtimeDir, { isVoice: true });
        } catch (err) {
          log.error({ err }, "WhatsApp voice message error");
          await sock.sendMessage(jid, { text: "Sorry, I couldn't process your voice message. Please try again or send text." });
        }
        return;
      }

      // ── Text message handling ──────────────────────────
      const messageText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      if (!messageText) return;

      log.info({ from: jid, text: messageText.slice(0, 50) }, "Received WhatsApp message");

      // Process the message
      await processCommand(sock, jid, messageText, runtimeDir);
    });

    return sock;
  }

  // Start connection
  log.info("Starting WhatsApp connection...");
  return await connectToWhatsApp();
}

/**
 * Get the socket instance for external use
 */
export function getWhatsAppSocket(): WASocket | null {
  return sockInstance;
}
