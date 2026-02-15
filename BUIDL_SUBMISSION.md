[![Wispy Demo Video](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/docs/devpost-assets/hero-banner.png)](https://youtu.be/YOUR_VIDEO_ID_HERE)

> **Watch the demo video above** -- the agent discovers services, pays for APIs, trades on Algebra DEX, encrypts transactions with BITE, and sends results to Telegram. All autonomous, all on SKALE.

# Wispy -- An AI Agent That Can Spend Money on the Internet by Itself

**Team:** Brian Mwai & Joy Lang'at ([Hausor Labs](https://hausorlabs.tech))
**Website:** [wispy.cc](https://wispy.cc) | **Docs:** [docs.wispy.cc](https://docs.wispy.cc) | **npm:** [wispy-ai](https://www.npmjs.com/package/wispy-ai) | **GitHub:** [github.com/hausorlabs/wispy](https://github.com/hausorlabs/wispy)

---

## The Problem

AI agents can research, write code, analyze data, and plan complex tasks. But the moment they need to pay for something, everything stops. A wallet popup appears. The agent waits. A human has to come back, review the transaction, and click "Approve."

For a $0.001 API call. That's the commerce bottleneck.

---

## What Wispy Does

Wispy is an autonomous AI agent platform powered by Google Gemini 2.5 Pro. It can discover paid services, decide whether to pay for them, make the payment in USDC, and use the result. No human touches a wallet.

We built a full agentic commerce stack on SKALE's BITE V2 Sandbox during this hackathon. The agent manages its own wallet, follows spending rules we set (like "never spend more than $10 per transaction"), and keeps a full record of every payment it makes.

![Commerce Stack](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/docs/devpost-assets/commerce-stack.png)

We run a 5-track live demo where the agent handles all of this on its own. No scripts. No hard-coded steps. The agent decides what to do based on goals we give it.

![5-Track Demo Overview](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/docs/devpost-assets/demo-tracks.png)

### Agent Wallet (On-Chain, Verifiable)

| Detail | Value |
|--------|-------|
| **Agent Address** | [`0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A) |
| **Network** | SKALE BITE V2 Sandbox (Chain ID: 103698795) |
| **Starting Balance** | $9,999.976 USDC + 4.99 sFUEL |
| **Gas Cost** | $0 (SKALE is gasless) |
| **Explorer** | [base-sepolia-testnet-explorer.skalenodes.com:10032](https://base-sepolia-testnet-explorer.skalenodes.com:10032) |

---

## Track-by-Track Breakdown with Proof

### Track 1: Overall Best Agentic App

The agent receives a single goal: "Research Nairobi weather and market sentiment, compile a report." It autonomously discovers three paid API services, pays for each one in USDC via x402, chains the results together, and delivers a compiled report. No human intervention at any step.

![x402 Payment Flow](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/docs/devpost-assets/x402-flow.png)

**Live demo output (verbatim from terminal):**

```
Agent wallet: 0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A
Budget: $10.00 USDC daily

[Step 1] Fetching weather data for Nairobi ($0.001)...
[x402] Fetching: http://localhost:4021/weather?city=Nairobi
[x402] Payment payload created
[seller:weather] Paid request for city=Nairobi
  Result: Nairobi - 25C, Light Rain

[Step 2] Analyzing market sentiment ($0.002)...
[x402] Fetching: http://localhost:4022/analyze
[x402] Payment payload created
[seller:sentiment] Paid analysis for: "Nairobi weather is Light Rain at 25C..."
  Result: Sentiment is positive (score: 0.97)

[Step 3] Generating compiled report ($0.001)...
[x402] Fetching: http://localhost:4023/report
[x402] Payment payload created
[seller:report] Paid report generation (format=detailed)
  Result: "Agent-Generated Report" with 3 sections
```

**What this proves:** The agent discovered 3 services, evaluated costs against its budget, signed EIP-3009 USDC authorizations, paid via the Kobaru facilitator on SKALE, received data, and chained results into a final report. All autonomous, all in 35.6 seconds.

**Verification:**
- Agent address: [`0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A) (check on-chain activity)
- Seller wallets rotated per track (e.g., `0xB4304808aDFaaF3f94982B4b12f07eE4cDec0cda`)
- Settlement via [Kobaru facilitator](https://gateway.kobaru.io) on SKALE BITE V2

---

### Track 2: Agentic Tool Usage on x402

The agent operates under a tight $0.01/day budget. Before making any call, it reasons about whether the total cost fits within its limit. It discovers 3 services totaling $0.004, confirms they fit the $0.01 budget, and proceeds.

**Live demo output (verbatim):**

```
Daily limit: $0.01 USDC (tight budget for demo)
Auto-approve below: $0.005 USDC

Cost Reasoning:
  Weather API:   $0.001/call (auto-approve: yes)
  Sentiment API: $0.002/call (auto-approve: yes)
  Report API:    $0.001/call (auto-approve: yes)
  Total needed:  $0.004
  Budget:        $0.01
  Decision:      PROCEED -- total cost $0.004 within $0.01 daily limit

[x402 Call 1] Weather API -> $0.001
  Budget check: $0.000 spent / $0.010 limit -> OK
  HTTP 402 -> Sign EIP-3009 -> Pay via Kobaru -> 200 OK
  Data: Lagos 25C Sunny

[x402 Call 2] Sentiment API -> $0.002
  Budget check: $0.000 spent / $0.010 limit -> OK
  HTTP 402 -> Sign EIP-3009 -> Pay via Kobaru -> 200 OK
  Data: neutral (score: -0.11)

[x402 Call 3] Report API -> $0.001
  Budget check: $0.000 spent / $0.010 limit -> OK
  HTTP 402 -> Sign EIP-3009 -> Pay via Kobaru -> 200 OK
  Data: "Agent-Generated Report"
```

**What this proves:** The agent performs pre-call cost reasoning, checks budget at every step, signs EIP-3009 USDC authorizations per call, and handles the full HTTP 402 -> sign -> pay -> retry flow automatically. The Commerce Policy Engine enforces hard limits -- the agent cannot exceed them even if it wants to.

**Commerce Policy Engine config:**

| Parameter | Value |
|-----------|-------|
| Max per transaction | $10.00 USDC |
| Daily limit | $100.00 USDC |
| Auto-approve below | $1.00 USDC |
| Require approval above | $1.00 USDC |
| Session isolation | Only "main" session can use wallet |

---

### Track 3: Best Integration of AP2

AP2 (Google's Agentic Payments Protocol) structures every purchase into four cryptographically signed mandates: Intent, Cart, Payment, Receipt. We run 3 AP2 flows: 2 successful purchases and 1 deliberate failure to show graceful denial handling.

**AP2 Purchase 1 -- Weather Data (Success):**

```
[AP2] Step 1: Creating IntentMandate...
[AP2] Intent signed: 0xf86716e07cbc37fc1b...
[AP2] Intent created: intent_ff7f799d-d335-4131-9ea9-92d607d97cb9

[AP2] Step 2: Requesting cart from merchant...
[AP2] Cart received: cart_029a4542-0a6d-4618-a490-1fd66af9ca71 (total: $0.001000 USDC)

[AP2] Step 3: Authorizing payment...
[AP2] Payment signed: 0x8823ea44c5de9d3101...
[AP2] Payment authorized: payment_1f6c34e3-349d-4dad-b717-58eb68d884f3

[AP2] Step 4: Settling payment via x402...
[AP2] Settlement complete
[AP2] === Flow Complete (success) ===

  Mandates: Intent -> Cart -> Payment -> Receipt
  Receipt: receipt_e83ab0d7-3331-4209-aefa-12db979a13e2
```

**AP2 Purchase 2 -- Sentiment Analysis (Success):**

```
[AP2] Intent: intent_7c9034e0-ff9f-420b-a575-d5b0b0c7d057
[AP2] Cart: cart_3e0c2e72-2cd6-4996-b576-f715736f1a3e (total: $0.002000 USDC)
[AP2] Payment: payment_7f8f07b2-2bc1-4920-8e0d-d4e3f4207e7d
[AP2] Receipt: receipt_664c28f3-2fdd-407f-963d-615984b7d6da
[AP2] === Flow Complete (success) ===
```

**AP2 Purchase 3 -- Authorization Denied (Graceful Failure):**

```
[AP2] === Starting AP2 Failure Flow (authorization_denied) ===
[AP2] === Flow Failed Gracefully (authorization_denied) ===

  Status: failed
  Error: Payment authorization denied: amount exceeds agent's approved spending limit
  Graceful handling: Agent acknowledges denial and continues operation.
```

**Full AP2 Audit Trail:**

| # | Intent ID | Cart Total | Payment ID | Receipt ID | Status |
|---|-----------|-----------|------------|------------|--------|
| 1 | `intent_ff7f799d` | $0.001 USDC | `payment_1f6c34e3` | `receipt_e83ab0d7` | Success |
| 2 | `intent_7c9034e0` | $0.002 USDC | `payment_7f8f07b2` | `receipt_664c28f3` | Success |
| 3 | `intent_adb87797` | $0.001 USDC | `payment_fa204325` | `receipt_be494f7e` | Denied |

**What this proves:** Full AP2 mandate chain with EIP-191 signatures at every step. The agent signs Intents, receives Carts from merchants, authorizes Payments, and receives verifiable Receipts. When a payment is denied (exceeds spending limit), the agent handles it gracefully without crashing.

---

### Track 4: Best Trading / DeFi Agent

The agent researches token markets using Algebra DEX subgraph data, evaluates risk with a built-in risk engine, and executes trades on-chain. It has hard guardrails: max position size $0.005, max slippage 1%, daily loss limit $0.02.

**Live demo -- 3 trade evaluations:**

```
Trade 1: 0.001 USDC -> ETH
  Risk score: 21/100 -> APPROVED
  Executed: tx=0x39b126ab04c25e... Gas: 36034

Trade 2: 1.0 USDC -> ETH
  Risk score: 90/100 -> DENIED
  Reason: Amount $1 exceeds max position size $0.005
  Agent: "Acknowledged denial, adjusting strategy to stay within risk bounds."

Trade 3: 0.002 USDC -> ETH (reduced after denial)
  Risk score: 28/100 -> APPROVED
  Executed: tx=0x122939784a5550... Gas: 36034
```

**Full DeFi Trade Log:**

| # | Action | From | To | Amount | Risk Score | Approved | Method | Tx Hash |
|---|--------|------|----|--------|-----------|----------|--------|---------|
| 1 | swap | USDC | ETH | $0.001 | 21/100 | YES | direct_transfer | `0x39b126ab04c25e...` |
| 2 | swap | USDC | ETH | $1.000 | 90/100 | NO | denied | N/A |
| 3 | swap | USDC | ETH | $0.002 | 28/100 | YES | direct_transfer | `0x122939784a5550...` |

**What this proves:** The agent queries Algebra DEX (SwapRouter: `0x3012E9049d05B4B5369D690114D5A5861EbB85cb`), evaluates risk before every trade, respects hard position limits, and adapts its strategy when denied. Trade 2 is denied at $1.00 (exceeds $0.005 limit), and the agent immediately adjusts to $0.002 for Trade 3.

**Risk Engine Parameters:**

| Parameter | Value |
|-----------|-------|
| Max position size | $0.005 USDC |
| Max slippage | 100bps (1%) |
| Daily loss limit | $0.02 USDC |
| DEX | Algebra Integral v1.2.2 on SKALE BITE V2 |

---

### Track 5: Encrypted Agents (BITE v2)

The agent encrypts transaction data using BLS threshold encryption before submitting to SKALE. The `to` address and `calldata` are invisible in the mempool. Validators cooperatively decrypt during consensus using 2t+1 threshold. This prevents MEV, front-running, and provides privacy.

![BITE Encryption Flow](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/docs/devpost-assets/bite-flow.png)

**Demo 1: Encrypted USDC Transfer -- VERIFIED ON-CHAIN**

```
[BITE] Encrypting payment bite_63e817a0-c7b1-43aa-a162-dc502a2ea632...
  Original to: 0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8 (USDC contract)
  Original data: 0xa9059cbb000000... (ERC-20 transfer calldata)
  Encrypted to: 0x42495445204D452049274d20454e435259505444 (BITE magic address)
  Encrypted data: 0xf9017e80b9017a010b4826cdbb... (BLS-encrypted)

  Submitting encrypted tx to SKALE...
  Tx Hash: 0xfe12466c68602e3c3ac3a41f7d85f9145a8be40a19de628a9dcb9ee572833d41
  Block: 26844 | Gas: 62586

  Decryption verified: Original address recovered.
```

**On-chain proof:** [`0xfe12466c68602e3c3ac3a41f7d85f9145a8be40a19de628a9dcb9ee572833d41`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0xfe12466c68602e3c3ac3a41f7d85f9145a8be40a19de628a9dcb9ee572833d41)

**Demo 2: Time-Locked Encrypted Payment -- VERIFIED ON-CHAIN**

```
[BITE] Encrypting payment bite_9a4097dc-a299-4587-9b6e-5f21b8143223...
  Condition: time_lock -- Unlock after 2-second delay

  Checking condition immediately...
  Condition met: false (time lock active)

  Waiting 2.5 seconds for time lock to expire...
  Condition met: true (time lock expired)

  Tx Hash: 0x1c5f82afe320d8fbcd148a0102a5f27942122c40fd7f19431892041893a4e9b4
  Block: 26845 | Gas: 48136
  Decryption verified.
```

**On-chain proof:** [`0x1c5f82afe320d8fbcd148a0102a5f27942122c40fd7f19431892041893a4e9b4`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x1c5f82afe320d8fbcd148a0102a5f27942122c40fd7f19431892041893a4e9b4)

**Demo 3: Delivery-Proof Payment (Condition Not Met)**

```
[BITE] Condition: delivery_proof -- Delivery proof required
  Attempting execution without delivery proof...
  Status: encrypted (no proof on-chain)
  Agent: Payment remains encrypted. Will retry when delivery is confirmed.
```

**BITE v2 Summary:**

| Demo | Payment ID | Condition | Status | Block | Tx Hash (Explorer Link) |
|------|-----------|-----------|--------|-------|------------------------|
| 1 | `bite_63e817a0` | time_lock (immediate) | Verified | 26844 | [`0xfe124...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0xfe12466c68602e3c3ac3a41f7d85f9145a8be40a19de628a9dcb9ee572833d41) |
| 2 | `bite_9a4097dc` | time_lock (2s delay) | Verified | 26845 | [`0x1c5f8...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x1c5f82afe320d8fbcd148a0102a5f27942122c40fd7f19431892041893a4e9b4) |
| 3 | `bite_72aca0ff` | delivery_proof | Encrypted (pending) | -- | Waiting for delivery confirmation |

**BLS Committee Info:**
```
Epoch 0: BLS public key 281b1097935f19c3e5076ce4d6cfaba1724e821916713a24...
1 committee(s) active -- 2t+1 validators needed for decryption.
```

**What this proves:** Real BLS threshold encryption on SKALE. Transaction data is encrypted before reaching the chain, decrypted by validators during consensus, and verifiable on the explorer. The agent can set conditions (time locks, delivery proofs) that control when encrypted payments execute.

---

### Demo Summary -- All 5 Tracks

```
[OK] Track 1: Overall Best Agentic App     -- PASS (35.6s)
[OK] Track 2: Agentic Tool Usage on x402   -- PASS (26.9s)
[OK] Track 3: Best Integration of AP2      -- PASS (10.7s)
[OK] Track 4: Best Trading / DeFi Agent    -- PASS (14.1s)
[OK] Track 5: Encrypted Agents (BITE v2)   -- PASS (14.7s)

Tracks passed: 5/5
Total time:    102.0s
```

---

## How We Built It

### The Platform

Wispy is written entirely in TypeScript running on Node.js 20+. Gemini receives a message along with tool definitions, decides which tools to call, Wispy executes them, and sends the results back. This loops until the task is done.

The platform has 92+ built-in tools covering file operations, web browsing, code execution, image generation, and now commerce. It runs across CLI, Telegram, WhatsApp, and a REST API.

![Architecture](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/docs/devpost-assets/architecture-v2.png)

### Gemini Integration

Gemini runs everything in Wispy:

| What | How Gemini Powers It |
|------|---------------------|
| **Planning** | Gemini 2.5 Pro with extended thinking (up to 24K tokens of reasoning) breaks complex goals into step-by-step plans |
| **Tool Use** | 92+ tools registered as native function declarations. Gemini picks which ones to call, in what order, with what parameters |
| **Streaming** | Real-time token streaming across CLI, Telegram, WhatsApp, and SSE endpoints |
| **Memory** | text-embedding-004 embeds every conversation into SQLite for long-term recall |
| **Images** | Imagen 3 is available as a tool for visual tasks |
| **Speed** | Gemini 2.5 Flash handles lightweight tasks like token counting and routing |

![Gemini Integration Map](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/docs/devpost-assets/gemini-integration.png)

### SKALE Integration

We chose SKALE because it's gasless. The agent doesn't need ETH for gas. It gets free sFUEL and every transaction costs $0. For an AI agent making dozens of micro-payments, this is essential.

![SKALE Integration](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/docs/devpost-assets/skale-integration.png)

| Detail | Value |
|--------|-------|
| **Chain** | SKALE BITE V2 Sandbox |
| **Chain ID** | 103698795 |
| **RPC** | `https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox` |
| **Explorer** | [base-sepolia-testnet-explorer.skalenodes.com:10032](https://base-sepolia-testnet-explorer.skalenodes.com:10032) |
| **USDC Contract** | [`0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8) |
| **Gas** | Free ($0, gasless) |
| **Facilitator** | Kobaru ([gateway.kobaru.io](https://gateway.kobaru.io)) |
| **Algebra SwapRouter** | [`0x3012E9049d05B4B5369D690114D5A5861EbB85cb`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0x3012E9049d05B4B5369D690114D5A5861EbB85cb) |

### x402 + Coinbase

We used the `@x402/evm` SDK to handle EIP-3009 signed USDC authorizations. When the agent detects a 402 response, it reads the price and payee headers, constructs a signed authorization, and sends it to Kobaru for settlement. The agent treats paid APIs the same way it treats free ones. We also added Base mainnet support via Coinbase Developer Platform for real-world x402 services.

### Multi-Network Support

| Network | Chain ID | Purpose | Status |
|---------|----------|---------|--------|
| **SKALE BITE V2** | 103698795 | Demo services, gasless testing | Active (default) |
| **Base Mainnet** | 8453 | Real x402 services (CoinGecko, etc.) | Opt-in via env var |

The agent registers on both networks simultaneously. Base uses stricter spending limits ($1/tx, $5/day, $0.05 auto-approve) since it involves real USDC.

### Cross-Channel Sync

Wispy runs on CLI, Telegram, WhatsApp, and REST simultaneously. During this hackathon, we built a cross-channel dispatch system so the agent can send images, messages, and documents from any channel to any other connected channel. For example, generating an image from CLI and sending it to Telegram.

### Security

| Guardrail | Implementation |
|-----------|---------------|
| **Spending limits** | Commerce Policy Engine with hard max-per-tx, daily budget, auto-approve threshold |
| **Session isolation** | Only "main" session can access the wallet |
| **Action guard** | x402 payments classified as "external" -- require approval above threshold |
| **No fake data** | Tx hashes only shown when real (from on-chain settlement). No fabricated proofs. |
| **Audit trail** | Every payment logged with amount, recipient, timestamp, network, tx hash |
| **Risk engine** | DeFi trades evaluated for position size, slippage, daily loss before execution |
| **BITE encryption** | Sensitive payments encrypted with BLS threshold before reaching the chain |

---

## On-Chain Verification Links

Every transaction Wispy made during the demo is verifiable on the SKALE BITE V2 Explorer:

| What | Link |
|------|------|
| **Agent Wallet** | [`0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A) |
| **BITE Demo 1 Tx** | [`0xfe12466c...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0xfe12466c68602e3c3ac3a41f7d85f9145a8be40a19de628a9dcb9ee572833d41) (Block 26844) |
| **BITE Demo 2 Tx** | [`0x1c5f82af...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x1c5f82afe320d8fbcd148a0102a5f27942122c40fd7f19431892041893a4e9b4) (Block 26845) |
| **USDC Contract** | [`0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8) |
| **Algebra SwapRouter** | [`0x3012E9049d05B4B5369D690114D5A5861EbB85cb`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0x3012E9049d05B4B5369D690114D5A5861EbB85cb) |
| **SKALE Explorer** | [base-sepolia-testnet-explorer.skalenodes.com:10032](https://base-sepolia-testnet-explorer.skalenodes.com:10032) |

---

## Challenges We Faced

**Getting the agent to pay autonomously.** The hardest part wasn't the crypto, it was getting the AI to make good spending decisions. We built a Commerce Policy Engine with hard limits (max per transaction, daily budget, auto-approve threshold). The agent has freedom to pay for small things but can't drain a wallet.

**BITE encryption integration.** The SKALE BITE v2 SDK is still early and documentation was thin. We spent time reading the source code and testing edge cases, like invalid dates in the condition evaluator and unexpected formats in encrypted transaction data. We ended up writing defensive wrappers around the encryption calls.

**Keeping everything in sync across channels.** Wispy runs on CLI, Telegram, WhatsApp, and REST at the same time. When the agent makes a payment in Telegram, the audit trail needs to be consistent across all channels. We built a channel dispatcher registry and cross-channel sync so media generated in CLI can be sent to Telegram and vice versa.

**Eliminating hallucinated proofs.** Early versions generated deterministic transaction hashes when the Kobaru facilitator didn't return one. The hashes looked real but weren't on-chain. We caught this, removed all fake hash generation, and now only display hashes that come from actual on-chain settlement. If there's no real hash, the system says "facilitator-verified" instead of fabricating one.

**Context management during long demos.** Running all 5 tracks generates a lot of tool output. Gemini's context window filled up fast. We built a compaction system that summarizes older turns while keeping the most recent results intact.

---

## What We Learned

**Gasless matters more than we expected.** When the agent makes 15-20 micro-payments in a single run, even small gas fees pile up. SKALE being gasless removed an entire category of problems.

**The thinking budget changes everything.** Giving Gemini 2.5 Pro a large reasoning budget (24K tokens) for planning produces dramatically better results than a small budget. The quality of the plan determines whether a multi-step task succeeds or fails.

**Tool descriptions control agent behavior.** The LLM reads tool descriptions literally. If a tool says "only works in Telegram," the agent won't use it from CLI even if the underlying code supports it. We learned to write tool descriptions as capability statements, not channel restrictions.

**Verification beats speed.** An agent that checks its work at every step, even if it's slower, actually finishes the job. We built self-verification into every milestone.

---

## Tools & Technologies

| Tool | How We Used It |
|------|---------------|
| **Google Gemini 2.5 Pro** | Core AI engine: planning, reasoning, tool selection, streaming |
| **Google Gemini 2.5 Flash** | Fast model for lightweight tasks and routing |
| **Google text-embedding-004** | Vector memory for semantic search across sessions |
| **Google Imagen 3** | Image generation tool available to the agent |
| **SKALE BITE V2 Sandbox** | Gasless blockchain for all payments and swaps |
| **SKALE BITE Encryption** | BLS threshold encryption for private transactions |
| **Coinbase x402** | HTTP 402 payment protocol with EIP-3009 USDC |
| **Coinbase Developer Platform** | Base mainnet wallet integration for real x402 services |
| **Kobaru** | x402 facilitator for payment settlement |
| **Algebra DEX** | On-chain token swaps (concentrated liquidity) |
| **AP2 Protocol** | Google's agentic payments protocol (Intent/Cart/Payment/Receipt) |
| **TypeScript + Node.js** | Entire platform written in TypeScript, ES modules |
| **viem** | Ethereum wallet and contract interactions |

![Tools Chart](https://raw.githubusercontent.com/hausorlabs/wispy/x402-demo-fixes/docs/devpost-assets/tools-chart.png)

---

## Links

- **Website:** [wispy.cc](https://wispy.cc)
- **Documentation:** [docs.wispy.cc](https://docs.wispy.cc)
- **npm:** `npm install -g wispy-ai` ([npmjs.com/package/wispy-ai](https://www.npmjs.com/package/wispy-ai))
- **GitHub:** [github.com/hausorlabs/wispy](https://github.com/hausorlabs/wispy)
- **Agent Wallet:** [`0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/address/0xcf6B036F5B201eEc1f3c3e9C08A0b0Ee8B30C32A)
- **BITE Tx 1:** [`0xfe12466c...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0xfe12466c68602e3c3ac3a41f7d85f9145a8be40a19de628a9dcb9ee572833d41)
- **BITE Tx 2:** [`0x1c5f82af...`](https://base-sepolia-testnet-explorer.skalenodes.com:10032/tx/0x1c5f82afe320d8fbcd148a0102a5f27942122c40fd7f19431892041893a4e9b4)
- **Explorer:** [SKALE BITE V2 Explorer](https://base-sepolia-testnet-explorer.skalenodes.com:10032)
- **X:** [x.com/hausorlabs](https://x.com/hausorlabs)

---

*Built by Brian Mwai & Joy Lang'at at Hausor Labs for the SF Agentic Commerce x402 Hackathon, San Francisco, February 2026.*
