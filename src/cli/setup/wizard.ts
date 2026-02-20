/**
 * Interactive setup wizard — first-run onboarding experience.
 *
 * Steps:
 * 1. Welcome screen with ASCII art
 * 2. API key configuration (+ Telegram, Autonomous Mode)
 * 3. Theme selection
 * 4. Agent selection
 * 5. Integration selection
 * 6. MCP Servers
 * 7. x402 Agentic Commerce
 * 8. Voice/TTS
 * 9. Summary
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import gradient from "gradient-string";
import { writeYAML } from "../../utils/file.js";

// ── Brand color ──────────────────────────────────────────
const sky = chalk.rgb(49, 204, 255);
const skyBold = chalk.rgb(49, 204, 255).bold;
const dim = chalk.dim;
const bold = chalk.bold;
const green = chalk.green;
const yellowBright = chalk.yellowBright;

// ── ASCII Art (gradient block letters) ───────────────────
const WISPY_ASCII_RAW = [
  "\u2588\u2588\u2557    \u2588\u2588\u2557 \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2557   \u2588\u2588\u2557",
  "\u2588\u2588\u2551    \u2588\u2588\u2551 \u2588\u2588\u2551 \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557 \u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D",
  "\u2588\u2588\u2551 \u2588\u2557 \u2588\u2588\u2551 \u2588\u2588\u2551 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D  \u255A\u2588\u2588\u2588\u2588\u2554\u255D ",
  "\u2588\u2588\u2551\u2588\u2588\u2588\u2557\u2588\u2588\u2551 \u2588\u2588\u2551 \u255A\u2550\u2550\u2550\u2550\u2588\u2588\u2551 \u2588\u2588\u2554\u2550\u2550\u2550\u255D    \u255A\u2588\u2588\u2554\u255D  ",
  "\u255A\u2588\u2588\u2588\u2554\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2551 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551 \u2588\u2588\u2551         \u2588\u2588\u2551   ",
  " \u255A\u2550\u2550\u255D\u255A\u2550\u2550\u255D  \u255A\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D         \u255A\u2550\u255D   ",
];
const wizardGradient = gradient(["#31CCFF", "#7B61FF", "#31CCFF"]);
const WISPY_ASCII = "\n" + WISPY_ASCII_RAW.map(line => `  ${wizardGradient(line)}`).join("\n") + "\n";

// ── Theme definitions ────────────────────────────────────
const THEMES = [
  { key: "dawn", label: `${chalk.yellow("◉")}  Dawn   — Warm sunrise tones` },
  { key: "day", label: `${chalk.rgb(49,204,255)("◉")}  Day    — Clean sky blue (default)` },
  { key: "dusk", label: `${chalk.magenta("◉")} Dusk   — Twilight purple` },
  { key: "night", label: `${chalk.blue("◉")} Night  — Deep dark mode` },
] as const;

const THEME_ICON: Record<string, string> = {
  dawn: chalk.yellow("◉"),
  day: chalk.rgb(49,204,255)("◉"),
  dusk: chalk.magenta("◉"),
  night: chalk.blue("◉"),
};

// ── Agent definitions ────────────────────────────────────
const AGENTS = [
  { id: "coder", label: "Coder      — Code generation, debugging, refactoring", defaultOn: true },
  { id: "researcher", label: "Researcher — Web search, analysis, summarization", defaultOn: true },
  { id: "writer", label: "Writer     — Content creation, copywriting, docs", defaultOn: false },
  { id: "devops", label: "DevOps     — CI/CD, deployment, infrastructure", defaultOn: false },
  { id: "designer", label: "Designer   — UI/UX design, accessibility", defaultOn: false },
  { id: "data", label: "Data       — SQL, data analysis, visualization", defaultOn: false },
  { id: "security", label: "Security   — Audit, vulnerability scanning", defaultOn: false },
  { id: "planner", label: "Planner    — Task breakdown, project planning", defaultOn: false },
];

// ── Integration definitions ──────────────────────────────
const INTEGRATIONS = [
  { id: "google-calendar", label: "Google Calendar" },
  { id: "gmail", label: "Gmail" },
  { id: "google-drive", label: "Google Drive" },
  { id: "discord", label: "Discord" },
  { id: "github", label: "GitHub" },
  { id: "notion", label: "Notion" },
  { id: "slack", label: "Slack" },
  { id: "spotify", label: "Spotify" },
  { id: "zoho-email", label: "Zoho Mail" },
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "groq", label: "Groq" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "kimi", label: "Kimi (Moonshot)" },
];

// ── Helpers ──────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    rl.question(question, (answer) => resolve(answer));
    rl.once("close", () => reject(new Error("Setup cancelled.")));
  });
}

function parseNumberList(input: string, max: number): number[] {
  return input
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 1 && n <= max)
    .map((n) => n - 1);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Public API ───────────────────────────────────────────

/**
 * Check whether this is the first run (no config.yaml exists).
 */
export function isFirstRun(runtimeDir: string): boolean {
  const configPath = path.resolve(runtimeDir, "config.yaml");
  return !fs.existsSync(configPath);
}

/**
 * Run the interactive setup wizard.
 */
