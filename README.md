# FROG Community Hub

FROG Community Hub is a Stacks dApp for community growth around FROG token with faucet, DAO pass, social posting, and STX tipping.

## Why This Repo Matters For Leaderboards

This repo demonstrates activity across the 3 required areas:

- Smart contract activity and impact on Stacks:
  - social posting contracts (`frog-social-v1`, `frog-social-reputation-v1`)
  - STX tipping contracts (`frog-social-tips-v1`, `frog-social-tips-reputation-v1`)
  - on-chain reputation points for creators (`+10` publish, `+2` received like)
- Usage of Stacks SDKs:
  - `@stacks/connect` for wallet connect and transaction requests
  - `@stacks/transactions` for read-only calls and Clarity arg encoding
- Public repo development activity:
  - contract evolution, deployment plans, frontend/backend wiring, and docs

## Demo

![Frog Social Demo 01](screenshot/frog-social-demo-01.png)

![Frog Social Demo 02](screenshot/frog-social-demo-02.png)

![Frog Social Demo 03](screenshot/frog-social-demo-03.png)

## Features

- FROG token interactions via `frog-token-v3`
- Faucet claim/transfer + admin controls
- DAO pass flow via `frog-dao-nft-v5`
- Social feed with hybrid storage:
  - on-chain: author, content hash, likes, block
  - backend: post text, links, images
- Reputation social flow via `frog-social-reputation-v1`:
  - publish fee: `50 FROG`
  - like fee: `5 FROG`
  - one-like-per-wallet
  - no self-like
  - author reputation score:
    - `+10` for each publish
    - `+2` for each received like
- STX tipping with reputation-compatible tips contract `frog-social-tips-reputation-v1`

## Active Contracts

Contracts in [Clarinet.toml](/Users/vanhuy/Documents/stacks-frog-community-hub/Clarinet.toml):

- `contracts/frog-token-v3.clar`
- `contracts/frog-dao-nft-v5.clar`
- `contracts/frog-social-v1.clar`
- `contracts/frog-social-reputation-v1.clar`
- `contracts/frog-social-tips-v1.clar`
- `contracts/frog-social-tips-reputation-v1.clar`

## Prerequisites

- Node.js 18+
- npm
- Clarinet

## Local Setup

```bash
cd /Users/vanhuy/Documents/stacks-frog-community-hub
./scripts/bootstrap-local-config.sh
./scripts/install-hooks.sh
```

This creates local gitignored config files:

- `settings/Testnet.toml`
- `settings/Mainnet.toml`
- `frontend/.env`

## Run Locally

### Backend (testnet)

```bash
cd /Users/vanhuy/Documents/stacks-frog-community-hub/backend
npm install
npm run dev
```

### Frontend (testnet)

```bash
cd /Users/vanhuy/Documents/stacks-frog-community-hub/frontend
npm install
npm run dev:testnet
```

## Standard Scripts

### Frontend (`frontend/`)

```bash
npm run dev:testnet
npm run dev:mainnet
npm run build:testnet
npm run build:mainnet
npm run preview:testnet
npm run preview:mainnet
```

### Contracts (repo root)

```bash
./scripts/contracts-generate.sh testnet
./scripts/contracts-apply.sh testnet
./scripts/contracts-deploy.sh testnet

./scripts/contracts-generate.sh mainnet
./scripts/contracts-apply.sh mainnet
./scripts/contracts-deploy.sh mainnet
```

## Environment

### Frontend env (`frontend/.env.development` testnet)

Required keys:

- `VITE_STACKS_NETWORK=testnet`
- `VITE_CONTRACT_ADDRESS=<deployer>`
- `VITE_CONTRACT_NAME=frog-token-v3`
- `VITE_DAO_CONTRACT_ADDRESS=<deployer>`
- `VITE_DAO_CONTRACT_NAME=frog-dao-nft-v5`
- `VITE_SOCIAL_CONTRACT_ADDRESS=<deployer>`
- `VITE_SOCIAL_CONTRACT_NAME=frog-social-reputation-v1`
- `VITE_SOCIAL_TIPS_CONTRACT_ID=<deployer>.frog-social-tips-reputation-v1`
- `VITE_SOCIAL_TIPS_CONTRACT_ADDRESS=<deployer>`
- `VITE_SOCIAL_TIPS_CONTRACT_NAME=frog-social-tips-reputation-v1`
- `VITE_SOCIAL_API_BASE_URL=<backend base url>`
- `VITE_HIRO_API_BASE_URL=https://api.testnet.hiro.so`

### Frontend env (`frontend/.env.production` mainnet)

- Keep mainnet values, currently wired to `frog-social-v1` and `frog-social-tips-v1`.

### Backend env (`backend/.env` testnet)

Required keys:

- `BACKEND_PORT=8787`
- `BACKEND_STACKS_NETWORK=testnet`
- `HIRO_API_BASE_URL=https://api.testnet.hiro.so`
- `TIPS_CONTRACT_ID=<deployer>.frog-social-tips-reputation-v1`
- `SUPABASE_URL=<https://your-project.supabase.co>`
- `SUPABASE_SERVICE_ROLE_KEY=<service role key>`
- `SUPABASE_STORAGE_BUCKET=frog-uploads`

## Deployment

### Dedicated testnet plans (safe migration)

Use dedicated plans to avoid touching legacy contracts:

- [testnet-social-reputation-only.yaml](/Users/vanhuy/Documents/stacks-frog-community-hub/deployments/testnet-social-reputation-only.yaml)
- [testnet-social-tips-reputation-only.yaml](/Users/vanhuy/Documents/stacks-frog-community-hub/deployments/testnet-social-tips-reputation-only.yaml)

Apply:

```bash
clarinet deployments apply -p deployments/testnet-social-reputation-only.yaml --no-dashboard
clarinet deployments apply -p deployments/testnet-social-tips-reputation-only.yaml --no-dashboard
```

### Current testnet contracts deployed for reputation flow

- `ST18GQ5APPBQ0QF1ZR2CTCW6AV63EKT6T4FSMA9T0.frog-social-reputation-v1`
- `ST18GQ5APPBQ0QF1ZR2CTCW6AV63EKT6T4FSMA9T0.frog-social-tips-reputation-v1`

## Validation Checklist

Run before opening PR or deploy:

```bash
cd /Users/vanhuy/Documents/stacks-frog-community-hub
clarinet check

cd frontend
npm run build:testnet
npm run build:mainnet
```

Manual app checks:

- Connect wallet
- Publish post and verify `Rep` badge appears
- Like from second wallet and verify reputation increases
- Tip post and verify tip sync succeeds against tips-reputation contract

## Known Limitations

- Mainnet production config still points to legacy social/tips contracts until migration is explicitly executed.
- Tips and social contracts must stay paired by generation:
  - `frog-social-v1` <-> `frog-social-tips-v1`
  - `frog-social-reputation-v1` <-> `frog-social-tips-reputation-v1`

## Contributing

- Open an issue describing bug/feature and expected behavior.
- Keep PRs focused (contract, frontend, backend, docs separated when possible).
- Run `clarinet check` and frontend build before requesting review.

## Notes

- Backend runtime data is stored at `backend/data/posts.json`.
- `backend/data/posts.json` is gitignored (local runtime data only).
