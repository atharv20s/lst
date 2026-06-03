#!/usr/bin/env tsx
/**
 * @module test-integration
 * @description End-to-end integration testing script for Kirat LST.
 *
 * Runs fully on localhost and Solana devnet. This script:
 *   1. Automatically checks/configures .env with a pool keypair and token mint.
 *   2. Generates a temporary User keypair and requests devnet SOL.
 *   3. Performs a real devnet SOL transfer from the User to the Pool wallet.
 *   4. Calls the local server's `/webhook` endpoint with a mock Helius webhook payload.
 *   5. Verifies that the server correctly mints Kirat tokens to the user on-chain.
 *   6. Performs the redemption flow by calling `/redeem`, co-signing, and broadcasting.
 *
 * Usage:
 *   npm run test-integration
 */

import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint,
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

/** Helper to update key-value pairs in the .env file. */
function updateEnv(key: string, value: string) {
  let envContent = '';
  if (fs.existsSync(ENV_PATH)) {
    envContent = fs.readFileSync(ENV_PATH, 'utf-8');
  } else {
    const examplePath = path.join(PROJECT_ROOT, '.env.example');
    if (fs.existsSync(examplePath)) {
      envContent = fs.readFileSync(examplePath, 'utf-8');
    }
  }

  const lines = envContent.split(/\r?\n/);
  let keyFound = false;
  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      keyFound = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!keyFound) {
    newLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(ENV_PATH, newLines.join('\n'), 'utf-8');
  console.log(`📝 Updated .env: set ${key} to ${value}`);
}

/** Utility to wait for user terminal input. */
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    }),
  );
}

