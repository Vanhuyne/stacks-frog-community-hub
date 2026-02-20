# FROG Community Hub

FROG Community Hub is a Stacks dApp that combines faucet onboarding, DAO membership, governance actions, ecosystem links, and admin controls in one UI.

## Features

- FROG fungible token (`decimals = 0`) via `frog-token-v3`
- Faucet claim with configurable cooldown and amount
- DAO Pass flow via `frog-dao-nft-v5`
  - register username (ASCII)
  - mint one non-transferable DAO pass
- Governance board
  - create proposal
  - vote (yes/no/abstain)
  - execute/cancel proposal
  - browse and load recent proposals
- Ecosystem tab with curated Stacks app categories
- Admin tab for owner-only faucet controls

## Frontend Tabs

- `Faucet`: connect wallet, claim FROG, transfer token, view faucet config
- `DAO Pass`: register username and mint membership pass
- `Governance`: proposal board and voting actions
- `Ecosystem`: curated app directory
- `Admin`: pause/unpause faucet, update claim amount/cooldown (owner only)

## Contracts

Active contracts:
- `contracts/frog-token-v3.clar`
- `contracts/frog-dao-nft-v5.clar`

Legacy contracts (archived):
- `contracts/archive/frog-token.clar`
- `contracts/archive/frog-dao-nft.clar`
- `contracts/archive/frog-dao-nft-v3.clar`

Quick contract checks:

```bash
clarinet check
clarinet console
```

## Local Setup

Run once after clone:

```bash
./scripts/bootstrap-local-config.sh
./scripts/install-hooks.sh
```

This creates local config files (gitignored):
- `settings/Testnet.toml`
- `settings/Mainnet.toml`
- `frontend/.env`

Templates tracked in git:
- `settings/Testnet.toml.example`
- `settings/Mainnet.toml.example`
- `frontend/.env.example`

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Environment Variables (frontend/.env)

- `VITE_STACKS_NETWORK=testnet|mainnet`
- `VITE_CONTRACT_ADDRESS=<deployer address>`
- `VITE_CONTRACT_NAME=frog-token-v3`
- `VITE_DAO_CONTRACT_ADDRESS=<deployer address>`
- `VITE_DAO_CONTRACT_NAME=frog-dao-nft-v5`
- `VITE_HIRO_API_BASE_URL=<optional custom Hiro API URL>`

Notes:
- In local dev, the app can use `/hiro` proxy via Vite config.
- For production, point to Hiro API directly or your own API gateway.

## Deploy

### Testnet

1. Fill mnemonic in `settings/Testnet.toml`.
2. Generate plan:

```bash
clarinet deployments generate --testnet --manual-cost
```

3. Review `deployments/default.testnet-plan.yaml`.
4. Apply plan:

```bash
clarinet deployments apply --testnet --no-dashboard --use-on-disk-deployment-plan
```

### Mainnet

1. Fill mnemonic in `settings/Mainnet.toml`.
2. Generate plan:

```bash
clarinet deployments generate --mainnet --manual-cost
```

3. Review `deployments/default.mainnet-plan.yaml`.
4. Apply plan:

```bash
clarinet deployments apply --mainnet --no-dashboard --use-on-disk-deployment-plan
```

5. Update frontend `.env` values to mainnet addresses/names.

## Demo Screenshots

- Faucet tab: `diagram/screenshots/faucet-tab.png`
- DAO tab: `diagram/screenshots/dao-tab.png`
- Ecosystem tab: `diagram/screenshots/ecosystem-tab.png`

## Security Notes

- Pre-commit hook uses `gitleaks` to scan staged changes.
- A mnemonic was exposed in repository history previously; rotate old wallets and move funds to fresh keys.
