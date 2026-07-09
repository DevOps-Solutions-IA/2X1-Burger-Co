#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# shellcheck disable=SC1091
source "$ROOT_DIR/infra/scripts/load-env.sh"
assert_test_database_url "$DATABASE_URL"

bash "$ROOT_DIR/infra/scripts/wait-for-postgres.sh"

pnpm exec prisma generate --schema prisma/schema.prisma >/dev/null
pnpm exec prisma migrate reset --force --skip-generate --skip-seed --schema prisma/schema.prisma >/dev/null
pnpm exec prisma migrate deploy --schema prisma/schema.prisma >/dev/null
pnpm --filter @inventory-fastfood/api prisma:seed >/dev/null
