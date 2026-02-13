# FROG FT + Faucet (24h cooldown)

MVP includes:
- Fungible Token `FROG` (decimals = 0)
- Faucet allows each address to claim 1,000 FROG every 24h (~144 blocks)
- React + Vite frontend: connect wallet, claim, view balance, transfer

## Contract (Clarinet)

```bash
clarinet check
clarinet console
```

Contract is at `contracts/frog-token.clar`.

## Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Update `VITE_CONTRACT_ADDRESS` in `.env` after deploying the contract.

## TODO
- Deploy contract to testnet
- Update contract address for frontend
- Demo end-to-end flow
