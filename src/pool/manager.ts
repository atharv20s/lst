/**
 * @module pool/manager
 * @description Pool state manager for the Kirat LST.
 *
 * Tracks total SOL deposited, total Kirat minted, individual deposit records,
 * and provides exchange-rate calculations. State is persisted to `pool-state.json`
 * in the project root for durability across restarts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Project root directory (two levels up from src/pool/) */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** A single deposit record */
export interface DepositRecord {
  /** The Solana transaction signature */
  txSignature: string;
  /** The sender's public key (base58) */
  sender: string;
  /** Amount of SOL deposited */
  solAmount: number;
  /** Amount of Kirat tokens minted to the user */
  kiratMinted: number;
  /** Unix timestamp (ms) of when the deposit was processed */
  timestamp: number;
}

/** The full pool state persisted to disk */
export interface PoolState {
  /** Total SOL deposited into the pool (in SOL, not lamports) */
  totalSolDeposited: number;
  /** Total Kirat tokens minted across all deposits */
  totalKiratMinted: number;
  /** Ordered list of every deposit processed */
  deposits: DepositRecord[];
}

/** Path to the pool state JSON file */
const STATE_FILE = path.join(PROJECT_ROOT, 'pool-state.json');

/**
 * Load the pool state from `pool-state.json`.
 * Returns a default empty state if the file does not exist or is unreadable.
 * @returns {PoolState} The current pool state
 */
export function loadPoolState(): PoolState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const state: PoolState = JSON.parse(raw);
      console.log(
        `[Pool] Loaded state — totalSOL: ${state.totalSolDeposited}, totalKirat: ${state.totalKiratMinted}, deposits: ${state.deposits.length}`
      );
      return state;
    }
  } catch (error) {
    console.error('[Pool] Error reading pool state file, starting fresh:', error);
  }

  console.log('[Pool] No existing state found, initializing default pool state');
  return {
    totalSolDeposited: 0,
    totalKiratMinted: 0,
    deposits: [],
  };
}

/**
 * Persist the pool state to `pool-state.json`.
 * @param {PoolState} state - The state to save
 */
export function savePoolState(state: PoolState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    console.log('[Pool] State saved successfully');
  } catch (error) {
    console.error('[Pool] Failed to save pool state:', error);
    throw error;
  }
}

/**
 * Calculate the current exchange rate: SOL per Kirat.
 *
 * - When the pool is empty (no mints yet) the rate is 1.0 (1 SOL = 1 Kirat).
 * - Otherwise: `totalSolDeposited / totalKiratMinted`.
 *
 * As staking rewards accrue (SOL in the pool grows without new mints),
 * the exchange rate increases, meaning each Kirat is worth more SOL.
 *
 * @param {PoolState} state - Current pool state
 * @returns {number} The exchange rate (SOL per Kirat)
 */
export function getExchangeRate(state: PoolState): number {
  if (state.totalKiratMinted === 0) {
    console.log('[Pool] No mints yet — exchange rate is 1.0');
    return 1.0;
  }
  const rate = state.totalSolDeposited / state.totalKiratMinted;
  console.log(`[Pool] Exchange rate: ${rate} SOL per Kirat`);
  return rate;
}

/**
 * Calculate how many Kirat tokens to mint for a given SOL deposit.
 *
 * `kiratToMint = solAmount / exchangeRate`
 *
 * At a 1:1 rate this returns `solAmount`. As the exchange rate rises
 * (pool accrues rewards), users receive fewer Kirat per SOL.
 *
 * @param {PoolState} state - Current pool state
 * @param {number} solAmount - Amount of SOL being deposited (in SOL, not lamports)
 * @returns {number} The amount of Kirat tokens to mint
 */
export function calculateKiratToMint(state: PoolState, solAmount: number): number {
  const exchangeRate = getExchangeRate(state);
  const kiratToMint = solAmount / exchangeRate;
  console.log(
    `[Pool] For ${solAmount} SOL at rate ${exchangeRate}: minting ${kiratToMint} Kirat`
  );
  return kiratToMint;
}

/**
 * Record a successful deposit and mint in the pool state, then persist it.
 *
 * @param {PoolState} state - Current pool state (mutated in place)
 * @param {string} txSignature - The original SOL transfer transaction signature
 * @param {string} sender - The sender's public key (base58)
 * @param {number} solAmount - Amount of SOL deposited (in SOL)
 * @param {number} kiratMinted - Amount of Kirat tokens minted
 * @returns {PoolState} The updated pool state
 */
export function recordDeposit(
  state: PoolState,
  txSignature: string,
  sender: string,
  solAmount: number,
  kiratMinted: number
): PoolState {
  state.totalSolDeposited += solAmount;
  state.totalKiratMinted += kiratMinted;

  state.deposits.push({
    txSignature,
    sender,
    solAmount,
    kiratMinted,
    timestamp: Date.now(),
  });

  savePoolState(state);

  console.log(
    `[Pool] Recorded deposit — tx: ${txSignature}, sender: ${sender}, ` +
      `SOL: ${solAmount}, Kirat: ${kiratMinted}, ` +
      `newTotalSOL: ${state.totalSolDeposited}, newTotalKirat: ${state.totalKiratMinted}`
  );

  return state;
}

/**
 * Check whether a transaction has already been processed (idempotency guard).
 *
 * @param {PoolState} state - Current pool state
 * @param {string} txSignature - The transaction signature to check
 * @returns {boolean} `true` if the transaction was already processed
 */
export function isTransactionProcessed(state: PoolState, txSignature: string): boolean {
  const processed = state.deposits.some((d) => d.txSignature === txSignature);
  if (processed) {
    console.log(`[Pool] Transaction ${txSignature} already processed — skipping`);
  }
  return processed;
}
