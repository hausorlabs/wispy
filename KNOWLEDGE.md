# Wispy CLI -- Developer Knowledge Base

> Comprehensive reference for the Wispy AI Agent Platform CLI.
> Version: 1.4.1 | Stack: TypeScript, Node.js 20+, Gemini API

---

## Architecture Overview

```
User Input -> Channel Adapter -> Agent Core -> Gemini AI -> Tool Execution -> Response
                                    |              |
                                 Session      Model Router
                                 Memory       (pro/flash)
                                 Marathon     System Prompts
```

**Core Loop** (`src/core/agent.ts`):
1. Receive message from any channel
2. Load session context + memory
3. Route to appropriate model (thinking level inference)
4. Stream response with tool calls
5. Execute tools via unified executor
6. Return response to channel

---

## Key File Paths

| Module | Path | Purpose |
|--------|------|---------|
| Agent Core | `src/core/agent.ts` | Main agent class, tool execution, streaming |
| Gemini AI | `src/ai/gemini.ts` | Google Gemini API wrapper (API key + Vertex AI) |
| Model Router | `src/ai/router.ts` | Task routing (reasoning vs speed) |
| System Prompts | `src/ai/prompts.ts` | Instruction templates, persona |
| Tool Builder | `src/ai/tools.ts` | Tool declarations for Gemini |
| Model Registry | `src/ai/model-registry.ts` | Multi-provider (OpenAI, Anthropic, Ollama, Groq) |
| Embeddings | `src/ai/embeddings.ts` | Embedding API support |
| Session | `src/core/session.ts` | Session persistence (multi-peer, multi-channel) |
| Context Manager | `src/core/context.manager.ts` | Context window + auto-compaction |
| Thinking | `src/core/thinking.ts` | Thinking level inference |
| Config Schema | `src/config/schema.ts` | Zod config schema + defaults |
| Config Loader | `src/config/config.ts` | Config loading + hot-reload |
| CLI Entry | `src/cli/program.ts` | Commander.js CLI |
| REPL | `src/cli/repl.ts` | Interactive terminal |
| Banner | `src/cli/ui/banner.ts` | ASCII art + WISPY_VERSION |
| Entry Point | `src/index.ts` | Main export |

---

## Channels (6 Working + 4 Stubs)

### Working Channels

| Channel | Library | Adapter Path | Capabilities |
|---------|---------|-------------|--------------|
| **CLI REPL** | readline | `src/cli/repl.ts` | text, voice, history |
| **Telegram** | grammy | `src/channels/telegram/adapter.ts` | text, media, voice, buttons, threads, approval |
| **WhatsApp** | Baileys | `src/channels/telegram/adapter.ts` (via integration) | text, media |
| **REST API** | Express | `src/channels/rest/adapter.ts` | text, streaming (SSE) |
| **WebSocket** | ws | `src/gateway/server.ts` | text, bidirectional |
| **VS Code** | Antigravity | `src/integrations/` | text, code context |

### Stub Channels (config exists, no adapter)

Discord, Slack, Signal, Matrix

### Channel Dock (`src/channels/dock.ts`)
- Registry-based (Map)
- Event broadcasting across all channels
- Events: message, marathon_update, approval, notification, status_change
- `broadcastChannelEvent(event: ChannelEvent)`
- `registerChannelDispatcher(name, { sendMessage, sendImage?, sendDocument? })`

---

## Integrations (27 modules, ~143 tools)

### Google (9)
| Integration | File | Auth | Key Tools |
|-------------|------|------|-----------|
| Calendar | `integrations/google/calendar.ts` | OAuth2 | create_event, list_events, update_event |
| Gmail | `integrations/google/gmail.ts` | OAuth2 | send_email, list_messages, search |
| Drive | `integrations/google/drive.ts` | OAuth2 | list, upload, download |
| Docs | `integrations/google/docs.ts` | OAuth2 | create, insert_text, export |
| Sheets | `integrations/google/sheets.ts` | OAuth2 | read_values, append_values, create |
| Meet | `integrations/google/meet.ts` | OAuth2 | create_space, list_spaces |
| Maps | `integrations/google/maps.ts` | API Key | directions, place_details, search |
| Search | `integrations/google/search.ts` | API Key | web_search, news_search |
| YouTube | `integrations/google/youtube.ts` | OAuth2 | search_videos, get_video |

### Chat (3)
| Integration | File | Auth |
|-------------|------|------|
| Discord | `integrations/chat/discord.ts` | Token |
| Slack | `integrations/chat/slack.ts` | OAuth2 + App Token |
| WhatsApp | `integrations/chat/whatsapp.ts` | Phone pairing (Baileys) |

### AI Models (2)
| Integration | File | Auth |
|-------------|------|------|
| OpenAI | `integrations/ai-models/openai.ts` | API Key |
| Ollama | `integrations/ai-models/ollama.ts` | None (local) |

