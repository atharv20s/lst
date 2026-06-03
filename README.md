# Kirat — Centralized Liquid Staking Token on Solana

**Kirat** is a centralized liquid staking token (LST) built on Solana devnet. Users deposit SOL into a pool wallet and receive **Kirat** SPL tokens in return. Those tokens can later be redeemed (burned) to withdraw SOL, at a rate that tracks the pool's total value.

---

## How It Works

### System Architecture
The following diagram illustrates how the components of the centralized liquid staking token system interact:

```mermaid
graph TD
    %% Styling
    classDef user fill:#6366F1,stroke:#4F46E5,stroke-width:2px,color:#FFF;
    classDef backend fill:#10B981,stroke:#059669,stroke-width:2px,color:#FFF;
    classDef solana fill:#8B5CF6,stroke:#7C3AED,stroke-width:2px,color:#FFF;
    classDef helius fill:#F59E0B,stroke:#D97706,stroke-width:2px,color:#FFF;
    classDef db fill:#EC4899,stroke:#DB2777,stroke-width:2px,color:#FFF;

    User([User Wallet]):::user
    
    subgraph backend_group [Node.js Backend Server]
        Server[Express App]:::backend
        PoolMgr[Pool State Manager]:::backend
        StateFile[(pool-state.json)]:::db
    end

    subgraph solana_group [Solana Blockchain]
        Devnet((Solana Devnet)):::solana
        PoolWallet[Pool SOL Wallet]:::solana
        TokenMint[Kirat Token Mint]:::solana
    end

    Helius[Helius Webhook Engine]:::helius

    %% Deposit Flow
    User -->|1. Transfer SOL| PoolWallet
    Devnet -.->|2. Watch Transactions| Helius
    Helius -->|3. POST /webhook| Server
    Server -->|4. Mint Token| TokenMint
    TokenMint -->|5. Deliver Kirat| User
    Server -->|6. Save State| PoolMgr
    PoolMgr --> StateFile

    %% Redeem Flow
    User -->|a. Request Redeem /redeem| Server
    Server -->|b. Build co-signed Tx| User
    User -->|c. Sign & Broadcast Tx| Devnet
    Devnet -->|d. Burn Kirat & Release SOL| User
```

---

## Data Schema & ERD

Since this is a centralized liquid staking pool, state is stored on the local disk inside `pool-state.json`. The following entity-relationship diagram shows the schema structure:

```mermaid
erDiagram
    PoolState ||--o{ DepositRecord : records
    PoolState {
        float totalSolDeposited "Accumulated SOL in the pool"
        float totalKiratMinted "Accumulated Kirat tokens minted"
    }
    DepositRecord {
        string txSignature PK "Solana Transaction Signature (Unique)"
        string sender "User Wallet Address (Base58)"
        float solAmount "SOL amount deposited"
        float kiratMinted "Kirat amount minted"
        int64 timestamp "Epoch timestamp in milliseconds"
    }
```

---

## Detailed Sequence Flows

### 1. Deposit & Mint Flow (Automated via Webhook)
When a user deposits SOL into the pool, Helius detects the event and informs our server, which automates the minting of Kirat tokens at the current exchange rate:

```mermaid
sequenceDiagram
    autonumber
    actor User as User Wallet
    participant Solana as Solana Devnet
    participant Helius as Helius Webhook
    participant Server as Express Server
    participant State as pool-state.json

    User->>Solana: Transfer SOL to Pool Wallet
    Note over Solana: Tx is processed and finalized
    Solana->>Helius: Enhanced webhook event triggered
    Helius->>Server: POST /webhook (payload containing transfers)
    activate Server
    Server->>State: Read pool-state.json (current totals)
    State-->>Server: Return PoolState
    Server->>Server: Calculate exchange rate & Kirat to mint
    Server->>Solana: mintTo (Mint Kirat to User's ATA, signed by Pool Keypair)
    Solana-->>Server: Tx Signature returned & confirmed
    Server->>State: Record deposit & update totals
    Server-->>Helius: 200 OK Response
    deactivate Server
```

### 2. Redeem & Burn Flow (Co-Signed Transaction)
To withdraw SOL, the user initiates a redemption request. The server builds a transaction that burns Kirat and releases SOL, co-signing it before returning it to the user for final signing and broadcast:

