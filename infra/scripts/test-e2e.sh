#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# shellcheck disable=SC1091
source "$ROOT_DIR/infra/scripts/load-env.sh"

bash "$ROOT_DIR/infra/scripts/prepare-test-db.sh"

pnpm exec playwright test
