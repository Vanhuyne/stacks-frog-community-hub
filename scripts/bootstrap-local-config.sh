#!/usr/bin/env bash
set -euo pipefail

copy_if_missing() {
  local src="$1"
  local dst="$2"
  if [ ! -f "$dst" ]; then
    cp "$src" "$dst"
    echo "Created $dst from template"
  else
    echo "Skip $dst (already exists)"
  fi
}

copy_if_missing "settings/Testnet.toml.example" "settings/Testnet.toml"
copy_if_missing "settings/Mainnet.toml.example" "settings/Mainnet.toml"
copy_if_missing "frontend/.env.example" "frontend/.env"
