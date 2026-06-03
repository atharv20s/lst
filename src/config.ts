/**
 * @module config
 * @description Central configuration module for the Kirat LST server.
 * Loads environment variables from .env and exports a fully-typed config object.
 */

import dotenv from "dotenv";

// Load .env file into process.env (must happen before reading any vars)
dotenv.config();

/**
 * Determines the Helius RPC endpoint based on the configured network.
 * Helius provides dedicated RPC nodes that include enhanced transaction data
 * and higher rate limits compared to the public Solana RPC.
 */
function buildHeliusRpcUrl(network: string, apiKey: string): string {
  const subdomain = network === "mainnet-beta" ? "mainnet" : "devnet";
  return `https://${subdomain}.helius-rpc.com/?api-key=${apiKey}`;
}

/** Shape of the application configuration object. */
export interface AppConfig {
  /** Helius API key for RPC and webhook access. */
  HELIUS_API_KEY: string;
  /** Solana cluster — "devnet" or "mainnet-beta". */
  SOLANA_NETWORK: string;
  /** Full Helius RPC URL (derived from network + API key). */
  HELIUS_RPC_URL: string;
  /** Base URL for the Helius REST API (webhooks, DAS, etc.). */
  HELIUS_API_URL: string;
  /** Base58-encoded private key for the pool wallet (may be empty on first run). */
  POOL_WALLET_PRIVATE_KEY: string;
  /** SPL Token mint address for Kirat (set after running `npm run create-mint`). */
  MINT_ADDRESS: string;
  /** HTTP port the Express server listens on. */
  PORT: number;
  /** Publicly-reachable URL where Helius sends webhook callbacks. */
  WEBHOOK_URL: string;
}

/**
 * Validated, frozen configuration object used throughout the application.
 *
 * @remarks
 * - `HELIUS_API_KEY` is required — the server cannot start without it.
 * - `POOL_WALLET_PRIVATE_KEY` and `MINT_ADDRESS` may be empty during
 *   initial setup; the relevant scripts will populate them.
 */
export const config: AppConfig = Object.freeze({
  HELIUS_API_KEY: process.env.HELIUS_API_KEY ?? "",
  SOLANA_NETWORK: process.env.SOLANA_NETWORK ?? "devnet",
  HELIUS_RPC_URL: buildHeliusRpcUrl(
    process.env.SOLANA_NETWORK ?? "devnet",
    process.env.HELIUS_API_KEY ?? ""
  ),
  HELIUS_API_URL: "https://api.helius.xyz",
  POOL_WALLET_PRIVATE_KEY: process.env.POOL_WALLET_PRIVATE_KEY ?? "",
  MINT_ADDRESS: process.env.MINT_ADDRESS ?? "",
  PORT: parseInt(process.env.PORT ?? "3000", 10),
  WEBHOOK_URL: process.env.WEBHOOK_URL ?? "",
});

// ── Startup validation ──────────────────────────────────────────────────────
if (!config.HELIUS_API_KEY) {
  console.error(
    "❌ HELIUS_API_KEY is not set. Please add it to your .env file."
  );
  process.exit(1);
}
