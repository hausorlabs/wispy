/**
 * Wispy Ink REPL - Entry point
 *
 * Initializes the agent, services, and integrations, then renders
 * the Ink-based React UI. Replaces the old readline-based REPL.
 */

import React from "react";
import { render } from "ink";
import { existsSync } from "fs";
import { join } from "path";
import { App, registerInkClear } from "./App.js";
import { loadEnv } from "../../infra/dotenv.js";
import { loadConfig } from "../../config/config.js";
import { loadOrCreateIdentity } from "../../security/device-identity.js";
import { initGemini } from "../../ai/gemini.js";
import { Agent } from "../../core/agent.js";
import { runBoot } from "../../gateway/boot.js";
import { logger } from "../../infra/logger.js";
import { TokenManager } from "../../token/estimator.js";
import { McpRegistry } from "../../mcp/client.js";
import { loadSkills } from "../../skills/loader.js";
import { setApprovalHandler } from "../../security/action-guard.js";
import { showApprovalDialog } from "../permissions.js";
import { registerChannel } from "../../channels/dock.js";

export interface InkReplOpts {
  rootDir: string;
  runtimeDir: string;
  soulDir: string;
}

export async function startInkRepl(opts: InkReplOpts): Promise<void> {
  const { rootDir, runtimeDir, soulDir } = opts;

  // ── Global error safety net — prevent stray EADDRINUSE / network errors
  // from crashing the process (especially important for multi-instance) ──
  process.on("uncaughtException", (err) => {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") return; // swallow port conflicts
    console.error("[wispy] Uncaught:", err.message);
  });
  process.on("unhandledRejection", () => {}); // swallow unhandled promise rejections

  // ── TTY check — fall back to readline REPL in non-interactive environments ──
  if (!process.stdin.isTTY) {
    const { startRepl } = await import("../repl.js");
    return startRepl(opts);
  }

  // ── Environment ──
  loadEnv(rootDir);

  // ── Config & setup wizard ──
  const configPath = join(runtimeDir, "config.yaml");
  if (!existsSync(configPath)) {
    const { runSetupWizard } = await import("../setup/wizard.js");
    await runSetupWizard({ rootDir, runtimeDir, soulDir });
  }

  logger.level = "silent";

  // ── Boot sequence ──
  const bootOk = await runBoot({ rootDir, runtimeDir, soulDir });
  if (!bootOk) {
    console.error("Boot failed. Run 'wispy onboard' first.");
    process.exit(1);
  }

  const config = loadConfig(runtimeDir);

  // ── Theme ──
  if (config.theme) {
    const { setTheme } = await import("../ui/theme.js");
    setTheme(config.theme as any);
  }

  const identity = loadOrCreateIdentity(runtimeDir);

  // ── Gemini initialization ──
  let vertexEnabled = false;
  let apiKeyStr = "";
  const vc = config.gemini.vertexai;

  if (vc?.enabled) {
    const project =
      vc.project ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT;
    const location =
      vc.location ||
      process.env.GOOGLE_CLOUD_LOCATION ||
      "us-central1";

    if (!project) {
      console.error(
        "Vertex AI enabled but project not set. " +
          "Add vertexai.project to config or set GOOGLE_CLOUD_PROJECT.",
      );
      process.exit(1);
    }

    initGemini({ vertexai: true, project, location });
    vertexEnabled = true;
    apiKeyStr = `vertex:${project}`;
  } else {
    const key =
      config.gemini.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;

    if (!key) {
      console.error(
        "GEMINI_API_KEY not set. Add it to .env or config.",
      );
      process.exit(1);
    }

    initGemini(key);
    apiKeyStr = key;
  }

  logger.level = "silent";

  // ── Permission handler ──
  setApprovalHandler(showApprovalDialog);

  // ── Agent ──
  const agent = new Agent({ config, runtimeDir, soulDir });

  // ── Skills ──
  const skills = loadSkills(soulDir);
  if (skills.length > 0) agent.setSkills(skills);

  // ── MCP servers ──
  const mcpRegistry = new McpRegistry(runtimeDir);
  await mcpRegistry.startAll();
  if (mcpRegistry.getStatus().length > 0) {
    agent.setMcpRegistry(mcpRegistry);
  }

  // ── Wallet & Commerce (x402 hackathon) ──
  // Must init BEFORE integrations so AGENT_PRIVATE_KEY is available
  // for the agentic-commerce integration to auto-enable.
  try {
    const { initWallet, exportWalletPrivateKey } = await import("../../wallet/x402.js");
    initWallet(runtimeDir, identity);

    // Export wallet private key for agentic-commerce integration
    if (!process.env.AGENT_PRIVATE_KEY) {
      try {
        const pk = exportWalletPrivateKey(runtimeDir, identity);
        process.env.AGENT_PRIVATE_KEY = pk;
      } catch {
        // Wallet may not exist yet on first run
      }
    }

    const { X402Client, setX402Client } = await import("../../wallet/x402-client.js");
    const x402Client = await X402Client.create(runtimeDir, identity);
    setX402Client(x402Client);

    const { initCommerceEngine } = await import("../../wallet/commerce.js");
    initCommerceEngine(runtimeDir);
  } catch {
    // Non-fatal: wallet features degrade gracefully
  }

  // ── Integrations (agentic-commerce, etc.) ──
  try {
    const { loadIntegrations } = await import(
      "../../integrations/loader.js"
    );
    const { CredentialManager } = await import(
      "../../integrations/credential-manager.js"
    );
    const credMgr = new CredentialManager(
      runtimeDir,
      Buffer.from(identity.deviceId, "hex"),
    );
    const integrationRegistry = await loadIntegrations(
      {
        config,
        runtimeDir,
        soulDir,
        credentialManager: credMgr,
        logger,
      },
      config.integrations ?? [],
    );
    agent.setIntegrationRegistry(integrationRegistry);
  } catch {
    // Non-fatal: integrations are optional
  }

  // ── Multi-instance: primary lock ──────────────────────────────
  // Only ONE instance owns shared services (Telegram, A2A, cron, reminders).
  // Secondary instances run CLI + agent only, preventing port/file conflicts.
  const { writeFileSync, unlinkSync, readFileSync } = await import("fs");
  const lockPath = join(runtimeDir, "wispy.lock");
  let isPrimary = false;

  // Check if lock is stale (held by a dead process)
  if (existsSync(lockPath)) {
    try {
      const lockPid = parseInt(readFileSync(lockPath, "utf-8").trim(), 10);
      try { process.kill(lockPid, 0); } catch { unlinkSync(lockPath); }
    } catch { try { unlinkSync(lockPath); } catch {} }
  }

  if (!existsSync(lockPath)) {
    try {
      writeFileSync(lockPath, String(process.pid), "utf-8");
      isPrimary = true;
      const releaseLock = () => { try { unlinkSync(lockPath); } catch {} };
      process.on("exit", releaseLock);
      process.on("SIGINT", () => { releaseLock(); process.exit(0); });
      process.on("SIGTERM", () => { releaseLock(); process.exit(0); });
    } catch { /* lock write failed, run as secondary */ }
  }

  // ── Marathon (always — lightweight, no ports) ──
  const { MarathonService } = await import(
    "../../marathon/service.js"
  );
  const marathonSvc = new MarathonService(runtimeDir);
  agent.setMarathonService(marathonSvc, apiKeyStr);

  // ── Primary-only services (cron, reminders, Telegram, A2A) ──
  let cronService: any = null;
  let reminderService: any = null;

  if (isPrimary) {
    // ── Cron service ──
    const { CronService } = await import("../../cron/service.js");
    cronService = new CronService(runtimeDir, agent);
    cronService.start();
    agent.setCronService(cronService);

    // ── Reminders ──
    const { ReminderService } = await import("../../cron/reminders.js");
    reminderService = new ReminderService(runtimeDir);
    reminderService.start();
    agent.setReminderService(reminderService);
  }

  // ── Channel registration ──
  registerChannel({
    name: "cli",
    type: "cli",
    capabilities: {
      text: true,
      media: false,
      voice: false,
      buttons: false,
      reactions: false,
      groups: false,
      threads: false,
    },
    status: "connected",
  });

  // ── Auto-start configured channels ──
  const startedChannels: string[] = ["cli"];

  // Telegram & A2A: primary instance only
  if (isPrimary) {
    if (config.channels?.telegram?.enabled && config.channels.telegram.token) {
      try {
        const { startTelegram } = await import(
          "../../channels/telegram/adapter.js"
        );
        startTelegram(
          config.channels.telegram.token,
          agent,
          runtimeDir,
          apiKeyStr,
        );
        startedChannels.push("telegram");
      } catch {
        // Non-fatal: Telegram is optional
      }
    }

    // ── A2A server ──
    try {
      const { A2AServer } = await import("../../a2a/delegation.js");
      const { findFreePort } = await import("../../infra/ports.js");
      const a2aPort = await findFreePort(4002);
      const a2aServer = new A2AServer(runtimeDir, soulDir, config.agent.name, agent);
      a2aServer.start(a2aPort);
      startedChannels.push("a2a");
    } catch {
      // Non-fatal: A2A is optional
    }
  }

  // ── Token manager ──
  const tokenManager = new TokenManager();

  // ── Render the Ink app ──
  const { waitUntilExit, clear } = render(
    <App
      agent={agent}
      config={config}
      tokenManager={tokenManager}
      vertexEnabled={vertexEnabled}
      runtimeDir={runtimeDir}
      soulDir={soulDir}
      connectedChannels={startedChannels}
      marathonService={marathonSvc}
    />,
  );

  // Register Ink's clear() so App can call it on resize
  registerInkClear(clear);

  await waitUntilExit();

  // ── Cleanup ──
  try {
    mcpRegistry.stopAll();
  } catch {}
  if (cronService) try { cronService.stop(); } catch {}
  if (reminderService) try { reminderService.stop(); } catch {}
  // Stop Telegram bot if running
  try {
    const { getTelegramBot } = await import(
      "../../channels/telegram/adapter.js"
    );
    getTelegramBot()?.stop();
  } catch {}

  process.exit(0);
}