export async function runSetupWizard(opts: {
  rootDir: string;
  runtimeDir: string;
  soulDir: string;
}): Promise<void> {
  const { rootDir, runtimeDir } = opts;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Graceful Ctrl+C
  rl.on("SIGINT", () => {
    console.log(dim("\n\n  Setup cancelled.\n"));
    rl.close();
    process.exit(0);
  });

  try {
    // ── Step 1: Welcome ──────────────────────────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.rgb(49,204,255)("*")} Welcome to Wispy!\n`));
    console.log(dim("  Wispy is your autonomous AI agent powered by Google Gemini."));
    console.log(dim("  This wizard will walk you through setup step by step.\n"));
    console.log(dim("  You will need:"));
    console.log(`  ${sky("1.")} A Gemini API key ${dim("(free at aistudio.google.com/apikey)")}`);
    console.log(`  ${sky("2.")} ${dim("Optional:")} A Telegram bot token ${dim("(from @BotFather on Telegram)")}`);
    console.log(`  ${sky("3.")} ${dim("Optional:")} An Ethereum wallet key ${dim("(for x402 payments)")}`);
    console.log("");
    console.log(dim("  Everything else has smart defaults. You can change settings later.\n"));
    await ask(rl, dim("  Press Enter to start..."));

    // ── Step 2: API Key ──────────────────────────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.yellow("▸")} Step 1 of 4: AI Configuration\n`));
    console.log(dim("  Wispy needs a Google Gemini API key to think and reason.\n"));
    console.log(`  ${sky("1)")} ${bold("Gemini API Key")} ${dim("(Recommended)")}`);
    console.log(dim(`     Free to start. Go to this link and click "Create API key":`));
    console.log(`     ${sky("https://aistudio.google.com/apikey")}`);
    console.log("");
    console.log(`  ${sky("2)")} ${bold("Vertex AI")} ${dim("(For production / higher quotas)")}`);
    console.log(dim(`     Needs a Google Cloud project with billing.`));
    console.log(dim(`     Only choose this if you already have a GCP account.`));
    console.log("");

    const existingKey = process.env.GEMINI_API_KEY;
    const existingVertexProject = process.env.GOOGLE_CLOUD_PROJECT;
    let apiKey = "";
    let useVertexAI = false;

    if (existingVertexProject) {
      console.log(green(`  ✓ Found Vertex AI project: ${existingVertexProject}`));
      console.log(dim("  Using Vertex AI for higher quotas.\n"));
      useVertexAI = true;
    } else if (existingKey) {
      const masked = existingKey.slice(0, 8) + "..." + existingKey.slice(-4);
      console.log(green(`  ✓ Found existing API key: ${masked}\n`));
      apiKey = existingKey;
    } else {
      const choice = await ask(rl, sky("  Select [1/2] (default: 1): "));

      if (choice.trim() === "2") {
        console.log("");
        console.log(dim("  To use Vertex AI, you need:"));
        console.log(dim("  1. A Google Cloud project with Vertex AI API enabled"));
        console.log(dim("  2. A service account key JSON file"));
        console.log(dim("  3. Set these environment variables in .env:"));
        console.log("");
        console.log(sky("     GOOGLE_CLOUD_PROJECT=your-project-id"));
        console.log(sky("     GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json"));
        console.log("");
        console.log(dim("  Quick setup guide:"));
        console.log(dim(`  ${sky("https://cloud.google.com/vertex-ai/docs/authentication")}`));
        console.log("");
        const vertexProject = await ask(rl, sky("  Enter your project ID (or press Enter to skip): "));
        if (vertexProject.trim()) {
          useVertexAI = true;
          // Will save to .env later
        } else {
          console.log(dim("  Skipping Vertex AI. You can set it up later in .env\n"));
        }
      } else {
        console.log("");
        console.log(dim("  How to get your key:"));
        console.log(`  ${sky("1.")} Open ${sky("https://aistudio.google.com/apikey")}`);
        console.log(`  ${sky("2.")} Sign in with your Google account`);
        console.log(`  ${sky("3.")} Click ${bold("\"Create API key\"")}`);
        console.log(`  ${sky("4.")} Copy the key (starts with ${bold("AIza")}...)`);
        console.log("");
        apiKey = await ask(rl, sky("  Paste your Gemini API key here: "));
        apiKey = apiKey.trim();

        if (apiKey && !apiKey.startsWith("AIza")) {
          console.log(yellowBright("\n  ⚠ Key doesn't start with 'AIza'. Double-check it's correct."));
          const proceed = await ask(rl, dim("  Continue anyway? [y/N]: "));
          if (!proceed.trim().toLowerCase().startsWith("y")) {
            apiKey = "";
            console.log(dim("  Skipped. Set GEMINI_API_KEY in .env later.\n"));
          }
        } else if (!apiKey) {
          console.log(dim("  Skipped. Set GEMINI_API_KEY in .env later.\n"));
        }
      }
    }

    // ── Step 2a+: Additional AI Providers (optional) ────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.cyan("▸")} Additional AI Providers (Optional)\n`));
    console.log(dim("  Wispy's core engine runs on Gemini. You can also configure"));
    console.log(dim("  other providers as tools the agent can delegate tasks to.\n"));
    console.log(`  ${sky("1)")} ${bold("Anthropic")} ${dim("(Claude Opus, Sonnet)")}`);
    console.log(`  ${sky("2)")} ${bold("OpenAI")} ${dim("(GPT-4o, Codex, o3)")}`);
    console.log(`  ${sky("3)")} ${bold("Groq")} ${dim("(Ultra-fast inference, free tier)")}`);
    console.log(`  ${sky("4)")} ${bold("OpenRouter")} ${dim("(200+ models, unified API)")}`);
    console.log(`  ${sky("5)")} ${bold("Kimi / Moonshot")} ${dim("(128K context, long docs)")}`);
    console.log(`  ${sky("6)")} ${bold("Ollama")} ${dim("(Local, free, offline)")}`);
    console.log("");

    let anthropicKey = process.env.ANTHROPIC_API_KEY || "";
    let openaiKey = process.env.OPENAI_API_KEY || "";
    let groqKey = process.env.GROQ_API_KEY || "";
    let openrouterKey = process.env.OPENROUTER_API_KEY || "";
    let kimiKey = process.env.MOONSHOT_API_KEY || "";
    let ollamaUrl = "";

    const addProviders = await ask(rl, sky("  Add providers? Enter numbers (e.g. 1,3) or press Enter to skip: "));

    if (addProviders.trim()) {
      const picks = parseNumberList(addProviders, 6);
      console.log("");

      for (const idx of picks) {
        switch (idx) {
          case 0: { // Anthropic
            if (anthropicKey) {
              const masked = anthropicKey.slice(0, 10) + "..." + anthropicKey.slice(-4);
              console.log(green(`  ✓ Anthropic key found: ${masked}`));
            } else {
              console.log(dim(`  Get your key at: ${sky("https://console.anthropic.com/keys")}`));
              const key = await ask(rl, sky("  Anthropic API key (sk-ant-...): "));
              anthropicKey = key.trim();
              if (anthropicKey) console.log(green("  ✓ Anthropic configured"));
              else console.log(dim("  Skipped."));
            }
            console.log("");
            break;
          }
          case 1: { // OpenAI
            if (openaiKey) {
              const masked = openaiKey.slice(0, 8) + "..." + openaiKey.slice(-4);
              console.log(green(`  ✓ OpenAI key found: ${masked}`));
            } else {
              console.log(dim(`  Get your key at: ${sky("https://platform.openai.com/api-keys")}`));
              const key = await ask(rl, sky("  OpenAI API key (sk-...): "));
              openaiKey = key.trim();
              if (openaiKey) console.log(green("  ✓ OpenAI configured"));
              else console.log(dim("  Skipped."));
            }
            console.log("");
            break;
          }
          case 2: { // Groq
            if (groqKey) {
              const masked = groqKey.slice(0, 8) + "..." + groqKey.slice(-4);
              console.log(green(`  ✓ Groq key found: ${masked}`));
            } else {
              console.log(dim(`  Get your key at: ${sky("https://console.groq.com/keys")}`));
              const key = await ask(rl, sky("  Groq API key (gsk_...): "));
              groqKey = key.trim();
              if (groqKey) console.log(green("  ✓ Groq configured"));
              else console.log(dim("  Skipped."));
            }
            console.log("");
            break;
          }
          case 3: { // OpenRouter
            if (openrouterKey) {
              const masked = openrouterKey.slice(0, 10) + "..." + openrouterKey.slice(-4);
              console.log(green(`  ✓ OpenRouter key found: ${masked}`));
            } else {
              console.log(dim(`  Get your key at: ${sky("https://openrouter.ai/keys")}`));
              const key = await ask(rl, sky("  OpenRouter API key (sk-or-...): "));
              openrouterKey = key.trim();
              if (openrouterKey) console.log(green("  ✓ OpenRouter configured"));
              else console.log(dim("  Skipped."));
            }
            console.log("");
            break;
          }
          case 4: { // Kimi
            if (kimiKey) {
              const masked = kimiKey.slice(0, 8) + "..." + kimiKey.slice(-4);
              console.log(green(`  ✓ Kimi key found: ${masked}`));
            } else {
              console.log(dim(`  Get your key at: ${sky("https://platform.moonshot.cn/console/api-keys")}`));
              const key = await ask(rl, sky("  Moonshot API key: "));
              kimiKey = key.trim();
              if (kimiKey) console.log(green("  ✓ Kimi configured"));
              else console.log(dim("  Skipped."));
            }
            console.log("");
            break;
          }
          case 5: { // Ollama
            console.log(dim("  Make sure Ollama is running locally."));
            console.log(dim(`  Install: ${sky("https://ollama.com/download")}`));
            const url = await ask(rl, sky("  Ollama URL (default: http://localhost:11434): "));
            ollamaUrl = url.trim() || "http://localhost:11434";
            console.log(green(`  ✓ Ollama: ${ollamaUrl}`));
            console.log("");
            break;
          }
        }
      }
    } else {
      console.log(dim("  Skipped. You can add providers later in .env or config.yaml.\n"));
    }

    // ── Step 2b: Telegram Bot Token (optional) ──────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.blue("▸")} Step 2 of 4: Telegram Bot (Optional)\n`));
    console.log(dim("  Connect Telegram to chat with Wispy from your phone."));
    console.log(dim("  Skip this if you only want to use the terminal.\n"));
    console.log(dim("  How to create a Telegram bot (takes 1 minute):"));
    console.log(`  ${sky("1.")} Open Telegram and search for ${bold("@BotFather")}`);
    console.log(`  ${sky("2.")} Send the message: ${sky("/newbot")}`);
    console.log(`  ${sky("3.")} Choose a name for your bot (e.g. "My Wispy")`);
    console.log(`  ${sky("4.")} Choose a username (e.g. "my_wispy_bot")`);
    console.log(`  ${sky("5.")} BotFather will reply with a ${bold("token")} like: ${dim("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11")}`);
    console.log(`  ${sky("6.")} Copy that token`);
    console.log("");

    const existingTelegramToken = process.env.TELEGRAM_BOT_TOKEN;
    let telegramToken = "";

    if (existingTelegramToken) {
      const masked = existingTelegramToken.slice(0, 10) + "...";
      console.log(green(`  ✓ Found existing token: ${masked}\n`));
      telegramToken = existingTelegramToken;
    } else {
      telegramToken = await ask(rl, sky("  Paste your bot token here (or press Enter to skip): "));
      telegramToken = telegramToken.trim();

      if (!telegramToken) {
        console.log(dim("  Skipped. You can add TELEGRAM_BOT_TOKEN to .env later.\n"));
      }
    }

    // ── Step 2c: Autonomous Mode ──────────────────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.yellow("▸")} Step 3 of 4: How Should Wispy Work?\n`));
    console.log(dim("  Choose how much freedom Wispy gets:\n"));
    console.log(`  ${sky("1)")} ${bold("Standard Mode")} ${dim("(Ask before acting)")}`);
    console.log(dim("     Wispy will ask your permission before writing files or running code."));
    console.log(dim("     Best for: Beginners, shared computers, production servers.\n"));
    console.log(`  ${sky("2)")} ${bold("Autonomous Mode")} ${dim("(Recommended)")}`);
    console.log(dim("     Wispy acts on its own -- writes files, runs code, creates projects."));
    console.log(dim("     Best for: Personal computer, development, getting things done fast.\n"));

    const modeChoice = await ask(rl, sky("  Select [1/2] (default: 2 for Autonomous): "));
    const autonomousMode = modeChoice.trim() !== "1";

    // ── Step 2d: File System Access ──────────────────────
    let fullFilesystemAccess = false;
    if (autonomousMode) {
      console.clear();
      console.log(WISPY_ASCII);
      console.log(skyBold(`  ${chalk.yellow("▸")} File System Access\n`));
      console.log(dim("  Autonomous mode is enabled. Wispy can already write files in its workspace."));
      console.log(dim("  Enable full filesystem access to let Wispy work on projects anywhere.\n"));
      console.log(`  ${sky("Examples:")}`);
      console.log(dim("  - Edit files across your projects directories"));
      console.log(dim("  - Read/write anywhere on your drive"));
      console.log(dim("  - Manage files in your Downloads folder\n"));

      const fsChoice = await ask(rl, sky("  Enable full filesystem access? [Y/n]: "));
      fullFilesystemAccess = !fsChoice.trim().toLowerCase().startsWith("n");
    }

    // ── Step 3: Theme ────────────────────────────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.magenta("▸")} Pick a Color Theme\n`));
    console.log(dim("  This changes how Wispy looks in your terminal.\n"));

    for (let i = 0; i < THEMES.length; i++) {
      const num = sky(`${i + 1})`);
      console.log(`  ${num} ${THEMES[i].label}`);
    }

    const themeInput = await ask(rl, sky("\n  Select [1-4] (default: 2): "));
    const themeIdx = parseInt(themeInput.trim(), 10);
    const selectedTheme =
      themeIdx >= 1 && themeIdx <= 4
        ? THEMES[themeIdx - 1].key
        : "day";

    // ── Step 4: Agents ───────────────────────────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.cyan("▸")} Choose Agent Roles\n`));
    console.log(dim("  These are Wispy's specializations. Coder + Researcher are pre-selected."));
    console.log(dim("  Just press Enter to keep the defaults, or pick more.\n"));

    for (let i = 0; i < AGENTS.length; i++) {
      const mark = AGENTS[i].defaultOn ? green("[x]") : dim("[ ]");
      const num = sky(`${i + 1})`);
      console.log(`  ${mark} ${num} ${AGENTS[i].label}`);
    }

    const agentInput = await ask(rl, sky("\n  Enter numbers separated by commas (default: 1,2): "));
    let selectedAgents: string[];

    if (!agentInput.trim()) {
      selectedAgents = AGENTS.filter((a) => a.defaultOn).map((a) => a.id);
    } else {
      const indices = parseNumberList(agentInput, AGENTS.length);
      selectedAgents = indices.length > 0
        ? indices.map((i) => AGENTS[i].id)
        : AGENTS.filter((a) => a.defaultOn).map((a) => a.id);
    }

    // ── Step 5: Integrations ─────────────────────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.blue("▸")} Connect Apps (Optional)\n`));
    console.log(dim("  Connect Wispy to services you use. Skip for now if unsure."));
    console.log(dim("  You can always enable these later: wispy integrations enable <name>\n"));

    // Display in two columns
    const half = Math.ceil(INTEGRATIONS.length / 2);
    for (let i = 0; i < half; i++) {
      const left = `${dim("[ ]")} ${sky(`${i + 1})`)} ${INTEGRATIONS[i].label}`;
      const rightIdx = i + half;
      const right =
        rightIdx < INTEGRATIONS.length
          ? `${dim("[ ]")} ${sky(`${rightIdx + 1})`)} ${INTEGRATIONS[rightIdx].label}`
          : "";
      console.log(`  ${left.padEnd(38)}${right}`);
    }

    const intInput = await ask(rl, sky("\n  Enter numbers to enable (or press Enter to skip): "));
    let selectedIntegrations: string[];

    if (!intInput.trim()) {
      selectedIntegrations = [];
    } else {
      const indices = parseNumberList(intInput, INTEGRATIONS.length);
      selectedIntegrations = indices.map((i) => INTEGRATIONS[i].id);
    }

    // ── Step 6: MCP Servers ─────────────────────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.green("▸")} Extra Tools (MCP Servers)\n`));
    console.log(dim("  These give Wispy extra abilities like reading files or browsing the web."));
    console.log(dim("  The defaults (File System + Web Fetch) are recommended. Just press Enter.\n"));

    const MCP_SERVERS = [
      {
        id: "filesystem",
        label: "File System — Read/write files anywhere (Recommended)",
        command: "npx",
        args: ["-y", "@anthropic/mcp-server-filesystem", "--allow-write", "/"],
        default: true,
      },
      {
        id: "fetch",
        label: "Web Fetch   — Make HTTP requests with headers & auth",
        command: "npx",
        args: ["-y", "@anthropic/mcp-server-fetch"],
        default: true,
      },
      {
        id: "memory",
        label: "Memory      — Persistent key-value storage",
        command: "npx",
        args: ["-y", "@anthropic/mcp-server-memory"],
        default: false,
      },
      {
        id: "brave",
        label: "Brave Search— Web search via Brave API",
        command: "npx",
        args: ["-y", "@anthropic/mcp-server-brave-search"],
        default: false,
        envRequired: "BRAVE_API_KEY",
      },
      {
        id: "github",
        label: "GitHub      — Access repos, issues, PRs",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        default: false,
        envRequired: "GITHUB_TOKEN",
      },
      {
        id: "postgres",
        label: "PostgreSQL  — Query databases directly",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        default: false,
        envRequired: "DATABASE_URL",
      },
    ];

    for (let i = 0; i < MCP_SERVERS.length; i++) {
      const mark = MCP_SERVERS[i].default ? green("[x]") : dim("[ ]");
      const num = sky(`${i + 1})`);
      const envNote = MCP_SERVERS[i].envRequired ? dim(` (needs ${MCP_SERVERS[i].envRequired})`) : "";
      console.log(`  ${mark} ${num} ${MCP_SERVERS[i].label}${envNote}`);
    }

    console.log("");
    console.log(dim("  MCP servers run alongside the gateway and provide additional tools."));
    console.log(dim(`  Learn more: ${sky("https://modelcontextprotocol.io")}\n`));

    const mcpInput = await ask(rl, sky("  Enter numbers to enable (default: 1,2): "));
    let selectedMCPs: typeof MCP_SERVERS;

    if (!mcpInput.trim()) {
      selectedMCPs = MCP_SERVERS.filter((m) => m.default);
    } else {
      const indices = parseNumberList(mcpInput, MCP_SERVERS.length);
      selectedMCPs = indices.length > 0
        ? indices.map((i) => MCP_SERVERS[i])
        : MCP_SERVERS.filter((m) => m.default);
    }

    // ── Step 7: x402 Agentic Commerce ──────────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.hex('#00FFA3')("▸")} Step 4 of 4: Blockchain Wallet (Optional)\n`));
    console.log(dim("  Give Wispy a wallet so it can pay for services automatically."));
    console.log(dim("  Uses USDC on SKALE (gasless -- no transaction fees).\n"));
    console.log(dim("  What this enables:"));
    console.log(`  ${chalk.hex('#00FFA3')("•")} Agent pays for APIs on its own (micro-payments)`);
    console.log(`  ${chalk.hex('#00FFA3')("•")} DeFi trading with built-in risk controls`);
    console.log(`  ${chalk.hex('#00FFA3')("•")} Encrypted conditional payments (BITE v2)`);
    console.log("");
    console.log(dim("  Skip this if you just want to use Wispy for chat and coding.\n"));

    const existingAgentKey = process.env.AGENT_PRIVATE_KEY;
    let agentPrivateKey = "";
    let commerceEnabled = false;

    if (existingAgentKey) {
      const masked = existingAgentKey.slice(0, 6) + "..." + existingAgentKey.slice(-4);
      console.log(green(`  ✓ Found wallet key: ${masked}\n`));
      agentPrivateKey = existingAgentKey;
      commerceEnabled = true;
    } else {
      const enableChoice = await ask(rl, sky("  Enable x402 commerce? [Y/n]: "));

      if (!enableChoice.trim() || enableChoice.trim().toLowerCase().startsWith("y")) {
        console.log("");
        console.log(`  ${sky("1)")} ${bold("Generate a new wallet")} ${dim("(Recommended -- creates one for you)")}`);
        console.log(`  ${sky("2)")} ${bold("Use an existing wallet")} ${dim("(Paste your private key)")}`);
        console.log("");

        const keyChoice = await ask(rl, sky("  Select [1/2] (default: 1): "));

        if (keyChoice.trim() === "2") {
          const keyInput = await ask(rl, sky("  Enter private key (0x...): "));
          agentPrivateKey = keyInput.trim();
          if (agentPrivateKey && !agentPrivateKey.startsWith("0x")) {
            agentPrivateKey = "0x" + agentPrivateKey;
          }
        } else {
          // Generate a new wallet with recovery phrase
          try {
            const { ethers } = await import("ethers");
            const wallet = ethers.Wallet.createRandom();
            agentPrivateKey = wallet.privateKey;
            const mnemonic = wallet.mnemonic?.phrase || "";
            console.log("");
            console.log(green(`  ✓ Generated new wallet!\n`));
            console.log(`  ${dim("Address:")} ${sky(wallet.address)}`);
            if (mnemonic) {
              console.log("");
              console.log(yellowBright(`  ┌─────────────────────────────────────────────────┐`));
              console.log(yellowBright(`  │  RECOVERY PHRASE — Write this down on paper!    │`));
              console.log(yellowBright(`  └─────────────────────────────────────────────────┘`));
              console.log("");
              const words = mnemonic.split(" ");
              for (let i = 0; i < words.length; i += 3) {
                const row = words.slice(i, i + 3).map((w, j) => {
                  const num = String(i + j + 1).padStart(2, " ");
                  return `${dim(num + ".")} ${bold(w.padEnd(10))}`;
                }).join("  ");
                console.log(`    ${row}`);
              }
              console.log("");
              console.log(yellowBright("  ⚠ This is the ONLY time you will see this phrase."));
              console.log(dim("    You can recover your wallet with these 12 words."));
              console.log(dim("    Never share them. Never type them online.\n"));
              await ask(rl, dim("  Press Enter once you have saved your recovery phrase..."));
            }
          } catch {
            console.log(yellowBright("  ⚠ Could not generate wallet."));
            console.log(dim("  Add AGENT_PRIVATE_KEY=0x... to .env manually.\n"));
          }
        }

        if (agentPrivateKey) {
          commerceEnabled = true;
        }
      } else {
        console.log(dim("\n  Skipped. Enable later by adding AGENT_PRIVATE_KEY to .env\n"));
      }
    }

    // Optional CDP wallet (advanced)
    let cdpKeyName = process.env.CDP_API_KEY_NAME || "";
    let cdpPrivateKey = process.env.CDP_PRIVATE_KEY || "";

    if (commerceEnabled && !cdpKeyName) {
      console.log("");
      console.log(dim("  Optional: Coinbase Developer Platform (CDP) wallet"));
      console.log(dim("  Provides custodial wallet management. Skip if unsure.\n"));
      const cdpChoice = await ask(rl, sky("  Configure CDP wallet? [y/N]: "));

      if (cdpChoice.trim().toLowerCase().startsWith("y")) {
        console.log(dim("\n  Get credentials at: https://portal.cdp.coinbase.com/\n"));
        cdpKeyName = (await ask(rl, sky("  CDP API Key Name: "))).trim();
        cdpPrivateKey = (await ask(rl, sky("  CDP Private Key: "))).trim();
      }
    }

    await ask(rl, dim("\n  Press Enter to continue..."));

    // ── Step 8: Voice/TTS Setup (Edge TTS) ─────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.hex('#FF6B6B')("▸")} Voice (Optional)\n`));
    console.log(dim("  Let Wispy speak responses aloud in Telegram voice messages."));
    console.log(dim("  Uses Edge TTS -- free, fast, and natural-sounding.\n"));
    console.log(`  ${chalk.hex('#FF6B6B')("Features:")}`);
    console.log(`  ${sky("•")} Multiple natural voices (male/female, various accents)`);
    console.log(`  ${sky("•")} Fast generation (2-3 seconds)`);
    console.log(`  ${sky("•")} No API key required`);
    console.log(`  ${sky("•")} Works on any system (no GPU needed)`);
    console.log("");

    // Check if Edge TTS is installed
    let voiceInstalled = false;
    try {
      const { execSync } = await import("child_process");
      execSync("python -m edge_tts --version", { stdio: "pipe", timeout: 5000 });
      voiceInstalled = true;
    } catch {
      voiceInstalled = false;
    }

    if (voiceInstalled) {
      console.log(green("  ✓ Edge TTS is already installed!\n"));
    } else {
      console.log(yellowBright("  ⚠ Edge TTS not installed"));
      console.log(dim("  Required for natural voice messages in Telegram.\n"));

      const installChoice = await ask(rl, sky("  Install Edge TTS now? [Y/n]: "));

      if (!installChoice.trim() || installChoice.trim().toLowerCase().startsWith("y")) {
        console.log("");
        console.log(dim("  Installing Edge TTS..."));

        try {
          const { execSync } = await import("child_process");
          execSync("pip install edge-tts", {
            stdio: "inherit",
            timeout: 120000,
          });
          voiceInstalled = true;
          console.log("");
          console.log(green("  ✓ Edge TTS installed successfully!"));
        } catch (installErr: any) {
          console.log("");
          console.log(yellowBright("  ⚠ Installation failed. You can install manually later:"));
          console.log(sky("     pip install edge-tts"));
        }
      } else {
        console.log(dim("\n  Skipped. Install later with: pip install edge-tts\n"));
      }
    }

    // Keep variable name for backward compatibility
    const chatterboxInstalled = voiceInstalled;

    // Qwen3-TTS via HuggingFace Spaces (cloud-based, no local GPU needed)
    let qwen3Installed = false;
    try {
      const { execSync } = await import("child_process");
      execSync('python -c "from gradio_client import Client"', { stdio: "pipe", timeout: 10000 });
      qwen3Installed = true;
    } catch {
      qwen3Installed = false;
    }

    console.log("");
    console.log(chalk.hex('#FF6B6B')("  Optional: Qwen3-TTS (Premium Voice)"));
    console.log(dim("  Best quality TTS via HuggingFace Spaces (cloud-based)."));
    console.log(dim("  No local GPU needed - runs on HuggingFace servers!\n"));
    console.log(`  ${sky("•")} 10 languages: English, Chinese, Japanese, Korean, etc.`);
    console.log(`  ${sky("•")} 9 voices: Serena, Ryan, Vivian, Dylan, Aiden, etc.`);
    console.log(`  ${sky("•")} Emotion & style control via natural language`);
    console.log(`  ${sky("•")} Free to use (HuggingFace Spaces)`);
    console.log("");

    if (qwen3Installed) {
      console.log(green("  ✓ Qwen3-TTS client is ready!\n"));
    } else {
      console.log(yellowBright("  ⚠ gradio_client not installed"));
      console.log(dim("  Required for Qwen3-TTS cloud API.\n"));

      const installChoice = await ask(rl, sky("  Install gradio_client now? [Y/n]: "));

      if (!installChoice.trim() || installChoice.trim().toLowerCase().startsWith("y")) {
        console.log("");
        console.log(dim("  Installing gradio_client..."));

        try {
          const { execSync } = await import("child_process");
          execSync("pip install gradio_client -q", {
            stdio: "inherit",
            timeout: 120000,
          });
          qwen3Installed = true;
          console.log("");
          console.log(green("  ✓ Qwen3-TTS client installed successfully!"));
        } catch (installErr: any) {
          console.log("");
          console.log(yellowBright("  ⚠ Installation failed. You can install manually later:"));
          console.log(sky("     pip install gradio_client"));
        }
      } else {
        console.log(dim("\n  Skipped. Edge TTS will be used (still sounds great!).\n"));
      }
    }

    await ask(rl, dim("\n  Press Enter to continue..."));

    rl.close();

    // ── Save config ──────────────────────────────────────

    // Ensure runtime directory exists
    fs.mkdirSync(runtimeDir, { recursive: true });

    const config = {
      agent: { name: "wispy", id: "main" },
      gemini: {
        models: {
          pro: "gemini-2.5-pro-preview-05-06",
          flash: "gemini-2.5-flash-preview-05-20",
          image: "gemini-2.0-flash",
          embedding: "text-embedding-004",
        },
      },
      channels: {
        web: { enabled: true, port: 4000 },
        rest: { enabled: true, port: 4001 },
        telegram: { enabled: !!telegramToken, token: telegramToken || undefined },
        whatsapp: { enabled: false },
      },
      providers: {
        ...(anthropicKey ? { anthropic: { apiKey: anthropicKey } } : {}),
        ...(openaiKey ? { openai: { apiKey: openaiKey } } : {}),
        ...(groqKey ? { groq: { apiKey: groqKey } } : {}),
        ...(openrouterKey ? { openrouter: { apiKey: openrouterKey } } : {}),
        ...(kimiKey ? { kimi: { apiKey: kimiKey } } : {}),
        ...(ollamaUrl ? { ollama: { baseUrl: ollamaUrl } } : {}),
      },
      browser: { enabled: true },
      wallet: { enabled: commerceEnabled, chain: "skale-bite-sandbox" },
      memory: { embeddingDimensions: 768, heartbeatIntervalMinutes: 30, hybridSearch: true },
      security: { requireApprovalForExternal: !autonomousMode, allowedGroups: [] as string[], autonomousMode, fullFilesystemAccess },
      thinking: { defaultLevel: "medium", costAware: true },
      theme: selectedTheme,
      agents: selectedAgents,
      integrations: selectedIntegrations,
    };

    const configPath = path.resolve(runtimeDir, "config.yaml");
    writeYAML(configPath, config);

    // ── Save MCP server configuration ───────────────────
    const mcpDir = path.resolve(runtimeDir, "mcp");
    fs.mkdirSync(mcpDir, { recursive: true });

    const mcpConfig = {
      servers: selectedMCPs.map((m) => ({
        id: m.id,
        command: m.command,
        args: m.args,
        enabled: true,
        env: {},
      })),
    };

    const mcpConfigPath = path.resolve(mcpDir, "servers.json");
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

    // Save credentials to .env
    const envPath = path.resolve(rootDir, ".env");
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

    // Add API key if new
    if (apiKey && !existingKey) {
      if (!envContent.includes("GEMINI_API_KEY=")) {
        envContent += `\nGEMINI_API_KEY=${apiKey}`;
      }
    }

    // Add Telegram token if new
    if (telegramToken && !existingTelegramToken) {
      if (!envContent.includes("TELEGRAM_BOT_TOKEN=")) {
        envContent += `\nTELEGRAM_BOT_TOKEN=${telegramToken}`;
      }
    }

    // Add additional provider keys
    if (anthropicKey && !process.env.ANTHROPIC_API_KEY) {
      if (!envContent.includes("ANTHROPIC_API_KEY=")) {
        envContent += `\nANTHROPIC_API_KEY=${anthropicKey}`;
      }
    }
    if (openaiKey && !process.env.OPENAI_API_KEY) {
      if (!envContent.includes("OPENAI_API_KEY=")) {
        envContent += `\nOPENAI_API_KEY=${openaiKey}`;
      }
    }
    if (groqKey && !process.env.GROQ_API_KEY) {
      if (!envContent.includes("GROQ_API_KEY=")) {
        envContent += `\nGROQ_API_KEY=${groqKey}`;
      }
    }
    if (openrouterKey && !process.env.OPENROUTER_API_KEY) {
      if (!envContent.includes("OPENROUTER_API_KEY=")) {
        envContent += `\nOPENROUTER_API_KEY=${openrouterKey}`;
      }
    }
    if (kimiKey && !process.env.MOONSHOT_API_KEY) {
      if (!envContent.includes("MOONSHOT_API_KEY=")) {
        envContent += `\nMOONSHOT_API_KEY=${kimiKey}`;
      }
    }

    // Add x402 commerce keys
    if (agentPrivateKey && !existingAgentKey) {
      if (!envContent.includes("AGENT_PRIVATE_KEY=")) {
        envContent += `\n\n# x402 Agentic Commerce\nAGENT_PRIVATE_KEY=${agentPrivateKey}`;
      }
    }
    if (cdpKeyName && !envContent.includes("CDP_API_KEY_NAME=")) {
      envContent += `\nCDP_API_KEY_NAME=${cdpKeyName}`;
    }
    if (cdpPrivateKey && !envContent.includes("CDP_PRIVATE_KEY=")) {
      envContent += `\nCDP_PRIVATE_KEY=${cdpPrivateKey}`;
    }

    // Write .env if we have content
    if (envContent.trim()) {
      fs.writeFileSync(envPath, envContent.trim() + "\n");
    }

    // ── Step 9: Summary ──────────────────────────────────
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${chalk.green("✓")} Setup complete!\n`));

    const themeDisplay = `${capitalize(selectedTheme)} ${THEME_ICON[selectedTheme] || ""}`;
    const agentsDisplay = selectedAgents.map(capitalize).join(", ");
    const intDisplay =
      selectedIntegrations.length > 0
        ? selectedIntegrations.map((id) => {
            const found = INTEGRATIONS.find((i) => i.id === id);
            return found ? found.label : id;
          }).join(", ")
        : "None (enable later with /integrations)";
    const mcpDisplay =
      selectedMCPs.length > 0
        ? selectedMCPs.map((m) => capitalize(m.id)).join(", ")
        : "None";

    const aiDisplay = useVertexAI ? "Vertex AI (high quota)" : apiKey ? "Gemini API" : "Not configured";
    const extraProviders: string[] = [];
    if (anthropicKey) extraProviders.push("Anthropic");
    if (openaiKey) extraProviders.push("OpenAI");
    if (groqKey) extraProviders.push("Groq");
    if (openrouterKey) extraProviders.push("OpenRouter");
    if (kimiKey) extraProviders.push("Kimi");
    if (ollamaUrl) extraProviders.push("Ollama");
    const providersDisplay = extraProviders.length > 0 ? extraProviders.join(", ") : dim("None");
    const telegramDisplay = telegramToken ? green("Enabled") : dim("Not configured");
    const modeDisplay = autonomousMode
      ? chalk.yellow("⚡ Autonomous") + dim(" (auto-approve file/code ops)")
      : green("🛡️ Standard") + dim(" (requires approval)");
    const voiceDisplay = qwen3Installed
      ? green("✓ Qwen3-TTS") + dim(" (premium, multilingual)")
      : (chatterboxInstalled
          ? green("✓ Edge TTS") + dim(" (natural voice)")
          : dim("Not installed"));

    const commerceDisplay = commerceEnabled
      ? green("✓ Enabled") + dim(` (${cdpKeyName ? "CDP wallet" : "raw key"})`)
      : dim("Not configured");

    const fsDisplay = fullFilesystemAccess
      ? chalk.yellow("⚡ Full Access") + dim(" (entire drive)")
      : dim("Workspace only");

    console.log(`  ${dim("AI Provider:")}  ${aiDisplay}`);
    console.log(`  ${dim("Providers:")}    ${providersDisplay}`);
    console.log(`  ${dim("Mode:")}         ${modeDisplay}`);
    console.log(`  ${dim("File System:")}  ${fsDisplay}`);
    console.log(`  ${dim("Theme:")}        ${themeDisplay}`);
    console.log(`  ${dim("Agents:")}       ${agentsDisplay}`);
    console.log(`  ${dim("Telegram:")}     ${telegramDisplay}`);
    console.log(`  ${dim("x402 Commerce:")} ${commerceDisplay}`);
    console.log(`  ${dim("Voice:")}        ${voiceDisplay}`);
    console.log(`  ${dim("MCP Servers:")}  ${mcpDisplay}`);
    console.log(`  ${dim("Integrations:")} ${intDisplay}`);
    console.log("");

    if (!apiKey && !useVertexAI) {
      console.log(yellowBright("  ⚠ No AI credentials configured!"));
      console.log(dim("  To fix: add GEMINI_API_KEY=your-key-here to the .env file"));
      console.log(dim(`  Get a free key: ${sky("https://aistudio.google.com/apikey")}`));
      console.log("");
    }

    console.log(skyBold("  What to do next:\n"));
    console.log(`  ${sky("wispy chat")}             Start chatting with Wispy`);
    console.log(`  ${sky("wispy gateway")}          Start the server (Telegram + REST + Web)`);
    console.log(`  ${sky("wispy doctor")}           Check if everything is working`);
    console.log(`  ${sky("wispy onboard")}          Re-run this wizard anytime`);
    console.log("");
    console.log(dim("  Try saying: \"Build me a todo app\" or \"Research AI trends in 2026\""));
    console.log("");
    console.log(dim("  Docs:     https://docs.wispy.cc"));
    console.log(dim("  Help:     https://github.com/hausorlabs/wispy/issues"));
    console.log("");
  } catch (err: any) {
    rl.close();
    if (err?.message === "Setup cancelled.") {
      console.log(dim("\n  Setup cancelled.\n"));
      process.exit(0);
    }
    throw err;
  }
}
