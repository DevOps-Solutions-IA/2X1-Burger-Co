#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"

if [[ -z "${DATABASE_URL:-}" ]]; then
  load_runtime_env
fi

DATABASE_URL_RUNTIME="${DATABASE_URL:-}"
[[ -n "$DATABASE_URL_RUNTIME" ]] || fail "DATABASE_URL es obligatorio."

DB_NAME="$(parse_database_url_field database "$DATABASE_URL_RUNTIME")"

if [[ "$DB_NAME" != *_test && "${SEED_ALLOW_LIVE_DATABASE:-false}" != "true" ]]; then
  fail "Seed bloqueado para proteger la base viva (${DB_NAME}). Usa SEED_ALLOW_LIVE_DATABASE=true solo si lo decides explícitamente."
fi

pnpm --dir apps/api exec tsx ../../prisma/seed.ts
