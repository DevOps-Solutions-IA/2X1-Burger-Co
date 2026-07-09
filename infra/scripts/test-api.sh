#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# shellcheck disable=SC1091
source "$ROOT_DIR/infra/scripts/load-env.sh"
assert_test_database_url "$DATABASE_URL"

bash "$ROOT_DIR/infra/scripts/prepare-test-db.sh"

jest_args=(--runInBand)
if [[ "${API_TEST_FORCE_EXIT:-0}" == "1" ]]; then
  jest_args+=(--forceExit)
fi
if [[ "${API_TEST_DETECT_OPEN_HANDLES:-0}" == "1" ]]; then
  jest_args+=(--detectOpenHandles)
fi
if [[ $# -gt 0 ]]; then
  if [[ "${1:-}" == "--" ]]; then
    shift
  fi
  jest_args+=("$@")
fi

pnpm --dir apps/api exec jest "${jest_args[@]}"
