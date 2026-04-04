#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/generate-app-icons.sh"
"$ROOT_DIR/scripts/generate-pdf-document-icons.sh"

echo "All icons generated."
