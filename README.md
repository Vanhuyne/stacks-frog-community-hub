# FROG FT + Faucet (24h cooldown)

MVP gồm:
- Fungible Token `FROG` (decimals = 0)
- Faucet cho phép mỗi địa chỉ claim 1,000 FROG mỗi 24h (ước tính ~144 block)
- Frontend React + Vite: connect ví, claim, xem balance, transfer

## Contract (Clarinet)

```bash
clarinet check
clarinet console
```

Contract nằm tại `contracts/frog-token.clar`.

## Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Cập nhật `VITE_CONTRACT_ADDRESS` trong `.env` sau khi deploy contract.

## TODO
- Deploy contract lên testnet
- Update contract address cho frontend
- Demo flow end-to-end
