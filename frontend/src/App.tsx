import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { Connection, PublicKey, Keypair, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import { Activity, ShieldCheck, Flame, RefreshCw } from 'lucide-react';

// Import local components
import { Dashboard } from './components/Dashboard';
import { StakingForm } from './components/StakingForm';
import { AIChat } from './components/AIChat';

// Wallet adapter CSS
import '@solana/wallet-adapter-react-ui/styles.css';

interface PoolState {
  totalSolDeposited: number;
  totalKiratMinted: number;
  exchangeRate: number;
  poolWalletAddress: string;
  mintAddress: string;
}

interface UserWalletState {
  publicKey: string | null;
  solBalance: number;
  kiratBalance: number;
  isMock: boolean;
}

const AppContent: React.FC = () => {
  const { publicKey: realPublicKey, signTransaction, sendTransaction } = useWallet();
  const [poolState, setPoolState] = useState<PoolState | null>(null);
  const [userWallet, setUserWallet] = useState<UserWalletState>({
    publicKey: null,
    solBalance: 0,
    kiratBalance: 0,
    isMock: false,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Setup Solana Connection - fallback to standard devnet public node to bypass browser CORS on custom RPCs
  const connection = useMemo(() => new Connection('https://api.devnet.solana.com', 'confirmed'), []);

  // Fetch pool stats from Express backend
  const fetchPoolState = useCallback(async () => {
    try {
      const serverPort = '3000';
      const res = await fetch(`http://localhost:${serverPort}/pool`);
      if (res.ok) {
        const data = await res.json() as PoolState;
        setPoolState(data);
        return data;
      }
    } catch (err) {
      console.error('Failed to fetch pool state:', err);
    }
    return null;
  }, []);

  // Instantiate or retrieve mock wallet
  const handleInstantiateMockWallet = useCallback(() => {
    let mockSecret = localStorage.getItem('mock_wallet_secret');
    let mockKp: Keypair;
    
    if (!mockSecret) {
      mockKp = Keypair.generate();
      localStorage.setItem('mock_wallet_secret', bs58.encode(mockKp.secretKey));
    } else {
      mockKp = Keypair.fromSecretKey(bs58.decode(mockSecret));
    }

    setUserWallet(prev => ({
      ...prev,
      publicKey: mockKp.publicKey.toBase58(),
      isMock: true,
    }));
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // Request devnet airdrop for Mock Wallet
  const handleMockAirdrop = async () => {
    if (!userWallet.publicKey || !userWallet.isMock) return;
    try {
      console.log('Requesting 1 SOL airdrop for Mock Wallet...');
      const userPubkey = new PublicKey(userWallet.publicKey);
      const sig = await connection.requestAirdrop(userPubkey, 1 * LAMPORTS_PER_SOL);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
      console.log('Airdrop confirmed!');
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Airdrop rate limit hit:', err);
      alert('Airdrop failed. Please fund this wallet manually or try again in a few minutes: ' + userWallet.publicKey);
    }
  };

  // Sign & Send Transaction handler for both wallet modes
  const handleSignAndSendTx = async (tx: Transaction, isMock: boolean): Promise<string> => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    if (isMock) {
      const mockSecret = localStorage.getItem('mock_wallet_secret');
      if (!mockSecret) throw new Error('No mock wallet secret key found.');
      
      const mockKp = Keypair.fromSecretKey(bs58.decode(mockSecret));
      tx.feePayer = mockKp.publicKey;
      
      // Sign & broadcast
      tx.partialSign(mockKp);
      const serialized = tx.serialize();
      const sig = await connection.sendRawTransaction(serialized);
      
      await connection.confirmTransaction({
        signature: sig,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');
      
      return sig;
    } else {
      if (!realPublicKey) throw new Error('Real wallet not connected.');
      
      // Standard adapter transaction submission
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({
        signature: sig,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');
      
      return sig;
    }
  };

  // Synchronise wallet connection and retrieve balances
  useEffect(() => {
    const syncBalances = async () => {
      let activePubkey: string | null = null;
      let activeIsMock = false;

      // Real wallet takes precedence if connected
      if (realPublicKey) {
        activePubkey = realPublicKey.toBase58();
        activeIsMock = false;
      } else {
        // Fall back to mock wallet if previously initialized
        const mockSecret = localStorage.getItem('mock_wallet_secret');
        if (mockSecret) {
          const mockKp = Keypair.fromSecretKey(bs58.decode(mockSecret));
          activePubkey = mockKp.publicKey.toBase58();
          activeIsMock = true;
        }
      }

      if (!activePubkey) {
        setUserWallet({
          publicKey: null,
          solBalance: 0,
          kiratBalance: 0,
          isMock: false,
        });
        setLoading(false);
        return;
      }

      try {
        const pubkeyObj = new PublicKey(activePubkey);
        
        // Fetch SOL balance
        const lamports = await connection.getBalance(pubkeyObj);
        const solBalance = lamports / LAMPORTS_PER_SOL;

        // Fetch Kirat LST balance if mint is set
        let kiratBalance = 0;
        const currentPoolState = poolState || await fetchPoolState();
        
        if (currentPoolState && currentPoolState.mintAddress && currentPoolState.mintAddress !== '(not set)') {
          try {
            const mintPubkey = new PublicKey(currentPoolState.mintAddress);
            const userAta = await getAssociatedTokenAddress(mintPubkey, pubkeyObj);
            const tokenBalanceInfo = await connection.getTokenAccountBalance(userAta);
            kiratBalance = Number(tokenBalanceInfo.value.amount) / 1e9;
          } catch {
            // ATA does not exist on-chain yet (balance = 0)
            kiratBalance = 0;
          }
        }

        setUserWallet({
          publicKey: activePubkey,
          solBalance,
          kiratBalance,
          isMock: activeIsMock,
        });
      } catch (err) {
        console.error('Failed to sync wallet balances:', err);
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    fetchPoolState().then(() => {
      syncBalances();
    });
  }, [realPublicKey, refreshTrigger, fetchPoolState, connection, poolState]);

  // Periodic polling refresh (every 10 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPoolState();
      setRefreshTrigger(prev => prev + 1);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchPoolState]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ 
            background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)',
            borderRadius: '10px',
            padding: '0.45rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Flame size={24} style={{ color: 'white' }} />
          </div>
          <div>
            <h2 className="gradient-text" style={{ fontSize: '1.4rem', fontFamily: 'var(--font-mono)' }}>KIRAT LST</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Centralised Liquid Staking</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Refresh Action */}
          <button 
            onClick={() => { fetchPoolState(); setRefreshTrigger(prev => prev + 1); }}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '50%',
              padding: '0.6rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)'
            }}
          >
            <RefreshCw size={16} />
          </button>

          {/* Web3 Wallet adapter connection button */}
          <WalletMultiButton />

          {/* Local Mock Wallet Toggle */}
          {!realPublicKey && (
            <button 
              onClick={userWallet.isMock ? handleMockAirdrop : handleInstantiateMockWallet}
              className="btn-secondary"
              style={{ 
                height: '48px', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem',
                border: userWallet.isMock ? '1px solid var(--color-accent)' : undefined
              }}
            >
              {userWallet.isMock ? (
                <>
                  <ShieldCheck size={18} style={{ color: 'var(--color-accent)' }} />
                  Fund Mock Wallet (+1 SOL)
                </>
              ) : (
                'Instantiate Mock Wallet'
              )}
            </button>
          )}
        </div>
      </header>

      {/* Main Grid View */}
      <main className="app-container">
        {/* Left Side: Staking Dashboard and Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <h1 className="gradient-text" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
              Stake SOL. Receive Kirat. Earn Rewards.
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
              Kirat is a centralized Liquid Staking Token running on Solana Devnet. Deposit native SOL and receive liquid KIRAT tokens in return, tracking pool value automatically.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
            <StakingForm
              poolState={poolState}
              userWallet={userWallet}
              connection={connection}
              signAndSendTx={handleSignAndSendTx}
              refreshData={() => setRefreshTrigger(prev => prev + 1)}
              instantiateMockWallet={handleInstantiateMockWallet}
            />
            <Dashboard
              poolState={poolState}
              userWallet={userWallet}
              loading={loading}
              refreshData={() => setRefreshTrigger(prev => prev + 1)}
            />
          </div>
        </div>

        {/* Right Side: AI Assistant Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <AIChat />
        </div>
      </main>

      {/* Footer */}
      <footer style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        <span>Centralised Solana Liquid Staking Token (Devnet)</span>
        <span>MIT License © 2026</span>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  // Initialize wallet adapter adapters
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => 'https://api.devnet.solana.com', []);
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AppContent />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;
