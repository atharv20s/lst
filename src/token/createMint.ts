/**
 * @module createMint
 * @description One-time script to create the Kirat SPL token mint on Solana devnet.
 *
 * Usage:
 *   npm run create-mint
 *   # or: npx tsx src/token/createMint.ts
 *
 * This script will:
 *   1. Load (or generate) the pool keypair via the existing config system
 *   2. Airdrop 2 SOL to the pool wallet for transaction fees
 *   3. Create a new SPL token mint (decimals = 9)
 *   4. Print the mint address — add it to your .env as MINT_ADDRESS
 */

import { createMint } from '@solana/spl-token';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getConnection, getPoolKeypair } from '../utils/solana.js';

(async () => {
  try {
    const connection = getConnection();
    const poolKeypair = getPoolKeypair();

    console.log('='.repeat(60));
    console.log('  Kirat LST — Mint Creation Script');
    console.log('='.repeat(60));
    console.log(`Pool wallet: ${poolKeypair.publicKey.toBase58()}`);

    // ── Step 1: Airdrop 2 SOL for fees ──────────────────────────
    console.log('\n[CreateMint] Requesting airdrop of 2 SOL to pool wallet...');
    const airdropSignature = await connection.requestAirdrop(
      poolKeypair.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    console.log(`[CreateMint] Airdrop tx: ${airdropSignature}`);

    console.log('[CreateMint] Waiting for airdrop confirmation...');
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      {
        signature: airdropSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      'confirmed'
    );
    console.log('[CreateMint] Airdrop confirmed ✓');

    const balance = await connection.getBalance(poolKeypair.publicKey);
    console.log(`[CreateMint] Pool balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    // ── Step 2: Create the SPL token mint ───────────────────────
    console.log('\n[CreateMint] Creating Kirat SPL token mint...');
    const mint = await createMint(
      connection,
      poolKeypair,                  // payer
      poolKeypair.publicKey,        // mint authority
      poolKeypair.publicKey,        // freeze authority
      9                             // decimals (matches SOL)
    );

    console.log('\n' + '='.repeat(60));
    console.log('  ✅ Kirat Mint Created Successfully!');
    console.log('='.repeat(60));
    console.log(`Mint Address: ${mint.toBase58()}`);
    console.log(`Decimals:     9`);
    console.log(`Authority:    ${poolKeypair.publicKey.toBase58()}`);
    console.log('');
    console.log('👉 Add the following to your .env file:');
    console.log('');
    console.log(`   MINT_ADDRESS=${mint.toBase58()}`);
    console.log('');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('[CreateMint] Fatal error:', error);
    process.exit(1);
  }
})();
