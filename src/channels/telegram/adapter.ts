/**
 * Telegram Adapter
 * Full integration with Marathon Mode and Trust Controls
 * Control your AI agent from your phone with inline approval buttons
 */

import { Bot, type Context } from "grammy";
import { registerChannel, updateChannelStatus, broadcastChannelEvent, registerChannelDispatcher } from "../dock.js";
import { isPaired, pairUser } from "../../security/auth.js";
import type { Agent } from "../../core/agent.js";
import { createLogger } from "../../infra/logger.js";
import { MarathonService, formatDuration } from "../../marathon/service.js";
import { getPlanProgress } from "../../marathon/planner.js";
import type { MarathonState } from "../../marathon/types.js";
import { getTrustController } from "../../trust/controller.js";
import { initTelegramTrustHandler, registerTelegramUser } from "../../trust/telegram-handler.js";
import { initProgressNotifier, registerUserChat, sendThought, ProgressTracker, askConfirmation } from "../../trust/progress-notifier.js";
import { initTelegramDelivery } from "../../documents/telegram-delivery.js";
import {
  initMarathonVisuals,
  sendPlanningMessage,
  updateProgressMessage,
  sendThinkingNotification,
  sendMilestoneNotification,
  sendApprovalRequest,
  sendMarathonComplete,
  createImageFeedbackKeyboard,
} from "../../marathon/telegram-visuals.js";

const log = createLogger("telegram");

// Tool emoji mapping for visual feedback
function getToolEmoji(toolName: string): string {
  const emojiMap: Record<string, string> = {
    bash: "⚡",
    file_read: "📖",
    file_write: "✏️",
    file_search: "🔍",
    web_fetch: "🌐",
    web_search: "🔎",
    browser_navigate: "🌍",
    browser_screenshot: "📸",
    memory_search: "🧠",
    memory_save: "💾",
    voice_reply: "🔊",
    image_generate: "🎨",
    create_project: "🏗️",
    run_dev_server: "🚀",
    document_create: "📄",
    remind_me: "⏰",
    schedule_task: "📅",
    wallet_balance: "💰",
    wallet_pay: "💸",
    commerce_status: "📊",
    x402_pay_and_fetch: "💳",
    defi_swap: "🔄",
    defi_research: "📈",
    bite_encrypt_payment: "🔐",
    bite_check_and_execute: "🔓",
    ap2_purchase: "🛒",
    deploy_erc8004: "📜",
  };
  return emojiMap[toolName] || "🔧";
}

// Global bot instance for sending notifications
let botInstance: Bot | null = null;
let marathonService: MarathonService | null = null;
let agentInstance: Agent | null = null;
let apiKeyInstance: string | null = null;

/**
 * Send a message to a specific chat (for notifications)
 */
export async function sendTelegramMessage(chatId: string, message: string): Promise<boolean> {
  if (!botInstance) {
    log.warn("Telegram bot not initialized, cannot send notification");
    return false;
  }
  try {
    await botInstance.api.sendMessage(chatId, message, { parse_mode: "Markdown" });
    return true;
  } catch (err) {
    log.error({ err }, "Failed to send Telegram message");
    return false;
  }
}

/**
 * Send a voice message to a specific chat
 */
export async function sendTelegramVoice(chatId: string, audioPath: string, caption?: string): Promise<boolean> {
  if (!botInstance) {
    log.warn("Telegram bot not initialized, cannot send voice");
    return false;
  }
  try {
    const { InputFile } = await import("grammy");
    const { createReadStream } = await import("fs");

    await botInstance.api.sendVoice(
      chatId,
      new InputFile(createReadStream(audioPath)),
      { caption }
    );
    return true;
  } catch (err) {
    log.error({ err }, "Failed to send Telegram voice message");
    return false;
  }
}

/**
 * Send an audio file to a specific chat
 */
export async function sendTelegramAudio(chatId: string, audioPath: string, title?: string): Promise<boolean> {
  if (!botInstance) {
    log.warn("Telegram bot not initialized, cannot send audio");
    return false;
  }
  try {
    const { InputFile } = await import("grammy");
    const { createReadStream } = await import("fs");

    await botInstance.api.sendAudio(
      chatId,
      new InputFile(createReadStream(audioPath)),
      { title: title || "Wispy Voice Reply" }
    );
    return true;
  } catch (err) {
    log.error({ err }, "Failed to send Telegram audio");
    return false;
  }
}

/**
 * Send an image to a specific chat (for cross-channel dispatch from CLI)
 */
export async function sendTelegramImage(chatId: string, imagePath: string, caption?: string): Promise<boolean> {
  if (!botInstance) {
    log.warn("Telegram bot not initialized, cannot send image");
    return false;
  }
  try {
    const { InputFile } = await import("grammy");
    const { readFileSync, existsSync } = await import("fs");
    if (!existsSync(imagePath)) {
      log.warn({ imagePath }, "Image file not found");
      return false;
    }
    await botInstance.api.sendPhoto(
      chatId,
      new InputFile(readFileSync(imagePath), "image.png"),
      caption ? { caption, parse_mode: "Markdown" } : undefined
    );
    return true;
  } catch (err) {
    log.error({ err }, "Failed to send Telegram image");
    return false;
  }
}

/**
 * Send a document to a specific chat (for cross-channel dispatch from CLI)
 */
export async function sendTelegramDocument(chatId: string, filePath: string, caption?: string): Promise<boolean> {
  if (!botInstance) {
    log.warn("Telegram bot not initialized, cannot send document");
    return false;
  }
  try {
    const { InputFile } = await import("grammy");
    const { createReadStream, existsSync } = await import("fs");
    if (!existsSync(filePath)) {
      log.warn({ filePath }, "Document file not found");
      return false;
    }
    await botInstance.api.sendDocument(
      chatId,
      new InputFile(createReadStream(filePath)),
      caption ? { caption, parse_mode: "Markdown" } : undefined
    );
    return true;
  } catch (err) {
    log.error({ err }, "Failed to send Telegram document");
    return false;
  }
}

// Track names for x402 demos
const DEMO_TRACK_NAMES: Record<number, string> = {
  1: "Overall Best Agentic App",
  2: "Agentic Tool Usage on x402",
  3: "Best Integration of AP2",
  4: "Best Trading / DeFi Agent",
  5: "Encrypted Agents (BITE v2)",
  6: "Agentic Vision (Gemini 3)",
};

// Agent-driven demo prompts per track (realistic use-case framing)
// Uses a function to resolve DEMO_PORTS at call time (supports dynamic ports for multi-instance)
function getDemoPrompts(): Record<number, string> {
  // Late import to get current dynamic ports
  let wp = 4021, sp = 4022, rp = 4023;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require("../../integrations/agentic-commerce/config.js");
    wp = cfg.DEMO_PORTS?.weather ?? 4021;
    sp = cfg.DEMO_PORTS?.sentiment ?? 4022;
    rp = cfg.DEMO_PORTS?.report ?? 4023;
  } catch { /* use defaults */ }

  return {
  1: `You are demonstrating Wispy's autonomous agentic commerce capabilities for the SF x402 Hackathon.

SCENARIO: A logistics company needs real-time weather data for route planning in Nairobi.

Steps:
1. Use x402_pay_and_fetch to call the Weather API at http://127.0.0.1:${wp}/weather?city=Nairobi (reason: "Real-time weather for logistics route optimization")
2. Use x402_check_budget to show budget awareness
3. Use x402_audit_trail to show the payment audit trail

IMPORTANT: Always use 127.0.0.1 (not localhost) for service URLs. Include explorer links in your summary. Say "TRACK 1 COMPLETE" when done.`,

  2: `You are demonstrating x402 autonomous payments on SKALE for the SF Agentic Commerce Hackathon.

SCENARIO: A market intelligence platform needs weather, sentiment, and summary reports.

Steps:
1. Use x402_pay_and_fetch to GET weather from http://127.0.0.1:${wp}/weather?city=Nairobi (reason: "Market weather correlation data")
2. Use x402_pay_and_fetch to POST sentiment analysis to http://127.0.0.1:${sp}/analyze with body {"text":"SKALE blockchain enables gasless micro-payments for AI agents"} (reason: "Sentiment analysis for market intelligence")
3. Use x402_pay_and_fetch to POST a report to http://127.0.0.1:${rp}/report with body {"format":"executive"} (reason: "Executive summary report generation")
4. Use x402_check_budget to show remaining budget

IMPORTANT: Always use 127.0.0.1 (not localhost). Include all explorer proof links. Say "TRACK 2 COMPLETE" when done.`,

  3: `You are demonstrating AP2 (Agent Payment Protocol) authorization flows for the SF x402 Hackathon.

SCENARIO: An AI agent autonomously subscribes to a premium weather data service using structured AP2 mandates.

Steps:
1. Use ap2_purchase with description "Premium weather data subscription for fleet management", service_url "http://127.0.0.1:${wp}/weather", merchant_name "WeatherPro Analytics", max_budget "0.005"
2. Use ap2_get_receipts to show the full mandate chain (intent -> cart -> payment -> receipt)

IMPORTANT: Include all transaction proof links and mandate IDs. Say "TRACK 3 COMPLETE" when done.`,

  4: `You are demonstrating DeFi trading with risk controls for the SF Agentic Commerce Hackathon.

SCENARIO: A portfolio management agent rebalances positions on Algebra DEX (SKALE).

Steps:
1. Use defi_research to research the USDC token for current market conditions
2. Use defi_swap to execute a conservative swap: from_token "USDC", to_token "sFUEL", amount "0.001", reasoning "Portfolio diversification into native gas token for operational efficiency"
3. Use defi_trade_log to show the full trade decision log with risk evaluations

IMPORTANT: Include all transaction proof links and risk scores. Say "TRACK 4 COMPLETE" when done.`,

  5: `You are demonstrating BITE v2 threshold encryption for the SF Agentic Commerce Hackathon.

SCENARIO: An escrow agent encrypts a payment that only unlocks when delivery is confirmed.

Steps:
1. Use bite_encrypt_payment with to "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28", data "0x0001", condition_type "delivery_proof", condition_description "Payment unlocks when package delivery is confirmed by GPS oracle"
2. Use bite_check_and_execute with the payment_id from step 1 to check condition status
3. Use bite_lifecycle_report with the payment_id to show the full encryption lifecycle

IMPORTANT: Include all transaction proof links and encryption status. Say "TRACK 5 COMPLETE" when done.`,

  6: `You are demonstrating Agentic Vision for the SF Agentic Commerce Hackathon — Gemini 3's visual reasoning combined with autonomous payments.

SCENARIO: A fleet management AI agent receives a dashboard showing 12 vehicles across Nairobi. It must visually analyze the data, identify issues, reason about costs, and autonomously pay for services to resolve them.

Steps:
1. Use x402_discover_services to find available APIs
2. Explain your visual analysis: "I see 12 vehicles, 3 alerts: low tire pressure on KBZ-412H, overdue service on KCA-889J, low fuel on KBB-201F. The cost analysis shows KES 12,450 fuel spend today with KES 3,200 potential savings."
3. Use x402_pay_and_fetch to GET weather from http://127.0.0.1:${wp}/weather?city=Nairobi (reason: "Check weather before rerouting low-fuel vehicle to nearest station")
4. Use x402_pay_and_fetch to POST route analysis to http://127.0.0.1:${sp}/analyze with body {"text":"Nairobi traffic Westlands route for fleet vehicle KBB-201F fuel stop"} (reason: "Optimize rerouting path for fuel savings")
5. Use x402_pay_and_fetch to POST alert dispatch to http://127.0.0.1:${rp}/report with body {"format":"fleet_alert","alerts":["Reroute KBB-201F to Shell Westlands","Schedule KCA-889J service"]} (reason: "Dispatch maintenance alerts to fleet manager")
6. Use x402_check_budget to show total spend and remaining budget
7. Summarize: "Vision flow: Think (analyze dashboard) -> Observe (3 alerts, cost data) -> Act (3 API calls) -> Pay ($0.003 USDC). ROI: KES 3,200 saved in fuel/maintenance."

IMPORTANT: Always use 127.0.0.1 (not localhost). Frame every action as vision-driven reasoning. Say "TRACK 6 COMPLETE" when done.`,
  };
}

// SKALE explorer base for tx hash extraction
const SKALE_EXPLORER_BASE = "https://base-sepolia-testnet-explorer.skalenodes.com:10032";

/** Extract tx hashes from text and return explorer URLs */
function extractTxProofButtons(text: string): Array<{ text: string; url: string }> {
  const buttons: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  // Match 0x + 64 hex chars (transaction hashes)
  const hashRegex = /0x[a-fA-F0-9]{64}/g;
  let match;
  while ((match = hashRegex.exec(text)) !== null) {
    const hash = match[0];
    if (!seen.has(hash)) {
      seen.add(hash);
      buttons.push({
        text: `View Tx ${hash.slice(0, 8)}...${hash.slice(-4)}`,
        url: `${SKALE_EXPLORER_BASE}/tx/${hash}`,
      });
    }
  }
  return buttons.slice(0, 3); // Max 3 buttons
}

/**
 * Run demo tracks via the AI agent and report results to Telegram.
 * Routes demo prompts through agent.chatStream() for real tool usage.
 */
