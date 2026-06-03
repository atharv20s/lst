/**
 * @module token/burn
 * @description Redeem Kirat LST tokens by burning them and returning SOL to the user.
 *
 * Two approaches are provided:
 * 1. `redeemKirat` — Server-side redemption when a user has already sent
 *    Kirat tokens to the pool's ATA (simple V1 model).
 * 2. `createRedeemTransaction` — Builds a partially-signed transaction that
 *    the user signs client-side: burns Kirat from their ATA and receives SOL
 *    from the pool. This is the approach used by the `/redeem` API endpoint.
 */

import {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createBurnInstruction,
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import { getConnection, getPoolKeypair } from '../utils/solana.js';
import { config } from '../config.js';
import { loadPoolState, getExchangeRate, savePoolState } from '../pool/manager.js';

/** Result returned by a server-side redemption operation */
export interface RedeemResult {
  success: boolean;
  solReturned: number;
  kiratBurned: number;
  txSignature?: string;
}

/** Result returned when building a redeem transaction for client signing */
export interface RedeemTransactionResult {
  /** Base64-encoded serialized transaction (partially signed by pool) */
  transaction: string;
  /** SOL the user will receive upon signing and submitting */
  solToReturn: number;
  /** Kirat tokens that will be burned */
  kiratToBurn: number;
  /** Human-readable message */
  message: string;
}

/**
 * Resolve the Kirat mint {@link PublicKey} from config.
 */
function getKiratMintAddress(): PublicKey {
  if (!config.MINT_ADDRESS) {
    throw new Error(
      '[Burn] MINT_ADDRESS is not set. Run `npm run create-mint` and update .env'
    );
  }
  return new PublicKey(config.MINT_ADDRESS);
}

/**
 * Server-side redemption: process a Kirat burn when the user has already
 * transferred Kirat tokens to the pool's Associated Token Account.
 *
 * The pool verifies the Kirat balance it received, calculates the SOL
 * equivalent at the current exchange rate, and transfers SOL back to the user.
 *
 * @param {string} userPublicKey - The user's wallet address (base58)
 * @param {number} kiratAmount - Amount of Kirat to redeem (in token units, not raw)
 * @returns {Promise<RedeemResult>} Redemption result with SOL returned
 * @throws {Error} If redemption fails
 */
export async function redeemKirat(
  userPublicKey: string,
  kiratAmount: number
): Promise<RedeemResult> {
  console.log(`[Burn] Processing redemption — user: ${userPublicKey}, kirat: ${kiratAmount}`);

  const connection = getConnection();
  const poolKeypair = getPoolKeypair();
  const mintAddress = getKiratMintAddress();

  // ── Calculate SOL to return ───────────────────────────────────
  const state = loadPoolState();
  const exchangeRate = getExchangeRate(state);
  const solToReturn = kiratAmount * exchangeRate;

  console.log(
    `[Burn] Exchange rate: ${exchangeRate} SOL/Kirat — returning ${solToReturn} SOL for ${kiratAmount} Kirat`
  );

  // ── Verify pool has sufficient SOL ────────────────────────────
  const poolBalanceLamports = await connection.getBalance(poolKeypair.publicKey);
  const poolBalanceSol = poolBalanceLamports / LAMPORTS_PER_SOL;

  if (poolBalanceSol < solToReturn) {
    throw new Error(
      `[Burn] Insufficient pool balance. Need ${solToReturn} SOL but pool has ${poolBalanceSol} SOL`
    );
  }

  // ── Verify the pool received the Kirat tokens ────────────────
  const poolAta = await getAssociatedTokenAddress(mintAddress, poolKeypair.publicKey);

  let poolTokenBalance: number;
  try {
    const poolTokenAccount = await getAccount(connection, poolAta);
    poolTokenBalance = Number(poolTokenAccount.amount) / 1e9;
  } catch {
    throw new Error('[Burn] Pool does not have an ATA for Kirat — no tokens received');
  }

  if (poolTokenBalance < kiratAmount) {
    throw new Error(
      `[Burn] Pool ATA has ${poolTokenBalance} Kirat but expected at least ${kiratAmount}`
    );
  }

  // ── Transfer SOL to user ──────────────────────────────────────
  const userPubkey = new PublicKey(userPublicKey);
  const solLamports = Math.round(solToReturn * LAMPORTS_PER_SOL);

  const transferTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: poolKeypair.publicKey,
      toPubkey: userPubkey,
      lamports: solLamports,
    })
  );

  console.log('[Burn] Sending SOL back to user...');
  const txSignature = await connection.sendTransaction(transferTx, [poolKeypair]);
  console.log(`[Burn] SOL transfer tx: ${txSignature}`);

  // ── Update pool state ─────────────────────────────────────────
  state.totalSolDeposited -= solToReturn;
  state.totalKiratMinted -= kiratAmount;
  savePoolState(state);

  console.log(
    `[Burn] ✅ Redeemed ${kiratAmount} Kirat → ${solToReturn} SOL for ${userPublicKey} (tx: ${txSignature})`
  );

  return {
    success: true,
    solReturned: solToReturn,
    kiratBurned: kiratAmount,
    txSignature,
  };
}

