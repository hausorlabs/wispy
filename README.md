<p align="center">
  <img src="assets/banner.png" alt="Wispy Banner" width="100%" />
</p>

<h1 align="center">Wispy</h1>

<p align="center">
  <strong>Autonomous AI Agent Platform</strong><br />
  <em>125+ tools, 42+ integrations, dual-engine (Gemini + Claude), Memory Bank, sessions, skills.sh, x402 commerce</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/wispy-ai"><img src="https://img.shields.io/npm/v/wispy-ai?style=flat-square&color=31ccff" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="Node.js" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
</p>

<p align="center">
  <a href="https://docs.wispy.cc">Docs</a> &middot;
  <a href="https://wispy.cc">Website</a> &middot;
  <a href="https://app.wispy.cc">Platform</a> &middot;
  <a href="https://github.com/hausorlabs/wispy">GitHub</a>
</p>

---

## What is Wispy?

Wispy is an autonomous AI agent that lives in your terminal, messaging apps, and APIs. Dual-engine architecture powered by Google Gemini 2.5 Pro and Anthropic Claude, with cross-model delegation to GPT-4o, Llama, and 200+ models via OpenRouter. Features a structured Memory Bank with typed categories, lifecycle management, and AI-powered reflection.

```bash
npm install -g wispy-ai
wispy onboard
wispy chat
```

---

## Features

### Core

- **125+ Built-in Tools** across file system, web, browser automation, code execution, memory, media, blockchain, and identity
- **Dual Engine** -- switch between Gemini and Claude with a single env var (`ENGINE=gemini|claude`)
- **Memory Bank** with 4 typed categories (episodic, semantic, procedural, preference), time-based decay, reinforcement, and AI-powered reflection
- **Marathon Mode** for multi-step, long-running autonomous tasks with checkpointing and auto-recovery
- **Thinking Levels** (low/medium/high/ultra) with up to 24K thinking tokens (Gemini) or 32K budget tokens (Claude)
- **Named Sessions** with isolated context, daily auto-reset, and instant switching
- **Process Manager** to spawn, monitor, and manage background processes
- **Skills.sh Registry** with 67,000+ community skills you can install with a single command

### Multi-Model / Dual Engine

- **Gemini 2.5 Pro** -- primary reasoning engine with native function calling and extended thinking
- **Claude (Opus/Sonnet/Haiku)** -- switchable alternative engine via `@anthropic-ai/sdk` with tool_use and extended thinking
- **Engine abstraction layer** -- seamless switching, embeddings always via Gemini
- **Cross-model delegation** to GPT-4o, Groq, Kimi, Llama via Ollama, and 200+ models via OpenRouter
- **Model comparison** to send the same prompt to multiple models and compare responses
- **Setup wizard** configures all providers in one flow

### Channels (10)

| Channel | Status |
|---------|--------|
| CLI (REPL) | Built-in |
| Telegram | Full adapter with Marathon support, file access, voice |
| WhatsApp | Baileys adapter with Marathon support |
| Discord | Full adapter with threads, file uploads |
| Slack | Socket Mode adapter with mentions, threads |
| Matrix | Client-Server API v3 with long-poll sync |
| Signal | signal-cli REST API adapter |
| REST API | Express with API key auth |
| WebSocket | Real-time streaming |
| Agent-to-Agent (A2A) | Google A2A protocol |

### Integrations (42+)

| Category | Integrations |
|----------|-------------|
| AI Models | OpenAI, Anthropic, Ollama, OpenRouter, Groq, Kimi |
| Google | Calendar, Docs, Drive, Gmail, Maps, Meet, Search, Sheets, YouTube |
| Chat | Discord, Slack, Matrix, Signal, MS Teams |
| Productivity | Notion, GitHub, Linear, Obsidian, Trello, Asana, Calendly |
| Social | Twitter/X, LinkedIn, Instagram, Reddit |
| Smart Home | Home Assistant, Hue, Sonos |
| Music | Spotify |
| Commerce | Stripe |
| Security | 1Password |
| Media | Image Generation (DALL-E/Stability/Replicate), Camera/Screenshot |
| Tools | Weather, Webhooks, Canvas (SVG/Mermaid) |
| Browser | 39 automation tools + 55 built-in skills via Playwright |

### Agentic Commerce (x402)

