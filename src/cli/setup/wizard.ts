/**
 * Interactive setup wizard — comprehensive first-run onboarding.
 *
 * Steps:
 *  1. Welcome
 *  2. AI Engine + API Keys
 *  3. Channels (Telegram, Discord, Slack, WhatsApp, Matrix, Signal, Email, Phone)
 *  4. Integrations (Google, Productivity, Social, Smart Home, Commerce, Security)
 *  5. Wallet & Commerce (x402)
 *  6. Security & Mode
 *  7. Extras (Voice, MCP, Theme, Agents, Memory)
 *  8. Summary
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import gradient from "gradient-string";
import { writeYAML } from "../../utils/file.js";

// ── Brand ────────────────────────────────────────────────
const sky = chalk.rgb(49, 204, 255);
const skyBold = chalk.rgb(49, 204, 255).bold;
const dim = chalk.dim;
const bold = chalk.bold;
const green = chalk.green;
const yellow = chalk.yellowBright;
const accent = chalk.hex("#00FFA3");

const wizardGradient = gradient(["#31CCFF", "#7B61FF", "#31CCFF"]);

const WISPY_ASCII_RAW = [
  "\u2588\u2588\u2557    \u2588\u2588\u2557 \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2557   \u2588\u2588\u2557",
  "\u2588\u2588\u2551    \u2588\u2588\u2551 \u2588\u2588\u2551 \u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557 \u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D",
  "\u2588\u2588\u2551 \u2588\u2557 \u2588\u2588\u2551 \u2588\u2588\u2551 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D  \u255A\u2588\u2588\u2588\u2588\u2554\u255D ",
  "\u2588\u2588\u2551\u2588\u2588\u2588\u2557\u2588\u2588\u2551 \u2588\u2588\u2551 \u255A\u2550\u2550\u2550\u2550\u2588\u2588\u2551 \u2588\u2588\u2554\u2550\u2550\u2550\u255D    \u255A\u2588\u2588\u2554\u255D  ",
  "\u255A\u2588\u2588\u2588\u2554\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2551 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551 \u2588\u2588\u2551         \u2588\u2588\u2551   ",
  " \u255A\u2550\u2550\u255D\u255A\u2550\u2550\u255D  \u255A\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D         \u255A\u2550\u255D   ",
];

const WISPY_ASCII =
  "\n" +
  WISPY_ASCII_RAW.map((line) => `  ${wizardGradient(line)}`).join("\n") +
  "\n";

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

function masked(key: string, prefixLen = 8, suffixLen = 4): string {
  if (key.length < prefixLen + suffixLen + 4) return key.slice(0, 4) + "...";
  return key.slice(0, prefixLen) + "..." + key.slice(-suffixLen);
}

function stepHeader(step: number, total: number, title: string, icon: string): void {
  console.clear();
  console.log(WISPY_ASCII);
  const progress = dim(`[${step}/${total}]`);
  console.log(skyBold(`  ${icon} Step ${step} of ${total}: ${title}  ${progress}\n`));
}

function envOrEmpty(name: string): string {
  return process.env[name] || "";
}

// ── Definitions ──────────────────────────────────────────

const THEMES = [
  { key: "dawn", label: `${chalk.yellow("\u25C9")}  Dawn   -- Warm sunrise tones` },
  { key: "day", label: `${sky("\u25C9")}  Day    -- Clean sky blue (default)` },
  { key: "dusk", label: `${chalk.magenta("\u25C9")} Dusk   -- Twilight purple` },
  { key: "night", label: `${chalk.blue("\u25C9")} Night  -- Deep dark mode` },
] as const;

const THEME_ICON: Record<string, string> = {
  dawn: chalk.yellow("\u25C9"),
  day: sky("\u25C9"),
  dusk: chalk.magenta("\u25C9"),
  night: chalk.blue("\u25C9"),
};

const AGENTS = [
  { id: "coder", label: "Coder      -- Code generation, debugging, refactoring", defaultOn: true },
  { id: "researcher", label: "Researcher -- Web search, analysis, summarization", defaultOn: true },
  { id: "writer", label: "Writer     -- Content creation, copywriting, docs", defaultOn: false },
  { id: "devops", label: "DevOps     -- CI/CD, deployment, infrastructure", defaultOn: false },
  { id: "designer", label: "Designer   -- UI/UX design, accessibility", defaultOn: false },
  { id: "data", label: "Data       -- SQL, data analysis, visualization", defaultOn: false },
  { id: "security", label: "Security   -- Audit, vulnerability scanning", defaultOn: false },
  { id: "planner", label: "Planner    -- Task breakdown, project planning", defaultOn: false },
];

// ── Channel definitions ──────────────────────────────────

interface ChannelDef {
  id: string;
  label: string;
  envVars: { name: string; prompt: string; hint: string }[];
  instructions: string[];
  configKey: string;
}

const CHANNELS: ChannelDef[] = [
  {
    id: "telegram",
    label: "Telegram",
    configKey: "telegram",
    envVars: [{ name: "TELEGRAM_BOT_TOKEN", prompt: "Bot token", hint: "123456:ABC-DEF..." }],
    instructions: [
      `Open Telegram, search ${bold("@BotFather")}`,
      `Send ${sky("/newbot")}, pick a name and username`,
      "Copy the token BotFather gives you",
    ],
  },
  {
    id: "discord",
    label: "Discord",
    configKey: "discord",
    envVars: [{ name: "DISCORD_BOT_TOKEN", prompt: "Bot token", hint: "MTIz..." }],
    instructions: [
      `Go to ${sky("https://discord.com/developers/applications")}`,
      "Create app, go to Bot tab, click Reset Token",
      "Enable Message Content Intent under Privileged Gateway Intents",
      "Invite bot to your server with bot + applications.commands scope",
    ],
  },
  {
    id: "slack",
    label: "Slack",
    configKey: "slack",
    envVars: [
      { name: "SLACK_BOT_TOKEN", prompt: "Bot token", hint: "xoxb-..." },
      { name: "SLACK_SIGNING_SECRET", prompt: "Signing secret", hint: "abc123..." },
      { name: "SLACK_APP_TOKEN", prompt: "App-level token", hint: "xapp-..." },
    ],
    instructions: [
      `Go to ${sky("https://api.slack.com/apps")} and create a new app`,
      "Enable Socket Mode, add chat:write + app_mentions:read scopes",
      "Install to your workspace and copy the tokens",
    ],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    configKey: "whatsapp",
    envVars: [],
    instructions: [
      "WhatsApp uses QR code authentication (Baileys)",
      `Run ${sky("wispy gateway")} and scan the QR code with your phone`,
      "No API key needed -- connects directly to WhatsApp Web",
    ],
  },
  {
    id: "matrix",
    label: "Matrix",
    configKey: "matrix",
    envVars: [
      { name: "MATRIX_HOMESERVER", prompt: "Homeserver URL", hint: "https://matrix.org" },
      { name: "MATRIX_ACCESS_TOKEN", prompt: "Access token", hint: "syt_..." },
      { name: "MATRIX_USER_ID", prompt: "User ID", hint: "@wispy:matrix.org" },
    ],
    instructions: [
      "Create a Matrix account on your homeserver",
      `Get an access token from ${sky("Element > Settings > Help & About")}`,
    ],
  },
  {
    id: "signal",
    label: "Signal",
    configKey: "signal",
    envVars: [
      { name: "SIGNAL_CLI_URL", prompt: "signal-cli REST URL", hint: "http://localhost:8080" },
      { name: "SIGNAL_PHONE_NUMBER", prompt: "Phone number", hint: "+1234567890" },
    ],
    instructions: [
      `Run signal-cli REST API: ${sky("docker run -p 8080:8080 bbernhard/signal-cli-rest-api")}`,
      "Register your phone number with signal-cli first",
    ],
  },
  {
    id: "email",
    label: "Email (AgentMail)",
    configKey: "email",
    envVars: [{ name: "AGENTMAIL_API_KEY", prompt: "AgentMail API key", hint: "am_..." }],
    instructions: [
      `Get your API key at ${sky("https://agentmail.to")}`,
      "Wispy gets its own email address to send and receive",
    ],
  },
  {
    id: "phone",
    label: "Phone / SMS (Telnyx)",
    configKey: "phone",
    envVars: [
      { name: "TELNYX_API_KEY", prompt: "Telnyx API key", hint: "KEY..." },
      { name: "TELNYX_CONNECTION_ID", prompt: "Connection ID", hint: "123456789" },
    ],
    instructions: [
      `Sign up at ${sky("https://telnyx.com")} and buy a phone number`,
      "Create a TeXML application and get credentials",
    ],
  },
];

// ── Integration definitions (by category) ────────────────

interface IntegrationDef {
  id: string;
  label: string;
  envVars?: string[];
  link?: string;
}

interface IntegrationCategory {
  name: string;
  icon: string;
  items: IntegrationDef[];
  note?: string;
}

const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  {
    name: "Google Workspace",
    icon: "\uD83D\uDD0D",
    note: "All Google integrations share one OAuth setup",
    items: [
      { id: "google-calendar", label: "Google Calendar" },
      { id: "gmail", label: "Gmail" },
      { id: "google-drive", label: "Google Drive" },
      { id: "google-docs", label: "Google Docs" },
      { id: "google-sheets", label: "Google Sheets" },
      { id: "google-meet", label: "Google Meet" },
      { id: "google-maps", label: "Google Maps" },
      { id: "google-search", label: "Google Search" },
      { id: "youtube", label: "YouTube" },
    ],
  },
  {
    name: "Productivity",
    icon: "\uD83D\uDCCB",
    items: [
      { id: "github", label: "GitHub", envVars: ["GITHUB_TOKEN"], link: "https://github.com/settings/tokens" },
      { id: "notion", label: "Notion", envVars: ["NOTION_TOKEN"], link: "https://www.notion.so/my-integrations" },
      { id: "linear", label: "Linear", envVars: ["LINEAR_API_KEY"], link: "https://linear.app/settings/api" },
      { id: "obsidian", label: "Obsidian (local)" },
      { id: "trello", label: "Trello", envVars: ["TRELLO_API_KEY", "TRELLO_TOKEN"] },
      { id: "asana", label: "Asana", envVars: ["ASANA_ACCESS_TOKEN"] },
      { id: "calendly", label: "Calendly", envVars: ["CALENDLY_API_KEY"] },
    ],
  },
  {
    name: "Social Media",
    icon: "\uD83D\uDCF1",
    items: [
      { id: "twitter", label: "Twitter / X", envVars: ["TWITTER_API_KEY", "TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_SECRET"], link: "https://developer.x.com/portal" },
      { id: "linkedin", label: "LinkedIn", envVars: ["LINKEDIN_ACCESS_TOKEN"] },
      { id: "instagram", label: "Instagram", envVars: ["INSTAGRAM_ACCESS_TOKEN"] },
      { id: "reddit", label: "Reddit", envVars: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"] },
    ],
  },
  {
    name: "Smart Home",
    icon: "\uD83C\uDFE0",
    items: [
      { id: "hue", label: "Philips Hue", envVars: ["HUE_BRIDGE_IP", "HUE_USERNAME"] },
      { id: "home-assistant", label: "Home Assistant", envVars: ["HA_URL", "HA_TOKEN"] },
      { id: "sonos", label: "Sonos", envVars: ["SONOS_API_KEY", "SONOS_HOUSEHOLD_ID"] },
    ],
  },
  {
    name: "Commerce & Security",
    icon: "\uD83D\uDD12",
    items: [
      { id: "stripe", label: "Stripe", envVars: ["STRIPE_SECRET_KEY"], link: "https://dashboard.stripe.com/apikeys" },
      { id: "1password", label: "1Password", envVars: ["OP_SERVICE_ACCOUNT_TOKEN"] },
    ],
  },
  {
    name: "Music & Media",
    icon: "\uD83C\uDFB5",
    items: [
      { id: "spotify", label: "Spotify", envVars: ["SPOTIFY_ACCESS_TOKEN"] },
      { id: "image-generation", label: "Image Generation (DALL-E / Stability)", envVars: ["IMAGE_GEN_API_KEY"] },
    ],
  },
];

// ── MCP Server definitions ───────────────────────────────

interface MCPDef {
  id: string;
  label: string;
  command: string;
  args: string[];
  default: boolean;
  envRequired?: string;
}

const MCP_SERVERS: MCPDef[] = [
  { id: "filesystem", label: "File System -- Read/write files anywhere", command: "npx", args: ["-y", "@anthropic/mcp-server-filesystem", "--allow-write", "/"], default: true },
  { id: "fetch", label: "Web Fetch   -- HTTP requests with auth", command: "npx", args: ["-y", "@anthropic/mcp-server-fetch"], default: true },
  { id: "memory", label: "Memory      -- Persistent key-value storage", command: "npx", args: ["-y", "@anthropic/mcp-server-memory"], default: false },
  { id: "brave", label: "Brave Search-- Web search via Brave API", command: "npx", args: ["-y", "@anthropic/mcp-server-brave-search"], default: false, envRequired: "BRAVE_API_KEY" },
  { id: "github", label: "GitHub      -- Access repos, issues, PRs", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], default: false, envRequired: "GITHUB_TOKEN" },
  { id: "postgres", label: "PostgreSQL  -- Query databases directly", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"], default: false, envRequired: "DATABASE_URL" },
];

// ── Public API ───────────────────────────────────────────

export function isFirstRun(runtimeDir: string): boolean {
  const configPath = path.resolve(runtimeDir, "config.yaml");
  return !fs.existsSync(configPath);
}

export async function runSetupWizard(opts: {
  rootDir: string;
  runtimeDir: string;
  soulDir: string;
}): Promise<void> {
  const { rootDir, runtimeDir } = opts;
  const TOTAL_STEPS = 8;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    console.log(dim("\n\n  Setup cancelled.\n"));
    rl.close();
    process.exit(0);
  });

  // Collected state
  const env: Record<string, string> = {};
  let engine: "gemini" | "claude" = "gemini";
  let apiKey = "";
  let useVertexAI = false;
  let anthropicKey = "";
  let openaiKey = "";
  let groqKey = "";
  let openrouterKey = "";
  let kimiKey = "";
  let ollamaUrl = "";
  let elevenlabsKey = "";
  const enabledChannels: Record<string, boolean> = {};
  let selectedIntegrations: string[] = [];
  let autonomousMode = true;
  let fullFilesystemAccess = true;
  let selectedTheme = "day";
  let selectedAgents: string[] = ["coder", "researcher"];
  let commerceEnabled = false;
  let agentPrivateKey = "";
  let cdpKeyName = "";
  let cdpPrivateKey = "";
  let voiceModel = "edge-tts";

  try {
    // ════════════════════════════════════════════════════════
    // STEP 1: Welcome
    // ════════════════════════════════════════════════════════
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  * Welcome to Wispy Setup!\n`));
    console.log(dim("  This wizard sets up everything your AI agent needs."));
    console.log(dim("  Every step has smart defaults -- just press Enter to skip.\n"));
    console.log(`  ${sky("What we will configure:")}`);
    console.log(`    ${dim("1.")} AI engine and API keys`);
    console.log(`    ${dim("2.")} Messaging channels (Telegram, Discord, Slack, etc.)`);
    console.log(`    ${dim("3.")} App integrations (GitHub, Notion, Google, etc.)`);
    console.log(`    ${dim("4.")} Blockchain wallet (optional)`);
    console.log(`    ${dim("5.")} Security and permissions`);
    console.log(`    ${dim("6.")} Voice, tools, theme, and more`);
    console.log("");
    console.log(dim("  Takes about 3 minutes. You can reconfigure anytime with:"));
    console.log(`  ${sky("wispy setup")}\n`);
    await ask(rl, dim("  Press Enter to start..."));

    // ════════════════════════════════════════════════════════
    // STEP 2: AI Engine + Keys
    // ════════════════════════════════════════════════════════
    stepHeader(2, TOTAL_STEPS, "AI Engine & API Keys", chalk.yellow("\u25B8"));

    console.log(dim("  Choose your primary AI engine:\n"));
    console.log(`  ${sky("1)")} ${bold("Gemini")} ${dim("(Google -- recommended, free tier available)")}`);
    console.log(dim(`     Get key: ${sky("https://aistudio.google.com/apikey")}`));
    console.log(`  ${sky("2)")} ${bold("Claude")} ${dim("(Anthropic -- advanced reasoning)")}`);
    console.log(dim(`     Get key: ${sky("https://console.anthropic.com/keys")}`));
    console.log(`  ${sky("3)")} ${bold("Vertex AI")} ${dim("(Google Cloud -- production / high quota)")}`);
    console.log("");

    const engineChoice = await ask(rl, sky("  Select [1/2/3] (default: 1): "));

    if (engineChoice.trim() === "2") {
      engine = "claude";
      console.log("");
      const existing = envOrEmpty("ANTHROPIC_API_KEY");
      if (existing) {
        console.log(green(`  Found existing key: ${masked(existing, 10)}`));
        anthropicKey = existing;
      } else {
        anthropicKey = (await ask(rl, sky("  Anthropic API key (sk-ant-...): "))).trim();
        if (anthropicKey) {
          console.log(green("  Configured."));
          env.ANTHROPIC_API_KEY = anthropicKey;
        }
      }
      // Still need Gemini for embeddings
      console.log(dim("\n  Note: Gemini is still used for embeddings. Adding Gemini key is recommended.\n"));
      const geminiKey = envOrEmpty("GEMINI_API_KEY");
      if (geminiKey) {
        console.log(green(`  Found Gemini key: ${masked(geminiKey)}`));
        apiKey = geminiKey;
      } else {
        const gk = (await ask(rl, sky("  Gemini API key (optional, for embeddings): "))).trim();
        if (gk) { apiKey = gk; env.GEMINI_API_KEY = gk; }
      }
    } else if (engineChoice.trim() === "3") {
      useVertexAI = true;
      console.log("");
      const existing = envOrEmpty("GOOGLE_CLOUD_PROJECT");
      if (existing) {
        console.log(green(`  Found Vertex project: ${existing}`));
      } else {
        console.log(dim("  Set these in .env:"));
        console.log(sky("    GOOGLE_CLOUD_PROJECT=your-project-id"));
        console.log(sky("    GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json"));
        const proj = (await ask(rl, sky("\n  Project ID (or Enter to skip): "))).trim();
        if (proj) env.GOOGLE_CLOUD_PROJECT = proj;
      }
    } else {
      // Gemini (default)
      engine = "gemini";
      console.log("");
      const existing = envOrEmpty("GEMINI_API_KEY");
      if (existing) {
        console.log(green(`  Found existing key: ${masked(existing)}`));
        apiKey = existing;
      } else {
        console.log(dim("  How to get your key:"));
        console.log(`  ${sky("1.")} Open ${sky("https://aistudio.google.com/apikey")}`);
        console.log(`  ${sky("2.")} Sign in and click ${bold('"Create API key"')}`);
        console.log(`  ${sky("3.")} Copy the key (starts with ${bold("AIza")}...)\n`);
        apiKey = (await ask(rl, sky("  Paste your Gemini API key: "))).trim();
        if (apiKey) {
          if (!apiKey.startsWith("AIza")) {
            console.log(yellow("\n  Key does not start with 'AIza'. Double-check it."));
            const ok = await ask(rl, dim("  Continue anyway? [y/N]: "));
            if (!ok.trim().toLowerCase().startsWith("y")) apiKey = "";
          }
          if (apiKey) { env.GEMINI_API_KEY = apiKey; console.log(green("  Configured.")); }
        }
      }
    }

    // Additional providers
    console.log("");
    console.log(dim("  ── Additional AI Providers (optional) ──\n"));
    console.log(`  ${sky("1)")} Anthropic ${dim("(Claude)")}     ${sky("4)")} OpenRouter ${dim("(200+ models)")}`);
    console.log(`  ${sky("2)")} OpenAI ${dim("(GPT-4o)")}       ${sky("5)")} Kimi ${dim("(128K context)")}`);
    console.log(`  ${sky("3)")} Groq ${dim("(fast inference)")}  ${sky("6)")} Ollama ${dim("(local, free)")}`);
    console.log(`                             ${sky("7)")} ElevenLabs ${dim("(voice AI)")}`);
    console.log("");

    const providerInput = await ask(rl, sky("  Add providers? Numbers (e.g. 1,3,7) or Enter to skip: "));

    if (providerInput.trim()) {
      const picks = parseNumberList(providerInput, 7);
      console.log("");

      for (const idx of picks) {
        switch (idx) {
          case 0: { // Anthropic
            if (!anthropicKey) {
              const existing = envOrEmpty("ANTHROPIC_API_KEY");
              if (existing) { anthropicKey = existing; console.log(green(`  Anthropic: ${masked(existing, 10)}`)); }
              else {
                console.log(dim(`  Get key: ${sky("https://console.anthropic.com/keys")}`));
                anthropicKey = (await ask(rl, sky("  Anthropic key (sk-ant-...): "))).trim();
                if (anthropicKey) { env.ANTHROPIC_API_KEY = anthropicKey; console.log(green("  Anthropic configured.")); }
              }
            } else { console.log(green(`  Anthropic: already set`)); }
            break;
          }
          case 1: { // OpenAI
            const existing = envOrEmpty("OPENAI_API_KEY");
            if (existing) { openaiKey = existing; console.log(green(`  OpenAI: ${masked(existing)}`)); }
            else {
              console.log(dim(`  Get key: ${sky("https://platform.openai.com/api-keys")}`));
              openaiKey = (await ask(rl, sky("  OpenAI key (sk-...): "))).trim();
              if (openaiKey) { env.OPENAI_API_KEY = openaiKey; console.log(green("  OpenAI configured.")); }
            }
            break;
          }
          case 2: { // Groq
            const existing = envOrEmpty("GROQ_API_KEY");
            if (existing) { groqKey = existing; console.log(green(`  Groq: ${masked(existing)}`)); }
            else {
              console.log(dim(`  Get key: ${sky("https://console.groq.com/keys")}`));
              groqKey = (await ask(rl, sky("  Groq key (gsk_...): "))).trim();
              if (groqKey) { env.GROQ_API_KEY = groqKey; console.log(green("  Groq configured.")); }
            }
            break;
          }
          case 3: { // OpenRouter
            const existing = envOrEmpty("OPENROUTER_API_KEY");
            if (existing) { openrouterKey = existing; console.log(green(`  OpenRouter: ${masked(existing, 10)}`)); }
            else {
              console.log(dim(`  Get key: ${sky("https://openrouter.ai/keys")}`));
              openrouterKey = (await ask(rl, sky("  OpenRouter key (sk-or-...): "))).trim();
              if (openrouterKey) { env.OPENROUTER_API_KEY = openrouterKey; console.log(green("  OpenRouter configured.")); }
            }
            break;
          }
          case 4: { // Kimi
            const existing = envOrEmpty("MOONSHOT_API_KEY");
            if (existing) { kimiKey = existing; console.log(green(`  Kimi: ${masked(existing)}`)); }
            else {
              console.log(dim(`  Get key: ${sky("https://platform.moonshot.cn/console/api-keys")}`));
              kimiKey = (await ask(rl, sky("  Moonshot key: "))).trim();
              if (kimiKey) { env.MOONSHOT_API_KEY = kimiKey; console.log(green("  Kimi configured.")); }
            }
            break;
          }
          case 5: { // Ollama
            console.log(dim(`  Make sure Ollama is running. Install: ${sky("https://ollama.com/download")}`));
            const url = (await ask(rl, sky("  Ollama URL (default: http://localhost:11434): "))).trim();
            ollamaUrl = url || "http://localhost:11434";
            console.log(green(`  Ollama: ${ollamaUrl}`));
            break;
          }
          case 6: { // ElevenLabs
            const existing = envOrEmpty("ELEVENLABS_API_KEY");
            if (existing) { elevenlabsKey = existing; console.log(green(`  ElevenLabs: ${masked(existing)}`)); }
            else {
              console.log(dim(`  Get key: ${sky("https://elevenlabs.io/app/settings/api-keys")}`));
              elevenlabsKey = (await ask(rl, sky("  ElevenLabs key: "))).trim();
              if (elevenlabsKey) { env.ELEVENLABS_API_KEY = elevenlabsKey; console.log(green("  ElevenLabs configured.")); }
            }
            break;
          }
        }
        console.log("");
      }
    }

    // ════════════════════════════════════════════════════════
    // STEP 3: Channels
    // ════════════════════════════════════════════════════════
    stepHeader(3, TOTAL_STEPS, "Messaging Channels", chalk.blue("\u25B8"));

    console.log(dim("  Where should Wispy be available? Pick one or more.\n"));

    for (let i = 0; i < CHANNELS.length; i++) {
      const ch = CHANNELS[i];
      const hasKey = ch.envVars.length > 0 && ch.envVars.some((v) => !!envOrEmpty(v.name));
      const status = hasKey ? green(" [key found]") : "";
      console.log(`  ${sky(`${i + 1})`)} ${bold(ch.label)}${status}`);
    }

    console.log("");
    console.log(dim("  CLI is always available. REST + WebSocket start with the gateway."));
    console.log(dim("  WhatsApp uses QR code scan -- no token needed.\n"));

    const channelInput = await ask(rl, sky("  Enter numbers (e.g. 1,2,4) or Enter to skip: "));

    if (channelInput.trim()) {
      const picks = parseNumberList(channelInput, CHANNELS.length);

      for (const idx of picks) {
        const ch = CHANNELS[idx];
        enabledChannels[ch.configKey] = true;
        console.log("");
        console.log(skyBold(`  -- ${ch.label} Setup --\n`));

        // Show instructions
        for (const step of ch.instructions) {
          console.log(`  ${dim("\u2022")} ${step}`);
        }
        console.log("");

        // Collect env vars
        for (const v of ch.envVars) {
          const existing = envOrEmpty(v.name);
          if (existing) {
            console.log(green(`  ${v.name}: ${masked(existing)}`));
            env[v.name] = existing;
          } else {
            const value = (await ask(rl, sky(`  ${v.prompt} (${dim(v.hint)}): `))).trim();
            if (value) {
              env[v.name] = value;
              console.log(green(`  Set.`));
            } else {
              console.log(dim(`  Skipped. Add ${v.name} to .env later.`));
            }
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════
    // STEP 4: Integrations (by category)
    // ════════════════════════════════════════════════════════
    stepHeader(4, TOTAL_STEPS, "App Integrations", chalk.cyan("\u25B8"));

    console.log(dim("  Connect Wispy to apps and services. Pick categories to configure."));
    console.log(dim("  You can enable individual integrations later: wispy setup <name>\n"));

    for (let i = 0; i < INTEGRATION_CATEGORIES.length; i++) {
      const cat = INTEGRATION_CATEGORIES[i];
      const items = cat.items.map((it) => it.label).join(", ");
      console.log(`  ${sky(`${i + 1})`)} ${bold(cat.name)} ${dim(`(${cat.items.length})`)} ${cat.icon}`);
      console.log(dim(`     ${items}`));
    }
    console.log("");

    const catInput = await ask(rl, sky("  Enter category numbers (e.g. 1,2) or Enter to skip: "));

    if (catInput.trim()) {
      const catPicks = parseNumberList(catInput, INTEGRATION_CATEGORIES.length);

      for (const catIdx of catPicks) {
        const cat = INTEGRATION_CATEGORIES[catIdx];
        console.log("");
        console.log(skyBold(`  -- ${cat.icon} ${cat.name} --\n`));

        if (cat.note) {
          console.log(dim(`  Note: ${cat.note}\n`));
        }

        // If Google category, prompt for OAuth credentials once
        if (cat.name === "Google Workspace") {
          console.log(dim("  Google integrations use OAuth2. You need:"));
          console.log(`  ${dim("1.")} Go to ${sky("https://console.cloud.google.com/apis/credentials")}`);
          console.log(`  ${dim("2.")} Create OAuth 2.0 Client ID`);
          console.log(`  ${dim("3.")} Enable the APIs you want (Calendar, Gmail, Drive, etc.)\n`);

          const googleClientId = envOrEmpty("GOOGLE_CLIENT_ID");
          const googleClientSecret = envOrEmpty("GOOGLE_CLIENT_SECRET");

          if (googleClientId) {
            console.log(green(`  Google OAuth: configured`));
          } else {
            const clientId = (await ask(rl, sky("  Google Client ID (or Enter to skip): "))).trim();
            if (clientId) {
              env.GOOGLE_CLIENT_ID = clientId;
              const secret = (await ask(rl, sky("  Google Client Secret: "))).trim();
              if (secret) env.GOOGLE_CLIENT_SECRET = secret;
              const redirect = (await ask(rl, sky("  Redirect URI (default: http://localhost:3000/auth/callback): "))).trim();
              env.GOOGLE_REDIRECT_URI = redirect || "http://localhost:3000/auth/callback";
              console.log(green("  Google OAuth configured."));
            }
          }
          console.log("");
        }

        // Show items and let user pick
        for (let i = 0; i < cat.items.length; i++) {
          const item = cat.items[i];
          const hasEnv = item.envVars?.some((v) => !!envOrEmpty(v)) || false;
          const status = hasEnv ? green(" [configured]") : "";
          console.log(`  ${sky(`${i + 1})`)} ${item.label}${status}`);
        }
        console.log("");

        const itemInput = await ask(rl, sky(`  Enable which? Numbers (e.g. 1,2,3) or Enter for all: `));

        let picked: number[];
        if (!itemInput.trim()) {
          picked = cat.items.map((_, i) => i);
        } else {
          picked = parseNumberList(itemInput, cat.items.length);
        }

        for (const itemIdx of picked) {
          const item = cat.items[itemIdx];
          selectedIntegrations.push(item.id);

          // Prompt for env vars if needed
          if (item.envVars && item.envVars.length > 0) {
            const allSet = item.envVars.every((v) => !!envOrEmpty(v));
            if (!allSet) {
              if (item.link) console.log(dim(`\n  ${item.label}: ${sky(item.link)}`));
              for (const varName of item.envVars) {
                const existing = envOrEmpty(varName);
                if (existing) {
                  env[varName] = existing;
                } else {
                  const val = (await ask(rl, sky(`  ${varName}: `))).trim();
                  if (val) env[varName] = val;
                }
              }
            }
          }
        }

        if (picked.length > 0) {
          const names = picked.map((i) => cat.items[i].label).join(", ");
          console.log(green(`\n  Enabled: ${names}`));
        }
      }
    }

    // ════════════════════════════════════════════════════════
    // STEP 5: Wallet & Commerce
    // ════════════════════════════════════════════════════════
    stepHeader(5, TOTAL_STEPS, "Blockchain Wallet", accent("\u25B8"));

    console.log(dim("  Give Wispy a wallet for autonomous payments (x402 protocol)."));
    console.log(dim("  Uses USDC on SKALE -- gasless, no transaction fees.\n"));
    console.log(`  ${accent("\u2022")} Agent pays for APIs on its own (micro-payments)`);
    console.log(`  ${accent("\u2022")} DeFi trading with built-in risk controls`);
    console.log(`  ${accent("\u2022")} Encrypted conditional payments (BITE v2)\n`);
    console.log(dim("  Skip this if you only want chat and coding.\n"));

    const existingAgentKey = envOrEmpty("AGENT_PRIVATE_KEY");

    if (existingAgentKey) {
      console.log(green(`  Found wallet key: ${masked(existingAgentKey, 6)}`));
      agentPrivateKey = existingAgentKey;
      commerceEnabled = true;
    } else {
      const walletChoice = await ask(rl, sky("  Enable x402 commerce? [y/N]: "));

      if (walletChoice.trim().toLowerCase().startsWith("y")) {
        console.log("");
        console.log(`  ${sky("1)")} ${bold("Generate new wallet")} ${dim("(recommended)")}`);
        console.log(`  ${sky("2)")} ${bold("Use existing wallet")} ${dim("(paste private key)")}`);
        console.log("");

        const keyChoice = await ask(rl, sky("  Select [1/2] (default: 1): "));

        if (keyChoice.trim() === "2") {
          agentPrivateKey = (await ask(rl, sky("  Private key (0x...): "))).trim();
          if (agentPrivateKey && !agentPrivateKey.startsWith("0x")) agentPrivateKey = "0x" + agentPrivateKey;
        } else {
          try {
            const { ethers } = await import("ethers");
            const wallet = ethers.Wallet.createRandom();
            agentPrivateKey = wallet.privateKey;
            const mnemonic = wallet.mnemonic?.phrase || "";
            console.log("");
            console.log(green(`  Generated new wallet!\n`));
            console.log(`  ${dim("Address:")} ${sky(wallet.address)}`);
            if (mnemonic) {
              console.log("");
              console.log(yellow("  +-------------------------------------------------+"));
              console.log(yellow("  |  RECOVERY PHRASE -- Write this down on paper!    |"));
              console.log(yellow("  +-------------------------------------------------+"));
              console.log("");
              const words = mnemonic.split(" ");
              for (let i = 0; i < words.length; i += 3) {
                const row = words
                  .slice(i, i + 3)
                  .map((w, j) => {
                    const num = String(i + j + 1).padStart(2, " ");
                    return `${dim(num + ".")} ${bold(w.padEnd(10))}`;
                  })
                  .join("  ");
                console.log(`    ${row}`);
              }
              console.log("");
              console.log(yellow("  This is the ONLY time you will see this phrase."));
              console.log(dim("  Never share it. Never type it online.\n"));
              await ask(rl, dim("  Press Enter once saved..."));
            }
          } catch {
            console.log(yellow("  Could not generate wallet. Add AGENT_PRIVATE_KEY to .env later."));
          }
        }

        if (agentPrivateKey) {
          commerceEnabled = true;
          env.AGENT_PRIVATE_KEY = agentPrivateKey;
        }

        // Optional CDP wallet
        if (commerceEnabled) {
          console.log("");
          console.log(dim("  Optional: Coinbase Developer Platform (CDP) custodial wallet"));
          const cdpChoice = await ask(rl, sky("  Configure CDP? [y/N]: "));
          if (cdpChoice.trim().toLowerCase().startsWith("y")) {
            console.log(dim(`\n  Get credentials: ${sky("https://portal.cdp.coinbase.com/")}\n`));
            cdpKeyName = (await ask(rl, sky("  CDP API Key Name: "))).trim();
            cdpPrivateKey = (await ask(rl, sky("  CDP Private Key: "))).trim();
            if (cdpKeyName) env.CDP_API_KEY_NAME = cdpKeyName;
            if (cdpPrivateKey) env.CDP_PRIVATE_KEY = cdpPrivateKey;
          }
        }
      }
    }

    // ════════════════════════════════════════════════════════
    // STEP 6: Security & Mode
    // ════════════════════════════════════════════════════════
    stepHeader(6, TOTAL_STEPS, "Security & Permissions", chalk.yellow("\u25B8"));

    console.log(dim("  Choose how much freedom Wispy gets:\n"));
    console.log(`  ${sky("1)")} ${bold("Autonomous Mode")} ${dim("(recommended)")}`);
    console.log(dim("     Wispy writes files, runs code, and manages projects on its own."));
    console.log(dim("     Best for: personal computer, development, getting things done.\n"));
    console.log(`  ${sky("2)")} ${bold("Standard Mode")} ${dim("(ask before acting)")}`);
    console.log(dim("     Wispy asks permission before writing files or running code."));
    console.log(dim("     Best for: shared computers, production servers.\n"));

    const modeChoice = await ask(rl, sky("  Select [1/2] (default: 1): "));
    autonomousMode = modeChoice.trim() !== "2";

    if (autonomousMode) {
      console.log("");
      console.log(dim("  File system access:\n"));
      console.log(`  ${sky("1)")} ${bold("Full access")} ${dim("-- read/write anywhere on your drive (recommended)")}`);
      console.log(`  ${sky("2)")} ${bold("Workspace only")} ${dim("-- restricted to Wispy's workspace directory")}\n`);
      const fsChoice = await ask(rl, sky("  Select [1/2] (default: 1): "));
      fullFilesystemAccess = fsChoice.trim() !== "2";
    } else {
      fullFilesystemAccess = false;
    }

    // ════════════════════════════════════════════════════════
    // STEP 7: Extras (Voice, MCP, Theme, Agents, Memory)
    // ════════════════════════════════════════════════════════
    stepHeader(7, TOTAL_STEPS, "Extras", chalk.hex("#FF6B6B")("\u25B8"));

    // ── Voice/TTS ────────────────────────────────────────
    console.log(skyBold("  Voice / Text-to-Speech\n"));
    console.log(dim("  Let Wispy speak aloud in voice messages.\n"));
    console.log(`  ${sky("1)")} ${bold("Edge TTS")} ${dim("-- free, fast, no API key (default)")}`);
    console.log(`  ${sky("2)")} ${bold("ElevenLabs")} ${dim("-- premium quality, requires API key")}`);
    console.log(`  ${sky("3)")} ${bold("Qwen3-TTS")} ${dim("-- multilingual via HuggingFace (free)")}`);
    console.log(`  ${sky("4)")} ${dim("Skip voice")}`);
    console.log("");

    const voiceChoice = await ask(rl, sky("  Select [1/2/3/4] (default: 1): "));

    if (voiceChoice.trim() === "2") {
      voiceModel = "elevenlabs";
      if (!elevenlabsKey) {
        const existing = envOrEmpty("ELEVENLABS_API_KEY");
        if (existing) {
          elevenlabsKey = existing;
          console.log(green(`  ElevenLabs: ${masked(existing)}`));
        } else {
          console.log(dim(`\n  Get key: ${sky("https://elevenlabs.io/app/settings/api-keys")}`));
          elevenlabsKey = (await ask(rl, sky("  ElevenLabs key: "))).trim();
          if (elevenlabsKey) env.ELEVENLABS_API_KEY = elevenlabsKey;
        }
      }
    } else if (voiceChoice.trim() === "3") {
      voiceModel = "qwen3-tts";
      // Check if gradio_client is installed
      let qwen3Ready = false;
      try {
        const { execSync } = await import("child_process");
        execSync('python -c "from gradio_client import Client"', { stdio: "pipe", timeout: 10000 });
        qwen3Ready = true;
      } catch { /* not installed */ }

      if (!qwen3Ready) {
        console.log(dim("\n  Qwen3-TTS needs the gradio_client Python package."));
        const install = await ask(rl, sky("  Install now? [Y/n]: "));
        if (!install.trim() || install.trim().toLowerCase().startsWith("y")) {
          try {
            const { execSync } = await import("child_process");
            execSync("pip install gradio_client -q", { stdio: "inherit", timeout: 120000 });
            console.log(green("  Installed."));
          } catch {
            console.log(yellow("  Install failed. Run: pip install gradio_client"));
            voiceModel = "edge-tts";
          }
        } else {
          voiceModel = "edge-tts";
        }
      }
    } else if (voiceChoice.trim() === "4") {
      voiceModel = "";
    } else {
      voiceModel = "edge-tts";
      // Check if Edge TTS is installed
      let edgeReady = false;
      try {
        const { execSync } = await import("child_process");
        execSync("python -m edge_tts --version", { stdio: "pipe", timeout: 5000 });
        edgeReady = true;
      } catch { /* not installed */ }

      if (!edgeReady) {
        console.log(dim("\n  Edge TTS needs the edge-tts Python package."));
        const install = await ask(rl, sky("  Install now? [Y/n]: "));
        if (!install.trim() || install.trim().toLowerCase().startsWith("y")) {
          try {
            const { execSync } = await import("child_process");
            execSync("pip install edge-tts", { stdio: "inherit", timeout: 120000 });
            console.log(green("  Installed."));
          } catch {
            console.log(yellow("  Install failed. Run: pip install edge-tts"));
          }
        }
      } else {
        console.log(green("  Edge TTS is ready."));
      }
    }

    // ── MCP Servers ──────────────────────────────────────
    console.log("");
    console.log(skyBold("  MCP Servers (Extra Tools)\n"));
    console.log(dim("  MCP servers give Wispy additional capabilities."));
    console.log(dim("  Defaults (File System + Web Fetch) are recommended.\n"));

    for (let i = 0; i < MCP_SERVERS.length; i++) {
      const m = MCP_SERVERS[i];
      const mark = m.default ? green("[x]") : dim("[ ]");
      const envNote = m.envRequired ? dim(` (needs ${m.envRequired})`) : "";
      console.log(`  ${mark} ${sky(`${i + 1})`)} ${m.label}${envNote}`);
    }
    console.log("");

    const mcpInput = await ask(rl, sky("  Numbers to enable (default: 1,2): "));
    let selectedMCPs: MCPDef[];
    if (!mcpInput.trim()) {
      selectedMCPs = MCP_SERVERS.filter((m) => m.default);
    } else {
      const indices = parseNumberList(mcpInput, MCP_SERVERS.length);
      selectedMCPs = indices.length > 0 ? indices.map((i) => MCP_SERVERS[i]) : MCP_SERVERS.filter((m) => m.default);
    }

    // ── Theme ────────────────────────────────────────────
    console.log("");
    console.log(skyBold("  Color Theme\n"));
    for (let i = 0; i < THEMES.length; i++) {
      console.log(`  ${sky(`${i + 1})`)} ${THEMES[i].label}`);
    }
    const themeInput = await ask(rl, sky("\n  Select [1-4] (default: 2): "));
    const themeIdx = parseInt(themeInput.trim(), 10);
    selectedTheme = themeIdx >= 1 && themeIdx <= 4 ? THEMES[themeIdx - 1].key : "day";

    // ── Agents ───────────────────────────────────────────
    console.log("");
    console.log(skyBold("  Agent Roles\n"));
    console.log(dim("  Wispy's specializations. Coder + Researcher are pre-selected.\n"));

    for (let i = 0; i < AGENTS.length; i++) {
      const mark = AGENTS[i].defaultOn ? green("[x]") : dim("[ ]");
      console.log(`  ${mark} ${sky(`${i + 1})`)} ${AGENTS[i].label}`);
    }

    const agentInput = await ask(rl, sky("\n  Numbers (default: 1,2): "));
    if (agentInput.trim()) {
      const indices = parseNumberList(agentInput, AGENTS.length);
      if (indices.length > 0) selectedAgents = indices.map((i) => AGENTS[i].id);
    }

    // ── Memory Bank ──────────────────────────────────────
    console.log("");
    console.log(skyBold("  Memory Bank\n"));
    console.log(dim("  Wispy can remember things across conversations using a structured memory"));
    console.log(dim("  system with 4 types: episodic, semantic, procedural, and preference.\n"));
    console.log(`  ${sky("\u2022")} Memories decay over time if not accessed`);
    console.log(`  ${sky("\u2022")} Frequently used memories get reinforced`);
    console.log(`  ${sky("\u2022")} AI-powered reflection merges similar memories\n`);
    console.log(green("  Memory Bank is enabled by default. No extra configuration needed."));
    console.log("");

    await ask(rl, dim("  Press Enter to continue..."));
    rl.close();

    // ════════════════════════════════════════════════════════
    // SAVE CONFIGURATION
    // ════════════════════════════════════════════════════════

    fs.mkdirSync(runtimeDir, { recursive: true });

    // Build config object
    const config: Record<string, unknown> = {
      agent: { name: "wispy", id: "main" },
      engine,
      gemini: {
        models: {
          pro: "gemini-2.5-pro-preview-05-06",
          flash: "gemini-2.5-flash-preview-05-20",
          image: "gemini-2.0-flash",
          embedding: "text-embedding-004",
        },
      },
      ...(engine === "claude" || anthropicKey
        ? {
            claude: {
              ...(anthropicKey ? { apiKey: anthropicKey } : {}),
              models: { reasoning: "claude-sonnet-4-20250514", fast: "claude-haiku-4-5-20251001" },
            },
          }
        : {}),
      channels: {
        web: { enabled: true, port: 4000 },
        rest: { enabled: true, port: 4001 },
        telegram: {
          enabled: !!enabledChannels.telegram && !!(env.TELEGRAM_BOT_TOKEN || envOrEmpty("TELEGRAM_BOT_TOKEN")),
        },
        discord: {
          enabled: !!enabledChannels.discord && !!(env.DISCORD_BOT_TOKEN || envOrEmpty("DISCORD_BOT_TOKEN")),
        },
        slack: {
          enabled: !!enabledChannels.slack && !!(env.SLACK_BOT_TOKEN || envOrEmpty("SLACK_BOT_TOKEN")),
        },
        whatsapp: { enabled: !!enabledChannels.whatsapp },
        matrix: {
          enabled: !!enabledChannels.matrix && !!(env.MATRIX_ACCESS_TOKEN || envOrEmpty("MATRIX_ACCESS_TOKEN")),
        },
        signal: {
          enabled: !!enabledChannels.signal && !!(env.SIGNAL_PHONE_NUMBER || envOrEmpty("SIGNAL_PHONE_NUMBER")),
        },
        email: {
          enabled: !!enabledChannels.email && !!(env.AGENTMAIL_API_KEY || envOrEmpty("AGENTMAIL_API_KEY")),
        },
        phone: {
          enabled: !!enabledChannels.phone && !!(env.TELNYX_API_KEY || envOrEmpty("TELNYX_API_KEY")),
        },
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
      security: {
        requireApprovalForExternal: !autonomousMode,
        allowedGroups: [] as string[],
        autonomousMode,
        fullFilesystemAccess,
      },
      thinking: { defaultLevel: "medium", costAware: true },
      voice: voiceModel ? { enabled: true, model: voiceModel, replyWithVoice: true } : { enabled: false },
      theme: selectedTheme,
      agents: selectedAgents,
      integrations: selectedIntegrations,
    };

    const configPath = path.resolve(runtimeDir, "config.yaml");
    writeYAML(configPath, config);

    // Save MCP config
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
    fs.writeFileSync(path.resolve(mcpDir, "servers.json"), JSON.stringify(mcpConfig, null, 2));

    // Save .env
    const envPath = path.resolve(rootDir, ".env");
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

    // Helper: add env var if not already present
    const addEnv = (key: string, value: string, section?: string) => {
      if (!value) return;
      if (envContent.includes(`${key}=`)) return;
      if (section && !envContent.includes(`# ${section}`)) {
        envContent += `\n\n# ${section}`;
      }
      envContent += `\n${key}=${value}`;
    };

    // Engine
    addEnv("ENGINE", engine, "AI Engine");

    // Primary keys
    if (apiKey && !envOrEmpty("GEMINI_API_KEY")) addEnv("GEMINI_API_KEY", apiKey);
    if (anthropicKey && !envOrEmpty("ANTHROPIC_API_KEY")) addEnv("ANTHROPIC_API_KEY", anthropicKey);

    // Additional providers
    if (openaiKey && !envOrEmpty("OPENAI_API_KEY")) addEnv("OPENAI_API_KEY", openaiKey, "Providers");
    if (groqKey && !envOrEmpty("GROQ_API_KEY")) addEnv("GROQ_API_KEY", groqKey);
    if (openrouterKey && !envOrEmpty("OPENROUTER_API_KEY")) addEnv("OPENROUTER_API_KEY", openrouterKey);
    if (kimiKey && !envOrEmpty("MOONSHOT_API_KEY")) addEnv("MOONSHOT_API_KEY", kimiKey);
    if (elevenlabsKey && !envOrEmpty("ELEVENLABS_API_KEY")) addEnv("ELEVENLABS_API_KEY", elevenlabsKey);

    // Channel tokens
    for (const [key, value] of Object.entries(env)) {
      if (key.startsWith("TELEGRAM_") || key.startsWith("DISCORD_") || key.startsWith("SLACK_") ||
          key.startsWith("MATRIX_") || key.startsWith("SIGNAL_") || key.startsWith("AGENTMAIL_") ||
          key.startsWith("TELNYX_")) {
        addEnv(key, value, "Channels");
      }
    }

    // Integration keys
    for (const [key, value] of Object.entries(env)) {
      if (key.startsWith("GOOGLE_") || key.startsWith("GITHUB_") || key.startsWith("NOTION_") ||
          key.startsWith("LINEAR_") || key.startsWith("TWITTER_") || key.startsWith("LINKEDIN_") ||
          key.startsWith("INSTAGRAM_") || key.startsWith("REDDIT_") || key.startsWith("SPOTIFY_") ||
          key.startsWith("STRIPE_") || key.startsWith("OP_") || key.startsWith("HUE_") ||
          key.startsWith("HA_") || key.startsWith("SONOS_") || key.startsWith("TRELLO_") ||
          key.startsWith("ASANA_") || key.startsWith("CALENDLY_") || key.startsWith("IMAGE_GEN_")) {
        addEnv(key, value, "Integrations");
      }
    }

    // Commerce
    if (agentPrivateKey && !envOrEmpty("AGENT_PRIVATE_KEY")) addEnv("AGENT_PRIVATE_KEY", agentPrivateKey, "x402 Commerce");
    if (cdpKeyName) addEnv("CDP_API_KEY_NAME", cdpKeyName);
    if (cdpPrivateKey) addEnv("CDP_PRIVATE_KEY", cdpPrivateKey);

    if (envContent.trim()) {
      fs.writeFileSync(envPath, envContent.trim() + "\n");
    }

    // ════════════════════════════════════════════════════════
    // STEP 8: Summary
    // ════════════════════════════════════════════════════════
    console.clear();
    console.log(WISPY_ASCII);
    console.log(skyBold(`  ${green("\u2713")} Setup complete!\n`));

    // Engine
    const engineDisplay = engine === "claude"
      ? `Claude ${dim("(Anthropic)")}`
      : useVertexAI
        ? `Gemini ${dim("(Vertex AI)")}`
        : apiKey
          ? `Gemini ${dim("(API key)")}`
          : yellow("Not configured");

    // Providers
    const extraProviders: string[] = [];
    if (engine !== "claude" && anthropicKey) extraProviders.push("Anthropic");
    if (openaiKey) extraProviders.push("OpenAI");
    if (groqKey) extraProviders.push("Groq");
    if (openrouterKey) extraProviders.push("OpenRouter");
    if (kimiKey) extraProviders.push("Kimi");
    if (ollamaUrl) extraProviders.push("Ollama");
    if (elevenlabsKey) extraProviders.push("ElevenLabs");

    // Channels
    const activeChannels = Object.entries(enabledChannels)
      .filter(([, v]) => v)
      .map(([k]) => capitalize(k));

    // Display
    console.log(`  ${dim("Engine:")}         ${engineDisplay}`);
    console.log(`  ${dim("Providers:")}      ${extraProviders.length > 0 ? extraProviders.join(", ") : dim("None")}`);
    console.log(`  ${dim("Channels:")}       ${activeChannels.length > 0 ? activeChannels.join(", ") : dim("CLI only")}`);
    console.log(`  ${dim("Integrations:")}   ${selectedIntegrations.length > 0 ? `${selectedIntegrations.length} enabled` : dim("None")}`);
    if (selectedIntegrations.length > 0) {
      // Show first 6 then "and X more"
      const show = selectedIntegrations.slice(0, 6);
      const rest = selectedIntegrations.length - show.length;
      const names = show.map((id) => {
        for (const cat of INTEGRATION_CATEGORIES) {
          const found = cat.items.find((i) => i.id === id);
          if (found) return found.label;
        }
        return id;
      });
      console.log(`  ${dim("                 ")}${dim(names.join(", "))}${rest > 0 ? dim(` +${rest} more`) : ""}`);
    }

    const modeDisplay = autonomousMode
      ? chalk.yellow("\u26A1 Autonomous") + (fullFilesystemAccess ? dim(" (full access)") : dim(" (workspace only)"))
      : green("Shield Standard") + dim(" (ask before acting)");
    console.log(`  ${dim("Mode:")}           ${modeDisplay}`);
    console.log(`  ${dim("Wallet:")}         ${commerceEnabled ? green("\u2713 Enabled") + dim(` (${cdpKeyName ? "CDP" : "raw key"})`) : dim("Not configured")}`);
    console.log(`  ${dim("Voice:")}          ${voiceModel ? green(`\u2713 ${voiceModel}`) : dim("Disabled")}`);
    console.log(`  ${dim("Memory Bank:")}    ${green("\u2713 Enabled")} ${dim("(episodic, semantic, procedural, preference)")}`);
    console.log(`  ${dim("MCP Servers:")}    ${selectedMCPs.map((m) => capitalize(m.id)).join(", ") || dim("None")}`);
    console.log(`  ${dim("Theme:")}          ${capitalize(selectedTheme)} ${THEME_ICON[selectedTheme] || ""}`);
    console.log(`  ${dim("Agents:")}         ${selectedAgents.map(capitalize).join(", ")}`);
    console.log("");

    if (!apiKey && !useVertexAI && engine === "gemini") {
      console.log(yellow("  No Gemini API key configured!"));
      console.log(dim(`  Add GEMINI_API_KEY to .env. Free: ${sky("https://aistudio.google.com/apikey")}`));
      console.log("");
    }
    if (engine === "claude" && !anthropicKey) {
      console.log(yellow("  No Anthropic API key configured!"));
      console.log(dim(`  Add ANTHROPIC_API_KEY to .env: ${sky("https://console.anthropic.com/keys")}`));
      console.log("");
    }

    console.log(skyBold("  What to do next:\n"));
    console.log(`  ${sky("wispy chat")}             Chat with Wispy in the terminal`);
    console.log(`  ${sky("wispy gateway")}          Start all channels (Telegram, Discord, etc.)`);
    console.log(`  ${sky("wispy doctor")}           Check if everything is working`);
    console.log(`  ${sky("wispy setup")}            Re-run this wizard anytime`);
    console.log(`  ${sky("wispy setup github")}     Configure a specific integration`);
    console.log("");
    console.log(dim(`  Config saved to: ${sky(path.resolve(runtimeDir, "config.yaml"))}`));
    console.log(dim(`  Env saved to:    ${sky(path.resolve(rootDir, ".env"))}`));
    console.log("");
    console.log(dim("  Docs:  https://docs.wispy.cc"));
    console.log(dim("  Help:  https://github.com/hausorlabs/wispy/issues"));
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
