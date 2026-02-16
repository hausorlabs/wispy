#!/usr/bin/env npx tsx
/**
 * Standalone x402 Demo Runner
 * Runs the /x402demo all flow without the Ink UI requirement.
 * Usage: npx tsx run-demo.ts
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = __dirname;
const RUNTIME_DIR = resolve(
  process.env.WISPY_HOME ||
    resolve(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".wispy"),
);
const SOUL_DIR = resolve(ROOT_DIR, "wispy");

// ── Helpers ──────────────────────────────────────────────────
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function progressBar(done: number, total: number): string {
  const width = 30;
  const filled = Math.round((done / total) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `[${bar}] ${done}/${total} tracks`;
}

console.log(`\n${bold("━━━ Wispy x402 Demo Runner ━━━")}\n`);

// ── Boot sequence (mirrors ink-repl.tsx) ─────────────────────
process.on("uncaughtException", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") return;
  console.error("[wispy] Uncaught:", err.message);
});
process.on("unhandledRejection", () => {});

// Load env
const { loadEnv } = await import("./src/infra/dotenv.js");
loadEnv(ROOT_DIR);
loadEnv(RUNTIME_DIR.replace(/[/\\]\.wispy$/, ""));

// Load config
const { loadConfig } = await import("./src/config/config.js");
const configPath = resolve(RUNTIME_DIR, "config.yaml");
if (!existsSync(configPath)) {
  console.error("No config found. Run 'wispy setup' first.");
  process.exit(1);
}
const config = loadConfig(RUNTIME_DIR);

// Init Gemini
const { initGemini } = await import("./src/ai/gemini.js");
let apiKeyStr = "";
const vc = config.gemini?.vertexai;
if (vc?.enabled) {
  const project = vc.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const location = vc.location || process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  if (!project) { console.error("Vertex AI project not set."); process.exit(1); }
  initGemini({ vertexai: true, project, location });
  apiKeyStr = `vertex:${project}`;
  console.log(dim(`  Using Vertex AI (${project}, ${location})`));
} else {
  const key = config.gemini?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) { console.error("GEMINI_API_KEY not set."); process.exit(1); }
  initGemini(key);
  apiKeyStr = key;
  console.log(dim("  Using Gemini API key"));
}

// Identity
const { loadOrCreateIdentity } = await import("./src/security/device-identity.js");
const identity = loadOrCreateIdentity(RUNTIME_DIR);

// Action guard
const { setApprovalHandler } = await import("./src/security/action-guard.js");
setApprovalHandler(async (_action: any) => true); // Auto-approve for demo

// Agent
const { Agent } = await import("./src/core/agent.js");
const agent = new Agent({ config, runtimeDir: RUNTIME_DIR, soulDir: SOUL_DIR });

// Skills
const { loadSkills } = await import("./src/skills/loader.js");
const skills = loadSkills(SOUL_DIR);
if (skills.length > 0) agent.setSkills(skills);

// MCP
const { McpRegistry } = await import("./src/mcp/client.js");
const mcpRegistry = new McpRegistry(RUNTIME_DIR);
await mcpRegistry.startAll();
if (mcpRegistry.getStatus().length > 0) agent.setMcpRegistry(mcpRegistry);

// Wallet & Commerce
try {
  const { initWallet, exportWalletPrivateKey } = await import("./src/wallet/x402.js");
  initWallet(RUNTIME_DIR, identity);
  if (!process.env.AGENT_PRIVATE_KEY) {
    try {
      process.env.AGENT_PRIVATE_KEY = exportWalletPrivateKey(RUNTIME_DIR, identity);
    } catch {}
  }
  const { X402Client, setX402Client } = await import("./src/wallet/x402-client.js");
  const x402Client = await X402Client.create(RUNTIME_DIR, identity);
  setX402Client(x402Client);
  const { initCommerceEngine } = await import("./src/wallet/commerce.js");
  initCommerceEngine(RUNTIME_DIR);
} catch {}

// Integrations (agentic-commerce)
try {
  const { loadIntegrations } = await import("./src/integrations/loader.js");
  const { CredentialManager } = await import("./src/integrations/credential-manager.js");
  const credMgr = new CredentialManager(RUNTIME_DIR, Buffer.from(identity.deviceId, "hex"));
  const { logger } = await import("./src/infra/logger.js");
  const integrationRegistry = await loadIntegrations(
    { config, runtimeDir: RUNTIME_DIR, soulDir: SOUL_DIR, credentialManager: credMgr, logger },
    config.integrations ?? [],
  );
  agent.setIntegrationRegistry(integrationRegistry);
} catch (e) {
  console.error("Integration load error:", (e as Error).message);
}

console.log(dim("  Agent initialized.\n"));

// ── Start demo services ──────────────────────────────────────
const { startDemoServices } = await import("./src/integrations/agentic-commerce/demo/server.js");
const { sellerAddress } = await startDemoServices(process.env.SELLER_PRIVATE_KEY);
const { getServiceUrls } = await import("./src/integrations/agentic-commerce/x402/seller.js");
const urls = getServiceUrls();

console.log(green("  Demo services running:"));
console.log(`    Weather:   ${urls.weather}  ($0.001)`);
console.log(`    Sentiment: ${urls.sentiment}  ($0.002)`);
console.log(`    Report:    ${urls.report}  ($0.001)`);
console.log(`    Seller:    ${sellerAddress}\n`);

// ── Build demo prompt (same as App.tsx) ──────────────────────
const trackList = ["1", "2", "3", "4", "5"];
const trackCount = trackList.length;

let demoPrompt = `You are Wispy, an autonomous AI agent running a LIVE demonstration for the SF Agentic Commerce x402 Hackathon. You have FULL AUTONOMY to choose how to accomplish each track's goals.

CRITICAL ANTI-HALLUCINATION RULES (you MUST follow these):
1. ONLY use these exact service URLs. Do NOT invent, guess, or modify URLs:
   - Weather:   ${urls.weather}
   - Sentiment: ${urls.sentiment}
   - Report:    ${urls.report}
2. For AP2 purchases, use service_url with the EXACT URLs above (e.g. "${urls.weather}?city=Tokyo").
3. NEVER fabricate transaction hashes, wallet addresses, payment IDs, or amounts. Only use values returned by tool calls.
4. For bite_check_and_execute: you MUST first call bite_encrypt_payment and use the payment_id it returns. NEVER guess or make up a payment_id.
5. If a tool returns an error, read the error message and fix the issue. Do NOT retry with made-up parameters.
6. When showing tx hashes, wallet addresses, or amounts in summaries, copy them EXACTLY from tool results. Do NOT paraphrase or approximate.
7. NEVER say a track passed if a tool call failed. Fix it or note it honestly.

YOUR FIRST ACTION: Call x402_discover_services to see available services.

Seller address: ${sellerAddress}

FORMATTING RULES:
- Do NOT use markdown tables. Use box-drawing characters (┌ ─ ┐ │ ├ └ ┘ ═ ━)
- Format tabular data with padded columns for alignment
- Use section headers with ━━━ borders
- Show your reasoning: WHY you do things, not just what
- For every x402 payment, show amount, recipient, and status

TRACK COMPLETION RULES:
- Complete ALL tracks sequentially. Do not stop until ALL are done.
- After EACH track, you MUST say exactly "TRACK N COMPLETE" on its own line (no markdown, no bold, no asterisks). Example: TRACK 1 COMPLETE
- Do NOT mark a track complete if it failed. Retry or adapt first.
- If a tool call fails, retry with the CORRECT URLs listed above. Do NOT invent new URLs.
- You decide the order of operations, which tools to use, and what data to work with.

AVAILABLE TOOLS: x402_discover_services, x402_pay_and_fetch, x402_check_budget, x402_audit_trail, ap2_purchase, ap2_get_receipts, defi_research, defi_swap, defi_trade_log, bite_encrypt_payment, bite_check_and_execute, bite_lifecycle_report, wallet_balance

Here are the tracks to complete:

━━━ TRACK 1: Overall Best Agentic App ━━━
GOAL: Demonstrate autonomous multi-step reasoning by fetching data from ALL THREE paid APIs and compiling findings.
SUCCESS CRITERIA (you MUST do ALL of these IN ORDER):
  Step A: Call x402_pay_and_fetch with url: "weather" (or the full weather URL) and reason: "Fetching weather data for demo"
  Step B: Call x402_pay_and_fetch with url: "sentiment" (method: POST, body with text from Step A's weather data) and reason: "Analyzing sentiment of weather report"
  Step C: Call x402_pay_and_fetch with url: "report" (method: POST, body with data from Steps A and B) and reason: "Compiling final report"
CRITICAL: You MUST call ALL THREE services (weather, sentiment, report). Do NOT skip any. These are 3 separate x402_pay_and_fetch calls.
WHEN DONE: Say exactly "TRACK 1 COMPLETE" on its own line (plain text).

━━━ TRACK 2: Agentic Tool Usage on x402 ━━━
GOAL: Demonstrate intelligent, cost-aware usage of x402-paywalled services.
SUCCESS CRITERIA (you MUST do ALL of these):
  Step A: Call x402_check_budget to show current budget status
  Step B: Explain your cost/benefit reasoning (how much you've spent, what's left, was it worth it)
  Step C: Call x402_audit_trail to show the full payment history
WHEN DONE: Say exactly "TRACK 2 COMPLETE" on its own line (plain text).

━━━ TRACK 3: Best Integration of AP2 ━━━
GOAL: Demonstrate the AP2 structured purchase flow (Intent -> Cart -> Payment -> Receipt).
SUCCESS CRITERIA (you MUST do ALL of these):
  Step A: Call ap2_purchase with service_url: "${urls.weather}?city=Tokyo", description: "Weather data purchase via AP2 protocol", amount: "0.001"
  Step B: Show and explain each mandate stage (Intent -> Cart -> Payment -> Receipt)
  Step C: Call ap2_get_receipts to show the receipt chain
CRITICAL: You MUST call ap2_purchase. This is a DIFFERENT tool from x402_pay_and_fetch. Do NOT skip this track.
WHEN DONE: Say exactly "TRACK 3 COMPLETE" on its own line (plain text).

━━━ TRACK 4: Best Trading/DeFi Agent ━━━
GOAL: Demonstrate autonomous DeFi trading with risk controls -- BOTH an approved swap AND a denied swap.
YOU MUST MAKE EXACTLY 4 TOOL CALLS FOR THIS TRACK:
  1. defi_research (token: "ETH") -- get market data
  2. defi_swap (from_token: "USDC", to_token: "ETH", amount: "0.01", reasoning: "Small safe swap within risk limits") -- this WILL BE APPROVED
  3. defi_swap (from_token: "USDC", to_token: "ETH", amount: "5000", reasoning: "Large swap to test risk engine denial") -- this WILL BE DENIED
  4. defi_trade_log -- show the full trade history with BOTH the approved and denied trades
ALL 4 CALLS ARE MANDATORY. The demo requires showing both an approved AND a denied swap. If you only show the denial, the track FAILS.
WHEN DONE: Say exactly "TRACK 4 COMPLETE" on its own line (plain text).

━━━ TRACK 5: Encrypted Agents (BITE v2) ━━━
GOAL: Demonstrate BITE v2 threshold encryption for conditional payments.
SUCCESS CRITERIA: Follow these steps IN ORDER:
  Step A: Call bite_encrypt_payment (use to: "${sellerAddress}", data: any hex string like "0x1234", condition_type: "time_lock", condition_description: "Immediate execution").
  Step B: Take the payment_id from Step A's response (it starts with "bite_").
  Step C: Call bite_check_and_execute with that exact payment_id from Step B.
  Step D: Call bite_lifecycle_report with that same payment_id.
CRITICAL: Do NOT call bite_check_and_execute before bite_encrypt_payment. The payment_id MUST come from the encrypt step's response.
AUTONOMY: You choose the condition description and data payload.
WHEN DONE: Say exactly "TRACK 5 COMPLETE" on its own line (plain text).

After ALL tracks are complete, call x402_audit_trail one final time, then provide a FINAL VERIFICATION SUMMARY using this format:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HACKATHON DEMO - FINAL VERIFICATION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Tracks Completed:    N / N
  Total Payments:      N transactions
  Total USDC Spent:    $X.XXXXXX

  ┌─ Transaction Log ─────────────────────────────────────────────────┐
  │ #  Service                Amount        Status     Tx Hash        │
  │────────────────────────────────────────────────────────────────────│
  │ (list ALL transactions with real values from audit trail)         │
  └────────────────────────────────────────────────────────────────────┘

  ┌─ Track Results ───────────────────────────────────────────────────┐
  │ Track   Title                      Status    Key Proof            │
  │────────────────────────────────────────────────────────────────────│
  │ (list ALL tracks with PASS/FAIL and evidence)                     │
  └────────────────────────────────────────────────────────────────────┘

  ┌─ On-Chain Verification ───────────────────────────────────────────┐
  │ Wallet:     (your real wallet address explorer link)              │
  │ Network:    SKALE BITE V2 Sandbox (Chain 103698795)               │
  │ Explorer:   https://base-sepolia-testnet-explorer.skalenodes.com:10032  │
  │ Tx Links:   (list all real tx hash explorer links)                │
  └────────────────────────────────────────────────────────────────────┘

ALL TRACKS COMPLETE

Fill in ALL actual values. Show real tx hashes, real wallet address, real amounts.
Use CLI-style formatting with box-drawing characters throughout.`;

// ── Multi-turn execution ─────────────────────────────────────
const MAX_DEMO_TURNS = 15;
let demoTurn = 0;
let demoComplete = false;
let allAccumulated = "";
const completedTracks = new Set<string>();
const toolCalls = new Map<string, number>();

// Tool counting helpers (same as App.tsx)
const toolCount = (name: string) => {
  let total = 0;
  for (const [k, v] of toolCalls) {
    if (k === name || k.toLowerCase().replace(/[\s-]+/g, "_") === name) total += v;
  }
  return total;
};

const hasTrackEvidence = (track: string): boolean => {
  switch (track) {
    case "1": return toolCount("x402_pay_and_fetch") >= 3;
    case "2": return toolCount("x402_check_budget") >= 1 && toolCount("x402_audit_trail") >= 1;
    case "3": return toolCount("ap2_purchase") >= 1;
    case "4": {
      const c = allAccumulated.toLowerCase();
      return toolCount("defi_swap") >= 2 && toolCount("defi_trade_log") >= 1
        && c.includes("swap executed successfully") && c.includes("swap denied");
    }
    case "5": return toolCount("bite_encrypt_payment") >= 1 && toolCount("bite_check_and_execute") >= 1;
    default: return false;
  }
};

const markTrackIfNeeded = (track: string) => {
  if (completedTracks.has(track)) return;
  completedTracks.add(track);
  console.log(`\n${green(`  ✓ Track ${track} COMPLETE`)} ${progressBar(completedTracks.size, trackCount)}\n`);
};

const checkTracks = () => {
  for (const t of trackList) {
    if (hasTrackEvidence(t)) markTrackIfNeeded(t);
  }
};

type SessionType = "main" | "background" | "tool-sandbox";
const currentSession: SessionType = "main";

console.log(bold(`\n  Starting demo (max ${MAX_DEMO_TURNS} turns)...\n`));
console.log(`  ${progressBar(0, trackCount)}\n`);

while (demoTurn < MAX_DEMO_TURNS && !demoComplete) {
  demoTurn++;
  const remainingTracks = trackList.filter((t) => !completedTracks.has(t));

  // Build continuation prompt with missing tool status
  let turnPrompt: string;
  if (demoTurn === 1) {
    turnPrompt = demoPrompt;
  } else {
    const toolStatus: string[] = [];
    for (const t of remainingTracks) {
      const missing: string[] = [];
      switch (t) {
        case "1": {
          const payCount = toolCount("x402_pay_and_fetch");
          if (payCount < 3) missing.push(`x402_pay_and_fetch (called ${payCount}/3)`);
          break;
        }
        case "2": {
          if (toolCount("x402_check_budget") < 1) missing.push("x402_check_budget");
          if (toolCount("x402_audit_trail") < 1) missing.push("x402_audit_trail");
          break;
        }
        case "3": {
          if (toolCount("ap2_purchase") < 1) missing.push(`ap2_purchase`);
          break;
        }
        case "4": {
          const ct = allAccumulated.toLowerCase();
          const hasApprovedSwap = ct.includes("swap executed successfully");
          const hasDeniedSwap = ct.includes("swap denied");
          if (!hasApprovedSwap) missing.push("defi_swap (0.01 USDC -- APPROVED swap)");
          if (!hasDeniedSwap) missing.push("defi_swap (5000 USDC -- DENIED swap)");
          if (toolCount("defi_trade_log") < 1) missing.push("defi_trade_log");
          break;
        }
        case "5": {
          if (toolCount("bite_encrypt_payment") < 1) missing.push("bite_encrypt_payment");
          if (toolCount("bite_check_and_execute") < 1) missing.push("bite_check_and_execute");
          break;
        }
      }
      if (missing.length > 0) toolStatus.push(`Track ${t} MISSING: ${missing.join(", ")}`);
    }

    turnPrompt = `Continue the demonstration. Remaining tracks: ${remainingTracks.map((t) => `Track ${t}`).join(", ")}.

WARNING: Tracks are ONLY complete when required tools have been called. Saying "TRACK N COMPLETE" without tool calls does NOT count.

${toolStatus.length > 0 ? `TOOL STATUS:\n${toolStatus.join("\n")}\n` : ""}
STRICT RULES:
- ONLY use URLs: ${urls.weather}, ${urls.sentiment}, ${urls.report}
- NEVER fabricate tx hashes, amounts, or addresses.
- Call ALL required tools BEFORE saying "TRACK N COMPLETE".`;
  }

  console.log(dim(`  ── Turn ${demoTurn}/${MAX_DEMO_TURNS} (${remainingTracks.length} tracks remaining) ──`));

  let turnAccumulated = "";
  let currentToolName = "";

  for await (const chunk of agent.chatStream(
    turnPrompt,
    "cli-user",
    "cli",
    currentSession,
  )) {
    switch (chunk.type) {
      case "thinking":
        // Silent -- don't print thinking
        break;

      case "tool_call": {
        let name = chunk.content;
        try {
          if (chunk.content.includes("{")) {
            name = chunk.content.slice(0, chunk.content.indexOf("{")).trim();
          }
        } catch {}
        currentToolName = name;
        const normalizedName = name.toLowerCase().replace(/[\s-]+/g, "_");
        toolCalls.set(normalizedName, toolCalls.get(normalizedName) ?? 0);
        console.log(cyan(`    ⚡ ${name}`));
        break;
      }

      case "tool_result": {
        const isError = chunk.success === false || chunk.content.startsWith("ERROR: ");
        const preview = chunk.content.slice(0, 200).replace(/\n/g, " ");
        if (isError) {
          console.log(red(`      ✗ ${preview}`));
        } else {
          console.log(green(`      ✓ ${preview}${chunk.content.length > 200 ? "..." : ""}`));
        }
        allAccumulated += "\n" + chunk.content;
        turnAccumulated += "\n" + chunk.content;
        if (!isError && currentToolName) {
          const normalizedTn = currentToolName.toLowerCase().replace(/[\s-]+/g, "_");
          toolCalls.set(normalizedTn, (toolCalls.get(normalizedTn) ?? 0) + 1);
          checkTracks();
        }
        currentToolName = "";
        break;
      }

      case "text": {
        if (chunk.content) {
          // Print text but limit verbosity
          const lines = chunk.content.split("\n");
          for (const line of lines) {
            if (line.trim()) {
              console.log(`  ${line}`);
            }
          }
          allAccumulated += "\n" + chunk.content;
          turnAccumulated += "\n" + chunk.content;
        }
        break;
      }

      case "usage": {
        // Parse token usage if available
        break;
      }

      case "done":
        break;
    }
  }

  // End-of-turn track detection from text
  checkTracks();
  const cleaned = allAccumulated
    .replace(/\*\*/g, "").replace(/\*/g, "").replace(/_/g, "").replace(/`/g, "")
    .replace(/[║│┃╎╏┆┇┊┋╔╗╚╝╠╣╦╩╬═─━┌┐└┘├┤┬┴┼▸▹►▻●○◉✓✗✔✕✅❌⚡⭐🟢🔴💰🎯📊🔒📄]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  for (const t of trackList) {
    if (completedTracks.has(t)) continue;
    const agentClaimsComplete =
      cleaned.includes(`track ${t} complete`) ||
      cleaned.includes(`track ${t}: complete`) ||
      cleaned.includes(`track ${t} pass`) ||
      !!cleaned.match(new RegExp(`track\\s*${t}\\s*(?::|\\s)\\s*(?:is\\s+)?(?:complete|pass|done|succeeded)`));
    if (agentClaimsComplete && hasTrackEvidence(t)) {
      markTrackIfNeeded(t);
    }
  }

  // Overall completion
  if (completedTracks.size >= trackCount) {
    demoComplete = true;
  } else if (
    cleaned.includes("all tracks complete") ||
    cleaned.includes("all 5 tracks") ||
    cleaned.includes("demonstration complete") ||
    cleaned.includes("5/5 tracks")
  ) {
    checkTracks();
    for (const t of trackList) {
      if (!completedTracks.has(t) && hasTrackEvidence(t)) markTrackIfNeeded(t);
    }
    demoComplete = true;
  } else if (!turnAccumulated.trim() && demoTurn > 1) {
    demoComplete = true;
  }

  console.log(dim(`  ── End turn ${demoTurn} ── ${progressBar(completedTracks.size, trackCount)}\n`));
}

// ── Programmatic verification ────────────────────────────────
console.log(bold("\n━━━ PROGRAMMATIC VERIFICATION ━━━\n"));

try {
  const { SKALE_BITE_SANDBOX } = await import("./src/integrations/agentic-commerce/config.js");
  const executor = agent.getToolExecutor();
  const auditResult = await executor.execute({ name: "x402_audit_trail", args: { format: "json" } });
  const budgetResult = await executor.execute({ name: "x402_check_budget", args: {} });

  if (auditResult.success && auditResult.output) {
    let report: any = {};
    try { report = JSON.parse(auditResult.output); } catch {}
    const records = report.records || [];
    const totalSpent = report.totalSpent ?? records.reduce((s: number, r: any) => s + (r.amount || 0), 0);
    const walletAddr = report.agentAddress || "";
    const explorerBase = SKALE_BITE_SANDBOX.explorerUrl;

    console.log(`  Tracks Completed:  ${completedTracks.size} / ${trackCount}`);
    console.log(`  Total Payments:    ${records.length} transactions`);
    console.log(`  Total USDC Spent:  $${totalSpent.toFixed(6)}`);
    console.log(`  Wallet:            ${walletAddr}`);
    console.log();

    // Transaction list
    console.log("  ┌─ Transactions ─────────────────────────────────────────┐");
    for (const r of records) {
      const hasRealHash = r.txHash && r.txHash.startsWith("0x") && r.txHash.length >= 66;
      const hash = hasRealHash ? `${r.txHash.slice(0, 14)}...` : "facilitator-settled";
      console.log(`  │ ${(r.service || "?").slice(0, 25).padEnd(26)} $${(r.amount || 0).toFixed(6).padEnd(12)} ${hash}`);
    }
    console.log("  └─────────────────────────────────────────────────────────┘\n");

    // Track results
    const trackNames: Record<string, string> = {
      "1": "Agentic App", "2": "x402 Tool Usage", "3": "AP2 Integration",
      "4": "DeFi/Trading", "5": "BITE v2 Encryption",
    };
    console.log("  ┌─ Track Results ──────────────────────────────────────────┐");
    for (const t of trackList) {
      const passed = completedTracks.has(t);
      const status = passed ? green("PASS") : red("FAIL");
      console.log(`  │ Track ${t}: ${(trackNames[t] || "").padEnd(22)} ${status}`);
    }
    console.log("  └──────────────────────────────────────────────────────────┘\n");

    // BITE hashes
    let biteHashes: string[] = [];
    try {
      const biteResult = await executor.execute({ name: "bite_lifecycle_report", args: { payment_id: "all" } });
      if (biteResult.success && biteResult.output) {
        const hashMatches = biteResult.output.matchAll(/Tx:\s+(0x[a-fA-F0-9]{64})/g);
        for (const m of hashMatches) biteHashes.push(m[1]);
      }
    } catch {}
    if (biteHashes.length === 0) {
      const patterns = [/\[BITE\]\s+Submitted:\s+(0x[a-fA-F0-9]{64})/g, /Tx:\s+(0x[a-fA-F0-9]{64})/g];
      for (const pat of patterns) {
        for (const m of allAccumulated.matchAll(pat)) {
          if (!records.some((r: any) => r.txHash === m[1])) biteHashes.push(m[1]);
        }
      }
    }
    biteHashes = [...new Set(biteHashes)];

    // Explorer links
    console.log("  ┌─ On-Chain Verification ──────────────────────────────────┐");
    if (walletAddr) console.log(`  │ Wallet: ${explorerBase}/address/${walletAddr}`);
    let idx = 0;
    for (const r of records) {
      if (r.txHash && r.txHash.startsWith("0x") && r.txHash.length >= 66) {
        console.log(`  │ Tx #${++idx}: ${explorerBase}/tx/${r.txHash}`);
      }
    }
    for (const h of biteHashes) {
      console.log(`  │ BITE #${++idx}: ${explorerBase}/tx/${h}`);
    }
    console.log("  └──────────────────────────────────────────────────────────┘\n");
  }
} catch (e) {
  console.error("Verification error:", (e as Error).message);
}

// Tool call summary
console.log(dim("  Tool call counts:"));
for (const [name, count] of [...toolCalls.entries()].sort()) {
  console.log(dim(`    ${name}: ${count}`));
}

console.log(`\n${bold("━━━ Demo complete ━━━")}\n`);

// Cleanup
try { mcpRegistry.stopAll(); } catch {}
try {
  const { stopAllServices } = await import("./src/integrations/agentic-commerce/x402/seller.js");
  await stopAllServices();
} catch {}

process.exit(0);
