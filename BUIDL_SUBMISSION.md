<div align="center">

[![Watch the Demo](https://img.youtube.com/vi/U7KddE5Yg1c/maxresdefault.jpg)](https://www.youtube.com/watch?v=U7KddE5Yg1c)

**[▶ Watch Demo Video](https://www.youtube.com/watch?v=U7KddE5Yg1c)**

</div>

# Wispy -- An Autonomous AI Agent That Discovers, Decides, Pays, and Delivers

**Team:** Brian Mwai & Joy Lang'at ([Hausor Labs](https://hausorlabs.tech))
**Demo:** [youtu.be/U7KddE5Yg1c](https://youtu.be/U7KddE5Yg1c?si=aj0V0K3UE1LICO5z) | **Site:** [wispy.cc](https://wispy.cc) | **npm:** [wispy-ai](https://www.npmjs.com/package/wispy-ai) | **Docs:** [docs.wispy.cc](https://docs.wispy.cc) | **GitHub:** [hausorlabs/wispy](https://github.com/hausorlabs/wispy)

---

## What It Does

Wispy is an AI agent platform powered by Gemini 2.5 Pro that completes real commerce workflows end-to-end without human wallet interaction. Give it a goal like "research Nairobi weather, analyze sentiment, compile a report" and it:

1. **Discovers** three paid API services and evaluates their cost
2. **Decides** whether to pay based on budget reasoning ($0.004 total vs $5.00 daily limit)
3. **Pays** each service in USDC via x402 (HTTP 402 -> EIP-3009 sign -> Kobaru settle -> retry)
4. **Delivers** a compiled report chaining all three results

No wallet popups. No human approval for micro-payments. The agent signs, pays, and moves on. Every payment is logged with amount, recipient, and on-chain proof. A Commerce Policy Engine enforces hard spending caps the agent cannot override.

This is not a demo of one payment. It is a full autonomous workflow: multi-step tool chaining, cost reasoning, DeFi trading with risk controls, AP2 structured purchases, and BITE v2 encrypted transactions -- all across 5 hackathon tracks.

---

## Live Demo Results (February 16, 2026)

The `/x402demo all` command ran all 5 tracks autonomously in 10 turns:

```
Tracks Completed:    5 / 5
Total Payments:      6 transactions
Total USDC Spent:    $0.016000
Demo Duration:       10 turns
Budget Remaining:    $99.984000
```

Full audit report PDF: [`x402_hackathon_report.pdf`](docs/x402_hackathon_report.pdf)

---

## Screenshots

### 1. CLI Startup & Banner
> Wispy v1.4.0-x402 with x402 + AP2 + BITE + DeFi capabilities, SKALE BITE V2 network, and connected Telegram channel.

![CLI Startup](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/01-cli-startup.png)

### 2. Track 1: Service Discovery & 3-API Chain
> Agent discovers x402 services, pays weather ($0.001), sentiment ($0.002), and report ($0.001) APIs autonomously.

![Service Discovery](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/02-service-discovery.png)

![API Chain](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/03-api-chain.png)

### 3. Track 2: Budget Reasoning & Audit Trail
> Agent checks budget ($0.004 spent of $5.00), explains cost/benefit, and generates full audit trail.

![Budget Reasoning](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/04-budget-reasoning.png)

### 4. Track 3: AP2 Purchase Flow
> Full AP2 mandate chain: Intent (EIP-191 signed) -> Cart -> Payment -> Receipt.

![AP2 Flow](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/05-ap2-flow.png)

### 5. Track 4: DeFi Trading with Risk Engine
> 0.01 USDC swap APPROVED (risk 15/100, real on-chain tx). 5000 USDC swap DENIED (risk 90/100, exceeds $500 limit).

![DeFi Trading](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/06-defi-trading.png)

### 6. Track 5: BITE v2 Encrypted Payment
> BLS threshold encryption, on-chain submission, condition evaluation, decryption verification.

![BITE Encryption](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/07-bite-encryption.png)

### 7. Final Verification Summary
> All 5 tracks PASS with 6 transactions and on-chain proof links.

![Verification Summary](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/08-verification-summary.png)

### 8. Agent-Generated Verification Report
> Wispy autonomously generates a full audit trail summary with all tx hashes and track results.

![Agent Report](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/09-agent-report.png)

### 9. Telegram Integration
> PDF audit report sent to Telegram with full demo results.

![Telegram](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/11-telegram.png)

### On-Chain Explorer Proof

> Agent Wallet -- [View on Explorer](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A)

![Explorer - Agent Wallet](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/12-explorer-wallet.png)

> DeFi Swap Transaction -- [View on Explorer](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x84878e1ae0f2c3c330d45040da6e83db204c72eb6b9b711ebe28f3a58a5d7b8d)

![Explorer - DeFi Tx](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/13-explorer-defi-tx.png)

> BITE Encrypted Transaction -- [View on Explorer](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x0cd005abdf1c4d7607caab14c4b01cee213f206c71d5dc0cd65fec24ad9af72a)

![Explorer - BITE Tx](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/14-explorer-bite-tx.png)

> Algebra SwapRouter Contract -- [View on Explorer](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0x3012E9049d05B4B5369D690114D5A5861EbB85cb)

![Explorer - SwapRouter](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/15-explorer-swapRouter.png)

### PDF Audit Report

> Full audit trail auto-generated by Wispy -- [View PDF](https://github.com/hausorlabs/wispy/blob/x402-demo-fixes/docs/x402_hackathon_report.pdf)

![PDF Report](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/screenshots/16-pdf-report.png)

---

## All 5 Tracks

### Track 1: Overall Best Agentic App

Full discover -> decide -> pay -> deliver workflow. Agent chains 3 paid API services:

| Step | Service | Cost | What It Does |
|------|---------|------|-------------|
| A | Weather API | $0.001 | Fetches Nairobi weather (29C, Light Rain) |
| B | Sentiment API | $0.002 | Analyzes weather text (negative, -0.7 score) |
| C | Report API | $0.001 | Compiles weather + sentiment into summary |

Total: $0.004 USDC, 3 autonomous x402 payments, zero human intervention. The agent reasons about each step before paying.

### Track 2: Agentic Tool Usage on x402

Budget-aware agent with full HTTP 402 flow:
- Calls `x402_check_budget` to see $0.004 spent of $5.00 daily limit
- Explains cost/benefit reasoning: "$0.004 was essential for Track 1, negligible vs $5.00 budget"
- Calls `x402_audit_trail` to display full payment history with amounts, recipients, timestamps
- Commerce Policy Engine enforces hard limits the agent cannot override

### Track 3: Best Integration of AP2

Full AP2 mandate chain with EIP-191 signatures at every stage:

```
Intent (agent signs)  ->  Cart (merchant provides)  ->  Payment (agent authorizes)  ->  Receipt (auditable)
intent_12d973c1...       cart_89c1d5c1...               payment_459de599...              settled via x402
```

Agent calls `ap2_purchase` and `ap2_get_receipts` to demonstrate the complete structured purchase flow.

### Track 4: Best Trading / DeFi Agent

Agent queries Algebra DEX on SKALE, evaluates risk, and demonstrates both approved and denied trades:

| Swap | Amount | Risk Score | Result | Tx Hash |
|------|--------|-----------|--------|---------|
| USDC -> ETH | 0.01 USDC | 15/100 | **APPROVED** | [`0x84878e1a...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x84878e1ae0f2c3c330d45040da6e83db204c72eb6b9b711ebe28f3a58a5d7b8d) |
| USDC -> ETH | 5000 USDC | 90/100 | **DENIED** | N/A (blocked by risk engine) |

Denial reason: "Amount $5000 exceeds max position size $500". Trade log confirms: Executed: 1, Denied: 1.

### Track 5: Encrypted Agents (BITE v2)

BLS threshold encryption via BITE v2 on SKALE:

| Step | Action | Result |
|------|--------|--------|
| A | `bite_encrypt_payment` | Payment encrypted, condition: time_lock (immediate) |
| B | Condition evaluation | Time lock expired, condition MET |
| C | On-chain submission | Tx [`0x0cd005ab...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x0cd005abdf1c4d7607caab14c4b01cee213f206c71d5dc0cd65fec24ad9af72a) confirmed in block 161119 |
| D | `bite_check_and_execute` | Verification tx [`0x8ec6fa6b...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x8ec6fa6b393fda96e3c03a3a683b84de5c63b7f41c73cdf4c1398a7c72672ac2) confirmed in block 161130 |
| E | Decryption verified | BLS threshold decryption confirmed on-chain |

Transaction `to` and `calldata` are encrypted before submission. Validators decrypt during consensus (2t+1 threshold). Prevents MEV and front-running.

---

## On-Chain Proof

All transactions are verifiable on the SKALE BITE V2 Sandbox Explorer. Every hash below is a real, confirmed transaction.

| What | Explorer Link |
|------|--------------|
| **Agent Wallet** | [`0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A) |
| **DeFi Swap** (0.01 USDC -> ETH) | [`0x84878e1a...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x84878e1ae0f2c3c330d45040da6e83db204c72eb6b9b711ebe28f3a58a5d7b8d) |
| **BITE Tx 1** (encrypt + execute) | [`0x0cd005ab...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x0cd005abdf1c4d7607caab14c4b01cee213f206c71d5dc0cd65fec24ad9af72a) |
| **BITE Tx 2** (check + verify) | [`0x8ec6fa6b...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x8ec6fa6b393fda96e3c03a3a683b84de5c63b7f41c73cdf4c1398a7c72672ac2) |
| **USDC Contract** | [`0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8) |
| **Algebra SwapRouter** | [`0x3012E9049d05B4B5369D690114D5A5861EbB85cb`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0x3012E9049d05B4B5369D690114D5A5861EbB85cb) |
| **Seller Wallet** | [`0x5327c1Aa24B7940677Ad0a826f1275414cF340Eb`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0x5327c1Aa24B7940677Ad0a826f1275414cF340Eb) |
| **Audit Report (PDF)** | [`x402_hackathon_report.pdf`](docs/x402_hackathon_report.pdf) |

| Detail | Value |
|--------|-------|
| **Network** | SKALE BITE V2 Sandbox |
| **Chain ID** | 103698795 |
| **Gas** | $0 (gasless) |
| **Facilitator** | [Kobaru](https://gateway.kobaru.io) |
| **SKALE Explorer** | [base-sepolia-testnet-explorer.skalenodes.com:10032](https://base-sepolia-testnet-explorer.skalenodes.com:10032) |

---

## Why This Wins

The judges want: *"agents that can reliably complete real workflows with payments/settlement."*

### Real Utility
The agent solves a concrete commerce task: it procures data from multiple paid APIs, reasons about cost, pays autonomously, trades on a DEX, encrypts conditional payments, and delivers a compiled result. It works across CLI, Telegram, and REST -- not a single-channel demo.

### Reliability
The x402 flow is deterministic: detect 402 -> read price headers -> check budget -> sign EIP-3009 -> settle via Kobaru -> retry with proof. If a payment is denied (over budget), the agent acknowledges and adapts. If a service is down, the agent reports it and continues with available data. 10 turns, 5/5 tracks, zero failures.

### Trust & Safety

| Guardrail | How It Works |
|-----------|-------------|
| **Spending caps** | Max $1/tx, $5/day, auto-approve below $0.10 |
| **Risk engine** | DeFi trades scored 0-100. Position size, slippage, daily loss checked before execution |
| **Session isolation** | Only the "main" session can access the wallet |
| **Action guard** | Payments classified as "external" -- require approval above threshold |
| **No fake proofs** | Tx hashes only shown when real. "facilitator-settled" shown when no on-chain hash returned |
| **Tool validation** | Tracks only marked PASS when required tools have actually been called (not agent text claims) |

### Receipts & Audit Trail
Every payment produces a logged record: amount, recipient wallet, timestamp, service name, and on-chain tx hash (when available). The x402 dashboard (Ctrl+E) shows wallet balance, budget usage, and full payment history in real time. AP2 flows produce signed mandate chains with EIP-191 signatures at every step. A PDF audit report is auto-generated and can be sent to Telegram.

---

## How We Built It

TypeScript on Node.js 20+. Gemini 2.5 Pro receives goals + 92 tool definitions, picks which to call, executes them, and loops until done. For paid services: HTTP 402 detected -> price/payee read from headers -> EIP-3009 USDC authorization signed -> Kobaru settles -> agent retries with payment proof.

| Component | Technology |
|-----------|-----------|
| **AI Engine** | Gemini 2.5 Pro (planning, reasoning, tool use), Flash (routing) |
| **Embeddings** | text-embedding-004 into SQLite vector store |
| **Images** | Imagen 3 |
| **Blockchain** | SKALE BITE V2, viem for wallet/contract ops |
| **Payments** | Coinbase x402 + @x402/evm SDK, Kobaru facilitator |
| **Settlements** | AP2 Protocol (Intent/Cart/Payment/Receipt mandates) |
| **DeFi** | Algebra DEX v1.2.2 (concentrated liquidity swaps via SwapRouter) |
| **Encryption** | BITE v2 BLS threshold encryption |
| **Wallet** | Coinbase Developer Platform (CDP) |
| **Channels** | CLI (Ink/React), Telegram, REST API |
| **UI** | Ink (React for CLI) with streaming, progress bars, thinking levels |

---

## Challenges

**Autonomous spending decisions.** Getting the AI to reason about cost before paying was the hardest part. We built a Commerce Policy Engine with hard caps that the agent cannot bypass, and a tool-evidence validation system that prevents the agent from claiming track completion without actually making the required tool calls.

**BITE encryption.** The SDK is early-stage. We wrote defensive wrappers around encryption calls and handled edge cases in condition evaluation. Time-lock conditions required careful coordination between encryption, condition checking, and on-chain submission.

**Hallucinated proofs.** Early versions generated fake tx hashes when the facilitator didn't return one. We caught this, removed all fake hash generation, and now display "facilitator-settled" for payments that go through the Kobaru facilitator without an on-chain hash. Only real, verified on-chain hashes are shown.

**DeFi risk engine calibration.** The agent needed to demonstrate both an approved trade and a denied trade in the same session. We tuned the risk engine parameters (maxPositionSize: $500, riskScore thresholds) so that small trades pass while large trades are blocked, proving the safety mechanism works.

---

## Links

- **Demo Video:** [youtu.be/U7KddE5Yg1c](https://youtu.be/U7KddE5Yg1c?si=aj0V0K3UE1LICO5z)
- **Website:** [wispy.cc](https://wispy.cc)
- **Docs:** [docs.wispy.cc](https://docs.wispy.cc)
- **npm:** `npm install -g wispy-ai`
- **GitHub:** [hausorlabs/wispy](https://github.com/hausorlabs/wispy)
- **Twitter/X:** [x.com/hausorlabs](https://x.com/hausorlabs)
- **Audit Report:** [`x402_hackathon_report.pdf`](docs/x402_hackathon_report.pdf)

---

*Built by Brian Mwai & Joy Lang'at at Hausor Labs. SF Agentic Commerce x402 Hackathon, February 2026.*