/**
 * Build a partially-signed transaction that:
 *   1. Burns `kiratAmount` Kirat from the user's ATA (user must sign)
 *   2. Transfers the equivalent SOL from the pool to the user (pool signs)
 *
 * The transaction is serialized to base64 so it can be sent to the client
 * for the user to sign and submit.
 *
 * @param {string} userPublicKey - The user's wallet address (base58)
 * @param {number} kiratAmount - Amount of Kirat to burn (in token units, not raw)
 * @returns {Promise<RedeemTransactionResult>} The serialized transaction and details
 * @throws {Error} If the transaction cannot be built
 */
export async function createRedeemTransaction(
  userPublicKey: string,
  kiratAmount: number
): Promise<RedeemTransactionResult> {
  console.log(`[Burn] Building redeem transaction — user: ${userPublicKey}, kirat: ${kiratAmount}`);

  const connection = getConnection();
  const poolKeypair = getPoolKeypair();
  const mintAddress = getKiratMintAddress();
  const userPubkey = new PublicKey(userPublicKey);

  // ── Calculate SOL to return ───────────────────────────────────
  const state = loadPoolState();
  const exchangeRate = getExchangeRate(state);
  const solToReturn = kiratAmount * exchangeRate;
  const solLamports = Math.round(solToReturn * LAMPORTS_PER_SOL);

  console.log(
    `[Burn] Exchange rate: ${exchangeRate} — ${kiratAmount} Kirat = ${solToReturn} SOL`
  );

  // ── Verify pool has enough SOL ────────────────────────────────
  const poolBalanceLamports = await connection.getBalance(poolKeypair.publicKey);
  if (poolBalanceLamports < solLamports) {
    throw new Error(
      `[Burn] Insufficient pool SOL. Need ${solToReturn} but have ${poolBalanceLamports / LAMPORTS_PER_SOL}`
    );
  }

  // ── Resolve the user's ATA ────────────────────────────────────
  const userAta = await getAssociatedTokenAddress(mintAddress, userPubkey);

  // Verify the ATA exists and has enough tokens
  try {
    const userTokenAccount = await getAccount(connection, userAta);
    const userBalance = Number(userTokenAccount.amount) / 1e9;
    if (userBalance < kiratAmount) {
      throw new Error(
        `[Burn] User has ${userBalance} Kirat but wants to redeem ${kiratAmount}`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[Burn]')) {
      throw error;
    }
    throw new Error('[Burn] User does not have an ATA for Kirat or account not found');
  }

  // ── Build the transaction ─────────────────────────────────────
  const kiratRawAmount = BigInt(Math.round(kiratAmount * 1e9));

  const transaction = new Transaction();

  // Instruction 1: Burn Kirat from user's ATA (user must sign as owner)
  transaction.add(
    createBurnInstruction(
      userAta,            // account to burn from
      mintAddress,        // the mint
      userPubkey,         // owner of the token account (user signs)
      kiratRawAmount      // amount to burn (raw units)
    )
  );

  // Instruction 2: Transfer SOL from pool to user (pool signs)
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: poolKeypair.publicKey,
      toPubkey: userPubkey,
      lamports: solLamports,
    })
  );

  // ── Set recent blockhash and fee payer ────────────────────────
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = userPubkey; // user pays the tx fee

  // ── Partially sign with pool keypair ──────────────────────────
  transaction.partialSign(poolKeypair);

  // ── Serialize for client ──────────────────────────────────────
  const serialized = transaction.serialize({
    requireAllSignatures: false,  // user hasn't signed yet
  });
  const base64Tx = serialized.toString('base64');

  console.log(`[Burn] Redeem transaction built — ${base64Tx.length} bytes base64`);

  return {
    transaction: base64Tx,
    solToReturn,
    kiratToBurn: kiratAmount,
    message: `Sign this transaction to burn ${kiratAmount} Kirat and receive ${solToReturn} SOL`,
  };
}
