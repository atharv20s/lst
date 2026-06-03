import React from 'react';
import { Shield, Coins, TrendingUp, Key, HelpCircle, Activity } from 'lucide-react';

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

interface DashboardProps {
  poolState: PoolState | null;
  userWallet: UserWalletState;
  loading: boolean;
  refreshData: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  poolState,
  userWallet,
  loading,
  refreshData,
}) => {
  const displayRate = poolState ? poolState.exchangeRate : 1.0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Dynamic Statistics Grid */}
      <div className="stats-grid">
        <div className="glass-card stat-item">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Total Value Locked</span>
            <Shield size={18} style={{ color: 'var(--color-primary)' }} />
          </div>
          <div className="stat-val gradient-text">
            {poolState ? `${poolState.totalSolDeposited.toFixed(2)} SOL` : '0.00 SOL'}
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            SOL active in staking pool
          </span>
        </div>

        <div className="glass-card stat-item">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Kirat Supply</span>
            <Coins size={18} style={{ color: 'var(--color-secondary)' }} />
          </div>
          <div className="stat-val" style={{ color: 'var(--color-secondary)' }}>
            {poolState ? `${poolState.totalKiratMinted.toFixed(2)} KIRAT` : '0.00 KIRAT'}
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            Total outstanding token supply
          </span>
        </div>

        <div className="glass-card stat-item">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Exchange Rate</span>
            <TrendingUp size={18} style={{ color: 'var(--color-accent)' }} />
          </div>
          <div className="stat-val" style={{ color: 'var(--text-primary)' }}>
            {`1 KIRAT = ${displayRate.toFixed(4)} SOL`}
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            Dynamic staking reward multiplier
          </span>
        </div>
      </div>

      {/* Connected Wallet Info */}
      <div className="glass-card">
        <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Key size={20} style={{ color: 'var(--color-primary)' }} />
          Connected Wallet
        </h3>
        
        {userWallet.publicKey ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Address:</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                {userWallet.publicKey}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Wallet Type:</span>
              <span style={{ 
                color: userWallet.isMock ? 'var(--color-accent)' : 'var(--color-secondary)',
                fontWeight: 600
              }}>
                {userWallet.isMock ? 'Mock Developer Wallet' : 'Standard Web3 Extension'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '0.5rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--border-radius-md)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', display: 'block', marginBottom: '0.25rem' }}>SOL Balance</span>
                <span style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {userWallet.solBalance.toFixed(4)} SOL
                </span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--border-radius-md)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', display: 'block', marginBottom: '0.25rem' }}>Kirat Balance</span>
                <span style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-secondary)' }}>
                  {userWallet.kiratBalance.toFixed(4)} KIRAT
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text-secondary)' }}>
            <HelpCircle size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
            <p>Connect your wallet or instantiate a Mock Developer Wallet above to view your balances and begin staking.</p>
          </div>
        )}
      </div>

      {/* Contract Addresses */}
      <div className="glass-card">
        <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={20} style={{ color: 'var(--color-secondary)' }} />
          On-Chain Program Info
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Pool Wallet:</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {poolState?.poolWalletAddress || 'Loading...'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Kirat Token Mint:</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-secondary)' }}>
              {poolState?.mintAddress || 'Loading...'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
