#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/release/docker-compose.canary.yml"
ARTIFACT_RECORD="${1:?Usage: canary-deploy.sh <artifact-record.json> [state-dir]}"
STATE_DIR="${2:-/tmp/inventory-fastfood-canary}"
ENV_FILE="$STATE_DIR/canary.env"
INITIALIZED_FILE="$STATE_DIR/database-initialized"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

read_field() {
  node -p "require(process.argv[1])$1" "$ARTIFACT_RECORD"
}

BUILD_ID="$(read_field .manifest.buildId)"
API_DIGEST="$(read_field .api.digest)"
WEB_DIGEST="$(read_field .web.digest)"
[[ "$API_DIGEST" =~ ^sha256:[a-f0-9]{64}$ && "$WEB_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]
node -e '
  const record = require(process.argv[1]);
  const manifest = record.manifest;
  if (manifest.dirtyBuild !== false) throw new Error("Canary requires a clean manifest");
  if (!Array.isArray(manifest.migrationInventory) || manifest.migrationInventory.length !== manifest.schemaMigrationCount) {
    throw new Error("Manifest migration inventory is incomplete");
  }
' "$ARTIFACT_RECORD"

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat >"$ENV_FILE" <<EOF
CANARY_POSTGRES_DB=inventory_fastfood_system_canary_test
CANARY_POSTGRES_USER=canary
CANARY_POSTGRES_PASSWORD=$(openssl rand -hex 24)
CANARY_JWT_ACCESS_SECRET=$(openssl rand -hex 48)
CANARY_JWT_REFRESH_SECRET=$(openssl rand -hex 48)
CANARY_ADMIN_EMAIL=canary-admin@local.invalid
CANARY_ADMIN_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
CANARY_API_PORT=4400
CANARY_WEB_PORT=3401
CANARY_POSTGRES_PORT=55433
CANARY_PUBLIC_WEB_ORIGIN=https://canary-web.local.invalid
CANARY_PUBLIC_PAYMENTS_BASE_URL=https://canary-pay.local.invalid
CANARY_PUBLIC_API_URL=https://canary-api.local.invalid
CANARY_SAFETY_ALLOWED_PHONES=573000000000,573000000010,573000000020
EOF
fi

ensure_default() {
  local key="$1" value="$2"
  grep -q "^${key}=" "$ENV_FILE" || printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
}

ensure_default CANARY_SAFETY_ALLOWED_PHONES '573000000000,573000000010,573000000020'
ensure_default CANARY_PUBLIC_WEB_ORIGIN 'https://canary-web.local.invalid'
ensure_default CANARY_PUBLIC_PAYMENTS_BASE_URL 'https://canary-pay.local.invalid'
ensure_default CANARY_PUBLIC_API_URL 'https://canary-api.local.invalid'

sed -i '/^CANARY_API_IMAGE=/d;/^CANARY_WEB_IMAGE=/d;/^CANARY_API_DIGEST=/d;/^CANARY_WEB_DIGEST=/d;/^CANARY_EXPECTED_MIGRATION_COUNT=/d;/^RELEASE_BUILD_ID=/d' "$ENV_FILE"
cat >>"$ENV_FILE" <<EOF
CANARY_API_IMAGE=$API_DIGEST
CANARY_WEB_IMAGE=$WEB_DIGEST
CANARY_API_DIGEST=$API_DIGEST
CANARY_WEB_DIGEST=$WEB_DIGEST
RELEASE_BUILD_ID=$BUILD_ID
EOF
chmod 600 "$ENV_FILE"

# Shell variables take precedence over --env-file in Compose. Rebind release
# identity explicitly so a prior baseline verification cannot pin stale images.
export CANARY_API_IMAGE="$API_DIGEST"
export CANARY_WEB_IMAGE="$WEB_DIGEST"
export CANARY_API_DIGEST="$API_DIGEST"
export CANARY_WEB_DIGEST="$WEB_DIGEST"
export RELEASE_BUILD_ID="$BUILD_ID"

if [[ "${CANARY_CONFIG_ONLY:-false}" == true ]]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
  printf '%s\n' "$ENV_FILE"
  exit 0
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d canary-postgres
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm canary-migrate \
  sh -lc './node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma'
if [[ ! -f "$INITIALIZED_FILE" ]]; then
  read_env_value() {
    sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
  }
  CANARY_DB="$(read_env_value CANARY_POSTGRES_DB)"
  CANARY_DB_USER="$(read_env_value CANARY_POSTGRES_USER)"
  CANARY_DB_PASSWORD="$(read_env_value CANARY_POSTGRES_PASSWORD)"
  CANARY_DB_PORT="$(read_env_value CANARY_POSTGRES_PORT)"
  CANARY_ADMIN_EMAIL="$(read_env_value CANARY_ADMIN_EMAIL)"
  CANARY_ADMIN_PASSWORD="$(read_env_value CANARY_ADMIN_PASSWORD)"
  DATABASE_URL="postgresql://$CANARY_DB_USER:$CANARY_DB_PASSWORD@127.0.0.1:$CANARY_DB_PORT/$CANARY_DB?schema=public" \
  ADMIN_EMAIL="$CANARY_ADMIN_EMAIL" ADMIN_PASSWORD="$CANARY_ADMIN_PASSWORD" \
    pnpm --dir "$ROOT_DIR/apps/api" exec tsx "$ROOT_DIR/prisma/seed.ts"
  : >"$INITIALIZED_FILE"
  chmod 600 "$INITIALIZED_FILE"
fi
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate \
  --wait --wait-timeout 120 canary-api canary-web
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
cp "$ARTIFACT_RECORD" "$STATE_DIR/current-artifact.json"
printf '%s\n' "$ENV_FILE"
