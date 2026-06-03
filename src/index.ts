import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { config } from './config.js';
import { getPoolKeypair } from './utils/solana.js';
import { getPoolState } from './token/mint.js';
import { createRedeemTransaction } from './token/burn.js';
import webhookRouter from './webhook/handler.js';
import chatRouter from './chat/handler.js';

// ────────────────────────────────────────────────────
//  ASCII Banner
// ────────────────────────────────────────────────────
const BANNER = `
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   ██╗  ██╗██╗██████╗  █████╗ ████████╗            ║
║   ██║ ██╔╝██║██╔══██╗██╔══██╗╚══██╔══╝            ║
║   █████╔╝ ██║██████╔╝███████║   ██║               ║
║   ██╔═██╗ ██║██╔══██╗██╔══██║   ██║               ║
║   ██║  ██╗██║██║  ██║██║  ██║   ██║               ║
║   ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝               ║
║                                                   ║
║       Centralized Liquid Staking Token            ║
║                 on Solana                         ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
`;

// ────────────────────────────────────────────────────
//  Express app
// ────────────────────────────────────────────────────
const app = express();

// ── CORS Middleware ─────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.json());

// ── Webhook ─────────────────────────────────────────
app.use('/webhook', webhookRouter);

// ── AI Chat Assistant ───────────────────────────────
app.use('/api/chat', chatRouter);

// ── Health check ────────────────────────────────────
/**
 * GET /health
 * Simple liveness probe.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Pool state ──────────────────────────────────────
/**
 * GET /pool
 * Returns the current pool statistics and addresses.
 */
app.get('/pool', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const poolState = await getPoolState();
    res.json(poolState);
  } catch (error) {
    next(error);
  }
});

// ── Redeem ──────────────────────────────────────────
/**
 * POST /redeem
 * Accepts { userPublicKey, kiratAmount } and returns a base64-serialized
 * Solana transaction that the user must sign client-side.
 */
app.post('/redeem', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userPublicKey, kiratAmount } = req.body;

    if (!userPublicKey || kiratAmount === undefined) {
      res.status(400).json({
        error: 'Missing required fields: userPublicKey, kiratAmount',
      });
      return;
    }

    const amount = Number(kiratAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: 'kiratAmount must be a positive number' });
      return;
    }

    const result = await createRedeemTransaction(userPublicKey, amount);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ── Global error handler ────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

// ────────────────────────────────────────────────────
//  Start
// ────────────────────────────────────────────────────
const PORT = config.PORT;

app.listen(PORT, () => {
  console.log(BANNER);
  console.log('🚀 Kirat LST server is running!\n');
  console.log(`   Port            : ${PORT}`);
  console.log(`   Network         : ${config.SOLANA_NETWORK}`);
  console.log(`   Pool Wallet     : ${getPoolKeypair().publicKey.toBase58()}`);
  console.log(`   Mint Address    : ${config.MINT_ADDRESS || '(not set — run npm run create-mint)'}`);
  console.log(`   Webhook URL     : ${config.WEBHOOK_URL || '(not set)'}`);
  console.log('');
});

export default app;
