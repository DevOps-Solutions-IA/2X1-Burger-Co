#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# shellcheck disable=SC1091
source "$ROOT_DIR/infra/scripts/load-env.sh"

database_url="${DATABASE_URL%%\?*}"
database_name="${database_url##*/}"

docker compose up -d postgres >/dev/null

for attempt in {1..30}; do
  if docker compose exec -T postgres pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    docker compose exec -T postgres psql -U postgres -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${database_name}'" \
      | grep -q 1 || docker compose exec -T postgres psql -U postgres -d postgres -c "CREATE DATABASE \"${database_name}\"" >/dev/null
    exit 0
  fi

  sleep 2
done

echo "PostgreSQL did not become ready in time." >&2
exit 1
