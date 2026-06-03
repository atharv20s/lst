/**
 * @module utils/connection
 * @description Re-exports core Solana helpers from `./solana.ts` and adds
 * project-level path utilities and mint-address resolution needed by the
 * pool manager and token modules.
 */

import * as nodePath from 'path';
import { fileURLToPath } from 'url';
import { PublicKey } from '@solana/web3.js';
import { config } from '../config.js';

// Re-export everything from solana.ts so consumers can use either import path
export { getConnection, getPoolKeypair, getOrCreateATA } from './solana.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = nodePath.dirname(__filename);

/** Project root directory (two levels up from src/utils/) */
const PROJECT_ROOT = nodePath.resolve(__dirname, '..', '..');

/**
 * Get the project root directory path.
 * @returns {string} Absolute path to the project root
 */
export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

/**
 * Get the Kirat SPL token mint address from the config / environment.
 *
 * Checks `config.MINT_ADDRESS` (loaded from `.env` as `MINT_ADDRESS`)
 * and falls back to `KIRAT_MINT_ADDRESS` env var for scripts that
 * bypass the main config module.
 *
 * @returns {PublicKey} The mint public key
 * @throws {Error} If neither env var is set
 */
export function getMintAddress(): PublicKey {
  const mintAddress = config.MINT_ADDRESS || process.env.KIRAT_MINT_ADDRESS;
  if (!mintAddress) {
    throw new Error(
      '[Utils] MINT_ADDRESS / KIRAT_MINT_ADDRESS not set. Run `npm run create-mint` first and add the address to .env'
    );
  }
  return new PublicKey(mintAddress);
}
