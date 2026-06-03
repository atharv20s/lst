import { Router, Request, Response } from 'express';
import { getPoolKeypair } from '../utils/solana.js';
import { mintKiratToUser } from '../token/mint.js';

/**
 * Shape of a single native SOL transfer inside a Helius enhanced transaction.
 */
interface NativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  /** Amount in lamports (1 SOL = 1e9 lamports). */
  amount: number;
}

/**
 * Minimal type for the Helius enhanced-transaction webhook payload.
 * See https://docs.helius.dev/webhooks-and-websockets/webhooks
 */
interface HeliusEnhancedTransaction {
  signature: string;
  type: string;
  nativeTransfers: NativeTransfer[];
  accountData: unknown[];
  description?: string;
  timestamp?: number;
}

/**
 * Express router that handles incoming Helius enhanced webhook events.
 *
 * @remarks
 * - Always returns 200 OK so Helius does not retry delivery.
 * - Filters native transfers where the recipient is our pool wallet.
 * - For every qualifying deposit it calls {@link mintKiratToUser}.
 */
const webhookRouter = Router();

/**
 * POST /
 * Receives the Helius enhanced-transaction webhook payload (an array of
 * enhanced transaction objects) and processes SOL deposits.
 */
webhookRouter.post('/', async (req: Request, res: Response) => {
  // Always respond 200 immediately to prevent Helius retries.
  // Processing continues asynchronously below.
  res.status(200).json({ status: 'ok' });

  try {
    const transactions: HeliusEnhancedTransaction[] = Array.isArray(req.body)
      ? req.body
      : [req.body];

    const poolKeypair = getPoolKeypair();
    const poolWalletAddress = poolKeypair.publicKey.toBase58();

    console.log(
      `\n📥 [Webhook] Received ${transactions.length} transaction(s)`,
    );

    for (const tx of transactions) {
      console.log(`  ├─ Signature : ${tx.signature}`);
      console.log(`  ├─ Type      : ${tx.type}`);
      console.log(
        `  └─ Transfers : ${tx.nativeTransfers?.length ?? 0} native transfer(s)`,
      );

      if (!tx.nativeTransfers || tx.nativeTransfers.length === 0) {
        console.log('     ⏭  No native transfers — skipping.');
        continue;
      }

      // Aggregate deposits from each unique sender in this transaction.
      const depositsBySender = new Map<string, number>();

      for (const transfer of tx.nativeTransfers) {
        if (transfer.toUserAccount !== poolWalletAddress) continue;

        const sender = transfer.fromUserAccount;
        const currentTotal = depositsBySender.get(sender) ?? 0;
        depositsBySender.set(sender, currentTotal + transfer.amount);
      }

      if (depositsBySender.size === 0) {
        console.log('     ⏭  No transfers to pool wallet — skipping.');
        continue;
      }

      for (const [sender, lamports] of depositsBySender) {
        const solAmount = lamports / 1e9;

        if (solAmount <= 0) {
          console.log(`     ⏭  Zero-amount transfer from ${sender} — skipping.`);
          continue;
        }

        console.log(
          `     💰 Deposit: ${solAmount} SOL from ${sender}`,
        );

        try {
          await mintKiratToUser(sender, solAmount, tx.signature);
          console.log(
            `     ✅ Minted Kirat for ${solAmount} SOL to ${sender}`,
          );
        } catch (mintError) {
          console.error(
            `     ❌ Failed to mint Kirat for ${sender}:`,
            mintError,
          );
          // Do not rethrow — we don't want one failed mint to block
          // processing the remaining transactions.
        }
      }
    }
  } catch (error) {
    // Log but never crash — the 200 response is already sent.
    console.error('❌ [Webhook] Unexpected error while processing payload:', error);
  }
});

export default webhookRouter;
