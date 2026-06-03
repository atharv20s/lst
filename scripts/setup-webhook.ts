#!/usr/bin/env tsx
/**
 * @module setup-webhook
 *
 * Registers a Helius enhanced webhook that watches for native SOL transfers
 * to the Kirat pool wallet. Run once after the server is publicly reachable
 * (e.g. behind ngrok).
 *
 * Usage:
 *   npx tsx scripts/setup-webhook.ts
 *   — or —
 *   npm run setup-webhook
 */

import 'dotenv/config';
import { config } from '../src/config.js';
import { getPoolKeypair } from '../src/utils/solana.js';

interface HeliusWebhookResponse {
  webhookID: string;
  wallet: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: string;
}

async function main(): Promise<void> {
  const { HELIUS_API_KEY, WEBHOOK_URL } = config;

  if (!HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY is not set. Add it to your .env file.');
    process.exit(1);
  }

  if (!WEBHOOK_URL) {
    console.error(
      '❌ WEBHOOK_URL is not set. Expose your server with ngrok and add the URL to .env.',
    );
    process.exit(1);
  }

  const poolKeypair = getPoolKeypair();
  const poolWalletPublicKey = poolKeypair.publicKey.toBase58();
  const webhookEndpoint = `${WEBHOOK_URL}/webhook`;

  console.log('🔧 Registering Helius webhook…');
  console.log(`   Pool Wallet : ${poolWalletPublicKey}`);
  console.log(`   Webhook URL : ${webhookEndpoint}`);
  console.log('');

  const apiUrl = `https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`;

  const body = {
    webhookURL: webhookEndpoint,
    transactionTypes: ['TRANSFER'],
    accountAddresses: [poolWalletPublicKey],
    webhookType: 'enhanced',
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Helius API returned ${response.status} ${response.statusText}: ${errorBody}`,
      );
    }

    const data = (await response.json()) as HeliusWebhookResponse;

    console.log('✅ Webhook registered successfully!');
    console.log(`   Webhook ID  : ${data.webhookID}`);
    console.log(`   Webhook URL : ${data.webhookURL}`);
    console.log(`   Type        : ${data.webhookType}`);
    console.log(`   Watching    : ${data.accountAddresses?.join(', ')}`);
    console.log(`   Tx Types    : ${data.transactionTypes?.join(', ')}`);
  } catch (error) {
    console.error('❌ Failed to register webhook:', error);
    process.exit(1);
  }
}

main();
