/**
 * Multi-network chain configuration for x402 agentic commerce.
 * Supports SKALE BITE V2 Sandbox (demo/hackathon) and Base mainnet (real USDC).
 */

import { defineChain, parseAbi } from "viem";
import type { Address } from "viem";

// ─── SKALE Network Config ────────────────────────────────────

export const SKALE_BITE_SANDBOX = {
  rpcUrl:
    "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox" as const,
  chainId: 103698795,
  chainIdHex: "0x62e516b" as const,
  explorerUrl:
    "https://base-sepolia-testnet-explorer.skalenodes.com:10032" as const,
  usdc: "0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8" as const,
  facilitatorUrl: "https://gateway.kobaru.io" as const,
  evmVersion: "istanbul" as const,
  /** CAIP-2 network identifier for x402 */
  network: "eip155:103698795" as `${string}:${string}`,
  /** BITE magic address — encrypted txs are sent here */
  biteAddress: "0x42495445204D452049274d20454e435259505444" as const,
};

// ─── Base Mainnet Config ──────────────────────────────────────

export const BASE_MAINNET = {
  rpcUrl: (process.env.BASE_RPC_URL ?? "https://mainnet.base.org") as string,
  chainId: 8453,
  chainIdHex: "0x2105" as const,
  explorerUrl: "https://basescan.org" as const,
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
  /** CAIP-2 network identifier for x402 */
  network: "eip155:8453" as `${string}:${string}`,
};

// ─── Token Registry (BITE V2 Sandbox) ───────────────────────

export const TOKEN_ADDRESSES = {
  USDC: "0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8" as Address,
  WETH: "0xd74190a1b2a69c2f123a0df16ba21959a01eb843" as Address,
  WBTC: "0x26b1f043545118103097767184c419f12b5a3e88" as Address,
  USDT: "0x36923f1c58a7a4640f1918dac2f5ce732cd0ea46" as Address,
} as const;

export const TOKENS: Record<string, { address: Address; decimals: number; symbol: string }> = {
  USDC: { address: TOKEN_ADDRESSES.USDC, decimals: 6, symbol: "USDC" },
  WETH: { address: TOKEN_ADDRESSES.WETH, decimals: 18, symbol: "WETH" },
  ETH:  { address: TOKEN_ADDRESSES.WETH, decimals: 18, symbol: "WETH" }, // ETH resolves to WETH
  WBTC: { address: TOKEN_ADDRESSES.WBTC, decimals: 8, symbol: "WBTC" },
  USDT: { address: TOKEN_ADDRESSES.USDT, decimals: 6, symbol: "USDT" },
};

export const PAIRS: Record<string, { token0: string; token1: string }> = {
  "ETH/USDC":  { token0: "USDC", token1: "WETH" },
  "WETH/USDC": { token0: "USDC", token1: "WETH" },
  "WBTC/USDC": { token0: "USDC", token1: "WBTC" },
  "ETH/WBTC":  { token0: "WETH", token1: "WBTC" },
};

/** Resolve a token symbol (e.g. "ETH", "USDC") to its on-chain contract address. */
export function resolveTokenAddress(symbolOrAddress: string): Address {
  // Already a hex address -- return as-is
  if (symbolOrAddress.startsWith("0x") && symbolOrAddress.length === 42) {
    return symbolOrAddress as Address;
  }
  const entry = TOKENS[symbolOrAddress.toUpperCase()];
  if (!entry) {
    throw new Error(`Unknown token symbol: ${symbolOrAddress}. Known: ${Object.keys(TOKENS).join(", ")}`);
  }
  return entry.address;
}

/** Get token decimals by symbol or address. */
export function getTokenDecimals(symbolOrAddress: string): number {
  if (symbolOrAddress.startsWith("0x")) {
    const entry = Object.values(TOKENS).find(
      (t) => t.address.toLowerCase() === symbolOrAddress.toLowerCase(),
    );
    return entry?.decimals ?? 18;
  }
  return TOKENS[symbolOrAddress.toUpperCase()]?.decimals ?? 18;
}

// ─── Viem Chain Definition ──────────────────────────────────

export const skaleBiteSandbox = defineChain({
  id: SKALE_BITE_SANDBOX.chainId,
  name: "SKALE BITE V2 Sandbox",
  nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
  rpcUrls: {
    default: { http: [SKALE_BITE_SANDBOX.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "Explorer", url: SKALE_BITE_SANDBOX.explorerUrl },
  },
});

export const baseMainnet = defineChain({
  id: BASE_MAINNET.chainId,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [BASE_MAINNET.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "BaseScan", url: BASE_MAINNET.explorerUrl },
  },
});

// ─── Algebra DEX Contracts (deployed on sandbox) ────────────

