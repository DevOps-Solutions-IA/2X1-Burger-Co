#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${1:-/tmp/inventory-fastfood-canary}"
ENV_FILE="$STATE_DIR/canary.env"
[[ -f "$ENV_FILE" ]] || exit 0
docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/infra/release/docker-compose.canary.yml" down