### Productivity (4)
| Integration | File | Auth |
|-------------|------|------|
| Notion | `integrations/productivity/notion.ts` | API Key |
| Obsidian | `integrations/productivity/obsidian.ts` | None (vault) |
| GitHub | `integrations/productivity/github.ts` | OAuth2 |
| Linear | `integrations/productivity/linear.ts` | API Key |

### Music (1)
Spotify (`integrations/music/spotify.ts`) -- OAuth2

### Smart Home (2)
| Integration | File | Auth |
|-------------|------|------|
| Philips Hue | `integrations/smart-home/hue.ts` | Bridge Token |
| Home Assistant | `integrations/smart-home/homeassistant.ts` | API Token |

### Tools (3)
Browser (`integrations/tools/browser.ts`), Webhooks, Weather

### Social (2)
Twitter/X (`integrations/social/twitter.ts`), SMTP Email

### Agentic Commerce (1 -- hackathon)
`integrations/agentic-commerce/` -- x402, AP2, BITE v2, DeFi, Identity

**Integration Base** (`integrations/base.ts`):
```typescript
interface IntegrationManifest {
  id: string; name: string; category: string; version: string;
  auth: { type: "oauth2" | "api-key" | "token" | "none"; envVars?: string[] };
  tools: ToolDeclaration[];
}
```

**Loader** (`integrations/loader.ts`): Static imports with `importSafe()` fallback.
**Registry** (`integrations/registry.ts`): Map-based, `registerIntegration()` / `getIntegration()`.
**Credentials** (`integrations/credential-manager.ts`): AES-256 encrypted, device-bound.

---

## Skills (24 across 6 categories)

Loaded from `wispy/skills/[name]/SKILL.md` files. Parser in `src/skills/loader.ts`.

### Development (5)
Code Generation, Code Review, Debug Assistant, Git Operations, API Testing

### Research (4)
Web Search, Deep Research, Paper Analysis, Market Research

### Content (4)
Article Writer, Summarizer, Translator, Social Media Posts

### Web3 (4)
Token Transfer, x402 Payment, DeFi Swap, NFT Operations

### Agents (3)
A2A Delegation, MCP Server, Agent Monitor

### Automation (4)
Cron Scheduler, Workflow Builder, Email Automation, Data Pipeline

**Skill Format**:
```markdown
# Skill Name
Description
## Tools
### tool_name
Tool description and parameters
```

---

## Wallet System

### Core (`src/wallet/x402.ts`)
- **Library**: ethers.js v6
- **Chains**: Base mainnet (USDC), SKALE mainnet (sFUEL/BITE)
- **Storage**: `~/.wispy/wallet/wallet.json` (encrypted with device key)
- **Functions**: `initWallet()`, `getBalance()`, `exportWalletPrivateKey()`, `recoverWalletFromMnemonic()`

### Commerce Policy (from config)
```typescript
wallet.commerce: {
  maxPerTransaction: number;
  dailyLimit: number;
  autoApproveBelow: number;
  requireApprovalAbove: number;
  whitelistedRecipients: string[];
}
```

### CDP Wallet (`src/wallet/cdp-wallet.ts`)
Coinbase SDK integration for managed wallets.

### x402 Protocol
- HTTP 402 detection -> EIP-3009 USDC authorization
- Budget-aware spending with daily limits
- Tools: `x402_pay_and_fetch`, `x402_check_budget`, `x402_audit_trail`, `x402_discover_services`

### AP2 Protocol
- Mandate chain with rollback
- Tools: `ap2_create_intent`, `ap2_checkout_cart`, `ap2_pay_mandate`, `ap2_verify_receipt`

---

## Marathon System (`src/marathon/`)

### Types (`marathon/types.ts`)
```typescript
MarathonStatus = "planning" | "executing" | "verifying" | "paused" | "completed" | "failed" | "waiting_human"

MarathonState {
  id: string;
  plan: MarathonPlan;         // plan.goal (NOT state.goal)
  status: MarathonStatus;
  startedAt: string;
  totalTokensUsed: number;
  checkpoints: Checkpoint[];
  logs: MarathonLog[];
}

MarathonEventType = union type   // CHECK before using string literals
MarathonEvent.data = unknown     // Cast to Record<string,unknown>
```

### Key Files
| File | Purpose |
|------|---------|
| `marathon/planner.ts` | Goal -> milestone breakdown |
| `marathon/executor.ts` | Milestone execution, loop detection |
| `marathon/durable-executor.ts` | Crash recovery + checkpoints |
| `marathon/service.ts` | Marathon lifecycle + storage |
| `marathon/watchdog.ts` | Heartbeat + crash detection (30s/120s) |
| `marathon/nlp-controller.ts` | Natural language planning |
| `marathon/telegram-visuals.ts` | Telegram progress updates |

### Loop Detection
- Hash normalized responses (lowercase, numbers -> N, slice 500 chars)
- Keep last 10 action hashes
- Trigger after 3 identical hashes

---

## API Key System (`src/api/keys.ts`)

- **Prefix**: `wsk_*`
- **Hashing**: SHA-256 (only prefix stored in plaintext)
- **Scopes**: `["chat", "tools", "wallet", "admin"]`
- **Rate limiting**: Per-key configurable
- **Storage**: `~/.wispy/api-keys.json`

