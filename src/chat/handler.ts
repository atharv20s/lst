import { Router, Request, Response } from 'express';
import { loadPoolState, getExchangeRate } from '../pool/manager.js';
import { getPoolKeypair } from '../utils/solana.js';
import { config } from '../config.js';

const chatRouter = Router();

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

/**
 * Fallback AI response generator for offline or non-API key runs.
 * Computes calculations and answers dynamically using the current pool state.
 */
function generateFallbackResponse(userMessage: string, poolState: any, rate: number, poolAddr: string, mintAddr: string): string {
  const msg = userMessage.toLowerCase();
  
  if (msg.includes('rate') || msg.includes('exchange') || msg.includes('price')) {
    return `The current exchange rate is **${rate.toFixed(4)} SOL per Kirat**. \n\nFormula: \`exchangeRate = totalSolDeposited / totalKiratMinted\`\n- Total SOL: \`${poolState.totalSolDeposited} SOL\`\n- Total Kirat: \`${poolState.totalKiratMinted} Kirat\``;
  }

  if (msg.includes('pool') || msg.includes('stats') || msg.includes('solana') || msg.includes('staked')) {
    return `Here are the current pool statistics:\n- **Total SOL Staked**: \`${poolState.totalSolDeposited} SOL\`\n- **Total Kirat Minted**: \`${poolState.totalKiratMinted} Kirat\`\n- **Exchange Rate**: \`${rate.toFixed(4)} SOL/Kirat\`\n- **Pool Wallet Address**: \`${poolAddr}\`\n- **Mint Address**: \`${mintAddr}\``;
  }

  if (msg.includes('stake') || msg.includes('deposit') || msg.includes('mint')) {
    return `To stake SOL and mint **Kirat**:\n1. Enter your deposit amount of SOL in the Staking card.\n2. Click "Stake SOL".\n3. Confirm the transaction. \n\nUpon confirmation, Helius notifies our backend and we mint **Kirat** tokens directly to your wallet ATA at the rate of **${rate.toFixed(4)} SOL/Kirat**!`;
  }

  if (msg.includes('unstake') || msg.includes('redeem') || msg.includes('burn')) {
    return `To unstake / redeem your SOL:\n1. Head to the "Unstake" tab in the Staking card.\n2. Enter the amount of **Kirat** you wish to burn.\n3. The server will build a transaction co-signed by the pool.\n4. Sign with your wallet, and upon confirmation on-chain, you'll receive your SOL back instantly!`;
  }

  // Check if it's a calculator query
  const numMatch = msg.match(/(\d+(?:\.\d+)?)\s*(sol|kirat)/i);
  if (numMatch) {
    const val = parseFloat(numMatch[1]);
    const type = numMatch[2].toLowerCase();
    if (type === 'sol') {
      const result = val / rate;
      return `At the current exchange rate of **${rate.toFixed(4)} SOL/Kirat**, staking **${val} SOL** will mint you approximately **${result.toFixed(6)} Kirat** tokens.`;
    } else {
      const result = val * rate;
      return `At the current exchange rate of **${rate.toFixed(4)} SOL/Kirat**, unstaking/burning **${val} Kirat** will redeem you approximately **${result.toFixed(6)} SOL**.`;
    }
  }

  return `Hello! I am Kirat, your AI Staking Assistant. I can help you with:
- Explaining how the Liquid Staking Token (LST) works.
- Showing real-time pool metrics & exchange rate.
- Calculating staking yields or conversions (e.g. "How much Kirat for 5 SOL?").
- Guiding you through Staking / Unstaking operations.

How can I help you today?`;
}

chatRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const poolState = loadPoolState();
    const rate = getExchangeRate(poolState);
    const poolWalletAddress = getPoolKeypair().publicKey.toBase58();
    let mintAddress = '';
    try {
      mintAddress = config.MINT_ADDRESS || '';
    } catch {
      mintAddress = '(not set)';
    }

    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) {
      console.log('⚠️ GEMINI_API_KEY is not set. Using smart fallback chatbot logic.');
      const reply = generateFallbackResponse(message, poolState, rate, poolWalletAddress, mintAddress);
      res.json({ reply });
      return;
    }

    // Prepare system instructions and context
    const systemInstruction = `You are Kirat, a helpful and premium AI Staking Assistant for the Kirat Liquid Staking Token (LST) on Solana.
You have access to the real-time pool state:
- Network: Solana ${config.SOLANA_NETWORK}
- Pool Wallet Address: ${poolWalletAddress}
- Token Mint Address: ${mintAddress}
- Current SOL Deposited: ${poolState.totalSolDeposited} SOL
- Current Kirat Minted: ${poolState.totalKiratMinted} Kirat
- Exchange Rate: ${rate.toFixed(6)} SOL per Kirat (Meaning 1 Kirat = ${rate.toFixed(6)} SOL)

Formulas:
- Staking: Kirat to Mint = SOL Deposited / Exchange Rate
- Redeeming: SOL Returned = Kirat Burned * Exchange Rate

Guidelines:
- Explain concepts clearly and professionally.
- Format numbers nicely (e.g. 4 decimal places for exchange rates).
- Use Markdown for bolding, bullet points, and code blocks.
- If users ask about yield, explain that as staking rewards accrue, the exchange rate increases, making each Kirat worth more SOL over time.
- Be concise and focus on helping them stake/unstake.`;

    // Format history for Gemini API
    // Gemini expects contents: [{ role: 'user' | 'model', parts: [{ text: string }] }]
    const contents = [];
    if (history && Array.isArray(history)) {
      for (const h of history) {
        contents.push({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.text }],
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: message }],
    });

    console.log('🤖 Sending request to Gemini API...');
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Gemini API error: ${response.status} - ${errText}`);
      // Fallback if API fails
      const reply = generateFallbackResponse(message, poolState, rate, poolWalletAddress, mintAddress);
      res.json({ reply });
      return;
    }

    const data = (await response.json()) as any;
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'I could not generate a response. Please try again.';

    res.json({ reply });
  } catch (error) {
    console.error('❌ Error in /api/chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default chatRouter;
