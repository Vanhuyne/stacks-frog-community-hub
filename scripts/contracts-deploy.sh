#!/usr/bin/env bash
set -euo pipefail

network="${1:-}"
if [[ "$network" != "testnet" && "$network" != "mainnet" ]]; then
  echo "Usage: $0 <testnet|mainnet>" >&2
  exit 1
fi

./scripts/contracts-generate.sh "$network"
./scripts/contracts-apply.sh "$network"