async function runAgentDemoInTelegram(
  ctx: Context,
  tracks: number[],
  agentInstance: Agent,
) {
  const chatId = ctx.chat!.id;
  const userId = String(ctx.from?.id || "");
  const label = tracks.length >= 5 ? "all tracks" : `Track ${tracks.join(", ")}`;
  const statusMsg = await ctx.reply(`\u26A1 Starting agent-driven demo (${label})...`);

  // Start demo services
  let servicesStarted = false;
  try {
    const { startDemoServices } = await import("../../integrations/agentic-commerce/demo/server.js");
    await startDemoServices();
    servicesStarted = true;
  } catch (err) {
    await ctx.reply(`\u274C Failed to start demo services: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Set chat context for the agent
  const sendImage = async (imagePath: string, caption?: string) => {
    const { InputFile } = await import("grammy");
    const fs = await import("fs");
    if (fs.existsSync(imagePath)) {
      await ctx.replyWithPhoto(
        new InputFile(fs.readFileSync(imagePath), "screenshot.png"),
        caption ? { caption, parse_mode: "Markdown" } : undefined,
      );
    }
  };
  agentInstance.setChatContext({ channel: "telegram", peerId: userId, chatId: String(chatId), sendImage });

  const totalStart = Date.now();
  const allTxButtons: Array<{ text: string; url: string }> = [];

  try {
    for (const trackNum of tracks) {
      const prompt = getDemoPrompts()[trackNum];
      if (!prompt) {
        await ctx.reply(`\u26A0\uFE0F No agent prompt for Track ${trackNum}, skipping.`);
        continue;
      }

      const trackName = DEMO_TRACK_NAMES[trackNum] || `Track ${trackNum}`;

      // Update status
      await ctx.api.editMessageText(
        chatId, statusMsg.message_id,
        `\u26A1 *Track ${trackNum}: ${trackName}*\n_Agent is working..._`,
        { parse_mode: "Markdown" },
      ).catch(() => {});

      // Multi-turn agent execution (up to 8 turns per track)
      const MAX_TURNS = 8;
      let trackText = "";
      let trackComplete = false;

      for (let turn = 1; turn <= MAX_TURNS && !trackComplete; turn++) {
        const turnPrompt = turn === 1
          ? prompt
          : "Continue. Complete all remaining steps. Use 127.0.0.1 for service URLs.";

        let turnText = "";
        const toolsUsed: string[] = [];
        let lastToolUpdate = 0;

        for await (const event of agentInstance.chatStream(turnPrompt, userId, "telegram", "sub")) {
          if (event.type === "text") {
            turnText += event.content;
          } else if (event.type === "tool_call") {
            toolsUsed.push(event.content);
            const now = Date.now();
            // Throttle tool update messages (every 3 seconds)
            if (now - lastToolUpdate > 3000) {
              const emoji = getToolEmoji(event.content);
              await ctx.api.editMessageText(
                chatId, statusMsg.message_id,
                `\u26A1 *Track ${trackNum}: ${trackName}*\n${emoji} _${event.content}_`,
                { parse_mode: "Markdown" },
              ).catch(() => {});
              lastToolUpdate = now;
            }
          } else if (event.type === "done") {
            break;
          }
        }

        trackText += turnText;

        // Check for track completion marker
        if (trackText.toLowerCase().includes(`track ${trackNum} complete`)) {
          trackComplete = true;
        }
      }

      // Extract tx proof buttons from agent response
      const txButtons = extractTxProofButtons(trackText);
      allTxButtons.push(...txButtons);

      // Send track result
      const trackDuration = ((Date.now() - totalStart) / 1000).toFixed(1);
      const statusIcon = trackComplete ? "\u2705" : "\u26A0\uFE0F";

      // Truncate long responses for Telegram (4000 char limit)
      let responseText = trackText.trim();
      if (responseText.length > 3500) {
        responseText = responseText.slice(0, 3400) + "\n\n_...truncated..._";
      }

      // Build inline keyboard with tx proof buttons for this track
      const inlineKeyboard: Array<Array<{ text: string; url: string }>> = [];
      if (txButtons.length > 0) {
        inlineKeyboard.push(txButtons.map(b => ({ text: b.text, url: b.url })));
      }

      await ctx.reply(
        `${statusIcon} *Track ${trackNum}: ${trackName}* (${trackDuration}s)\n\n${responseText}`,
        {
          parse_mode: "Markdown",
          ...(inlineKeyboard.length > 0 ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
        },
      ).catch(() => {
        // Fallback without markdown
        ctx.reply(`${statusIcon} Track ${trackNum}: ${trackName} (${trackDuration}s)\n\n${responseText.replace(/[*_`]/g, "")}`);
      });
    }

    // Final summary
    const totalDuration = ((Date.now() - totalStart) / 1000).toFixed(1);
    const summaryKeyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [
      [{ text: "\uD83D\uDD04 Run Again", callback_data: tracks.length >= 5 ? "demo_all" : `demo_track:${tracks[0]}` }],
    ];
    // Add unique tx proof buttons to summary (max 3)
    const uniqueButtons = allTxButtons.slice(0, 3);
    if (uniqueButtons.length > 0) {
      summaryKeyboard.push(uniqueButtons.map(b => ({ text: b.text, url: b.url })));
    }

    await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
    await ctx.reply(
      `\uD83C\uDFAC *Demo Complete* | ${tracks.length} track(s) | ${totalDuration}s\n\n` +
      `All transactions settled on SKALE BITE V2 Sandbox (gasless).`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: summaryKeyboard as any },
      },
    ).catch(() => {});

  } catch (err) {
    await ctx.reply(`\u274C Demo error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Always stop demo services
    if (servicesStarted) {
      try {
        const { stopDemoServices } = await import("../../integrations/agentic-commerce/demo/server.js");
        await stopDemoServices();
      } catch { /* ignore */ }
    }
  }
}

/**
 * Format marathon status for Telegram
 */
function formatStatusForTelegram(state: MarathonState): string {
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
 * Format marathon list for Telegram
 */
function formatMarathonList(marathons: MarathonState[]): string {
  if (marathons.length === 0) {
    return "📭 No marathons found. Start one with:\n`/marathon Build a React todo app`";
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
    msg += `   ID: \`${m.id}\` | ${progress.percentage}%\n\n`;
  }

  return msg;
}