---

## Security

### Action Guard (`src/security/action-guard.ts`)
- Categories: `internal` | `external` | `destructive`
- `requestApproval()` routes to TrustController
- `wouldRequireApproval()` pre-check

### Session Isolation (`src/security/isolation.ts`)
```typescript
SessionType = "main" | "cron" | "group" | "sub" | "heartbeat"
// main: full access
// cron: no wallet, no memory write
// group: external only
// sub: internal tools only
// heartbeat: memory + status only
```

### Credential Encryption (`src/security/encryption.ts`)
- AES-256 with device-derived key
- Device identity from hardware (UUID + MAC)
- `encryptCredential()` / `decryptCredential()`

### API Key Guard (`src/security/api-key-guard.ts`)
- Output sanitization: redacts keys, tokens, emails before display

### Trust Controller (`src/trust/controller.ts`)
- Global trust manager
- Channel-specific approval handlers (Telegram inline buttons)
- Cross-channel notifications

---

## Browser Engine (`src/integrations/browser-engine/`)

### Components
| File | Purpose |
|------|---------|
| `session-manager.ts` | Browser session lifecycle (Playwright) |
| `dom-processor.ts` | DOM parsing + schema extraction |
| `tab-manager.ts` | Multi-tab management |
| `workflow-engine.ts` | Workflow execution with forEach loops |
| `stealth-engine.ts` | Anti-detection (fingerprint, WebGL, navigator) |

### Stats
- 46 browser tools
- 55 built-in skills
- Stealth mode for anti-bot bypass

---

## Config Schema (`src/config/schema.ts`)

```typescript
WispyConfig {
  agent: { name, id }
  gemini: { apiKey, vertexai?, models: { pro, flash, image, embedding } }
  providers?: { openai?, anthropic?, ollama?, openrouter?, groq? }
  channels: { telegram?, whatsapp?, discord?, slack?, signal?, matrix?, web?, rest? }
  memory: { embeddingDimensions, heartbeatIntervalMinutes, hybridSearch? }
  wallet?: { enabled, chain, autoPayThreshold, commerce? }
  security: { requireApprovalForExternal, allowedGroups, sandbox?, autonomousMode? }
  thinking?: { defaultLevel, costAware }
  browser?: { enabled, cdpUrl? }
  voice?: { enabled, model, language? }
}
```

**Location**: `~/.wispy/config.json`
**Hot reload**: `src/config/hot-reload.ts` (chokidar file watcher)

---

## MCP Server (`src/mcp/server.ts`)

Protocol version: 2024-11-05

**11 Core Tools**:
`wispy_chat`, `wispy_chat_with_image`, `wispy_memory_search`, `wispy_memory_save`,
`wispy_file_read`, `wispy_file_write`, `wispy_file_list`, `wispy_web_search`,
`wispy_web_fetch`, `wispy_bash`, `wispy_memory_context`

**MCP Client** (`src/mcp/client.ts`): Loads servers from `~/.wispy/mcp/servers.json`, spawns child processes, JSON-RPC over stdio.

---

## REST API Endpoints (`src/channels/rest/adapter.ts`)

```
GET  /api/v1/health          -> { status, agent, version }
POST /api/v1/chat            -> { text, thinking?, toolCalls? }
POST /api/v1/chat/stream     -> SSE stream of chat chunks
GET  /dashboard              -> Marathon dashboard HTML
```

Auth: Optional bearer token via `rest.bearerToken` config.

---

## Multi-Agent System (`src/agents/`)

8 specialist types in `src/agents/types/`:
Coder, Researcher, Writer, Planner, DataAnalyst, Designer, DevOps, Security

**Orchestrator** (`src/agents/orchestrator.ts`): Routes tasks to best agent.
**Collaboration** (`src/agents/collaboration.ts`): Inter-agent messaging.
**Tool Executor** (`src/agents/tool-executor.ts`): Unified tool execution layer.

---

## Build & Test

```bash
npm run build    # TypeScript -> dist/ (ES2022, NodeNext modules)
npm run cli      # Direct execution via tsx
npm test         # Vitest with coverage (19 test files, 46+ tests)
npm run doctor   # Health diagnostics
```

**Default models**:
- Pro: `gemini-2.5-pro-preview-05-06`
- Flash: `gemini-2.5-flash-preview-05-20`

---

## Runtime Directory Structure

```
~/.wispy/
├── config.json              # Main configuration
├── wallet/
│   └── wallet.json          # Encrypted wallet
├── sessions/                # Session data
├── memory/                  # Vector store + daily notes
├── api-keys.json            # API key hashes
├── mcp/
│   └── servers.json         # MCP server configs
├── credentials/             # Encrypted integration credentials
├── marathon/                # Marathon state + checkpoints
├── wispy/
│   ├── SOUL.md              # Agent personality
│   ├── TOOLS.md             # Tool documentation
│   └── skills/              # User-defined skills
└── logs/                    # Pino log files
```
