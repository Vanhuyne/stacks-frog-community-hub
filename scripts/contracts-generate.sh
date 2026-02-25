#!/usr/bin/env bash
set -euo pipefail

network="${1:-}"
if [[ "$network" != "testnet" && "$network" != "mainnet" ]]; then
  echo "Usage: $0 <testnet|mainnet>" >&2
  exit 1
fi

settings_file="settings/${network^}.toml"
if [[ ! -f "$settings_file" ]]; then
  echo "Missing $settings_file. Run ./scripts/bootstrap-local-config.sh first." >&2
  exit 1
fi

clarinet deployments generate --"$network" --manual-cost

plan_file="deployments/default.${network}-plan.yaml"
echo "Generated plan: $plan_file"