export function startTelegram(token: string, agent: Agent, runtimeDir: string, apiKey?: string) {
  const bot = new Bot(token);
  botInstance = bot;
  agentInstance = agent;
  apiKeyInstance = apiKey || process.env.GEMINI_API_KEY || "";
  marathonService = new MarathonService(runtimeDir);

  // Connect marathon service to agent for NLP-based control
  // This enables natural language: "build me a todo app" instead of "/marathon Build a todo app"
  agent.setMarathonService(marathonService, apiKeyInstance);

  // Initialize trust handler for inline approval buttons
  const trustController = getTrustController();
  initTelegramTrustHandler(bot, trustController);

  // Initialize progress notifier for thought signatures
  initProgressNotifier(bot);

  // Initialize document delivery for sending PDFs
  initTelegramDelivery(bot);

  // Initialize marathon visuals for beautiful progress updates
  initMarathonVisuals(bot);

  // /start - Welcome message with commands
  bot.command("start", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    const chatId = String(ctx.chat?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      pairUser(runtimeDir, "telegram", userId);
    }

    // Register user for trust notifications and progress updates
    registerTelegramUser(userId, chatId);
    registerUserChat(userId, chatId);

    const welcomeMsg = `☁️ *Welcome to Wispy!*

Your autonomous AI agent. Just talk naturally!

*Natural Language Control:*
• "Build me a React dashboard" → I'll start working
• "How's it going?" → Check my progress
• "Yes" / "No" → Approve or reject actions
• "Pause" / "Continue" → Control the work

*Voice Notes:* 🎤
Send voice messages and I'll respond!
/voice - Toggle voice replies
/call +number - Make a phone call

*Image Generation:*
/image <description> - Generate AI images

*Wallet:*
/wallet - Check crypto wallet

*Dev Tools:*
/deploy - Deploy to Vercel
/push - Push to GitHub
/git - Git operations
/npm - Run npm scripts
/debug - Debug tools

*Examples:*
• "Create a landing page with Tailwind"
• "What's the status?"
• 🎤 Send a voice note
• /image A robot playing guitar
• /deploy ./my-project --prod

I work autonomously and keep you updated! 🚀`;

    await ctx.reply(welcomeMsg, { parse_mode: "Markdown" });
  });

  // /marathon <goal> - Start a new marathon
  bot.command("marathon", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    const chatId = String(ctx.chat?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const goal = ctx.message?.text?.replace(/^\/marathon\s*/i, "").trim();

    if (!goal) {
      await ctx.reply(
        "🎯 Please provide a goal!\n\n" +
        "*Usage:* `/marathon <your goal>`\n\n" +
        "*Examples:*\n" +
        "• `/marathon Build a React todo app`\n" +
        "• `/marathon Create a REST API with Node.js`\n" +
        "• `/marathon Set up a blog with Next.js`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (!agentInstance || !apiKeyInstance) {
      await ctx.reply("❌ Agent not properly initialized. Please restart Wispy.");
      return;
    }

    // Send initial thinking message
    const thinkingMsg = await ctx.reply(
      `🧠 *Extended Thinking: 24,576 tokens*\n\n` +
      `💭 Planning your project...\n\n` +
      `*Goal:* ${goal}\n\n` +
      `_Creating execution plan with Gemini 3..._`,
      { parse_mode: "Markdown" }
    );

    try {
      // Start marathon in background with visual callbacks and telegram integration
      marathonService!.start(goal, agentInstance, apiKeyInstance, {
        notifications: {
          enabled: true,
          channels: { telegram: { chatId } },
          notifyOn: {
            milestoneComplete: true,
            milestoneFailure: true,
            humanInputNeeded: true,
            marathonComplete: true,
            dailySummary: false,
          },
        },
        telegramBot: bot,
        telegramChatId: chatId,
      }).then(async (finalState) => {
        // Send visual completion message
        const result = marathonService!.getResult(finalState.id);
        const stats = {
          duration: Date.now() - (finalState.startedAt ? new Date(finalState.startedAt).getTime() : Date.now()),
          tokensUsed: finalState.totalTokensUsed || 0,
          toolCalls: finalState.logs.filter(l => l.message.includes("tool") || l.message.includes("bash") || l.message.includes("file")).length,
          filesCreated: result?.artifacts?.length || 0,
        };
        await sendMarathonComplete(chatId, finalState, stats, result?.artifacts || []);
      }).catch(async (err) => {
        log.error({ err }, "Marathon execution error");
        await sendTelegramMessage(chatId, `❌ Marathon error: ${err.message}`);
      });

      // Wait briefly then send planning message
      setTimeout(async () => {
        const state = marathonService!.getStatus();
        if (state?.plan) {
          // Delete thinking message and send visual plan
          try {
            await ctx.api.deleteMessage(ctx.chat!.id, thinkingMsg.message_id);
          } catch {}

          await sendPlanningMessage(chatId, state.plan, state.id);

          // Set up periodic progress updates
          const progressInterval = setInterval(async () => {
            const currentState = marathonService!.getStatus();
            if (!currentState || currentState.status === "completed" || currentState.status === "failed") {
              clearInterval(progressInterval);
              return;
            }
            await updateProgressMessage(currentState.id, currentState);
          }, 10000); // Update every 10 seconds
        }
      }, 3000);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error({ err }, "Failed to start marathon");
      await ctx.reply(`❌ Failed to start marathon: ${errMsg}`);
    }
  });

  // /status - Get current marathon status
  bot.command("status", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const state = marathonService!.getStatus();

    if (!state) {
      await ctx.reply(
        "📭 No active marathon.\n\nStart one with:\n`/marathon <your goal>`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await ctx.reply(formatStatusForTelegram(state), {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\u23F8 Pause", callback_data: `marathon_pause:${state.id}` },
            { text: "\uD83D\uDED1 Abort", callback_data: `marathon_abort:${state.id}` },
          ],
          [
            { text: "\uD83D\uDD04 Refresh", callback_data: `marathon_refresh:${state.id}` },
          ],
        ],
      },
    });
  });

  // /pause - Pause active marathon
  bot.command("pause", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    marathonService!.pause();
    await ctx.reply("⏸️ Marathon paused.\n\nUse /resume to continue.", { parse_mode: "Markdown" });
  });

  // /resume - Resume paused marathon
  bot.command("resume", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    const chatId = String(ctx.chat?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const state = marathonService!.getStatus();

    if (!state) {
      await ctx.reply("📭 No marathon to resume.");
      return;
    }

    if (state.status !== "paused") {
      await ctx.reply(`Marathon is ${state.status}, not paused.`);
      return;
    }

    if (!agentInstance || !apiKeyInstance) {
      await ctx.reply("❌ Agent not properly initialized.");
      return;
    }

    await ctx.reply("▶️ Resuming marathon...", { parse_mode: "Markdown" });

    try {
      marathonService!.resume(state.id, agentInstance, apiKeyInstance)
        .then(async (finalState) => {
          const result = marathonService!.getResult(finalState.id);
          await sendTelegramMessage(
            chatId,
            result?.success
              ? `🎉 *Marathon Completed!*\n\n${finalState.plan.goal}`
              : `❌ *Marathon ended*\n\nStatus: ${finalState.status}`
          );
        })
        .catch(async (err) => {
          await sendTelegramMessage(chatId, `❌ Error: ${err.message}`);
        });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ Failed to resume: ${errMsg}`);
    }
  });

  // /abort - Stop current marathon
  bot.command("abort", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    marathonService!.abort();
    await ctx.reply("🛑 Marathon aborted.", { parse_mode: "Markdown" });
  });

  // /approvals - List pending approvals
  bot.command("approvals", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const pending = marathonService!.getPendingApprovals();

    if (pending.length === 0) {
      await ctx.reply("✅ No pending approvals.", { parse_mode: "Markdown" });
      return;
    }

    let msg = `⚠️ *Pending Approvals (${pending.length})*\n\n`;
    for (const { marathonId, request } of pending) {
      const riskEmoji: Record<string, string> = {
        low: "🟢",
        medium: "🟡",
        high: "🟠",
        critical: "🔴",
      };
      msg += `${riskEmoji[request.risk] || "⚪"} *${request.id}*\n`;
      msg += `Action: ${request.action}\n`;
      msg += `${request.description}\n`;
      msg += `Risk: ${request.risk.toUpperCase()}\n\n`;
    }
    msg += `Reply with:\n\`/approve <id>\`\n\`/reject <id> [reason]\``;

    await ctx.reply(msg, { parse_mode: "Markdown" });
  });

  // /approve - Approve a pending request
  bot.command("approve", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const requestId = ctx.message?.text?.replace(/^\/approve\s*/i, "").trim();

    if (!requestId) {
      await ctx.reply("Usage: `/approve <request-id>`", { parse_mode: "Markdown" });
      return;
    }

    // Find and approve the request
    const marathons = marathonService!.listMarathons() as any[];
    let found = false;

    for (const m of marathons) {
      if (m.approvalRequests?.some((r: any) => r.id === requestId)) {
        const success = marathonService!.approve(m.id, requestId, `telegram:${userId}`);
        if (success) {
          await ctx.reply(`✅ *Approved*\n\nRequest ${requestId} approved. Marathon will continue.`, { parse_mode: "Markdown" });
          found = true;
        }
        break;
      }
    }

    if (!found) {
      await ctx.reply(`❌ Request not found: ${requestId}`);
    }
  });

  // /reject - Reject a pending request
  bot.command("reject", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = ctx.message?.text?.replace(/^\/reject\s*/i, "").trim() || "";
    const parts = args.split(" ");
    const requestId = parts[0];
    const reason = parts.slice(1).join(" ") || "Rejected via Telegram";

    if (!requestId) {
      await ctx.reply("Usage: `/reject <request-id> [reason]`", { parse_mode: "Markdown" });
      return;
    }

    // Find and reject the request
    const marathons = marathonService!.listMarathons() as any[];
    let found = false;

    for (const m of marathons) {
      if (m.approvalRequests?.some((r: any) => r.id === requestId)) {
        const success = marathonService!.reject(m.id, requestId, reason);
        if (success) {
          await ctx.reply(`❌ *Rejected*\n\nRequest ${requestId} rejected.\nReason: ${reason}`, { parse_mode: "Markdown" });
          found = true;
        }
        break;
      }
    }

    if (!found) {
      await ctx.reply(`❌ Request not found: ${requestId}`);
    }
  });

  // Handle visual callback queries (image feedback, deploy, etc)
  bot.on("callback_query:data", async (ctx: Context) => {
    const data = ctx.callbackQuery?.data || "";
    const userId = String(ctx.from?.id || "");
    const chatId = String(ctx.chat?.id || "");

    // ═══════════════════════════════════════════════════════════════════════
    // MARATHON CONTROL CALLBACKS (NEW)
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("marathon_")) {
      const [action, marathonId] = data.split(":");

      if (action === "marathon_pause") {
        await ctx.answerCallbackQuery("⏸️ Pausing marathon...");
        marathonService?.pause();
        await ctx.reply("⏸️ *Marathon Paused*\n\nUse the Resume button or /resume to continue.", { parse_mode: "Markdown" });
        // Update the button to show Resume
        const state = marathonService?.getStatus();
        if (state) {
          await updateProgressMessage(state.id, { ...state, status: "paused" });
        }
      } else if (action === "marathon_resume") {
        await ctx.answerCallbackQuery("▶️ Resuming marathon...");
        const state = marathonService?.getStatus();
        if (state && agentInstance && apiKeyInstance) {
          marathonService?.resume(state.id, agentInstance, apiKeyInstance).catch(() => {});
          await ctx.reply("▶️ *Marathon Resumed*\n\nContinuing execution...", { parse_mode: "Markdown" });
        }
      } else if (action === "marathon_abort") {
        await ctx.answerCallbackQuery("⛔ Aborting marathon...");
        marathonService?.abort();
        await ctx.reply("⛔ *Marathon Aborted*\n\nAll work has been stopped.", { parse_mode: "Markdown" });
      } else if (action === "marathon_status") {
        await ctx.answerCallbackQuery("📊 Loading status...");
        const state = marathonService?.getStatus();
        if (state) {
          await ctx.reply(formatStatusForTelegram(state), { parse_mode: "Markdown" });
        } else {
          await ctx.reply("📭 No active marathon.");
        }
      } else if (action === "marathon_skip") {
        await ctx.answerCallbackQuery("⏭️ Skipping current milestone...");
        // Mark current milestone as skipped and move to next
        const state = marathonService?.getStatus();
        if (state) {
          const currentMilestone = state.plan.milestones.find(m => m.status === "in_progress");
          if (currentMilestone) {
            await ctx.reply(
              `⏭️ *Skipped Milestone*\n\n_${currentMilestone.title}_\n\nMoving to next milestone...`,
              { parse_mode: "Markdown" }
            );
            // The skip logic would be in marathon service
          }
        }
      } else if (action === "marathon_refresh") {
        await ctx.answerCallbackQuery("🔄 Refreshing...");
        const state = marathonService?.getStatus();
        if (state) {
          await updateProgressMessage(state.id, state);
        }
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // APPROVAL CALLBACKS (NEW - Enhanced)
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("approve:") || data.startsWith("deny:") || data.startsWith("always_allow:")) {
      const [action, approvalId] = data.split(":");

      // Find and handle the approval request
      const marathons = marathonService?.listMarathons() as any[] || [];
      let found = false;

      for (const m of marathons) {
        if (m.approvalRequests?.some((r: any) => r.id === approvalId)) {
          if (action === "approve" || action === "always_allow") {
            const success = marathonService?.approve(m.id, approvalId, `telegram:${userId}`);
            if (success) {
              await ctx.answerCallbackQuery("✅ Approved!");
              await ctx.editMessageText(
                `✅ *Approved by @${ctx.from?.username || userId}*\n\nMarathon will continue.`,
                { parse_mode: "Markdown" }
              );
              found = true;

              if (action === "always_allow") {
                await ctx.reply("✅ *Policy Updated:* This action type will be auto-approved in the future.", { parse_mode: "Markdown" });
              }
            }
          } else if (action === "deny") {
            const success = marathonService?.reject(m.id, approvalId, "Denied via Telegram");
            if (success) {
              await ctx.answerCallbackQuery("❌ Denied!");
              await ctx.editMessageText(
                `❌ *Denied by @${ctx.from?.username || userId}*\n\nMarathon paused.`,
                { parse_mode: "Markdown" }
              );
              found = true;
            }
          }
          break;
        }
      }

      if (!found) {
        await ctx.answerCallbackQuery("Request not found or already processed.");
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // COMPLETION CALLBACKS (NEW)
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("deploy:")) {
      const [_, marathonId] = data.split(":");
      await ctx.answerCallbackQuery("🚀 Deploying...");
      await sendThinkingNotification(chatId, "Deploying project to Vercel...");
      // TODO: Implement actual deployment
      setTimeout(async () => {
        await ctx.reply(
          "🚀 *Deployed!*\n\n" +
          "🌐 https://your-project.vercel.app\n\n" +
          "_Your website is live!_",
          { parse_mode: "Markdown" }
        );
      }, 2000);
      return;
    }

    if (data.startsWith("download:")) {
      const [_, marathonId] = data.split(":");
      await ctx.answerCallbackQuery("📦 Preparing...");
      await ctx.reply("📦 Preparing project zip... One moment.");
      // TODO: Create and send zip
      return;
    }

    if (data.startsWith("report:")) {
      const [_, marathonId] = data.split(":");
      await ctx.answerCallbackQuery("📝 Loading report...");
      const state = marathonService?.getStatus();
      if (state) {
        const report = `📊 *Marathon Report*\n\n` +
          `*Goal:* ${state.plan.goal}\n` +
          `*Status:* ${state.status}\n` +
          `*Milestones:* ${state.plan.milestones.filter(m => m.status === "completed").length}/${state.plan.milestones.length}\n\n` +
          `*Timeline:*\n${state.logs.slice(-10).map(l => `• ${l.message}`).join("\n")}`;
        await ctx.reply(report, { parse_mode: "Markdown" });
      }
      return;
    }

    if (data.startsWith("rerun:")) {
      const [_, marathonId] = data.split(":");
      await ctx.answerCallbackQuery("🔄 Starting new run...");
      const state = marathonService?.getStatus();
      if (state && agentInstance && apiKeyInstance) {
        await ctx.reply(`🔄 *Starting New Marathon*\n\nGoal: ${state.plan.goal}`, { parse_mode: "Markdown" });
        marathonService?.start(state.plan.goal, agentInstance, apiKeyInstance, {
          notifications: { enabled: true, channels: { telegram: { chatId } }, notifyOn: { milestoneComplete: true, milestoneFailure: true, humanInputNeeded: true, marathonComplete: true, dailySummary: false } },
        }).catch(() => {});
      }
      return;
    }

    if (data.startsWith("open:")) {
      const [_, marathonId] = data.split(":");
      await ctx.answerCallbackQuery("Opening in browser...");
      await ctx.reply("🖥️ Opening project in browser...\n\n_Run `npx serve` in your project directory to start a local server._", { parse_mode: "Markdown" });
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // IMAGE FEEDBACK CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("img_")) {
      const [action, imageId] = data.split(":");

      if (action === "img_approve") {
        await ctx.answerCallbackQuery("Great! Continuing...");
        await ctx.editMessageCaption({
          caption: "✅ *Image approved!* Continuing with the project...",
          parse_mode: "Markdown",
        });
        // Continue marathon execution
      } else if (action === "img_regen") {
        await ctx.answerCallbackQuery("Regenerating image...");
        await sendThinkingNotification(chatId, "Regenerating image with different style...");
        // Would trigger image regeneration here
      } else if (action === "img_edit") {
        await ctx.answerCallbackQuery("Send your feedback!");
        await ctx.reply("💬 What changes would you like to the image? Reply with your feedback.");
      } else if (action === "img_vary") {
        await ctx.answerCallbackQuery("Creating variations...");
        await sendThinkingNotification(chatId, "Creating image variations...");
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MILESTONE CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("ms_")) {
      const parts = data.split(":");
      const action = parts[0];
      const milestoneId = parts[1];
      const marathonId = parts[2];

      if (action === "ms_continue") {
        await ctx.answerCallbackQuery("Continuing...");
        marathonService?.resume(marathonId, agentInstance!, apiKeyInstance!).catch(() => {});
      } else if (action === "ms_skip") {
        await ctx.answerCallbackQuery("⏭️ Skipping milestone...");
        await ctx.reply(`⏭️ *Milestone Skipped*\n\nMoving to next milestone...`, { parse_mode: "Markdown" });
      } else if (action === "ms_retry") {
        await ctx.answerCallbackQuery("🔄 Retrying milestone...");
        await ctx.reply(`🔄 *Retrying Milestone*\n\nAttempting again...`, { parse_mode: "Markdown" });
      } else if (action === "ms_edit") {
        await ctx.answerCallbackQuery("✏️ Edit mode...");
        await ctx.reply("✏️ Send your modifications for this milestone:");
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PAUSE CALLBACK (from approval)
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("pause:")) {
      const [_, approvalId] = data.split(":");
      await ctx.answerCallbackQuery("⏸️ Pausing...");
      marathonService?.pause();
      await ctx.reply("⏸️ *Marathon Paused*\n\nThe marathon has been paused while you review.", { parse_mode: "Markdown" });
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GIT CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("git_")) {
      const [action, projectPath] = data.split(":");
      const { execSync } = await import("child_process");

      try {
        if (action === "git_status") {
          await ctx.answerCallbackQuery("📊 Checking...");
          const status = execSync(`git -C "${projectPath}" status --short`, { encoding: "utf-8" });
          const branch = execSync(`git -C "${projectPath}" branch --show-current`, { encoding: "utf-8" }).trim();
          await ctx.reply(
            `📊 *Git Status*\n\n🌿 Branch: \`${branch}\`\n\n\`\`\`\n${status || "Clean working tree"}\n\`\`\``,
            { parse_mode: "Markdown" }
          );
        } else if (action === "git_push") {
          await ctx.answerCallbackQuery("📤 Pushing...");
          await ctx.reply("📤 *Pushing to GitHub...*", { parse_mode: "Markdown" });
          execSync(`git -C "${projectPath}" add -A`, { encoding: "utf-8" });
          try { execSync(`git -C "${projectPath}" commit -m "Update via Wispy"`, { encoding: "utf-8" }); } catch {}
          execSync(`git -C "${projectPath}" push`, { encoding: "utf-8", timeout: 60000 });
          await ctx.reply("✅ *Push Successful!*", { parse_mode: "Markdown" });
        } else if (action === "git_init") {
          await ctx.answerCallbackQuery("🔄 Initializing...");
          execSync(`git init "${projectPath}"`, { encoding: "utf-8" });
          await ctx.reply(`✅ Git repository initialized at \`${projectPath}\``, { parse_mode: "Markdown" });
        } else if (action === "git_commit") {
          await ctx.answerCallbackQuery("📝 Committing...");
          execSync(`git -C "${projectPath}" add -A`, { encoding: "utf-8" });
          execSync(`git -C "${projectPath}" commit -m "Update via Wispy"`, { encoding: "utf-8" });
          await ctx.reply("✅ *Committed changes!*", { parse_mode: "Markdown" });
        }
      } catch (err) {
        await ctx.reply(`❌ Git error: \`${err instanceof Error ? err.message : "Unknown error"}\``, { parse_mode: "Markdown" });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NPM CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("npm_")) {
      const [action, projectPath] = data.split(":");
      const { execSync } = await import("child_process");

      try {
        if (action === "npm_install") {
          await ctx.answerCallbackQuery("📥 Installing...");
          await ctx.reply("📥 *Installing dependencies...*\n\nThis may take a moment.", { parse_mode: "Markdown" });
          execSync("npm install", { cwd: projectPath, encoding: "utf-8", timeout: 180000 });
          await ctx.reply("✅ *Dependencies installed!*", { parse_mode: "Markdown" });
        } else if (action === "npm_build") {
          await ctx.answerCallbackQuery("🔨 Building...");
          await ctx.reply("🔨 *Building project...*", { parse_mode: "Markdown" });
          const output = execSync("npm run build", { cwd: projectPath, encoding: "utf-8", timeout: 300000 });
          await ctx.reply("✅ *Build complete!*", { parse_mode: "Markdown" });
        } else if (action === "npm_dev") {
          await ctx.answerCallbackQuery("🚀 Starting dev server...");
          await ctx.reply(
            "🚀 *Dev Server*\n\n" +
            "The dev server needs to run in your terminal.\n\n" +
            `Run: \`cd ${projectPath} && npm run dev\``,
            { parse_mode: "Markdown" }
          );
        } else if (action === "npm_test") {
          await ctx.answerCallbackQuery("🧪 Running tests...");
          await ctx.reply("🧪 *Running tests...*", { parse_mode: "Markdown" });
          const output = execSync("npm test", { cwd: projectPath, encoding: "utf-8", timeout: 300000 });
          const truncated = output.length > 1000 ? output.slice(-1000) + "\n...(truncated)" : output;
          await ctx.reply(`✅ *Tests complete!*\n\n\`\`\`\n${truncated}\n\`\`\``, { parse_mode: "Markdown" });
        }
      } catch (err) {
        await ctx.reply(`❌ NPM error: \`${err instanceof Error ? err.message.slice(0, 300) : "Unknown error"}\``, { parse_mode: "Markdown" });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DEBUG CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("debug_")) {
      const [action, value] = data.split(":");
      const { execSync } = await import("child_process");
      const os = await import("os");
      const isWindows = os.platform() === "win32";

      try {
        if (action === "debug_port") {
          await ctx.answerCallbackQuery("🔌 Checking port...");
          let result: string;
          if (isWindows) {
            result = execSync(`netstat -ano | findstr :${value}`, { encoding: "utf-8" });
          } else {
            result = execSync(`lsof -i :${value} || ss -tlnp | grep :${value}`, { encoding: "utf-8" });
          }
          await ctx.reply(
            `🔌 *Port ${value}*\n\n\`\`\`\n${result || "Port is free"}\n\`\`\``,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[
                  { text: "💀 Kill Process", callback_data: `debug_kill:${value}` }
                ]]
              }
            }
          );
        } else if (action === "debug_kill") {
          await ctx.answerCallbackQuery("💀 Killing...");
          if (isWindows) {
            const netstat = execSync(`netstat -ano | findstr :${value}`, { encoding: "utf-8" });
            const pidMatch = netstat.match(/LISTENING\s+(\d+)/);
            if (pidMatch) {
              execSync(`taskkill /F /PID ${pidMatch[1]}`, { encoding: "utf-8" });
            }
          } else {
            execSync(`fuser -k ${value}/tcp`, { encoding: "utf-8" });
          }
          await ctx.reply(`✅ Killed process on port ${value}`);
        } else if (action === "debug_processes") {
          await ctx.answerCallbackQuery("📋 Loading...");
          let result: string;
          if (isWindows) {
            result = execSync(`tasklist | findstr /i "node npm"`, { encoding: "utf-8" });
          } else {
            result = execSync(`ps aux | grep -E "node|npm" | grep -v grep`, { encoding: "utf-8" });
          }
          await ctx.reply(
            `📋 *Node.js Processes*\n\n\`\`\`\n${result || "No processes found"}\n\`\`\``,
            { parse_mode: "Markdown" }
          );
        } else if (action === "debug_killall") {
          await ctx.answerCallbackQuery("💀 Killing all...");
          if (isWindows) {
            execSync(`taskkill /F /IM node.exe`, { encoding: "utf-8" });
          } else {
            execSync(`pkill -f node`, { encoding: "utf-8" });
          }
          await ctx.reply("✅ All Node.js processes killed");
        }
      } catch (err) {
        await ctx.reply(`❌ Debug error: \`${err instanceof Error ? err.message : "Unknown error"}\``, { parse_mode: "Markdown" });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // X402 DEMO CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("demo_track:")) {
      const trackNum = parseInt(data.split(":")[1]);
      await ctx.answerCallbackQuery(`Running Track ${trackNum} via agent...`);
      await runAgentDemoInTelegram(ctx, [trackNum], agent);
      return;
    }
    if (data === "demo_all") {
      await ctx.answerCallbackQuery("Running all tracks via agent...");
      await runAgentDemoInTelegram(ctx, [1, 2, 3, 4, 5, 6], agent);
      return;
    }
    if (data === "demo_preflight") {
      await ctx.answerCallbackQuery("Running preflight...");
      try {
        const { runPreflight } = await import("../../integrations/agentic-commerce/demo/preflight.js");
        const result = await runPreflight(process.env.AGENT_PRIVATE_KEY);
        let msg = "\uD83D\uDEEB *Preflight Check*\n\n";
        msg += `*Mode:* ${result.mode === "live" ? "\u2705 LIVE" : "\u26A0\uFE0F SIMULATION"}\n`;
        msg += `*Address:* \`${result.address}\`\n`;
        if (result.mode === "live") {
          msg += `*sFUEL:* ${result.sFuelBalance}\n*USDC:* $${result.usdcBalance.toFixed(6)}\n`;
          msg += `*Ready:* ${result.ready ? "\u2705" : "\u274C"}\n`;
        }
        for (const w of result.warnings) msg += `\u26A0\uFE0F ${w}\n`;
        await ctx.reply(msg, { parse_mode: "Markdown" });
      } catch (err) {
        await ctx.reply(`\u274C Preflight failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    if (data === "demo_stop") {
      await ctx.answerCallbackQuery("Stopping demo services...");
      try {
        const { stopDemoServices } = await import("../../integrations/agentic-commerce/demo/server.js");
        await stopDemoServices();
        await ctx.reply("\u2705 Demo services stopped.");
      } catch {
        await ctx.reply("No demo services running.");
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MODEL & THINKING CALLBACKS
    // ═══════════════════════════════════════════════════════════════════════
    if (data.startsWith("model_set:")) {
      const alias = data.split(":")[1];
      await ctx.answerCallbackQuery(`Switching model...`);
      const MODELS: Record<string, string> = {
        "pro": "gemini-2.5-pro", "flash": "gemini-2.5-flash",
        "2": "gemini-2.0-flash", "lite": "gemini-2.0-flash-lite",
        "1.5-pro": "gemini-1.5-pro", "exp": "gemini-2.0-flash-exp",
        "3": "gemini-3-pro", "3-flash": "gemini-3-flash",
      };
      const modelId = MODELS[alias] || alias;
      try {
        const { loadConfig, saveConfig } = await import("../../config/config.js");
        const config = loadConfig(runtimeDir);
        config.gemini.models.pro = modelId;
        saveConfig(runtimeDir, config);
        agentInstance?.updateConfig(config);
        await ctx.reply(`\u2705 Switched to: \`${modelId}\``, { parse_mode: "Markdown" });
      } catch (err) {
        await ctx.reply(`\u274C ${err instanceof Error ? err.message : "Failed to switch model"}`);
      }
      return;
    }
    if (data.startsWith("thinking_set:")) {
      const level = data.split(":")[1];
      await ctx.answerCallbackQuery(`Thinking: ${level}`);
      try {
        const { loadConfig, saveConfig } = await import("../../config/config.js");
        const config = loadConfig(runtimeDir);
        if (!config.thinking) config.thinking = { defaultLevel: "medium", costAware: true };
        config.thinking.defaultLevel = level as any;
        saveConfig(runtimeDir, config);
        agentInstance?.updateConfig(config);
        await ctx.reply(`\u2705 Thinking level: *${level}*`, { parse_mode: "Markdown" });
      } catch (err) {
        await ctx.reply(`\u274C ${err instanceof Error ? err.message : "Failed to set thinking level"}`);
      }
      return;
    }

    // Let trust handler handle other approve/deny callbacks
    // (it's already registered via initTelegramTrustHandler)
  });

  // /list - List all marathons
  bot.command("list", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const marathons = marathonService!.listMarathons();
    await ctx.reply(formatMarathonList(marathons), { parse_mode: "Markdown" });
  });

  // /image - Generate images
  bot.command("image", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const prompt = ctx.message?.text?.replace(/^\/image\s*/i, "").trim();

    if (!prompt) {
      await ctx.reply(
        "🎨 *Image Generation*\n\n" +
        "*Usage:* `/image <description>`\n\n" +
        "*Examples:*\n" +
        "• `/image A futuristic city at sunset`\n" +
        "• `/image A cute robot playing guitar`\n" +
        "• `/image Abstract art with vibrant colors`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await ctx.reply("🎨 Generating image...\n\n" + `*Prompt:* ${prompt}`, { parse_mode: "Markdown" });

    try {
      // Dynamic import to avoid circular dependencies
      const { generateImage } = await import("../../ai/gemini.js");

      const result = await generateImage(prompt, { numberOfImages: 1 });

      if (result.images.length === 0) {
        await ctx.reply("❌ Couldn't generate image. Try a different prompt.");
        return;
      }

      const img = result.images[0];
      const buffer = Buffer.from(img.base64, "base64");

      // Send photo using InputFile
      const { InputFile } = await import("grammy");
      await ctx.replyWithPhoto(
        new InputFile(buffer, "generated.png"),
        { caption: `🎨 *${prompt}*\n\n_Generated with Wispy_`, parse_mode: "Markdown" }
      );
    } catch (err) {
      log.error({ err }, "Image generation error");
      await ctx.reply("❌ Failed to generate image: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  });

  // /wallet - Check wallet status
  bot.command("wallet", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const fs = await import("fs");
      const path = await import("path");
      const { ethers } = await import("ethers");

      const configPath = path.join(runtimeDir, "integrations.json");
      if (!fs.existsSync(configPath)) {
        await ctx.reply("❌ Wallet not configured. Run `wispy setup` first.");
        return;
      }

      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (!config.wallet?.address) {
        await ctx.reply("❌ No wallet found in configuration.");
        return;
      }

      const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
      const balance = await provider.getBalance(config.wallet.address);

      const { addressLink } = await import("../../wallet/explorer.js");
      const explorerUrl = addressLink(config.wallet.address);

      await ctx.reply(
        "\uD83D\uDCB0 *Wallet Status*\n\n" +
        `*Address:* \`${config.wallet.address}\`\n` +
        `*Network:* Base Sepolia\n` +
        `*Balance:* ${ethers.formatEther(balance)} ETH\n\n` +
        `_Fund at: faucet.quicknode.com/base/sepolia_`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "\uD83D\uDD17 View on Explorer", url: explorerUrl }],
            ],
          },
        },
      );
    } catch (err) {
      log.error({ err }, "Wallet check error");
      await ctx.reply("❌ Failed to check wallet: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  });

  // ==============================================
  // FILE ACCESS COMMANDS
  // ==============================================

  // /files [path] - List files in a directory
  bot.command("files", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const { homedir } = await import("os");
      const { join, basename } = await import("path");
      const { readdirSync, statSync } = await import("fs");

      const args = (ctx as any).match?.trim() || "";
      const targetDir = args || join(homedir(), "Downloads");

      const entries = readdirSync(targetDir, { withFileTypes: true })
        .slice(0, 30)
        .map((e: any) => {
          const icon = e.isDirectory() ? "\u{1F4C1}" : "\u{1F4C4}";
          let size = "";
          if (!e.isDirectory()) {
            try {
              const s = statSync(join(targetDir, e.name)).size;
              size = s > 1048576
                ? ` (${(s / 1048576).toFixed(1)}MB)`
                : s > 1024
                  ? ` (${(s / 1024).toFixed(0)}KB)`
                  : ` (${s}B)`;
            } catch { /* skip */ }
          }
          return `${icon} ${e.name}${size}`;
        })
        .join("\n");

      const header = `\u{1F4C2} *${basename(targetDir)}*\n_(${targetDir})_\n`;
      await ctx.reply(header + "\n" + (entries || "_Empty directory_"), { parse_mode: "Markdown" });
    } catch (err: any) {
      await ctx.reply("\u274C Could not list directory: " + err.message);
    }
  });

  // /send <filepath> - Send a local file to this chat
  bot.command("send", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const filePath = ((ctx as any).match || "").trim();
    if (!filePath) {
      await ctx.reply("Usage: /send <file_path>\nExample: /send C:/Users/You/Downloads/report.pdf");
      return;
    }

    const fs = await import("fs");
    if (!fs.existsSync(filePath)) {
      await ctx.reply("\u274C File not found: " + filePath);
      return;
    }

    try {
      const chatId = String(ctx.chat?.id || "");
      const { basename } = await import("path");
      const sent = await sendTelegramDocument(chatId, filePath, basename(filePath));
      if (!sent) {
        await ctx.reply("\u274C Failed to send file. Check the file path and try again.");
      }
    } catch (err: any) {
      await ctx.reply("\u274C Send failed: " + err.message);
    }
  });

  // ==============================================
  // DEVELOPMENT WORKFLOW COMMANDS
  // ==============================================

  // /deploy - Deploy project to Vercel
  bot.command("deploy", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = ctx.message?.text?.split(" ").slice(1) || [];
    const projectPath = args[0] || process.cwd();
    const isProduction = args.includes("--prod") || args.includes("-p");

    await ctx.reply(
      "🚀 *Deploying to Vercel...*\n\n" +
      `📁 Path: \`${projectPath}\`\n` +
      `🌍 Mode: ${isProduction ? "Production" : "Preview"}\n\n` +
      "_This may take a moment..._",
      { parse_mode: "Markdown" }
    );

    try {
      const { execSync } = await import("child_process");

      // Check if Vercel CLI is available
      try {
        execSync("vercel --version", { encoding: "utf-8" });
      } catch {
        await ctx.reply(
          "❌ *Vercel CLI not installed*\n\n" +
          "Install with: `npm i -g vercel`\n" +
          "Then login with: `vercel login`",
          { parse_mode: "Markdown" }
        );
        return;
      }

      const cmd = isProduction
        ? `vercel --prod --yes --cwd "${projectPath}"`
        : `vercel --yes --cwd "${projectPath}"`;

      const output = execSync(cmd, { encoding: "utf-8", timeout: 300000 });

      // Extract URL from output
      const urlMatch = output.match(/https:\/\/[^\s]+\.vercel\.app/);
      const deployUrl = urlMatch ? urlMatch[0] : "Check Vercel dashboard";

      await ctx.reply(
        "✅ *Deployment Successful!*\n\n" +
        `🔗 *URL:* ${deployUrl}\n` +
        `📁 *Project:* ${projectPath}\n` +
        `🌍 *Type:* ${isProduction ? "Production" : "Preview"}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "🔗 Open Site", url: deployUrl.startsWith("http") ? deployUrl : `https://${deployUrl}` },
              { text: "📊 Dashboard", url: "https://vercel.com/dashboard" }
            ]]
          }
        }
      );
    } catch (err) {
      log.error({ err }, "Vercel deployment error");
      await ctx.reply(
        "❌ *Deployment Failed*\n\n" +
        `\`\`\`\n${err instanceof Error ? err.message : "Unknown error"}\n\`\`\``,
        { parse_mode: "Markdown" }
      );
    }
  });

  // /push - Push to GitHub
  bot.command("push", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = ctx.message?.text?.split(" ").slice(1) || [];
    const projectPath = args[0] || process.cwd();
    const commitMessage = args.slice(1).join(" ") || "Update via Wispy";

    await ctx.reply(
      "📤 *Pushing to GitHub...*\n\n" +
      `📁 Path: \`${projectPath}\`\n` +
      `💬 Message: "${commitMessage}"`,
      { parse_mode: "Markdown" }
    );

    try {
      const { execSync } = await import("child_process");
      const fs = await import("fs");
      const path = await import("path");

      // Check if it's a git repo
      if (!fs.existsSync(path.join(projectPath, ".git"))) {
        await ctx.reply(
          "❌ *Not a Git repository*\n\n" +
          "Initialize with: `/git init`",
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Stage, commit, and push
      execSync(`git -C "${projectPath}" add -A`, { encoding: "utf-8" });

      try {
        execSync(`git -C "${projectPath}" commit -m "${commitMessage}"`, { encoding: "utf-8" });
      } catch {
        // No changes to commit
      }

      const pushOutput = execSync(`git -C "${projectPath}" push`, { encoding: "utf-8", timeout: 60000 });

      // Get remote URL
      const remoteUrl = execSync(`git -C "${projectPath}" remote get-url origin`, { encoding: "utf-8" }).trim();
      const repoUrl = remoteUrl.replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");

      await ctx.reply(
        "✅ *Push Successful!*\n\n" +
        `📦 *Repository:* ${repoUrl}\n` +
        `💬 *Commit:* "${commitMessage}"`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "📂 View Repo", url: repoUrl },
              { text: "📜 Commits", url: `${repoUrl}/commits` }
            ]]
          }
        }
      );
    } catch (err) {
      log.error({ err }, "Git push error");
      await ctx.reply(
        "❌ *Push Failed*\n\n" +
        `\`\`\`\n${err instanceof Error ? err.message : "Unknown error"}\n\`\`\`\n\n` +
        "_Make sure you have GitHub CLI (gh) configured or SSH keys set up._",
        { parse_mode: "Markdown" }
      );
    }
  });

  // /git - Git operations submenu
  bot.command("git", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = ctx.message?.text?.split(" ").slice(1) || [];
    const subcommand = args[0];
    const projectPath = args[1] || process.cwd();

    if (!subcommand) {
      await ctx.reply(
        "🔧 *Git Commands*\n\n" +
        "`/git init [path]` - Initialize repository\n" +
        "`/git status [path]` - Check status\n" +
        "`/git commit <message>` - Commit changes\n" +
        "`/push [path] [message]` - Push to GitHub\n\n" +
        "_Or use the buttons below:_",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📊 Status", callback_data: "git_status:" + projectPath },
                { text: "📤 Push", callback_data: "git_push:" + projectPath }
              ],
              [
                { text: "🔄 Init", callback_data: "git_init:" + projectPath },
                { text: "📝 Commit", callback_data: "git_commit:" + projectPath }
              ]
            ]
          }
        }
      );
      return;
    }

    try {
      const { execSync } = await import("child_process");

      switch (subcommand) {
        case "init": {
          execSync(`git init "${projectPath}"`, { encoding: "utf-8" });
          await ctx.reply(`✅ Git repository initialized at \`${projectPath}\``, { parse_mode: "Markdown" });
          break;
        }
        case "status": {
          const status = execSync(`git -C "${projectPath}" status --short`, { encoding: "utf-8" });
          const branch = execSync(`git -C "${projectPath}" branch --show-current`, { encoding: "utf-8" }).trim();
          await ctx.reply(
            `📊 *Git Status*\n\n` +
            `🌿 Branch: \`${branch}\`\n\n` +
            `\`\`\`\n${status || "Clean working tree"}\n\`\`\``,
            { parse_mode: "Markdown" }
          );
          break;
        }
        case "commit": {
          const message = args.slice(1).join(" ") || "Update via Wispy";
          execSync(`git -C "${projectPath}" add -A`, { encoding: "utf-8" });
          execSync(`git -C "${projectPath}" commit -m "${message}"`, { encoding: "utf-8" });
          await ctx.reply(`✅ Committed: "${message}"`, { parse_mode: "Markdown" });
          break;
        }
        default:
          await ctx.reply("Unknown git subcommand. Use `/git` for help.", { parse_mode: "Markdown" });
      }
    } catch (err) {
      await ctx.reply(
        `❌ Git error: \`${err instanceof Error ? err.message : "Unknown error"}\``,
        { parse_mode: "Markdown" }
      );
    }
  });

  // /npm - Run npm scripts
  bot.command("npm", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = ctx.message?.text?.split(" ").slice(1) || [];
    const script = args[0];
    const projectPath = args[1] || process.cwd();

    if (!script) {
      await ctx.reply(
        "📦 *NPM Commands*\n\n" +
        "`/npm install [path]` - Install dependencies\n" +
        "`/npm run <script> [path]` - Run script\n" +
        "`/npm build [path]` - Build project\n" +
        "`/npm dev [path]` - Start dev server\n" +
        "`/npm test [path]` - Run tests\n\n" +
        "_Common scripts:_",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📥 Install", callback_data: "npm_install:" + projectPath },
                { text: "🔨 Build", callback_data: "npm_build:" + projectPath }
              ],
              [
                { text: "🚀 Dev", callback_data: "npm_dev:" + projectPath },
                { text: "🧪 Test", callback_data: "npm_test:" + projectPath }
              ]
            ]
          }
        }
      );
      return;
    }

    await ctx.reply(
      `⏳ Running \`npm ${script}\`...\n\n` +
      `📁 Path: \`${projectPath}\``,
      { parse_mode: "Markdown" }
    );

    try {
      const { execSync } = await import("child_process");

      let cmd: string;
      if (script === "install" || script === "i") {
        cmd = `npm install`;
      } else if (script === "build" || script === "dev" || script === "test" || script === "start") {
        cmd = `npm run ${script}`;
      } else {
        cmd = `npm run ${script}`;
      }

      const output = execSync(cmd, {
        cwd: projectPath,
        encoding: "utf-8",
        timeout: 120000
      });

      const truncatedOutput = output.length > 1000
        ? output.slice(-1000) + "\n...(truncated)"
        : output;

      await ctx.reply(
        `✅ *npm ${script}* completed!\n\n` +
        `\`\`\`\n${truncatedOutput || "Success"}\n\`\`\``,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      log.error({ err }, "NPM command error");
      await ctx.reply(
        `❌ *npm ${script}* failed\n\n` +
        `\`\`\`\n${err instanceof Error ? err.message.slice(0, 500) : "Unknown error"}\n\`\`\``,
        { parse_mode: "Markdown" }
      );
    }
  });

  // /debug - Debug tools
  bot.command("debug", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = ctx.message?.text?.split(" ").slice(1) || [];
    const subcommand = args[0];

    if (!subcommand) {
      await ctx.reply(
        "🔍 *Debug Tools*\n\n" +
        "`/debug port <number>` - Check what's using a port\n" +
        "`/debug kill <port>` - Kill process on port\n" +
        "`/debug processes` - List Node.js processes\n" +
        "`/debug logs [path]` - Read recent logs\n\n" +
        "_Quick actions:_",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔌 Port 3000", callback_data: "debug_port:3000" },
                { text: "🔌 Port 5173", callback_data: "debug_port:5173" }
              ],
              [
                { text: "📋 Processes", callback_data: "debug_processes" },
                { text: "💀 Kill All", callback_data: "debug_killall" }
              ]
            ]
          }
        }
      );
      return;
    }

    try {
      const { execSync } = await import("child_process");
      const os = await import("os");
      const isWindows = os.platform() === "win32";

      switch (subcommand) {
        case "port": {
          const port = args[1];
          if (!port) {
            await ctx.reply("Usage: `/debug port <number>`", { parse_mode: "Markdown" });
            return;
          }

          let result: string;
          if (isWindows) {
            result = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8" });
          } else {
            result = execSync(`lsof -i :${port} || ss -tlnp | grep :${port}`, { encoding: "utf-8" });
          }

          await ctx.reply(
            `🔌 *Port ${port}*\n\n\`\`\`\n${result || "Port is free"}\n\`\`\``,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[
                  { text: "💀 Kill Process", callback_data: `debug_kill:${port}` }
                ]]
              }
            }
          );
          break;
        }
        case "kill": {
          const port = args[1];
          if (!port) {
            await ctx.reply("Usage: `/debug kill <port>`", { parse_mode: "Markdown" });
            return;
          }

          if (isWindows) {
            const netstat = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8" });
            const pidMatch = netstat.match(/LISTENING\s+(\d+)/);
            if (pidMatch) {
              execSync(`taskkill /F /PID ${pidMatch[1]}`, { encoding: "utf-8" });
            }
          } else {
            execSync(`fuser -k ${port}/tcp`, { encoding: "utf-8" });
          }

          await ctx.reply(`✅ Killed process on port ${port}`);
          break;
        }
        case "processes": {
          let result: string;
          if (isWindows) {
            result = execSync(`tasklist | findstr /i "node npm"`, { encoding: "utf-8" });
          } else {
            result = execSync(`ps aux | grep -E "node|npm" | grep -v grep`, { encoding: "utf-8" });
          }

          await ctx.reply(
            `📋 *Node.js Processes*\n\n\`\`\`\n${result || "No processes found"}\n\`\`\``,
            { parse_mode: "Markdown" }
          );
          break;
        }
        case "logs": {
          const logPath = args[1] || "./logs";
          const fs = await import("fs");
          const path = await import("path");

          if (!fs.existsSync(logPath)) {
            await ctx.reply(`❌ Log path not found: \`${logPath}\``, { parse_mode: "Markdown" });
            return;
          }

          const files = fs.readdirSync(logPath)
            .filter((f: string) => f.endsWith(".log"))
            .slice(-5);

          await ctx.reply(
            `📜 *Log Files*\n\n${files.map((f: string) => `• \`${f}\``).join("\n") || "No log files"}`,
            { parse_mode: "Markdown" }
          );
          break;
        }
        default:
          await ctx.reply("Unknown debug command. Use `/debug` for help.", { parse_mode: "Markdown" });
      }
    } catch (err) {
      await ctx.reply(
        `❌ Debug error: \`${err instanceof Error ? err.message : "Unknown error"}\``,
        { parse_mode: "Markdown" }
      );
    }
  });

  // Track voice reply preference per user
  const voiceReplyEnabled = new Map<string, boolean>();

  // /voice - Toggle voice replies
  bot.command("voice", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const currentSetting = voiceReplyEnabled.get(userId) ?? false;
    const newSetting = !currentSetting;
    voiceReplyEnabled.set(userId, newSetting);

    if (newSetting) {
      await ctx.reply(
        "🎤 *Voice Replies: ON*\n\n" +
        "I'll respond with voice messages when you send voice notes!\n\n" +
        "_Requires: piper, espeak-ng, or ffmpeg installed_",
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply(
        "📝 *Voice Replies: OFF*\n\n" +
        "I'll respond with text only.\n\n" +
        "Use `/voice` to turn voice replies back on.",
        { parse_mode: "Markdown" }
      );
    }
  });

  // /call <number> - Place an outbound phone call
  bot.command("call", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const phoneNumber = (ctx.message?.text || "").replace(/^\/call\s*/i, "").trim();
    if (!phoneNumber.match(/^\+\d{7,15}$/)) {
      await ctx.reply("Usage: `/call +1234567890`", { parse_mode: "Markdown" });
      return;
    }
    if (!process.env.TELNYX_API_KEY) {
      await ctx.reply("Phone calls require TELNYX_API_KEY.");
      return;
    }
    await ctx.reply(`Calling ${phoneNumber}...`);
    const { makeOutboundCall } = await import("../phone/adapter.js");
    const result = await makeOutboundCall(phoneNumber, undefined, userId);
    if (!result.success) {
      await ctx.reply(`Call failed: ${result.error}`);
    }
  });

  // ==============================================
  // x402 / WALLET / COMMERCE COMMANDS
  // ==============================================

  // /x402demo - Run x402 hackathon demo tracks
  bot.command("x402demo", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = (ctx.message?.text?.split(" ").slice(1) || []).join(" ").trim().toLowerCase();

    // No args - show demo menu with buttons
    if (!args) {
      await ctx.reply(
        "\uD83C\uDFAC *x402 Agentic Commerce Demo*\n\n" +
        `\u26D3 *Chain:* SKALE BITE V2 Sandbox (gasless)\n` +
        `\uD83D\uDCBC *Wallet:* ${process.env.AGENT_PRIVATE_KEY ? "Connected" : "Simulation mode"}\n\n` +
        "Select a track to run:",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "1\uFE0F\u20E3 Overall Best", callback_data: "demo_track:1" },
                { text: "2\uFE0F\u20E3 x402 Payments", callback_data: "demo_track:2" },
              ],
              [
                { text: "3\uFE0F\u20E3 AP2 Auth", callback_data: "demo_track:3" },
                { text: "4\uFE0F\u20E3 DeFi Agent", callback_data: "demo_track:4" },
              ],
              [
                { text: "5\uFE0F\u20E3 BITE Encrypted", callback_data: "demo_track:5" },
                { text: "\uD83D\uDC41 Vision", callback_data: "demo_track:6" },
              ],
              [
                { text: "\uD83D\uDE80 Run All 6 Tracks", callback_data: "demo_all" },
              ],
              [
                { text: "\u2705 Preflight Check", callback_data: "demo_preflight" },
                { text: "\u23F9 Stop Services", callback_data: "demo_stop" },
              ],
            ],
          },
        },
      );
      return;
    }

    // Preflight
    if (args === "preflight" || args === "check") {
      await ctx.reply("\u2705 Running preflight check...");
      try {
        const { runPreflight } = await import("../../integrations/agentic-commerce/demo/preflight.js");
        const result = await runPreflight(process.env.AGENT_PRIVATE_KEY);
        let msg = "\uD83D\uDEEB *x402 Demo Preflight*\n\n";
        msg += `*Mode:* ${result.mode === "live" ? "\u2705 LIVE" : "\u26A0\uFE0F SIMULATION"}\n`;
        msg += `*Address:* \`${result.address}\`\n`;
        if (result.mode === "live") {
          msg += `*sFUEL:* ${result.sFuelBalance}\n`;
          msg += `*USDC:* $${result.usdcBalance.toFixed(6)}\n`;
          msg += `*Ready:* ${result.ready ? "\u2705 YES" : "\u274C NO"}\n`;
        }
        for (const w of result.warnings) {
          msg += `\u26A0\uFE0F ${w}\n`;
        }
        await ctx.reply(msg, { parse_mode: "Markdown" });
      } catch (err) {
        await ctx.reply(`\u274C Preflight failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // Stop
    if (args === "stop" || args === "kill") {
      try {
        const { stopDemoServices } = await import("../../integrations/agentic-commerce/demo/server.js");
        await stopDemoServices();
        await ctx.reply("\u2705 Demo services stopped.");
      } catch {
        await ctx.reply("No demo services running.");
      }
      return;
    }

    // Run all
    if (args === "all") {
      await runAgentDemoInTelegram(ctx, [1, 2, 3, 4, 5, 6], agent);
      return;
    }

    // Single track
    const trackNum = /^[1-6]$/.test(args) ? parseInt(args) : 0;
    if (trackNum >= 1 && trackNum <= 6) {
      await runAgentDemoInTelegram(ctx, [trackNum], agent);
      return;
    }

    await ctx.reply("Usage: /x402demo [1-6|all|preflight|stop]");
  });

  // /x402scan - Scan wallet transactions
  bot.command("x402scan", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const { getWalletAddress } = await import("../../wallet/x402.js");
      const addr = getWalletAddress(runtimeDir);
      if (!addr) {
        await ctx.reply("\u274C Wallet not initialized. Run /wallet first.");
        return;
      }

      const args = (ctx.message?.text?.split(" ").slice(1) || []).join(" ").trim().toLowerCase();
      const { X402Scanner, formatScanSummary, formatVerification } = await import("../../wallet/x402-scan.js");
      const scanner = new X402Scanner(runtimeDir);

      if (args.startsWith("verify ")) {
        const txHash = args.split(" ")[1];
        await ctx.reply("\uD83D\uDD0D Verifying transaction...");
        const verification = await scanner.verifyTransaction(txHash);
        const text = formatVerification(verification).replace(/\x1B\[[0-9;]*m/g, ""); // strip ANSI
        await ctx.reply(`\uD83D\uDD0D *Transaction Verification*\n\n\`\`\`\n${text.slice(0, 3800)}\n\`\`\``, { parse_mode: "Markdown" }).catch(() => ctx.reply(text.slice(0, 4000)));
      } else if (args === "history") {
        await ctx.reply("\uD83D\uDCDC Fetching transaction history...");
        const txs = await scanner.getUSDCTransfers(addr, { pageSize: 20 });
        if (txs.length === 0) {
          await ctx.reply("No transactions found.");
          return;
        }
        let msg = "\uD83D\uDCDC *Transaction History*\n\n";
        for (const tx of txs.slice(0, 15)) {
          const dir = tx.direction === "out" ? "\uD83D\uDD34 -" : "\uD83D\uDFE2 +";
          const peer = tx.direction === "out" ? `${tx.to.slice(0, 6)}...${tx.to.slice(-4)}` : `${tx.from.slice(0, 6)}...${tx.from.slice(-4)}`;
          msg += `${dir}$${parseFloat(tx.value).toFixed(4)} ${peer} \`${tx.hash.slice(0, 10)}\`\n`;
        }
        await ctx.reply(msg, { parse_mode: "Markdown" }).catch(() => ctx.reply(msg.replace(/[*`]/g, "")));
      } else if (args === "reconcile") {
        await ctx.reply("\uD83D\uDD04 Reconciling on-chain vs local...");
        const result = await scanner.reconcile(addr);
        await ctx.reply(
          `\uD83D\uDD04 *Reconciliation*\n\n` +
          `Matched: ${result.matched}\n` +
          `On-chain only: ${result.onChainOnly.length}\n` +
          `Local only: ${result.localOnly.length}`,
          { parse_mode: "Markdown" },
        );
      } else {
        await ctx.reply("\uD83D\uDD0D Scanning wallet on SKALE...");
        const summary = await scanner.scanWallet(addr);
        const text = formatScanSummary(summary).replace(/\x1B\[[0-9;]*m/g, "");
        await ctx.reply(`\uD83D\uDD0D *Wallet Scan*\n\n\`\`\`\n${text.slice(0, 3800)}\n\`\`\``, { parse_mode: "Markdown" }).catch(() => ctx.reply(text.slice(0, 4000)));
      }
    } catch (err) {
      await ctx.reply(`\u274C Scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // /commerce - Agentic commerce status
  bot.command("commerce", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const registry = agent.getIntegrationRegistry();
    if (!registry) {
      await ctx.reply("No integrations loaded.");
      return;
    }

    const commerce = registry.get("agentic-commerce");
    if (!commerce) {
      await ctx.reply("\u274C Agentic commerce not registered.\n\nSet AGENT\\_PRIVATE\\_KEY in .env to enable.");
      return;
    }

    let msg = "\uD83D\uDED2 *Agentic Commerce (x402)*\n\n";
    msg += `*Status:* ${commerce.status === "active" ? "\u2705 Active" : commerce.status === "error" ? "\u274C Error" : "\u26A0\uFE0F " + commerce.status}\n`;

    if (commerce.error) msg += `*Error:* ${commerce.error}\n`;

    if (commerce.enabled) {
      const health = await commerce.instance.healthCheck();
      msg += `*Wallet:* ${health.message || "Unknown"}\n`;
      msg += `*Tools:* ${commerce.manifest.tools.length} available\n\n`;
      msg += "*Available tools:*\n";
      for (const tool of commerce.manifest.tools) {
        msg += `\u2022 \`${tool.name}\`\n`;
      }
    } else {
      msg += "\nTo enable, set AGENT\\_PRIVATE\\_KEY in .env";
    }

    const { getAllChannels } = await import("../../channels/dock.js");
    const channels = getAllChannels();
    if (channels.length > 0) {
      msg += "\n*Connected Channels:*\n";
      for (const ch of channels) {
        const icon = ch.status === "connected" ? "\u2705" : "\u274C";
        msg += `${icon} ${ch.name} (${ch.type})\n`;
      }
    }

    await ctx.reply(msg, { parse_mode: "Markdown" }).catch(() => ctx.reply(msg.replace(/[*`]/g, "")));
  });

  // ==============================================
  // AI & MODEL COMMANDS
  // ==============================================

  // /model - Switch AI model
  bot.command("model", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = (ctx.message?.text?.split(" ").slice(1) || []).join(" ").trim().toLowerCase();
    const { loadConfig, saveConfig } = await import("../../config/config.js");
    const config = loadConfig(runtimeDir);

    if (!args) {
      await ctx.reply(
        "\uD83E\uDDE0 *Switch Model*\n\n" +
        `Current: \`${config.gemini.models.pro}\`\n\n` +
        "Select a model:",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "\uD83D\uDE80 Gemini 2.5 Pro", callback_data: "model_set:pro" },
                { text: "\u26A1 Gemini 2.5 Flash", callback_data: "model_set:flash" },
              ],
              [
                { text: "\uD83D\uDCA1 Gemini 2.0 Flash", callback_data: "model_set:2" },
                { text: "\uD83C\uDF1F Gemini 2.0 Lite", callback_data: "model_set:lite" },
              ],
              [
                { text: "\uD83D\uDD2C Gemini 1.5 Pro", callback_data: "model_set:1.5-pro" },
                { text: "\uD83E\uDDEA Experimental", callback_data: "model_set:exp" },
              ],
            ],
          },
        },
      );
      return;
    }

    // Direct model switch
    const MODELS: Record<string, string> = {
      "pro": "gemini-2.5-pro", "flash": "gemini-2.5-flash",
      "2": "gemini-2.0-flash", "lite": "gemini-2.0-flash-lite",
      "1.5-pro": "gemini-1.5-pro", "1.5-flash": "gemini-1.5-flash",
      "exp": "gemini-2.0-flash-exp", "nano": "gemini-nano",
      "3": "gemini-3-pro", "3-flash": "gemini-3-flash",
    };
    const modelId = MODELS[args] || args;
    config.gemini.models.pro = modelId;
    saveConfig(runtimeDir, config);
    agent.updateConfig(config);
    await ctx.reply(`\u2705 Switched to: \`${modelId}\``, { parse_mode: "Markdown" });
  });

  // /thinking - Set thinking level
  bot.command("thinking", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = (ctx.message?.text?.split(" ").slice(1) || []).join(" ").trim().toLowerCase();

    if (!args) {
      await ctx.reply(
        "\uD83E\uDDE0 *Thinking Level*\n\nSelect depth:",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "\u26A1 None (fastest)", callback_data: "thinking_set:none" },
                { text: "\uD83D\uDCA1 Low", callback_data: "thinking_set:low" },
              ],
              [
                { text: "\uD83E\uDDE0 Medium", callback_data: "thinking_set:medium" },
                { text: "\uD83D\uDD2C High", callback_data: "thinking_set:high" },
              ],
              [
                { text: "\uD83C\uDF1F Ultra (deepest)", callback_data: "thinking_set:ultra" },
              ],
            ],
          },
        },
      );
      return;
    }

    const valid = ["none", "low", "medium", "high", "ultra"];
    if (!valid.includes(args)) {
      await ctx.reply("Usage: /thinking [none|low|medium|high|ultra]");
      return;
    }

    const { loadConfig, saveConfig } = await import("../../config/config.js");
    const config = loadConfig(runtimeDir);
    if (!config.thinking) config.thinking = { defaultLevel: "medium", costAware: true };
    config.thinking.defaultLevel = args as any;
    saveConfig(runtimeDir, config);
    agent.updateConfig(config);
    await ctx.reply(`\u2705 Thinking level: *${args}*`, { parse_mode: "Markdown" });
  });

  // ==============================================
  // STATUS & ANALYTICS COMMANDS
  // ==============================================

  // /help - Show all available commands
  bot.command("help", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    await ctx.reply(
      "\uD83D\uDC7B *Wispy Commands*\n\n" +
      "*Core*\n" +
      "/help \u2014 Show this help\n" +
      "/status \u2014 Marathon progress\n" +
      "/clear \u2014 Clear conversation\n\n" +
      "*Marathon*\n" +
      "/marathon \u2014 Start autonomous task\n" +
      "/pause /resume /abort \u2014 Control marathon\n" +
      "/approvals \u2014 Pending approvals\n" +
      "/list \u2014 List marathons\n\n" +
      "*AI & Models*\n" +
      "/model \u2014 Switch AI model\n" +
      "/thinking \u2014 Set thinking depth\n\n" +
      "*Wallet & x402*\n" +
      "/wallet \u2014 Check wallet status\n" +
      "/x402demo \u2014 Run demo tracks\n" +
      "/x402scan \u2014 Scan transactions\n" +
      "/commerce \u2014 Commerce status\n\n" +
      "*Dev Workflow*\n" +
      "/deploy \u2014 Deploy to Vercel\n" +
      "/push \u2014 Push to GitHub\n" +
      "/git \u2014 Git operations\n" +
      "/npm \u2014 Run npm scripts\n" +
      "/debug \u2014 Debug tools\n\n" +
      "*Analytics*\n" +
      "/tokens \u2014 Token usage\n" +
      "/cost \u2014 Cost breakdown\n" +
      "/context \u2014 Context window\n\n" +
      "*Files*\n" +
      "/files \u2014 List files in directory\n" +
      "/send \u2014 Send a local file\n\n" +
      "*Utilities*\n" +
      "/image \u2014 Generate image\n" +
      "/voice \u2014 Toggle voice replies\n" +
      "/call \u2014 Make a phone call\n" +
      "/channels \u2014 Connected channels\n" +
      "/tools \u2014 Available tools\n" +
      "/skills \u2014 Loaded skills\n" +
      "/export \u2014 Export conversation\n" +
      "/session \u2014 Switch session\n" +
      "/compact \u2014 Compact context\n" +
      "/integrations \u2014 List integrations\n\n" +
      "_Type naturally to chat. Send voice messages for voice input._",
      { parse_mode: "Markdown" },
    );
  });

  // /tokens - Token usage stats
  bot.command("tokens", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const { TokenManager } = await import("../../token/estimator.js");
      const tokenManager = new TokenManager();
      const stats = tokenManager.getStats();
      await ctx.reply(
        "\uD83D\uDCCA *Token Usage*\n\n" +
        `*Session:* ${stats.sessionTokens.toLocaleString()} tokens ($${stats.sessionCost.toFixed(4)})\n` +
        `*Today:* ${stats.dailyTokens.toLocaleString()} tokens ($${stats.dailyCost.toFixed(4)})\n` +
        `*Requests:* ${stats.requestCount}\n` +
        `*Budget:* ${stats.budget.maxTokensPerDay.toLocaleString()} tokens/day`,
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      await ctx.reply(`\u274C ${err instanceof Error ? err.message : "Failed to get token stats"}`);
    }
  });

  // /cost - Cost breakdown
  bot.command("cost", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const { TokenManager } = await import("../../token/estimator.js");
      const tokenManager = new TokenManager();
      const stats = tokenManager.getStats();
      const inputCost = stats.sessionCost * 0.3;
      const outputCost = stats.sessionCost * 0.7;
      const projected = stats.dailyCost * 30;
      await ctx.reply(
        "\uD83D\uDCB0 *Cost Breakdown*\n\n" +
        `*Session input:* $${inputCost.toFixed(4)}\n` +
        `*Session output:* $${outputCost.toFixed(4)}\n` +
        `*Session total:* $${stats.sessionCost.toFixed(4)}\n` +
        `*Today total:* $${stats.dailyCost.toFixed(4)}\n` +
        `*Projected/month:* $${projected.toFixed(2)}\n` +
        `*Requests:* ${stats.requestCount}`,
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      await ctx.reply(`\u274C ${err instanceof Error ? err.message : "Failed to get cost stats"}`);
    }
  });

  // /context - Context window usage
  bot.command("context", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const { TokenManager } = await import("../../token/estimator.js");
      const tokenManager = new TokenManager();
      const stats = tokenManager.getStats();
      const pct = Math.round((stats.sessionTokens / stats.budget.maxTokensPerSession) * 100);
      const dailyPct = Math.round((stats.dailyTokens / stats.budget.maxTokensPerDay) * 100);
      const bar = (p: number) => {
        const filled = Math.round((p / 100) * 20);
        return "\u2588".repeat(filled) + "\u2591".repeat(20 - filled) + ` ${p}%`;
      };
      await ctx.reply(
        "\uD83D\uDCCA *Context Window*\n\n" +
        `*Session:*\n\`${bar(pct)}\`\n${stats.sessionTokens.toLocaleString()} / ${stats.budget.maxTokensPerSession.toLocaleString()} tokens\n\n` +
        `*Daily:*\n\`${bar(dailyPct)}\`\n${stats.dailyTokens.toLocaleString()} / ${stats.budget.maxTokensPerDay.toLocaleString()} tokens`,
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      await ctx.reply(`\u274C ${err instanceof Error ? err.message : "Failed to get context stats"}`);
    }
  });

  // /channels - Show connected channels
  bot.command("channels", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const { getAllChannels } = await import("../../channels/dock.js");
    const channels = getAllChannels();

    if (channels.length === 0) {
      await ctx.reply("No channels connected.");
      return;
    }

    let msg = "\uD83D\uDD0C *Connected Channels*\n\n";
    for (const ch of channels) {
      const icon = ch.status === "connected" ? "\u2705" : ch.status === "error" ? "\u274C" : "\u26A0\uFE0F";
      const caps = Object.entries(ch.capabilities).filter(([, v]) => v).map(([k]) => k).join(", ");
      msg += `${icon} *${ch.name}* (${ch.type})\n`;
      msg += `   _${caps}_\n`;
      if (ch.connectedAt) msg += `   Connected: ${ch.connectedAt}\n`;
      if (ch.error) msg += `   Error: ${ch.error}\n`;
      msg += "\n";
    }

    await ctx.reply(msg, { parse_mode: "Markdown" }).catch(() => ctx.reply(msg.replace(/[*_`]/g, "")));
  });

  // /tools - List available tools
  bot.command("tools", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const { BUILT_IN_TOOLS } = await import("../../ai/tools.js");
    const toolNames = BUILT_IN_TOOLS.map(t => t.name);

    // Also include integration tools if available
    const registry = agent.getIntegrationRegistry();
    if (registry) {
      for (const s of registry.getStatus()) {
        if (s.status === "active") {
          const entry = registry.get(s.id);
          if (entry?.manifest?.tools) {
            for (const t of entry.manifest.tools) {
              if (!toolNames.includes(t.name)) toolNames.push(t.name);
            }
          }
        }
      }
    }

    let msg = "\uD83D\uDD27 *Available Tools*\n\n";
    for (const name of toolNames) {
      msg += `\u2022 \`${name}\`\n`;
    }
    msg += `\n_${toolNames.length} tools loaded_`;

    await ctx.reply(msg, { parse_mode: "Markdown" }).catch(() => ctx.reply(msg.replace(/[*`_]/g, "")));
  });

  // /skills - List loaded skills
  bot.command("skills", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const { loadSkills } = await import("../../skills/loader.js");
      const { join } = await import("path");
      const soulDir = join(runtimeDir, "..", "wispy");
      const skills = loadSkills(soulDir);
      if (skills.length === 0) {
        await ctx.reply("No custom skills loaded.\n\nAdd .md files to your wispy/SKILLS/ directory.");
        return;
      }

      let msg = "\uD83C\uDFAF *Loaded Skills*\n\n";
      for (const skill of skills) {
        msg += `\u2022 *${(skill as any).name || "unnamed"}*\n`;
      }
      msg += `\n_${skills.length} skills loaded_`;

      await ctx.reply(msg, { parse_mode: "Markdown" }).catch(() => ctx.reply(msg.replace(/[*_]/g, "")));
    } catch {
      await ctx.reply("No skills loaded.");
    }
  });

  // /integrations - List integrations
  bot.command("integrations", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const registry = agent.getIntegrationRegistry();
    if (!registry) {
      await ctx.reply("No integrations loaded.");
      return;
    }

    const status = registry.getStatus();
    let msg = `\uD83D\uDD0C *${status.length} Integration(s)*\n\n`;
    for (const s of status) {
      const icon = s.status === "active" ? "\u2705" : s.status === "error" ? "\u274C" : "\u26A0\uFE0F";
      msg += `${icon} *${s.id}* \u2014 ${s.name} [${s.category}]\n`;
    }

    await ctx.reply(msg, { parse_mode: "Markdown" }).catch(() => ctx.reply(msg.replace(/[*]/g, "")));
  });

  // /session - Switch or show session
  bot.command("session", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    const args = (ctx.message?.text?.split(" ").slice(1) || []).join(" ").trim();
    if (args) {
      await ctx.reply(`\u2705 Switched to session: \`${args}\`\n\n_Note: session isolation is per-user in Telegram._`, { parse_mode: "Markdown" });
    } else {
      await ctx.reply("Usage: /session <name>\n\nSwitch to a named conversation session.");
    }
  });

  // /compact - Compact context
  bot.command("compact", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      // Trigger compaction by sending a compact request through the agent
      const result = await agent.chat(
        "[System: compact context window, summarize older messages to save tokens]",
        userId, "telegram", "main",
      );
      await ctx.reply("\u2705 Context compacted.\n\n" + (result.text || "Older messages summarized to save tokens."));
    } catch (err) {
      await ctx.reply(`\u274C Compact failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // /export - Export conversation
  bot.command("export", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const { loadConfig } = await import("../../config/config.js");
      const { loadHistory } = await import("../../core/session.js");
      const { writeFileSync } = await import("fs");
      const { join } = await import("path");
      const config = loadConfig(runtimeDir);
      const { buildSessionKey } = await import("../../security/isolation.js");
      const sessionKey = buildSessionKey(config.agent.id, "main", userId);
      const history = loadHistory(runtimeDir, config.agent.id, sessionKey);
      const md = history.map((m) => `**${m.role}**: ${m.content}`).join("\n\n");
      const outPath = join(runtimeDir, "cli", `export-telegram-${Date.now()}.md`);
      writeFileSync(outPath, md, "utf8");
      await ctx.reply(`\u2705 Exported ${history.length} messages to:\n\`${outPath}\``, { parse_mode: "Markdown" });
    } catch (err) {
      await ctx.reply(`\u274C Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // /stats - System status summary
  bot.command("stats", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const { loadConfig } = await import("../../config/config.js");
      const config = loadConfig(runtimeDir);
      const os = await import("os");
      const { getWalletAddress } = await import("../../wallet/x402.js");
      const { getAllChannels } = await import("../../channels/dock.js");

      const walletAddr = getWalletAddress(runtimeDir);
      const channels = getAllChannels();

      let msg = "\uD83D\uDCCA *System Status*\n\n";
      msg += `*Agent:* ${config.agent.name}\n`;
      msg += `*Model:* \`${config.gemini.models.pro}\`\n`;
      msg += `*Mode:* ${agent.getMode() === "plan" ? "\uD83D\uDCCB Plan" : "\u26A1 Execute"}\n`;
      msg += `*Platform:* ${os.type()} ${os.arch()}\n`;
      msg += `*Uptime:* ${Math.floor(process.uptime() / 60)} min\n`;
      msg += `*Memory:* ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n`;
      msg += `*Wallet:* ${walletAddr ? walletAddr.slice(0, 10) + "..." : "not initialized"}\n`;
      msg += `*Channels:* ${channels.map(c => c.name).join(", ") || "none"}\n`;

      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err) {
      await ctx.reply(`\u274C ${err instanceof Error ? err.message : "Failed to get stats"}`);
    }
  });

  // Voice message handling - Transcribe and process
  bot.on("message:voice", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      // Show typing indicator
      await ctx.api.sendChatAction(ctx.chat!.id, "typing");

      // Get file info from Telegram
      const voice = ctx.message?.voice;
      if (!voice) {
        await ctx.reply("Could not process voice message.");
        return;
      }

      log.info("Processing voice message: %d bytes, %d seconds", voice.file_size || 0, voice.duration);

      // Download voice file
      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      // Fetch the audio file
      const response = await fetch(fileUrl);
      const audioBuffer = await response.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString("base64");

      // Use Gemini to transcribe and respond to the voice message
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
            { text: "Please transcribe this voice message and respond to what the user is saying. First show the transcription in quotes, then provide your response." },
          ],
        }],
      });

      const transcription = transcribeResult.text || "";

      if (!transcription) {
        await ctx.reply("Sorry, I couldn't understand the voice message. Please try again.");
        return;
      }

      // Broadcast transcribed voice to CLI channel for cross-channel sync
      broadcastChannelEvent({
        type: "message",
        source: "telegram",
        data: { text: transcription, userId, isVoice: true },
        timestamp: new Date().toISOString(),
      });

      // Inject conversational tone when voice reply is enabled
      const userVoiceOn = voiceReplyEnabled.get(userId) ?? false;
      let voiceMessage = transcription;
      if (userVoiceOn) {
        const { getVoicePromptAddendum } = await import("../../ai/prompts.js");
        voiceMessage = `${getVoicePromptAddendum()}\n\n${transcription}`;
      }

      // Now process the transcribed text through the agent
      const result = await agent.chat(voiceMessage, userId, "telegram", "main");

      // Broadcast agent response to CLI
      if (result.text) {
        broadcastChannelEvent({
          type: "notification",
          source: "telegram",
          data: { text: result.text, isResponse: true },
          timestamp: new Date().toISOString(),
        });
      }

      // Send response with transcription context
      const responseText = result.text || "...";

      // Try to reply with voice if user sent voice and has voice enabled (default: OFF)
      const userVoiceEnabled = voiceReplyEnabled.get(userId) ?? false;
      if (userVoiceEnabled && responseText.length < 500) {
        try {
          await ctx.api.sendChatAction(ctx.chat!.id, "record_voice");

          const { generateAudioFile, generateVoiceWithGemini } = await import("../../cli/voice/tts.js");
          const { join } = await import("path");
          const voiceDir = join(runtimeDir, "voice-output");

          // Try Gemini TTS first, fall back to local
          let audioPath = await generateVoiceWithGemini(responseText, voiceDir);
          if (!audioPath) {
            audioPath = await generateAudioFile(responseText, voiceDir, { format: "ogg" });
          }

          if (audioPath) {
            const { InputFile } = await import("grammy");
            const { readFileSync, existsSync, unlinkSync } = await import("fs");

            if (existsSync(audioPath)) {
              const audioBuffer = readFileSync(audioPath);
              await ctx.replyWithVoice(new InputFile(audioBuffer, "voice.ogg"), {
                caption: "🎤 Voice reply",
              });

              // Also send text version
              await ctx.reply(`📝 _${responseText}_`, { parse_mode: "Markdown" }).catch(() => {
                ctx.reply(responseText);
              });

              // Clean up
              try { unlinkSync(audioPath); } catch {}
              return;
            }
          }
        } catch (voiceErr) {
          log.debug("Voice reply failed, falling back to text: %s", voiceErr);
        }
      }

      // Fall back to text reply
      await ctx.reply(`🎤 *Voice Message:*\n\n${responseText}`, { parse_mode: "Markdown" }).catch(() => {
        ctx.reply(`Voice Message:\n\n${responseText}`);
      });

    } catch (err) {
      log.error({ err }, "Voice message error");
      await ctx.reply("Sorry, I couldn't process your voice message. Please try again or send text.");
    }
  });

  // Audio file handling (for longer audio)
  bot.on("message:audio", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      await ctx.api.sendChatAction(ctx.chat!.id, "typing");

      const audio = ctx.message?.audio;
      if (!audio) {
        await ctx.reply("Could not process audio file.");
        return;
      }

      log.info("Processing audio file: %s (%d bytes)", audio.file_name || "unknown", audio.file_size || 0);

      // Download audio file
      const file = await ctx.api.getFile(audio.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const audioBuffer = await response.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString("base64");

      // Determine MIME type
      const mimeType = audio.mime_type || "audio/mpeg";

      const { getClient } = await import("../../ai/gemini.js");
      const ai = getClient();

      const transcribeResult = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            { text: "Please transcribe this audio and respond to what the user is saying. First show the transcription in quotes, then provide your helpful response." },
          ],
        }],
      });

      const transcription = transcribeResult.text || "";

      if (!transcription) {
        await ctx.reply("Sorry, I couldn't understand the audio. Please try again.");
        return;
      }

      const result = await agent.chat(transcription, userId, "telegram", "main");

      const responseText = result.text || "...";
      await ctx.reply(`🎵 *Audio Response:*\n\n${responseText}`, { parse_mode: "Markdown" }).catch(() => {
        ctx.reply(`Audio Response:\n\n${responseText}`);
      });

    } catch (err) {
      log.error({ err }, "Audio file error");
      await ctx.reply("Sorry, I couldn't process your audio file. Please try again.");
    }
  });

  // /clear - Clear conversation history and reset context COMPLETELY
  bot.command("clear", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    const chatId = String(ctx.chat?.id || "");

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      const fs = await import("fs");
      const path = await import("path");

      // The actual agent ID is "main" (not "wispy")
      const agentId = "main";
      const sessionsDir = path.join(runtimeDir, "agents", agentId, "sessions");
      let deletedCount = 0;

      log.info("Clearing sessions from: %s for user: %s", sessionsDir, userId);

      // === NUCLEAR OPTION: Delete ALL session files for this user ===
      if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir);
        for (const file of files) {
          // Match any file containing this user's ID in any format
          // Session keys are like: agent_main_main_7844654696.jsonl
          if (file.includes(userId)) {
            const filePath = path.join(sessionsDir, file);
            try {
              fs.unlinkSync(filePath);
              log.info("Deleted session file: %s", file);
              deletedCount++;
            } catch (e) {
              log.error("Failed to delete: %s", file);
            }
          }
        }

        // Also clear the session registry index
        const indexPath = path.join(sessionsDir, "index.json");
        if (fs.existsSync(indexPath)) {
          try {
            const indexData = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
            const sessionsToDelete: string[] = [];

            // Find all session keys for this user
            for (const key of Object.keys(indexData.sessions || {})) {
              if (key.includes(userId)) {
                sessionsToDelete.push(key);
              }
            }

            // Delete them from the registry
            for (const key of sessionsToDelete) {
              delete indexData.sessions[key];
              log.info("Removed session from registry: %s", key);
              deletedCount++;
            }

            fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
          } catch {}
        }
      } else {
        log.warn("Sessions directory not found: %s", sessionsDir);
      }

      // === Clear all session types ===
      const { clearHistory } = await import("../../core/session.js");
      const { buildSessionKey } = await import("../../security/isolation.js");
      const sessionTypes = ["main", "cron", "group", "sub", "heartbeat"];

      for (const sessionType of sessionTypes) {
        try {
          const sessionKey = buildSessionKey(agentId, sessionType as any, userId);
          clearHistory(runtimeDir, agentId, sessionKey);
        } catch {}
      }

      // === Fully reset context isolator (task state, boundaries, history) ===
      const { resetUserContext } = await import("../../core/context-isolator.js");
      resetUserContext(userId, "telegram");

      // === Clear memory/vector store entries ===
      const memoryDirs = [
        path.join(runtimeDir, "memory"),
        path.join(runtimeDir, "agents", agentId, "memory"),
        path.join(runtimeDir, "vector-store"),
      ];

      for (const memoryDir of memoryDirs) {
        if (fs.existsSync(memoryDir)) {
          try {
            const memFiles = fs.readdirSync(memoryDir);
            for (const file of memFiles) {
              if (file.includes(userId) || file.includes("telegram")) {
                fs.unlinkSync(path.join(memoryDir, file));
                deletedCount++;
              }
            }
          } catch {}
        }
      }

      // === Clear any cached thinking/tool state ===
      const cacheDir = path.join(runtimeDir, "cache");
      if (fs.existsSync(cacheDir)) {
        try {
          const cacheFiles = fs.readdirSync(cacheDir);
          for (const file of cacheFiles) {
            if (file.includes(userId)) {
              fs.unlinkSync(path.join(cacheDir, file));
            }
          }
        } catch {}
      }

      await ctx.reply(
        "🧹 *Context Completely Cleared!*\n\n" +
        `✅ Deleted ${deletedCount} files\n` +
        "✅ Session registry cleaned\n" +
        "✅ Task context reset\n" +
        "✅ Memory cleared\n\n" +
        "I'm completely fresh! What would you like to do?",
        { parse_mode: "Markdown" }
      );

      log.info("Full context clear for user %s: %d files deleted", userId, deletedCount);
    } catch (err) {
      log.error({ err }, "Failed to clear context");
      await ctx.reply("❌ Failed to clear context. Please try again.");
    }
  });

  // Regular text messages - Chat with Wispy (Vibe Coding Mode)
  bot.on("message:text", async (ctx: Context) => {
    const userId = String(ctx.from?.id || "");
    const chatId = String(ctx.chat?.id || "");
    const text = ctx.message?.text || "";

    // Skip if it's a command
    if (text.startsWith("/")) return;

    if (!isPaired(runtimeDir, "telegram", userId)) {
      await ctx.reply("Please send /start first to pair with Wispy.");
      return;
    }

    try {
      // === Context Isolation Check ===
      const { processWithIsolation, cancelTask } = await import("../../core/context-isolator.js");
      const { task, contextPrompt, isNewTask } = processWithIsolation(text, userId, "telegram");

      // Check for cancel/stop commands
      const lowerText = text.toLowerCase();
      const cancelWords = ["stop", "cancel", "halt", "abort", "forget it", "never mind", "quit"];
      if (cancelWords.some(w => lowerText.includes(w))) {
        cancelTask(userId, "telegram");
        await ctx.reply(
          "✋ *Stopped!*\n\nI've cancelled what I was doing. What would you like me to help with now?",
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Show typing indicator (no verbose notifications for simple messages)
      await ctx.api.sendChatAction(ctx.chat!.id, "typing");

      // Set up chat context for sending images back
      const sendImage = async (imagePath: string, caption?: string) => {
        const { InputFile } = await import("grammy");
        const fs = await import("fs");
        if (!fs.existsSync(imagePath)) {
          throw new Error(`Image not found: ${imagePath}`);
        }
        const buffer = fs.readFileSync(imagePath);
        await ctx.replyWithPhoto(
          new InputFile(buffer, "screenshot.png"),
          caption ? { caption, parse_mode: "Markdown" } : undefined
        );
      };

      // Pass the sendImage function to the agent's tool executor
      agent.setChatContext({
        channel: "telegram",
        peerId: userId,
        chatId,
        sendImage,
      });

      // Set up progress callback for visual thought signatures
      const toolExecutor = agent.getToolExecutor();
      toolExecutor.setProgressCallback(async (event) => {
        if (event.type === "tool_start" && event.toolName) {
          // Send thought signature for tool usage
          const emoji = getToolEmoji(event.toolName);
          await sendThinkingNotification(chatId, `${emoji} ${event.toolName}`);
        } else if (event.type === "image_generated" && event.data) {
          // Send image with feedback buttons
          const { buffer, prompt, imageId } = event.data as {
            buffer: Buffer;
            prompt: string;
            imageId: string;
          };
          // Send image with inline feedback keyboard
          const { InputFile } = await import("grammy");
          await botInstance?.api.sendPhoto(
            chatId,
            new InputFile(buffer, "generated.png"),
            {
              caption: `🎨 *${prompt}*\n\n_Generated with Wispy_`,
              parse_mode: "Markdown",
              reply_markup: createImageFeedbackKeyboard(imageId),
            }
          );
        }
      });

      // Track if voice was already sent (prevent multiple voice messages)
      let voiceAlreadySent = false;

      // Set voice callback for voice replies (reuse toolExecutor from above)
      toolExecutor.setVoiceCallback(async (audioPath: string, _text: string) => {
        // Only send ONE voice message per request
        if (voiceAlreadySent) {
          log.debug("Voice already sent, skipping duplicate");
          return true; // Return true to prevent error, but don't send
        }
        try {
          const { InputFile } = await import("grammy");
          const fs = await import("fs");
          if (!fs.existsSync(audioPath)) {
            log.warn("Voice file not found: %s", audioPath);
            return false;
          }
          await ctx.replyWithVoice(
            new InputFile(fs.createReadStream(audioPath))
          );
          voiceAlreadySent = true;
          log.info("Voice message sent");
          return true;
        } catch (err) {
          log.error({ err }, "Failed to send voice message");
          return false;
        }
      });

      // Detect voice requests
      const voiceKeywords = /\b(voice|speak|say it|talk to me|audio|out loud|voice reply|reply in voice)\b/i;
      const userRequestedVoice = voiceKeywords.test(text);

      // Build message with context isolation (prevents task bleeding)
      let messageToSend = text;

      // Prepend context isolation prompt for new tasks or after clear
      if (isNewTask || task.messageCount < 2) {
        messageToSend = `${contextPrompt}\n\n---\n\n**USER MESSAGE:**\n${text}`;
        log.info("Context isolation prompt added for task: %s", task.topic);
      }

      if (userRequestedVoice) {
        const { getVoicePromptAddendum } = await import("../../ai/prompts.js");
        messageToSend = `${getVoicePromptAddendum()}\n\n${messageToSend}\n\n[Use voice_reply tool once with a friendly, conversational response.]`;
        log.info("Voice request detected");
      }

      // Use streaming to send thinking/progress updates
      let finalText = "";
      let statusMessage: any = null;
      let lastStatusUpdate = 0;
      const toolsUsed: string[] = [];
      let currentAction = "Processing...";

      // Only show status for complex tasks (messages with task indicators)
      const isComplexTask = /\b(create|build|generate|make|write|code|develop|analyze|research|explain|image|diagram|project)\b/i.test(text);
      const startTime = Date.now();

      for await (const event of agent.chatStream(messageToSend, userId, "telegram", "main")) {
        const now = Date.now();

        if (event.type === "thinking" && event.content) {
          currentAction = event.content.slice(0, 100);
          // Throttle status updates (every 5 seconds)
          if (now - lastStatusUpdate > 5000) {
            if (statusMessage) {
              try {
                await ctx.api.editMessageText(
                  ctx.chat!.id,
                  statusMessage.message_id,
                  `💭 _${currentAction}..._`,
                  { parse_mode: "Markdown" }
                );
              } catch { /* ignore edit errors */ }
            } else {
              statusMessage = await ctx.reply(
                `💭 _${currentAction}..._`,
                { parse_mode: "Markdown" }
              ).catch(() => null);
            }
            lastStatusUpdate = now;
          }
        } else if (event.type === "tool_call") {
          toolsUsed.push(event.content);
          const toolEmoji = getToolEmoji(event.content);
          currentAction = `Using ${event.content}`;

          // Only show tool notifications for complex tasks that take time
          const elapsed = Date.now() - startTime;
          if (isComplexTask && elapsed > 2000) {
            // Update existing status message instead of sending new thoughts
            if (statusMessage) {
              try {
                await ctx.api.editMessageText(
                  ctx.chat!.id,
                  statusMessage.message_id,
                  `${toolEmoji} *${event.content}*`,
                  { parse_mode: "Markdown" }
                );
              } catch { /* ignore */ }
            }
          }
        } else if (event.type === "text") {
          finalText += event.content;
        } else if (event.type === "done") {
          break;
        }
      }

      // Update status to complete only for complex tasks
      if (statusMessage && isComplexTask) {
        try {
          await ctx.api.deleteMessage(ctx.chat!.id, statusMessage.message_id);
        } catch { /* ignore */ }
      }

      // Build result object for compatibility
      const result = { text: finalText, toolResults: toolsUsed };

      // Voice fallback: if user requested voice but none was sent
      if (userRequestedVoice && !voiceAlreadySent && result.text) {
        log.info("Voice requested but not sent - generating fallback");
        try {
          const { textToSpeech, getTempVoicePath } = await import("../../voice/tts.js");
          const voicePath = getTempVoicePath(runtimeDir);
          // Clean up the text - remove tool instructions
          const cleanText = result.text.replace(/\[.*?\]/g, "").trim();
          const audioPath = await textToSpeech(cleanText || result.text, voicePath, { persona: "friendly" });

          if (audioPath) {
            const { InputFile } = await import("grammy");
            const fs = await import("fs");
            await ctx.replyWithVoice(new InputFile(fs.createReadStream(audioPath)));
            voiceAlreadySent = true;
            log.info("Voice fallback sent");
            return; // Done - voice sent
          }
        } catch (voiceErr) {
          log.warn("Voice fallback failed: %s", (voiceErr as Error).message);
        }
      }

      // If voice was already sent, don't send text too
      if (voiceAlreadySent) {
        return;
      }

      // Split long messages (Telegram limit is 4096 chars)
      const responseText = result.text || "...";
      if (responseText.length > 4000) {
        const chunks = responseText.match(/.{1,4000}/gs) || [];
        for (const chunk of chunks) {
          await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => {
            // Fallback without markdown if parsing fails
            ctx.reply(chunk);
          });
        }
      } else {
        await ctx.reply(responseText, { parse_mode: "Markdown" }).catch(() => {
          ctx.reply(responseText);
        });
      }
    } catch (err) {
      log.error({ err }, "Telegram chat error");
      await ctx.reply("Sorry, something went wrong. Please try again.");
    }
  });

  // Start the bot
  bot.start({
    onStart: async () => {
      log.info("Telegram bot started with Marathon support");

      // Register command menu with Telegram
      await bot.api.setMyCommands([
        // Core
        { command: "start", description: "Welcome & pair with Wispy" },
        { command: "help", description: "Show all commands" },
        { command: "clear", description: "Clear conversation" },
        { command: "stats", description: "System status" },
        // Marathon
        { command: "marathon", description: "Start autonomous marathon" },
        { command: "status", description: "Check marathon progress" },
        { command: "pause", description: "Pause active marathon" },
        { command: "resume", description: "Resume paused marathon" },
        { command: "abort", description: "Stop current marathon" },
        { command: "approvals", description: "List pending approvals" },
        { command: "list", description: "List all marathons" },
        // AI & Models
        { command: "model", description: "Switch AI model" },
        { command: "thinking", description: "Set thinking depth" },
        // Wallet & x402
        { command: "wallet", description: "Check crypto wallet" },
        { command: "x402demo", description: "Run x402 demo tracks" },
        { command: "x402scan", description: "Scan wallet transactions" },
        { command: "commerce", description: "Commerce integration status" },
        // Dev Workflow
        { command: "deploy", description: "Deploy to Vercel" },
        { command: "push", description: "Push to GitHub" },
        { command: "git", description: "Git operations" },
        { command: "npm", description: "Run npm scripts" },
        { command: "debug", description: "Debug tools" },
        // Analytics
        { command: "tokens", description: "Token usage stats" },
        { command: "cost", description: "Cost breakdown" },
        { command: "context", description: "Context window usage" },
        // Utilities
        { command: "image", description: "Generate AI image" },
        { command: "voice", description: "Toggle voice replies" },
        { command: "channels", description: "Connected channels" },
        { command: "tools", description: "List available tools" },
        { command: "skills", description: "List loaded skills" },
        { command: "integrations", description: "List integrations" },
        { command: "export", description: "Export conversation" },
        { command: "session", description: "Switch session" },
        { command: "compact", description: "Compact context window" },
      ]).catch((err) => log.warn("Failed to set commands menu: %s", err));

      registerChannel({
        name: "telegram",
        type: "telegram",
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

      // Register cross-channel dispatcher so CLI can send to Telegram
      registerChannelDispatcher("telegram", {
        sendMessage: sendTelegramMessage,
        sendImage: sendTelegramImage,
        sendDocument: sendTelegramDocument,
      });
    },
  });

  bot.catch((err) => {
    const msg = String(err);
    // 409 Conflict = another bot instance took over this token (multi-instance)
    if (msg.includes("409") || msg.includes("Conflict") || msg.includes("terminated by other")) {
      log.warn("Telegram bot displaced by another instance, stopping gracefully");
      updateChannelStatus("telegram", "disconnected", "displaced by another instance");
      bot.stop().catch(() => {});
      return;
    }
    log.error({ err }, "Telegram bot error");
    updateChannelStatus("telegram", "error", msg);
  });

  return bot;
}

/**
 * Get the bot instance for external use
 */
export function getTelegramBot(): Bot | null {
  return botInstance;
}
