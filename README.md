# FROG FT + Faucet (24h cooldown)

MVP includes:
- Fungible Token `FROG` (decimals = 0)
- Faucet allows each address to claim 1,000 FROG every 24h (~144 blocks)
- DAO NFT: register username + hold 1,000 FROG to mint a non-transferable membership pass
- React + Vite frontend: connect wallet, claim, view balance, transfer

## Contracts

```bash
clarinet check
clarinet console
```

Contracts:
- `contracts/frog-token.clar`
- `contracts/frog-dao-nft.clar`

## Secure Local Setup

Run once after cloning:

```bash
./scripts/bootstrap-local-config.sh
./scripts/install-hooks.sh
```

What this does:
- creates local config files from templates
- installs pre-commit hook for secret scanning

Local files generated (ignored by git):
- `settings/Testnet.toml`
- `settings/Mainnet.toml`
- `frontend/.env`

Template files tracked in git:
- `settings/Testnet.toml.example`
- `settings/Mainnet.toml.example`
- `frontend/.env.example`

## Frontend

```bash
cd frontend
npm install
npm run dev
```

## Deploy Testnet

1. Fill mnemonic in local file `settings/Testnet.toml`.
2. Generate deployment plan:

```bash
clarinet deployments generate --testnet --manual-cost
```

3. Review `deployments/default.testnet-plan.yaml`.
4. Apply deployment:

```bash
clarinet deployments apply --testnet --no-dashboard --use-on-disk-deployment-plan
```

## Deploy Mainnet

1. Fill mnemonic in local file `settings/Mainnet.toml`.
2. Generate deployment plan:

```bash
clarinet deployments generate --mainnet --manual-cost
```

3. Review `deployments/default.mainnet-plan.yaml`:
- `expected-sender` matches your deployer address
- contracts listed: `frog-token`, `frog-dao-nft`
- costs are acceptable

4. Apply deployment:

```bash
clarinet deployments apply --mainnet --no-dashboard --use-on-disk-deployment-plan
```

5. Update local frontend env `frontend/.env`:
- `VITE_CONTRACT_ADDRESS=<mainnet deployer address>`
- `VITE_CONTRACT_NAME=frog-token`
- `VITE_DAO_CONTRACT_ADDRESS=<mainnet deployer address>`
- `VITE_DAO_CONTRACT_NAME=frog-dao-nft`
- `VITE_HIRO_PROXY=` (empty for production build)

## Secret Scan (Pre-commit)

Pre-commit hook requires `gitleaks` installed locally.

Install on macOS:

```bash
brew install gitleaks
```

The hook scans staged changes and blocks commits containing potential secrets.

## Important Security Note

A mnemonic was previously exposed in this repository history. You should rotate those wallets and move funds to new keys.
