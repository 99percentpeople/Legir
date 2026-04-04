#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ICON="$ROOT_DIR/public/icons/app-icon.svg"
OUT_DIR="$ROOT_DIR/src-tauri/icons"

if [[ ! -f "$SRC_ICON" ]]; then
  echo "Missing source icon: $SRC_ICON" >&2
  exit 1
fi

bunx tauri icon "$SRC_ICON" -o "$OUT_DIR"

echo "Updated app icons from:"
echo "  public/icons/app-icon.svg"
