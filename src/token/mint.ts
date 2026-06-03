/**
 * @module token/mint
 * @description Core minting and pool-state query logic for Kirat LST.
 * Redeem/burn logic lives in {@link ../token/burn.js}.
 */

import { PublicKey } from '@solana/web3.js';
import { mintTo } from '@solana/spl-token';
import { getConnection, getPoolKeypair, getOrCreateATA } from '../utils/solana.js';
import { getMintAddress } from '../utils/connection.js';
import {
  loadPoolState,
  calculateKiratToMint,
  recordDeposit,
  getExchangeRate,
  isTransactionProcessed,
} from '../pool/manager.js';

// Re-export createRedeemTransaction so index.ts can import it from this module
export { createRedeemTransaction } from './burn.js';

/** Token decimals — matches SOL (9). */
const TOKEN_DECIMALS = 9;

/**
 * Mint Kirat tokens to a user who deposited SOL into the pool wallet.
 *
 * Steps:
 * 1. Check for duplicate transactions (idempotency).
 * 2. Calculate how many Kirat to mint at the current exchange rate.
 * 3. Get or create the user's Associated Token Account.
 * 4. Mint tokens via the pool wallet (mint authority).
 * 5. Record the deposit in pool state.
 *
 * @param senderAddress - Base58-encoded public key of the SOL depositor.
 * @param solAmount     - Amount of SOL deposited (in SOL, not lamports).
 * @param txSignature   - The original SOL transfer transaction signature.
 */
export async function mintKiratToUser(
  senderAddress: string,
  solAmount: number,
  txSignature: string,
): Promise<void> {
  const connection = getConnection();
  const poolKeypair = getPoolKeypair();
  const mintAddress = getMintAddress();
  const poolState = loadPoolState();

  // ── Idempotency guard ──────────────────────────────────────────
  if (isTransactionProcessed(poolState, txSignature)) {
    console.log(`⏭  Skipping duplicate transaction: ${txSignature}`);
    return;
  }

  // ── Calculate tokens to mint ───────────────────────────────────
  const kiratToMint = calculateKiratToMint(poolState, solAmount);
  const mintAmountRaw = BigInt(Math.round(kiratToMint * 10 ** TOKEN_DECIMALS));

  console.log(
    `🪙  Minting ${kiratToMint} Kirat (${mintAmountRaw} raw) to ${senderAddress}`,
  );

  // ── Ensure the user's ATA exists ───────────────────────────────
  const userPublicKey = new PublicKey(senderAddress);
  const userAta = await getOrCreateATA(
    connection,
    mintAddress,
    userPublicKey,
    poolKeypair,
  );

  // ── Mint tokens ────────────────────────────────────────────────
  const mintTxSig = await mintTo(
    connection,
    poolKeypair,         // payer
    mintAddress,         // mint
    userAta.address,     // destination ATA
    poolKeypair,         // mint authority
    mintAmountRaw,       // amount in raw units
  );

  console.log(`✅ Mint tx confirmed: ${mintTxSig}`);

  // ── Record deposit in pool state ───────────────────────────────
  recordDeposit(poolState, txSignature, senderAddress, solAmount, kiratToMint);
}

/**
 * Returns the current pool state for the `/pool` API endpoint.
 */
export async function getPoolState(): Promise<{
  totalSolDeposited: number;
  totalKiratMinted: number;
  exchangeRate: number;
  poolWalletAddress: string;
  mintAddress: string;
}> {
  const poolKeypair = getPoolKeypair();
  const poolState = loadPoolState();
  const exchangeRate = getExchangeRate(poolState);

  let mintAddr = '';
  try {
    mintAddr = getMintAddress().toBase58();
  } catch {
    mintAddr = '(not set)';
  }

  return {
    totalSolDeposited: poolState.totalSolDeposited,
    totalKiratMinted: poolState.totalKiratMinted,
    exchangeRate,
    poolWalletAddress: poolKeypair.publicKey.toBase58(),
    mintAddress: mintAddr,
  };
}
