#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ICON="$ROOT_DIR/public/icons/pdf-icon.svg"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/legir-pdf-document-icons.XXXXXX")"
TMP_SVG="$TMP_DIR/pdf-document-square.svg"
OUT_DIR="$TMP_DIR/out"

trap 'rm -rf "$TMP_DIR"' EXIT

if [[ ! -f "$SRC_ICON" ]]; then
  echo "Missing source icon: $SRC_ICON" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

bun scripts/create-square-svg.ts "$SRC_ICON" "$TMP_SVG"
bunx tauri icon "$TMP_SVG" -o "$OUT_DIR"

cp "$OUT_DIR/icon.ico" "$ROOT_DIR/src-tauri/icons/pdf-document.ico"
cp "$OUT_DIR/icon.icns" "$ROOT_DIR/src-tauri/icons/pdf-document.icns"

echo "Updated:"
echo "  src-tauri/icons/pdf-document.ico"
echo "  src-tauri/icons/pdf-document.icns"
