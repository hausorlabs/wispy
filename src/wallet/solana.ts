/**
 * Solana Wallet Module
 *
 * Ed25519-based wallet for Solana mainnet.
 * Separate from the EVM wallet (different key type).
 */

import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { resolve } from "path";
import { readJSON, writeJSON, ensureDir } from "../utils/file.js";
import { encryptCredential, decryptCredential } from "../security/encryption.js";
import type { DeviceIdentity } from "../security/device-identity.js";
import { createLogger } from "../infra/logger.js";

const log = createLogger("solana-wallet");

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface SolanaWalletInfo {
  address: string;
  chain: "solana";
  createdAt: string;
}

export interface SolanaWalletState {
  info: SolanaWalletInfo;
  encryptedSecretKey: string;
}

function getWalletPath(runtimeDir: string): string {
  return resolve(runtimeDir, "wallet", "solana.json");
}

/**
 * Initialize or load a Solana wallet.
 * Generates a new Ed25519 keypair if none exists.
 */
export function initSolanaWallet(
  runtimeDir: string,
  identity: DeviceIdentity
): SolanaWalletInfo {
  const walletPath = getWalletPath(runtimeDir);
  ensureDir(resolve(runtimeDir, "wallet"));

  const existing = readJSON<SolanaWalletState>(walletPath);
  if (existing) {
    log.info("Solana wallet loaded: %s", existing.info.address);
    return existing.info;
  }

  const keypair = Keypair.generate();
  const secretKeyBase64 = Buffer.from(keypair.secretKey).toString("base64");
  const encryptedSecretKey = encryptCredential(identity, secretKeyBase64);

  const info: SolanaWalletInfo = {
    address: keypair.publicKey.toBase58(),
    chain: "solana",
    createdAt: new Date().toISOString(),
  };

  const state: SolanaWalletState = { info, encryptedSecretKey };
  writeJSON(walletPath, state);
  log.info("Solana wallet created: %s", info.address);
  return info;
}

/**
 * Get the Solana wallet address, or null if not initialized.
 */
export function getSolanaWalletAddress(runtimeDir: string): string | null {
  const state = readJSON<SolanaWalletState>(getWalletPath(runtimeDir));
  return state?.info.address || null;
}

/**
 * Get SOL balance in lamports, returned as a human-readable string.
 */
export async function getSolanaBalance(
  runtimeDir: string,
  rpcUrl: string = DEFAULT_RPC
): Promise<string> {
  const state = readJSON<SolanaWalletState>(getWalletPath(runtimeDir));
  if (!state) return "0";

  const connection = new Connection(rpcUrl, "confirmed");
  const pubkey = new PublicKey(state.info.address);
  const lamports = await connection.getBalance(pubkey);
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

/**
 * Get USDC balance on Solana (SPL token).
 * Returns balance as a string with 6 decimal places.
 */
export async function getSolanaUsdcBalance(
  runtimeDir: string,
  rpcUrl: string = DEFAULT_RPC
): Promise<string> {
  const state = readJSON<SolanaWalletState>(getWalletPath(runtimeDir));
  if (!state) return "0";

  const connection = new Connection(rpcUrl, "confirmed");
  const owner = new PublicKey(state.info.address);
  const mint = new PublicKey(USDC_MINT);

  try {
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });
    if (accounts.value.length === 0) return "0";

    const balance = accounts.value[0].account.data.parsed.info.tokenAmount;
    return balance.uiAmountString || "0";
  } catch (err) {
    log.warn("Failed to fetch Solana USDC balance: %s", err);
    return "0";
  }
}

/**
 * Decrypt and return the Solana keypair for signing.
 */
export function getSolanaKeypair(
  runtimeDir: string,
  identity: DeviceIdentity
): Keypair {
  const state = readJSON<SolanaWalletState>(getWalletPath(runtimeDir));
  if (!state) throw new Error("Solana wallet not initialized");

  const secretKeyBase64 = decryptCredential(identity, state.encryptedSecretKey);
  const secretKey = Buffer.from(secretKeyBase64, "base64");
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

/**
 * Export the Solana secret key as a base58 string.
 */
export function exportSolanaPrivateKey(
  runtimeDir: string,
  identity: DeviceIdentity
): string {
  const keypair = getSolanaKeypair(runtimeDir, identity);
  log.warn("Solana private key exported for %s", keypair.publicKey.toBase58());

  // Return as base64 for portability (Phantom and other wallets accept this)
  return Buffer.from(keypair.secretKey).toString("base64");
}

/**
 * Import a Solana wallet from a base64-encoded secret key.
 */
export function importSolanaWallet(
  runtimeDir: string,
  identity: DeviceIdentity,
  secretKeyBase64: string
): SolanaWalletInfo {
  const walletPath = getWalletPath(runtimeDir);
  ensureDir(resolve(runtimeDir, "wallet"));

  const secretKey = Buffer.from(secretKeyBase64, "base64");
  if (secretKey.length !== 64) {
    throw new Error("Invalid Solana secret key (expected 64 bytes)");
  }

  const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
  const encryptedSecretKey = encryptCredential(identity, secretKeyBase64);

  const info: SolanaWalletInfo = {
    address: keypair.publicKey.toBase58(),
    chain: "solana",
    createdAt: new Date().toISOString(),
  };

  writeJSON(walletPath, { info, encryptedSecretKey });
  log.info("Solana wallet imported: %s", info.address);
  return info;
}