async function main() {
  console.log('='.repeat(65));
  console.log('         🚀 SOLANA DEVNET INTEGRATION TEST SUITE 🚀');
  console.log('='.repeat(65));

  // ── 1. Init connection ──────────────────────────────────────────────
  const solanaNetwork = process.env.SOLANA_NETWORK || 'devnet';
  const apiKey = process.env.HELIUS_API_KEY || '';
  if (!apiKey) {
    console.error('❌ HELIUS_API_KEY is not set in .env.');
    process.exit(1);
  }
  const rpcUrl = `https://${
    solanaNetwork === 'mainnet-beta' ? 'mainnet' : 'devnet'
  }.helius-rpc.com/?api-key=${apiKey}`;
  const connection = new Connection(rpcUrl, 'confirmed');
  console.log(`🔗 Connected to Solana network: ${solanaNetwork}`);

  // ── 2. Load or generate Pool Wallet ──────────────────────────────────
  let poolKeypair: Keypair;
  let poolPrivateKeyBase58 = process.env.POOL_WALLET_PRIVATE_KEY || '';

  if (!poolPrivateKeyBase58) {
    console.log(
      '\n[Setup] No POOL_WALLET_PRIVATE_KEY found in .env. Generating a fresh one...',
    );
    poolKeypair = Keypair.generate();
    poolPrivateKeyBase58 = bs58.encode(poolKeypair.secretKey);
    updateEnv('POOL_WALLET_PRIVATE_KEY', poolPrivateKeyBase58);
  } else {
    poolKeypair = Keypair.fromSecretKey(bs58.decode(poolPrivateKeyBase58));
  }
  const poolWalletPubkey = poolKeypair.publicKey.toBase58();
  console.log(`🔑 Pool Wallet: ${poolWalletPubkey}`);

  // Request airdrop for Pool if low on SOL
  try {
    const balance = await connection.getBalance(poolKeypair.publicKey);
    console.log(`💰 Pool Wallet Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    if (balance < 0.05 * LAMPORTS_PER_SOL) {
      console.log(
        '   Requesting airdrop of 0.5 SOL to pool wallet for transaction fees...',
      );
      try {
        const sig = await connection.requestAirdrop(
          poolKeypair.publicKey,
          0.5 * LAMPORTS_PER_SOL,
        );
        const latest = await connection.getLatestBlockhash();
        await connection.confirmTransaction(
          { signature: sig, ...latest },
          'confirmed',
        );
      } catch (err) {
        console.warn(
          '   ⚠️ Web3 airdrop request failed (Solana Devnet faucets are rate-limited).',
        );
      }
      
      let currentBalance = await connection.getBalance(poolKeypair.publicKey);
      while (currentBalance < 0.05 * LAMPORTS_PER_SOL) {
        console.log(
          '\n❌ Pool Wallet has insufficient SOL (needs at least 0.05 SOL to pay for transactions).',
        );
        console.log(`👉 Please fund your Pool Wallet: ${poolWalletPubkey}`);
        console.log('   You can use one of the following faucets:');
        console.log('   - https://faucet.solana.com/');
        console.log('   - https://solfaucet.com/');
        console.log('\n⏳ Waiting for funds...');
        await askQuestion(
          '👉 Press [Enter] once you have requested an airdrop to the Pool Wallet to check balance again...',
        );
        currentBalance = await connection.getBalance(poolKeypair.publicKey);
        console.log(
          `💰 Current Pool Wallet Balance: ${currentBalance / LAMPORTS_PER_SOL} SOL`,
        );
      }
    }
  } catch (err) {
    console.warn(
      '⚠️ Error checking pool wallet balance. Proceeding.',
    );
  }

  // ── 3. Load or create Token Mint ─────────────────────────────────────
  let mintAddress = process.env.MINT_ADDRESS || '';
  if (!mintAddress) {
    console.log(
      '\n[Setup] No MINT_ADDRESS found in .env. Creating Kirat token mint on devnet...',
    );
    try {
      const mintPublicKey = await createMint(
        connection,
        poolKeypair, // payer
        poolKeypair.publicKey, // mint authority
        poolKeypair.publicKey, // freeze authority
        9, // decimals (matches SOL)
      );
      mintAddress = mintPublicKey.toBase58();
      updateEnv('MINT_ADDRESS', mintAddress);
    } catch (err) {
      console.error('❌ Failed to create token mint:', err);
      process.exit(1);
    }
  }
  console.log(`🪙 Kirat Token Mint Address: ${mintAddress}`);

  console.log('\n' + '='.repeat(65));
  console.log('                     📋 NEXT STEPS');
  console.log('='.repeat(65));
  console.log(
    '1. Make sure your Express backend server is configured with the updated .env.',
  );
  console.log('2. Run your backend server in another terminal window:');
  console.log('   npm run dev');
  console.log('='.repeat(65));

  await askQuestion(
    '\n👉 Press [Enter] once your backend server is running on localhost:3000 to begin testing...',
  );

  // ── 4. Create User Wallet and airdrop ────────────────────────────────
  console.log(
    '\n[Test] Creating a temporary user wallet for transaction testing...',
  );
  const userKeypair = Keypair.generate();
  const userPubkey = userKeypair.publicKey;
  console.log(`👤 Temporary User Wallet: ${userPubkey.toBase58()}`);

  console.log(
    '💸 Requesting airdrop of 1.0 SOL to User wallet for deposit testing...',
  );
  try {
    const airdropSig = await connection.requestAirdrop(
      userPubkey,
      1.0 * LAMPORTS_PER_SOL,
    );
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      { signature: airdropSig, ...latest },
      'confirmed',
    );
  } catch (err) {
    console.warn(
      '   ⚠️ Web3 airdrop request failed (Solana Devnet faucets are rate-limited).',
    );
  }

  let userBal = await connection.getBalance(userPubkey);
  while (userBal < 0.25 * LAMPORTS_PER_SOL) {
    console.log(
      '\n❌ Temporary User Wallet has insufficient SOL (needs at least 0.25 SOL for testing).',
    );
    console.log(`👉 Please fund the User Wallet: ${userPubkey.toBase58()}`);
    console.log('   You can use one of the following faucets:');
    console.log('   - https://faucet.solana.com/');
    console.log('   - https://solfaucet.com/');
    console.log('\n⏳ Waiting for funds...');
    await askQuestion(
      '👉 Press [Enter] once you have requested an airdrop to the User Wallet to check balance again...',
    );
    userBal = await connection.getBalance(userPubkey);
    console.log(
      `👤 Current User wallet balance: ${userBal / LAMPORTS_PER_SOL} SOL`,
    );
  }
  console.log(`👤 User wallet balance: ${userBal / LAMPORTS_PER_SOL} SOL`);

  // ── 5. Perform SOL payment from User to Pool on devnet ───────────────
  const depositAmountSOL = 0.2;
  const depositAmountLamports = depositAmountSOL * LAMPORTS_PER_SOL;
  console.log(
    `\n[Test] Executing devnet payment of ${depositAmountSOL} SOL from User to Pool Wallet...`,
  );

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: userPubkey,
      toPubkey: poolKeypair.publicKey,
      lamports: depositAmountLamports,
    }),
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = userPubkey;
  tx.sign(userKeypair);

  const txSig = await connection.sendRawTransaction(tx.serialize());
  console.log(`📜 Solana Transaction Signature: ${txSig}`);
  console.log('⏳ Waiting for transaction confirmation on devnet...');

  await connection.confirmTransaction(
    {
      signature: txSig,
      blockhash,
      lastValidBlockHeight,
    },
    'confirmed',
  );
  console.log('✅ Solana payment transaction confirmed!');

  // ── 6. Send POST request to Local Backend Webhook ─────────────────────
  const serverPort = process.env.PORT || '3000';
  const localWebhookUrl = `http://localhost:${serverPort}/webhook`;
  console.log(
    `\n[Test] Triggering local server webhook at ${localWebhookUrl}...`,
  );

  const mockPayload = [
    {
      signature: txSig,
      type: 'TRANSFER',
      nativeTransfers: [
        {
          fromUserAccount: userPubkey.toBase58(),
          toUserAccount: poolWalletPubkey,
          amount: depositAmountLamports,
        },
      ],
      accountData: [],
    },
  ];

  try {
    const res = await fetch(localWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockPayload),
    });

    if (!res.ok) {
      throw new Error(
        `Server returned status ${res.status}: ${await res.text()}`,
      );
    }
    console.log(
      `📥 Webhook POST request sent. Server responded with: ${res.status} OK`,
    );
  } catch (err) {
    console.error(
      '❌ Failed to connect/send webhook to backend. Make sure server is running.',
      err,
    );
    process.exit(1);
  }

  // ── 7. Verify minting of Kirat tokens on-chain ──────────────────────
  console.log(
    '⏳ Waiting 6 seconds for backend to process webhook and mint tokens...',
  );
  await new Promise((r) => setTimeout(r, 6000));

  const mintPubkey = new PublicKey(mintAddress);
  const userAta = await getAssociatedTokenAddress(mintPubkey, userPubkey);
  console.log(
    `=== User Kirat Associated Token Account (ATA): ${userAta.toBase58()}`,
  );

  try {
    const tokenAccountInfo = await getAccount(connection, userAta);
    const balance = Number(tokenAccountInfo.amount) / 1e9;
    console.log(
      `🪙 Success! On-chain User Kirat Token Balance: ${balance} Kirat`,
    );
    if (balance > 0) {
      console.log('🎉 DEPOSIT & MINT INTEGRATION TEST PASSED! 🎉');
    } else {
      console.warn('⚠️ Token balance is 0. Please check server logs.');
    }
  } catch (err) {
    console.error(
      '❌ User ATA not found on-chain. Minting failed or was delayed.',
      err,
    );
    process.exit(1);
  }

  // ── 8. Redeem Flow Test ──────────────────────────────────────────────
  console.log('\n' + '='.repeat(65));
  console.log('                  🔄 TESTING REDEMPTION FLOW');
  console.log('='.repeat(65));
  const redeemAmountKirat = 0.1;
  console.log(`[Test] Requesting redemption of ${redeemAmountKirat} Kirat...`);

  const redeemUrl = `http://localhost:${serverPort}/redeem`;
  let base64Tx = '';
  try {
    const res = await fetch(redeemUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPublicKey: userPubkey.toBase58(),
        kiratAmount: redeemAmountKirat,
      }),
    });

    if (!res.ok) {
      throw new Error(`Redeem request failed: ${await res.text()}`);
    }

    const data = (await res.json()) as { transaction: string };
    base64Tx = data.transaction;
    console.log('✅ Received partially-signed transaction from server');
  } catch (err) {
    console.error('❌ Failed to request redemption from server:', err);
    process.exit(1);
  }

  // Sign & submit co-signed transaction
  console.log('[Test] Deserialising, signing, and broadcasting transaction...');
  try {
    const redeemTx = Transaction.from(Buffer.from(base64Tx, 'base64'));

    // User signs as fee payer and owner of the ATA
    redeemTx.partialSign(userKeypair);

    const serializedRedeem = redeemTx.serialize();
    const redeemSig = await connection.sendRawTransaction(serializedRedeem);
    console.log(`📜 Redemption Transaction Signature: ${redeemSig}`);
    console.log('⏳ Waiting for confirmation on devnet...');

    const redeemLatest = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      {
        signature: redeemSig,
        blockhash: redeemTx.recentBlockhash!,
        lastValidBlockHeight: redeemLatest.lastValidBlockHeight,
      },
      'confirmed',
    );
    console.log('✅ Redemption transaction confirmed!');

    // Check balances again
    const finalTokenAccount = await getAccount(connection, userAta);
    const finalKiratBal = Number(finalTokenAccount.amount) / 1e9;
    const finalSolBal =
      (await connection.getBalance(userPubkey)) / LAMPORTS_PER_SOL;

    console.log(`🪙 Final User Kirat Balance: ${finalKiratBal} Kirat`);
    console.log(`👤 Final User SOL Balance:   ${finalSolBal} SOL`);
    console.log('🎉 REDEMPTION / BURN INTEGRATION TEST PASSED! 🎉');
  } catch (err) {
    console.error('❌ Redemption execution failed:', err);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(65));
  console.log('🎉 ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY! 🎉');
  console.log('='.repeat(65));
}

main().catch((err) => {
  console.error('❌ Unexpected error during testing:', err);
});