```mermaid
sequenceDiagram
    autonumber
    actor User as User Wallet
    participant Server as Express Server
    participant State as pool-state.json
    participant Solana as Solana Devnet

    User->>Server: POST /redeem { userPublicKey, kiratAmount }
    activate Server
    Server->>State: Load pool-state.json & check exchange rate
    State-->>Server: Exchange Rate & Pool Balance
    Server->>Solana: Check User ATA balance
    Solana-->>Server: ATA details (verified owner/balance)
    Server->>Server: Build transaction:<br/>1. Burn Kirat from User ATA<br/>2. Transfer SOL from Pool Wallet to User
    Server->>Server: Partial Sign with Pool Wallet Keypair
    Server-->>User: Return Base64 Serialized Transaction
    deactivate Server
    User->>User: Sign transaction client-side (fee payer)
    User->>Solana: Submit fully-signed transaction
    Note over Solana: Executing on-chain...
    Solana->>Solana: 1. Burn user's Kirat tokens
    Solana->>Solana: 2. Transfer SOL from Pool to User Wallet
    Note over User: User receives SOL & tokens are burned
    Note over Server: Server state is updated upon next interaction or pool reload
```

---

## Exchange Rate Formula

The exchange rate is dynamic and updates automatically:

$$\text{exchangeRate} = \frac{\text{totalSOLInPool}}{\text{totalKiratMinted}}$$

- **Initial State**: Starts at **1 SOL = 1 Kirat** when no tokens have been minted yet.
- **Accruing Value**: As staking rewards accrue (e.g. SOL added to the pool without minting new tokens), the rate increases — meaning each Kirat becomes worth more than 1 SOL.
- **No minimum deposit**: Any amount of SOL is allowed.

---

## Prerequisites

| Requirement | Version |
|---|---|
| **Node.js** | 18 or later |
| **npm** | 9 or later |
| **Helius API Key** | Free tier at [helius.dev](https://helius.dev) |
| **ngrok** (or similar) | To expose localhost during dev |

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/kirat-lst.git
cd kirat-lst
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your **Helius API key**. The rest can remain default for now.

### 4. Create the Kirat token mint & pool wallet

```bash
npm run create-mint
```

This generates the pool wallet keypair (saved to `pool-wallet.json`) and creates the **Kirat** SPL token mint on devnet. Copy the printed **mint address** and paste it into your `.env` as `MINT_ADDRESS`.

### 5. Start the server

```bash
npm run dev
```

The server starts on `http://localhost:3000` by default.

### 6. Expose with ngrok

```bash
ngrok http 3000
```

Copy the **https** forwarding URL (e.g. `https://abc123.ngrok-free.app`).

### 7. Set the webhook URL

Add the ngrok URL to your `.env`:

```
WEBHOOK_URL=https://abc123.ngrok-free.app
```

### 8. Register the Helius webhook

```bash
npm run setup-webhook
```

You should see a confirmation with the webhook ID.

### 9. Test it!

Send some devnet SOL to the pool wallet address (printed on server startup) and watch the logs — Kirat tokens will be minted automatically.

---

## API Endpoints

### `GET /health`

Liveness probe.

```json
{ "status": "ok", "timestamp": "2026-06-03T08:37:00.000Z" }
```

### `GET /pool`

Returns the current pool state.

```json
{
  "totalSolDeposited": 10.5,
  "totalKiratMinted": 10.5,
  "exchangeRate": 1.0,
  "poolWalletAddress": "...",
  "mintAddress": "..."
}
```

### `POST /webhook`

Receives Helius enhanced webhook payloads. Returns `200 OK` immediately, then processes transfers asynchronously. **Do not call manually** — Helius calls this endpoint automatically.

### `POST /redeem`

Burns Kirat tokens and returns SOL.

**Request:**

```json
{
  "userPublicKey": "<base58 public key>",
  "kiratAmount": 5.0
}
```

**Response:**

```json
{
  "transaction": "<base64-encoded serialized transaction>"
}
```

The returned transaction must be **signed by the user** on the client side and submitted to the Solana network.

---

## Project Structure

```
├── src/
│   ├── index.ts              # Express server entry point
│   ├── config/
│   │   └── index.ts           # Environment & app configuration
│   ├── token/
│   │   ├── createMint.ts      # Script: create SPL mint + pool wallet
│   │   └── mint.ts            # Mint / burn / pool-state logic
│   └── webhook/
│       └── handler.ts         # Helius webhook handler
├── scripts/
│   └── setup-webhook.ts       # Register Helius webhook
├── .env.example               # Environment variable template
├── package.json
├── tsconfig.json
└── README.md
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `SOLANA_NETWORK` | Solana cluster URL | devnet |
| `HELIUS_API_KEY` | Your Helius API key | — |
| `WEBHOOK_URL` | Public URL where the server is reachable | — |
| `MINT_ADDRESS` | Kirat SPL token mint address | — |
| `POOL_WALLET_PATH` | Path to pool wallet keypair JSON | `pool-wallet.json` |

---

## Tech Stack

- **Solana** — web3.js + spl-token
- **Express** — HTTP server
- **Helius** — Enhanced webhooks for real-time transaction monitoring
- **TypeScript** — Type safety throughout
- **tsx** — Fast TypeScript execution for development

---

## License

MIT © 2026