- **x402 protocol** for autonomous USDC payments on SKALE (gasless)
- **AP2 mandate chains** (intent, cart, payment, receipt)
- **BITE v2 encryption** for private transactions (BLS threshold)
- **DeFi swap engine** with Algebra DEX integration and risk controls
- **Cross-model payment bridge** so any AI model can trigger payments
- **Budget controls** with daily limits, per-transaction caps, auto-approve thresholds

---

## Quick Start

```bash
# Install
npm install -g wispy-ai

# Interactive setup (Gemini key + optional providers + Telegram + wallet)
wispy onboard

# Chat in the terminal
wispy chat

# Start a Marathon (autonomous multi-step task)
wispy marathon "Build a full-stack SaaS dashboard with auth and payments"

# Run the gateway (all channels simultaneously)
wispy gateway

# Run as a background daemon
wispy gateway --daemon
```

---

## CLI Commands

```bash
wispy chat                    # Interactive REPL
wispy agent "prompt"          # Single-shot prompt
wispy marathon "goal"         # Autonomous multi-step task
wispy gateway                 # Start all channels
wispy onboard                 # Setup wizard
wispy doctor                  # Health check
wispy skills list             # List browser skills
wispy integrations list       # List all integrations
wispy wallet balance          # Check wallet balance
wispy wallet details          # Wallet address + chain info
```

---

## Configuration

Wispy uses `~/.wispy/config.yaml` for configuration and `.env` for secrets:

```yaml
# config.yaml
engine: gemini  # or "claude"

gemini:
  models:
    pro: gemini-2.5-pro-preview-05-06
    flash: gemini-2.5-flash-preview-05-20

claude:
  models:
    reasoning: claude-sonnet-4-20250514
    fast: claude-haiku-4-5-20251001

channels:
  telegram: { enabled: true }
  discord: { enabled: false }
  slack: { enabled: false }

providers:
  anthropic: { apiKey: "..." }
  openai: { apiKey: "..." }

security:
  autonomousMode: true
  fullFilesystemAccess: true

wallet:
  enabled: true
  chain: skale-bite-sandbox

theme: day
```

```bash
# .env
ENGINE=gemini              # Switch engine: gemini or claude
GEMINI_API_KEY=AIza...
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-20250514  # Optional override
TELEGRAM_BOT_TOKEN=123456:ABC...
AGENT_PRIVATE_KEY=0x...
OPENAI_API_KEY=sk-...
```

---

## Architecture

```
              ┌──────────────────┐     ┌──────────────────┐
              │  Gemini 2.5 Pro  │ ◄─► │  Claude (Anthropic│
              │  (default)       │     │  (switchable)     │
              └────────┬─────────┘     └────────┬─────────┘
                       └──────────┬─────────────┘
                       ┌──────────▼──────────┐
                       │  Engine Abstraction  │
                       │  + Memory Bank       │
                       │  + Cross-Model Bridge│
                       └──────────┬──────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                     │
     ┌────────▼──────┐  ┌───────▼───────┐  ┌─────────▼────────┐
     │  125+ Tools    │  │  42+ Integs   │  │  x402 Commerce   │
     │  Sessions      │  │  Skills.sh    │  │  Payment Bridge  │
     │  Processes     │  │  Browser (39) │  │  Budget Policy   │
     └────────┬──────┘  └───────┬───────┘  └─────────┬────────┘
              │                  │                      │
     ┌────────▼──────────────────▼──────────────────────▼──────┐
     │                    Channel Dock                          │
     │  CLI | Telegram | WhatsApp | Discord | Slack | Matrix   │
     │  Signal | REST | WebSocket | A2A                        │
     └─────────────────────────────────────────────────────────┘
```

---

## Documentation

Full documentation at **[docs.wispy.cc](https://docs.wispy.cc)**

---

## Team

Built by [Hausor Labs](https://hausorlabs.tech)

- **Brian Mwai** - Engineering
- **Joy C. Langat** - Product

---

## License

[MIT](LICENSE)

---

<p align="center">
  <a href="https://wispy.cc">wispy.cc</a> &middot;
  <a href="https://docs.wispy.cc">docs</a> &middot;
  <a href="https://app.wispy.cc">platform</a> &middot;
  <a href="https://www.npmjs.com/package/wispy-ai">npm</a> &middot;
  <a href="https://github.com/hausorlabs/wispy">GitHub</a>
</p>
