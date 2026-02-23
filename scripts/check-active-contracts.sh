#!/usr/bin/env bash
set -euo pipefail

# Guardrails to avoid accidentally wiring runtime/config back to archived contracts.
forbidden_pattern='(^|[^a-z0-9-])(frog-token|frog-dao-nft|frog-dao-nft-v3|frog-dao-nft-v4)([^a-z0-9-]|$)'

targets=(
  "Clarinet.toml"
  "deployments"
  "frontend/.env"
  "frontend/.env.example"
  "frontend/src"
  "settings"
)

existing_targets=()
for path in "${targets[@]}"; do
  if [ -e "$path" ]; then
    existing_targets+=("$path")
  fi
done

if [ "${#existing_targets[@]}" -eq 0 ]; then
  exit 0
fi

if rg -n --color=never "$forbidden_pattern" "${existing_targets[@]}"; then
  echo ""
  echo "[contract-check] Found archived contract names in active runtime/config files." >&2
  echo "[contract-check] Allowed active contracts: frog-token-v3, frog-dao-nft-v5, frog-social-v1, frog-social-tips-v1" >&2
  exit 1
fi
