/**
 * verify-swap.ts — Bootstrap & verify real Algebra DEX swaps on SKALE BITE V2.
 *
 * Usage:
 *   npx tsx scripts/verify-swap.ts
 *
 * Requires AGENT_PRIVATE_KEY in .env
 *
 * Steps:
 *   1. Check wallet balances (sFUEL, USDC, WETH)
 *   2. Mint WETH if balance is zero (test token)
 *   3. Approve WETH + USDC to SwapRouter
 *   4. Swap WETH → USDC via Algebra QuoterV2 + SwapRouter
 *   5. Swap USDC → WETH to verify the reverse direction
 *   6. Report final balances and tx hashes
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
} from "viem";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ─── Config ─────────────────────────────────────────────────
const RPC = "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox";
const EXPLORER = "https://base-sepolia-testnet-explorer.skalenodes.com:10032";
const CHAIN_ID = 103698795;

const USDC = "0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8" as Address;
const WETH = "0xd74190a1b2a69c2f123a0df16ba21959a01eb843" as Address;
const WBTC = "0x26b1f043545118103097767184c419f12b5a3e88" as Address;

const SWAP_ROUTER = "0x3012E9049d05B4B5369D690114D5A5861EbB85cb" as Address;
const QUOTER_V2 = "0xa77aD9f635a3FB3bCCC5E6d1A87cB269746Aba17" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

// ─── ABIs ───────────────────────────────────────────────────
const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const MINT_ABI = parseAbi([
  "function mint(address to, uint256 amount)",
]);

const SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function" as const,
    stateMutability: "payable" as const,
    inputs: [
      {
        name: "params",
        type: "tuple" as const,
        components: [
          { name: "tokenIn", type: "address" as const },
          { name: "tokenOut", type: "address" as const },
          { name: "deployer", type: "address" as const },
          { name: "recipient", type: "address" as const },
          { name: "deadline", type: "uint256" as const },
          { name: "amountIn", type: "uint256" as const },
          { name: "amountOutMinimum", type: "uint256" as const },
          { name: "limitSqrtPrice", type: "uint160" as const },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" as const }],
  },
] as const;

const QUOTER_V2_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      {
        name: "params",
        type: "tuple" as const,
        components: [
          { name: "tokenIn", type: "address" as const },
          { name: "tokenOut", type: "address" as const },
          { name: "deployer", type: "address" as const },
          { name: "amountIn", type: "uint256" as const },
          { name: "limitSqrtPrice", type: "uint160" as const },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" as const },
      { name: "amountIn", type: "uint256" as const },
      { name: "sqrtPriceX96After", type: "uint160" as const },
      { name: "initializedTicksCrossed", type: "uint32" as const },
      { name: "gasEstimate", type: "uint256" as const },
      { name: "fee", type: "uint16" as const },
    ],
  },
] as const;

// ─── Transfer event parsing ─────────────────────────────────
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function parseAmountOut(
  logs: Array<{ address: string; topics: string[]; data: string }>,
  tokenOut: Address,
  recipient: Address,
): bigint {
  for (const log of logs) {
    if (
      log.address.toLowerCase() === tokenOut.toLowerCase() &&
      log.topics[0] === TRANSFER_TOPIC
    ) {
      const to = "0x" + (log.topics[2] ?? "").slice(26);
      if (to.toLowerCase() === recipient.toLowerCase()) {
        return BigInt(log.data);
      }
    }
  }
  return 0n;
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) {
    console.error("Set AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const account = privateKeyToAccount(pk as `0x${string}`);
  console.log(`\n━━━ Wispy DEX Swap Verification ━━━\n`);
  console.log(`  Wallet:      ${account.address}`);
  console.log(`  Chain:       SKALE BITE V2 Sandbox (${CHAIN_ID})`);
  console.log(`  SwapRouter:  ${SWAP_ROUTER}`);
  console.log(`  USDC:        ${USDC}`);
  console.log(`  WETH:        ${WETH}`);
  console.log();

  const chain = {
    id: CHAIN_ID,
    name: "SKALE BITE V2",
    nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  } as const;

  const pc = createPublicClient({ chain, transport: http(RPC) });
  const wc = createWalletClient({ account, chain, transport: http(RPC) });

  // ─── Step 1: Check balances ───────────────────────────────
  console.log("Step 1: Checking balances...");
  const sfuel = await pc.getBalance({ address: account.address });
  const usdcBal = (await pc.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;
  const wethBal = (await pc.readContract({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;

  console.log(`  sFUEL: ${formatUnits(sfuel, 18)}`);
  console.log(`  USDC:  ${formatUnits(usdcBal, 6)}`);
  console.log(`  WETH:  ${formatUnits(wethBal, 18)}`);

  if (sfuel === 0n) {
    console.error("\n  No sFUEL! Get some from https://www.sfuelstation.com/");
    process.exit(1);
  }
  console.log();

  // ─── Step 2: Mint WETH if needed ──────────────────────────
  let currentWeth = wethBal;
  if (currentWeth < 10n ** 15n) { // < 0.001 WETH
    console.log("Step 2: Minting 0.01 WETH (test token)...");
    try {
      const mintAmount = 10n ** 16n; // 0.01 WETH
      const mintHash = await wc.writeContract({
        address: WETH,
        abi: MINT_ABI,
        functionName: "mint",
        args: [account.address, mintAmount],
        gas: 200_000n,
      });
      await pc.waitForTransactionReceipt({ hash: mintHash });
      currentWeth = (await pc.readContract({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;
      console.log(`  Minted! WETH balance: ${formatUnits(currentWeth, 18)}`);
      console.log(`  Tx: ${EXPLORER}/tx/${mintHash}`);
    } catch (err: any) {
      console.error(`  WETH mint failed: ${err.message}`);
      if (currentWeth === 0n && usdcBal === 0n) {
        console.error("  No tokens to trade. Need USDC or mintable WETH.");
        process.exit(1);
      }
    }
  } else {
    console.log("Step 2: WETH balance sufficient, skipping mint.");
  }
  console.log();

  // ─── Step 3: Approve tokens to SwapRouter ─────────────────
  console.log("Step 3: Approving tokens to SwapRouter...");
  const maxUint = 2n ** 256n - 1n;

  if (currentWeth > 0n) {
    const wethAllowance = (await pc.readContract({ address: WETH, abi: ERC20_ABI, functionName: "allowance", args: [account.address, SWAP_ROUTER] })) as bigint;
    if (wethAllowance < currentWeth) {
      const h = await wc.writeContract({ address: WETH, abi: ERC20_ABI, functionName: "approve", args: [SWAP_ROUTER, maxUint], gas: 100_000n });
      await pc.waitForTransactionReceipt({ hash: h });
      console.log(`  WETH approved. Tx: ${h.slice(0, 18)}...`);
    } else {
      console.log("  WETH already approved.");
    }
  }

  const usdcAllowance = (await pc.readContract({ address: USDC, abi: ERC20_ABI, functionName: "allowance", args: [account.address, SWAP_ROUTER] })) as bigint;
  if (usdcAllowance < 1_000_000n) {
    const h = await wc.writeContract({ address: USDC, abi: ERC20_ABI, functionName: "approve", args: [SWAP_ROUTER, maxUint], gas: 100_000n });
    await pc.waitForTransactionReceipt({ hash: h });
    console.log(`  USDC approved. Tx: ${h.slice(0, 18)}...`);
  } else {
    console.log("  USDC already approved.");
  }
  console.log();

  // ─── Step 4: Quote WETH → USDC ───────────────────────────
  const swapAmountWeth = 10n ** 15n; // 0.001 WETH
  console.log(`Step 4: Quoting ${formatUnits(swapAmountWeth, 18)} WETH → USDC...`);
  try {
    const quoteResult = await pc.readContract({
      address: QUOTER_V2,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: WETH, tokenOut: USDC, deployer: ZERO, amountIn: swapAmountWeth, limitSqrtPrice: 0n }],
    });
    const [quotedOut, , , , , fee] = quoteResult as [bigint, bigint, bigint, number, bigint, number];
    console.log(`  QuoterV2: ${formatUnits(quotedOut, 6)} USDC (fee: ${fee})`);
    const effectivePrice = Number(quotedOut) / 1e6 / (Number(swapAmountWeth) / 1e18);
    console.log(`  Effective price: 1 WETH = $${effectivePrice.toFixed(2)} USDC`);
  } catch (err: any) {
    console.warn(`  Quote failed: ${err.message}`);
  }
  console.log();

  // ─── Step 5: Swap WETH → USDC ────────────────────────────
  if (currentWeth >= swapAmountWeth) {
    console.log(`Step 5: Swapping ${formatUnits(swapAmountWeth, 18)} WETH → USDC via SwapRouter...`);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const usdcBefore = (await pc.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;

    try {
      const hash = await wc.writeContract({
        address: SWAP_ROUTER,
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [{
          tokenIn: WETH,
          tokenOut: USDC,
          deployer: ZERO,
          recipient: account.address,
          deadline,
          amountIn: swapAmountWeth,
          amountOutMinimum: 0n,
          limitSqrtPrice: 0n,
        }],
        gas: 12_000_000n,
      });

      console.log(`  Tx submitted: ${hash}`);
      const receipt = await pc.waitForTransactionReceipt({ hash });
      console.log(`  Status: ${receipt.status} | Gas: ${receipt.gasUsed}`);

      const usdcAfter = (await pc.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;
      const received = usdcAfter - usdcBefore;
      console.log(`  Received: ${formatUnits(received, 6)} USDC`);
      console.log(`  Explorer: ${EXPLORER}/tx/${hash}`);

      if (received === 0n) {
        // Try parsing from logs
        const parsed = parseAmountOut(receipt.logs as any, USDC, account.address);
        console.log(`  (Parsed from logs: ${formatUnits(parsed, 6)} USDC)`);
      }
    } catch (err: any) {
      console.error(`  WETH→USDC swap FAILED: ${err.message}`);
    }
  } else {
    console.log("Step 5: Insufficient WETH for swap, skipping.");
  }
  console.log();

  // ─── Step 6: Swap USDC → WETH ────────────────────────────
  const usdcNow = (await pc.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;
  const swapAmountUsdc = usdcNow > 500_000n ? 500_000n : usdcNow; // swap 0.5 USDC or whatever we have

  if (swapAmountUsdc > 0n) {
    console.log(`Step 6: Swapping ${formatUnits(swapAmountUsdc, 6)} USDC → WETH via SwapRouter...`);

    // Quote first
    try {
      const quoteResult = await pc.readContract({
        address: QUOTER_V2,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: USDC, tokenOut: WETH, deployer: ZERO, amountIn: swapAmountUsdc, limitSqrtPrice: 0n }],
      });
      const [quotedOut] = quoteResult as [bigint, bigint, bigint, number, bigint, number];
      console.log(`  QuoterV2: expect ${formatUnits(quotedOut, 18)} WETH`);
    } catch {
      console.log("  QuoterV2 unavailable, proceeding...");
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const wethBefore = (await pc.readContract({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;

    try {
      const hash = await wc.writeContract({
        address: SWAP_ROUTER,
        abi: SWAP_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [{
          tokenIn: USDC,
          tokenOut: WETH,
          deployer: ZERO,
          recipient: account.address,
          deadline,
          amountIn: swapAmountUsdc,
          amountOutMinimum: 0n,
          limitSqrtPrice: 0n,
        }],
        gas: 12_000_000n,
      });

      console.log(`  Tx submitted: ${hash}`);
      const receipt = await pc.waitForTransactionReceipt({ hash });
      console.log(`  Status: ${receipt.status} | Gas: ${receipt.gasUsed}`);

      const wethAfter = (await pc.readContract({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;
      const received = wethAfter - wethBefore;
      console.log(`  Received: ${formatUnits(received, 18)} WETH`);
      console.log(`  Explorer: ${EXPLORER}/tx/${hash}`);
    } catch (err: any) {
      console.error(`  USDC→WETH swap FAILED: ${err.message}`);
    }
  } else {
    console.log("Step 6: No USDC available for reverse swap.");
  }
  console.log();

  // ─── Final balances ───────────────────────────────────────
  console.log("━━━ Final Balances ━━━");
  const finalSfuel = await pc.getBalance({ address: account.address });
  const finalUsdc = (await pc.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;
  const finalWeth = (await pc.readContract({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] })) as bigint;

  console.log(`  sFUEL: ${formatUnits(finalSfuel, 18)}`);
  console.log(`  USDC:  ${formatUnits(finalUsdc, 6)}`);
  console.log(`  WETH:  ${formatUnits(finalWeth, 18)}`);
  console.log(`\n  Wallet: ${EXPLORER}/address/${account.address}`);
  console.log(`\nDone.\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