export const ALGEBRA_CONTRACTS = {
  factory: "0x10253594A832f967994b44f33411940533302ACb" as const,
  poolDeployer: "0xd7cB0E0692f2D55A17bA81c1fE5501D66774fC4A" as const,
  swapRouter: "0x3012E9049d05B4B5369D690114D5A5861EbB85cb" as const,
  quoterV2: "0xa77aD9f635a3FB3bCCC5E6d1A87cB269746Aba17" as const,
  nonfungiblePositionManager: "0x69D57B9D705eaD73a5d2f2476C30c55bD755cc2F" as const,
  limitOrderManager: "0xE94de02e52Eaf9F0f6Bf7f16E4927FcBc2c09bC7" as const,
  communityVault: "0x4439199c3743161ca22bB8F8B6deC5bF6fF65b04" as const,
  eternalFarming: "0x50FCbF85d23aF7C91f94842FeCd83d16665d27bA" as const,
  farmingCenter: "0x658E287E9C820484f5808f687dC4863B552de37D" as const,
  tickLens: "0x13fcE0acbe6Fb11641ab753212550574CaD31415" as const,
  multicall: "0xB4F9b6b019E75CBe51af4425b2Fc12797e2Ee2a1" as const,
} as const;

export const ALGEBRA_SUBGRAPHS = {
  analytics: "https://skale-sandbox-graph.algebra.finance/subgraphs/name/analytics",
  farmings: "https://skale-sandbox-graph.algebra.finance/subgraphs/name/farmings",
  limits: "https://skale-sandbox-graph.algebra.finance/subgraphs/name/limits",
} as const;

// ─── Algebra ABIs (minimal, for SwapRouter + QuoterV2) ──────

export const ALGEBRA_SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "deployer", type: "address" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "limitSqrtPrice", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export const ALGEBRA_QUOTER_V2_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "deployer", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "limitSqrtPrice", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
      { name: "fee", type: "uint16" },
    ],
  },
] as const;

export const ALGEBRA_FACTORY_ABI = parseAbi([
  "function createPool(address tokenA, address tokenB) external returns (address pool)",
  "function poolByPair(address tokenA, address tokenB) external view returns (address pool)",
]);

// ─── ERC-20 ABI (shared) ────────────────────────────────────

export const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// ─── Mock Service Pricing (atomic USDC, 6 decimals) ─────────

export const SERVICE_PRICING = {
  weather: { price: "1000", display: "$0.001" },
  sentiment: { price: "2000", display: "$0.002" },
  report: { price: "1000", display: "$0.001" },
  priceData: { price: "1500", display: "$0.0015" },
} as const;

// ─── Commerce Policy ────────────────────────────────────────

export const COMMERCE_DEFAULTS = {
  maxPerTransaction: 10.0,
  dailyLimit: 100.0,
  autoApproveBelow: 1.0,
  requireApprovalAbove: 1.0,
} as const;

/** Stricter defaults when Base mainnet is active (real USDC) */
export const BASE_COMMERCE_DEFAULTS = {
  maxPerTransaction: parseFloat(process.env.MAX_PER_TRANSACTION ?? "1.0"),
  dailyLimit: parseFloat(process.env.DAILY_LIMIT ?? "5.0"),
  autoApproveBelow: parseFloat(process.env.AUTO_APPROVE_BELOW ?? "0.05"),
  requireApprovalAbove: 0.05,
} as const;

// ─── Demo Server Ports ──────────────────────────────────────

export const DEMO_PORTS = {
  weather: 4021,
  sentiment: 4022,
  report: 4023,
  defi: 4024,
} as const;

// ─── Network Helpers ────────────────────────────────────────

/** Check if Base mainnet is explicitly enabled */
export function isBaseEnabled(): boolean {
  return process.env.ENABLE_BASE_MAINNET === "true" || !!process.env.BASE_RPC_URL;
}

/** Get all enabled x402 network identifiers (CAIP-2 format) */
export function getEnabledNetworks(): Array<`${string}:${string}`> {
  const networks: Array<`${string}:${string}`> = [SKALE_BITE_SANDBOX.network];
  if (isBaseEnabled()) {
    networks.push(BASE_MAINNET.network);
  }
  return networks;
}

// ─── Explorer Helpers ───────────────────────────────────────

const NETWORK_EXPLORERS: Record<string, string> = {
  [SKALE_BITE_SANDBOX.network]: SKALE_BITE_SANDBOX.explorerUrl,
  [BASE_MAINNET.network]: BASE_MAINNET.explorerUrl,
};

function resolveExplorerUrl(network?: string): string {
  if (network && NETWORK_EXPLORERS[network]) {
    return NETWORK_EXPLORERS[network];
  }
  return SKALE_BITE_SANDBOX.explorerUrl;
}

/** Format an explorer link for a transaction hash (network-aware) */
export function explorerTxLink(txHash: string, network?: string): string {
  return `${resolveExplorerUrl(network)}/tx/${txHash}`;
}

/** Format an explorer link for an address (network-aware) */
export function explorerAddressLink(address: string, network?: string): string {
  return `${resolveExplorerUrl(network)}/address/${address}`;
}

// ─── Conversion Helpers ─────────────────────────────────────

/** Convert atomic USDC (6 decimals) to human-readable */
export function atomicToUsdc(atomic: string | number): number {
  return Number(atomic) / 1_000_000;
}

/** Convert human-readable USDC to atomic (6 decimals) */
export function usdcToAtomic(usdc: number): string {
  return Math.round(usdc * 1_000_000).toString();
}
