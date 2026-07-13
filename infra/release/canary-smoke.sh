#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RECORD="${1:?Usage: canary-smoke.sh <artifact-record.json> [state-dir]}"
STATE_DIR="${2:-/tmp/inventory-fastfood-canary}"
ENV_FILE="$STATE_DIR/canary.env"
[[ -f "$ENV_FILE" ]] || { echo "Canary environment not found" >&2; exit 1; }
set -a
source "$ENV_FILE"
set +a
CANARY_API_BASE_URL="http://127.0.0.1:${CANARY_API_PORT}" \
CANARY_WEB_BASE_URL="http://127.0.0.1:${CANARY_WEB_PORT}" \
  node "$ROOT_DIR/infra/release/canary-smoke.mjs" "$RECORD"
