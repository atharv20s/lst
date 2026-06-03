/**
 * @module utils/solana
 * @description Solana connection helpers, pool keypair management, and
 * Associated Token Account utilities for the Kirat LST server.
 */

import {
  Connection,
  Keypair,
  type Commitment,
  PublicKey,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  type Account,
} from "@solana/spl-token";
import bs58 from "bs58";
import { config } from "../config.js";

// ── Connection ──────────────────────────────────────────────────────────────

/** Singleton Connection instance (lazily initialised). */
let connectionInstance: Connection | null = null;

/**
 * Returns a shared {@link Connection} to the Solana cluster via the Helius
 * RPC endpoint configured in `.env`.
 *
 * @param commitment - Transaction commitment level (default: `"confirmed"`).
 * @returns A reusable `Connection` object.
 *
 * @example
 * ```ts
 * const connection = getConnection();
 * const slot = await connection.getSlot();
 * ```
 */
export function getConnection(commitment: Commitment = "confirmed"): Connection {
  if (!connectionInstance) {
    connectionInstance = new Connection(config.HELIUS_RPC_URL, commitment);
    console.log(
      `🔗 Solana connection established — network: ${config.SOLANA_NETWORK}`
    );
  }
  return connectionInstance;
}

// ── Pool Keypair ────────────────────────────────────────────────────────────

/** Cached pool keypair so we only decode / generate once per process. */
let poolKeypairInstance: Keypair | null = null;

/**
 * Loads (or generates) the pool wallet {@link Keypair}.
 *
 * **Behaviour:**
 * 1. If `POOL_WALLET_PRIVATE_KEY` is set in `.env`, the key is decoded from
 *    Base58 and returned.
 * 2. If the env var is empty, a **new** keypair is generated. A prominent
 *    warning is logged with the public key and the Base58-encoded secret key
 *    so the operator can persist it to `.env` before restarting.
 *
 * @returns The pool wallet `Keypair`.
 *
 * @example
 * ```ts
 * const pool = getPoolKeypair();
 * console.log("Pool address:", pool.publicKey.toBase58());
 * ```
 */
export function getPoolKeypair(): Keypair {
  if (poolKeypairInstance) {
    return poolKeypairInstance;
  }

  if (config.POOL_WALLET_PRIVATE_KEY) {
    // Decode existing key from .env
    try {
      const secretKey = bs58.decode(config.POOL_WALLET_PRIVATE_KEY);
      poolKeypairInstance = Keypair.fromSecretKey(secretKey);
      console.log(
        `🔑 Pool wallet loaded — address: ${poolKeypairInstance.publicKey.toBase58()}`
      );
    } catch (error) {
      console.error(
        "❌ Failed to decode POOL_WALLET_PRIVATE_KEY. Ensure it is valid Base58."
      );
      throw error;
    }
  } else {
    // Generate a fresh keypair for first-time setup
    poolKeypairInstance = Keypair.generate();

    const secretKeyBase58 = bs58.encode(poolKeypairInstance.secretKey);

    console.warn("╔══════════════════════════════════════════════════════════╗");
    console.warn("║  ⚠️  NEW POOL WALLET GENERATED — SAVE THIS KEY!         ║");
    console.warn("╠══════════════════════════════════════════════════════════╣");
    console.warn(
      `║  Public Key  : ${poolKeypairInstance.publicKey.toBase58()}`
    );
    console.warn(`║  Private Key : ${secretKeyBase58}`);
    console.warn("╠══════════════════════════════════════════════════════════╣");
    console.warn("║  Add the private key to your .env file as:              ║");
    console.warn("║  POOL_WALLET_PRIVATE_KEY=<the key above>                ║");
    console.warn("║                                                         ║");
    console.warn("║  Fund this wallet on devnet:                            ║");
    console.warn(
      `║  solana airdrop 2 ${poolKeypairInstance.publicKey.toBase58()} --url devnet`
    );
    console.warn("╚══════════════════════════════════════════════════════════╝");
  }

  return poolKeypairInstance;
}

// ── Associated Token Account ────────────────────────────────────────────────

/**
 * Retrieves (or creates) an Associated Token Account (ATA) for the given
 * owner and SPL token mint.
 *
 * The `payer` signs and pays for account creation rent if the ATA does not
 * yet exist on-chain.
 *
 * @param connection - Active Solana {@link Connection}.
 * @param mint       - The SPL token mint {@link PublicKey}.
 * @param owner      - The wallet that will own the ATA.
 * @param payer      - The {@link Keypair} that pays for creation (typically the pool wallet).
 * @returns The ATA {@link Account} object containing the token account address and metadata.
 *
 * @throws Will throw if the transaction to create the ATA fails (e.g. payer
 *         has insufficient SOL for rent).
 *
 * @example
 * ```ts
 * const ata = await getOrCreateATA(
 *   connection,
 *   mintPublicKey,
 *   userPublicKey,
 *   poolKeypair
 * );
 * console.log("ATA address:", ata.address.toBase58());
 * ```
 */
export async function getOrCreateATA(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: Keypair
): Promise<Account> {
  try {
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,       // fee payer & signer
      mint,        // SPL token mint
      owner,       // wallet that will own the ATA
      false        // allowOwnerOffCurve — false for normal wallets
    );

    console.log(
      `🏦 ATA ready — owner: ${owner.toBase58()}, address: ${ata.address.toBase58()}`
    );

    return ata;
  } catch (error) {
    console.error(
      `❌ Failed to get/create ATA for owner ${owner.toBase58()}:`,
      error
    );
    throw error;
  }
}
