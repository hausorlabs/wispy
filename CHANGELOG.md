# Changelog

## [1.7.0] - 2026-02-23

### Added
- **Claude Engine** as switchable alternative to Gemini via `@anthropic-ai/sdk`
- **Engine Abstraction Layer** (`src/ai/engine.ts`) for seamless switching between Gemini and Claude
- **Memory Bank** skill with 4 typed categories: episodic, semantic, procedural, preference
- Memory lifecycle management: decay (time-based), reinforcement (access-based), reflection (AI consolidation)
- 5 new Memory Bank tools: `memory_store_typed`, `memory_reflect`, `memory_forget`, `memory_list_categories`, `memory_get_context`
- Context-aware memory injection into system prompts
- Claude extended thinking support with budget token mapping
- Claude tool_use format conversion from Gemini function declarations

### Changed
- Project structure cleaned up: tests moved to `tests/integration/`, scripts to `scripts/`, docs to `docs/submissions/`
- Removed unused stubs (`database/`, `backend/`)
- Heartbeat now runs Memory Bank decay cycle
- Router supports Claude model selection (Sonnet for reasoning, Haiku for fast)
- Engine configurable via `ENGINE=gemini|claude` env var

## [1.6.0] - 2026-02-20

### Added
- **Named Sessions** with isolated context, daily auto-reset, and instant switching
- **Process Manager** to spawn, monitor, kill, and auto-restart background processes
- **Skills.sh Registry** client with search, install, and uninstall for 67,000+ community skills
- **Cross-Model Delegation** to Claude, GPT-4o, Llama, Groq, Kimi, and 200+ models via OpenRouter
- **Cross-Model Payment Bridge** so any delegated model can trigger x402 payments
- **Model Comparison** tool to send the same prompt to multiple models side-by-side
- **Slack** channel adapter (Socket Mode with mentions, threads)
- **Matrix** channel adapter (Client-Server API v3, long-poll sync)
- **Signal** channel adapter (signal-cli REST API)
- 14 new integrations: LinkedIn, Instagram, Reddit, MS Teams, Matrix, Signal, Trello, Asana, Calendly, Image Generation, Camera/Screenshot, Stripe, 1Password, Sonos
- Canvas integration for SVG and Mermaid diagram generation
- Budget controls with daily limits, per-transaction caps, auto-approve thresholds
- Proactive goal tools (agent_goal_set, agent_goals_list)
- Multi-provider setup wizard (configure Gemini + Anthropic + OpenAI + Ollama + OpenRouter in one flow)

### Changed
- Tool count expanded from 90+ to 120+
- Integration count expanded from 27 to 42+
- Channel count expanded from 7 to 10
- Updated README to comprehensive product documentation
- Updated docs site (docs.wispy.cc) with all v1.6 features

## [1.5.1] - 2026-02-08

### Added
- Marathon Mode with autonomous multi-step execution, checkpointing, and auto-recovery
- Thinking Levels (low/medium/high/ultra) with up to 24K thinking tokens
- x402 agentic commerce with USDC payments on SKALE
- AP2 mandate chains and BITE v2 encryption
- DeFi swap engine with Algebra DEX integration
- Telegram and WhatsApp channel adapters with Marathon support
- Discord channel adapter with threads and file uploads
- REST API and WebSocket channels
- Agent-to-Agent (A2A) protocol support
- 90+ built-in tools across file system, web, browser, code execution, memory, media, blockchain
- 27 integrations across Google, productivity, social, smart home, and AI models
- Browser automation with 39 tools + 55 built-in skills via Playwright
- Interactive setup wizard (onboard command)
- Health check (doctor command)
- Day/night theme support

## [1.0.0] - 2026-01-15

- Initial release
