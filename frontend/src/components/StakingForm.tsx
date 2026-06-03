import React, { useState } from 'react';
import { ArrowDownUp, RefreshCw, Layers, CheckCircle2, AlertCircle } from 'lucide-react';
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Base64 helper for browser environments where Buffer is not global
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

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

interface StakingFormProps {
  poolState: PoolState | null;
  userWallet: UserWalletState;
  connection: Connection;
  signAndSendTx: (tx: Transaction, isMock: boolean) => Promise<string>;
  refreshData: () => void;
  instantiateMockWallet: () => void;
}

export const StakingForm: React.FC<StakingFormProps> = ({
  poolState,
  userWallet,
  connection,
  signAndSendTx,
  refreshData,
  instantiateMockWallet,
}) => {
  const [activeTab, setActiveTab] = useState<'stake' | 'unstake'>('stake');
  const [stakeAmount, setStakeAmount] = useState<string>('');
  const [unstakeAmount, setUnstakeAmount] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const exchangeRate = poolState ? poolState.exchangeRate : 1.0;

  // Stake Flow (SOL -> Kirat)
  const handleStake = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stakeAmount || !poolState || !userWallet.publicKey) return;

    setLoading(true);
    setTxSig(null);
    setErrorMsg(null);

    const amountSOL = parseFloat(stakeAmount);
    if (isNaN(amountSOL) || amountSOL <= 0) {
      setErrorMsg('Please enter a valid positive SOL amount.');
      setLoading(false);
      return;
    }

    if (amountSOL > userWallet.solBalance) {
      setErrorMsg('Insufficient SOL balance.');
      setLoading(false);
      return;
    }

    try {
      const userPubkey = new PublicKey(userWallet.publicKey);
      const poolPubkey = new PublicKey(poolState.poolWalletAddress);
      
      console.log(`[Stake] Building SOL transfer tx of ${amountSOL} SOL from User to Pool...`);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: userPubkey,
          toPubkey: poolPubkey,
          lamports: Math.round(amountSOL * LAMPORTS_PER_SOL),
        })
      );

      // Sign & send transfer tx via parent handler
      const sig = await signAndSendTx(tx, userWallet.isMock);
      console.log(`[Stake] Transfer tx signature: ${sig}`);

      // Call Express server webhook to simulate Helius detecting transfer
      console.log('[Stake] Triggering backend webhook to mint Kirat tokens...');
      const serverPort = '3000';
      const webhookUrl = `http://localhost:${serverPort}/webhook`;
      
      const payload = [
        {
          signature: sig,
          type: 'TRANSFER',
          nativeTransfers: [
            {
              fromUserAccount: userWallet.publicKey,
              toUserAccount: poolState.poolWalletAddress,
              amount: Math.round(amountSOL * LAMPORTS_PER_SOL),
            }
          ],
          accountData: [],
        }
      ];

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Server failed to process webhook: ${await res.text()}`);
      }

      setTxSig(sig);
      setStakeAmount('');
      
      // Wait for backend to mint before refreshing
      setTimeout(() => {
        refreshData();
        setLoading(false);
      }, 5000);

    } catch (err: any) {
      console.error('Stake failed:', err);
      setErrorMsg(err.message || 'Staking transaction failed. Check console for details.');
      setLoading(false);
    }
  };

  // Unstake Flow (Kirat -> SOL)
  const handleUnstake = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unstakeAmount || !poolState || !userWallet.publicKey) return;

    setLoading(true);
    setTxSig(null);
    setErrorMsg(null);

    const amountKirat = parseFloat(unstakeAmount);
    if (isNaN(amountKirat) || amountKirat <= 0) {
      setErrorMsg('Please enter a valid positive Kirat amount.');
      setLoading(false);
      return;
    }

    if (amountKirat > userWallet.kiratBalance) {
      setErrorMsg('Insufficient Kirat balance.');
      setLoading(false);
      return;
    }

    try {
      // 1. Fetch co-signed redeem transaction from server
      console.log(`[Unstake] Requesting co-signed redeem transaction from server for ${amountKirat} Kirat...`);
      const serverPort = '3000';
      const redeemUrl = `http://localhost:${serverPort}/redeem`;

      const res = await fetch(redeemUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPublicKey: userWallet.publicKey,
          kiratAmount: amountKirat,
        })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const { transaction: base64Tx } = await res.json() as { transaction: string };
      console.log('[Unstake] Co-signed transaction received from server. Deserialising...');

      // 2. Re-construct the Transaction object from base64
      const tx = Transaction.from(base64ToUint8Array(base64Tx));

      // 3. User signs (as fee payer & ATA owner) and broadcasts transaction
      const sig = await signAndSendTx(tx, userWallet.isMock);
      console.log(`[Unstake] Broadcasted redeem transaction. Signature: ${sig}`);

      setTxSig(sig);
      setUnstakeAmount('');

      // Wait for blockchain to update before refreshing
      setTimeout(() => {
        refreshData();
        setLoading(false);
      }, 5000);

    } catch (err: any) {
      console.error('Unstake failed:', err);
      setErrorMsg(err.message || 'Unstaking transaction failed. Check console.');
      setLoading(false);
    }
  };

  const calculatedOutput = () => {
    if (activeTab === 'stake') {
      const val = parseFloat(stakeAmount);
      return isNaN(val) ? '0.00' : (val / exchangeRate).toFixed(6);
    } else {
      const val = parseFloat(unstakeAmount);
      return isNaN(val) ? '0.00' : (val * exchangeRate).toFixed(6);
    }
  };

  return (
    <div className="glass-card" style={{ position: 'relative' }}>
      {/* Background glow decorator */}
      <div 
        className="glow-ambient" 
        style={{ 
          top: '-10%', 
          right: '-10%', 
          width: '200px', 
          height: '200px', 
          background: 'var(--color-primary)' 
        }} 
      />

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '2rem' }}>
        <button
          onClick={() => { setActiveTab('stake'); setErrorMsg(null); setTxSig(null); }}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'stake' ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: activeTab === 'stake' ? 'var(--text-primary)' : 'var(--text-secondary)',
            padding: '1rem',
            fontSize: '1rem',
            fontWeight: 600,
          }}
        >
          Stake SOL
        </button>
        <button
          onClick={() => { setActiveTab('unstake'); setErrorMsg(null); setTxSig(null); }}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'unstake' ? '2px solid var(--color-secondary)' : '2px solid transparent',
            color: activeTab === 'unstake' ? 'var(--text-primary)' : 'var(--text-secondary)',
            padding: '1rem',
            fontSize: '1rem',
            fontWeight: 600,
          }}
        >
          Unstake Kirat
        </button>
      </div>

      {!userWallet.publicKey ? (
        <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
          <Layers size={40} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h4 style={{ marginBottom: '0.5rem' }}>Wallet Not Connected</h4>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Staking operations require a wallet connection. Connect your browser wallet or launch a local developer keypair with one click:
          </p>
          <button onClick={instantiateMockWallet} className="btn-primary" style={{ width: '100%' }}>
            ✨ Initialize Mock Developer Wallet
          </button>
        </div>
      ) : (
        <form onSubmit={activeTab === 'stake' ? handleStake : handleUnstake}>
          {/* Input Group */}
          <div className="input-group">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label>{activeTab === 'stake' ? 'Staking Amount' : 'Redemption Amount'}</label>
              <span 
                onClick={() => {
                  if (activeTab === 'stake') {
                    setStakeAmount(Math.max(0, userWallet.solBalance - 0.01).toString());
                  } else {
                    setUnstakeAmount(userWallet.kiratBalance.toString());
                  }
                }}
                style={{ fontSize: '0.85rem', color: 'var(--color-primary)', cursor: 'pointer' }}
              >
                Max: {activeTab === 'stake' ? `${userWallet.solBalance.toFixed(4)} SOL` : `${userWallet.kiratBalance.toFixed(4)} KIRAT`}
              </span>
            </div>
            
            <div className="input-wrapper">
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={activeTab === 'stake' ? stakeAmount : unstakeAmount}
                onChange={(e) => activeTab === 'stake' ? setStakeAmount(e.target.value) : setUnstakeAmount(e.target.value)}
                disabled={loading}
              />
              <span className="input-suffix">
                {activeTab === 'stake' ? 'SOL' : 'KIRAT'}
              </span>
            </div>
          </div>

          {/* Swap Divider Icon */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '0.5rem 0 1.5rem 0' }}>
            <div style={{ 
              background: 'rgba(255,255,255,0.03)', 
              border: '1px solid rgba(255,255,255,0.08)', 
              borderRadius: '50%', 
              padding: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <ArrowDownUp size={16} style={{ color: 'var(--text-muted)' }} />
            </div>
          </div>

          {/* Output Info */}
          <div className="input-group" style={{ marginBottom: '2rem' }}>
            <label>{activeTab === 'stake' ? 'Estimated Minted' : 'Estimated Return'}</label>
            <div className="input-wrapper" style={{ opacity: 0.8 }}>
              <input
                type="text"
                readOnly
                value={calculatedOutput()}
                style={{ background: 'rgba(0, 0, 0, 0.1)', cursor: 'default' }}
              />
              <span className="input-suffix">
                {activeTab === 'stake' ? 'KIRAT' : 'SOL'}
              </span>
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              color: 'var(--color-danger)', 
              background: 'rgba(239, 68, 68, 0.1)', 
              padding: '0.75rem 1rem', 
              borderRadius: 'var(--border-radius-md)', 
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
              border: '1px solid rgba(239, 68, 68, 0.2)'
            }}>
              <AlertCircle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Message */}
          {txSig && (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column',
              gap: '0.25rem', 
              color: 'var(--color-secondary)', 
              background: 'rgba(16, 185, 129, 0.1)', 
              padding: '1rem', 
              borderRadius: 'var(--border-radius-md)', 
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
              border: '1px solid rgba(16, 185, 129, 0.2)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                <CheckCircle2 size={16} />
                <span>Transaction Succeeded!</span>
              </div>
              <a 
                href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} 
                target="_blank" 
                rel="noreferrer"
                style={{ color: 'var(--color-secondary)', textDecoration: 'underline', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', wordBreak: 'break-all', marginTop: '0.25rem' }}
              >
                Explorer: {txSig.substring(0, 16)}...
              </a>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ 
              width: '100%', 
              height: '52px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              gap: '0.5rem',
              fontSize: '1rem',
              background: activeTab === 'unstake' ? 'linear-gradient(135deg, var(--color-secondary) 0%, #059669 100%)' : undefined,
              boxShadow: activeTab === 'unstake' ? '0 4px 14px 0 rgba(16, 185, 129, 0.4)' : undefined
            }}
          >
            {loading ? (
              <>
                <RefreshCw className="spin" size={18} style={{ animation: 'spin 1.5s linear infinite' }} />
                Processing on Devnet...
              </>
            ) : (
              activeTab === 'stake' ? 'Stake SOL & Mint Kirat' : 'Unstake Kirat & Redeem SOL'
            )}
          </button>
        </form>
      )}
      
      {/* Dynamic inline styles for rotating animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
