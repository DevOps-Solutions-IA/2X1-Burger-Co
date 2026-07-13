#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/release/docker-compose.canary.yml"
ARTIFACT_RECORD="${1:?Usage: canary-deploy.sh <artifact-record.json> [state-dir]}"
STATE_DIR="${2:-/tmp/inventory-fastfood-canary}"
ENV_FILE="$STATE_DIR/canary.env"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

read_field() {
  node -p "require(process.argv[1])$1" "$ARTIFACT_RECORD"
}

BUILD_ID="$(read_field .manifest.buildId)"
API_DIGEST="$(read_field .api.digest)"
WEB_DIGEST="$(read_field .web.digest)"
[[ "$API_DIGEST" =~ ^sha256:[a-f0-9]{64}$ && "$WEB_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]

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
EOF
fi

sed -i '/^CANARY_API_IMAGE=/d;/^CANARY_WEB_IMAGE=/d;/^CANARY_API_DIGEST=/d;/^CANARY_WEB_DIGEST=/d;/^RELEASE_BUILD_ID=/d' "$ENV_FILE"
cat >>"$ENV_FILE" <<EOF
CANARY_API_IMAGE=$API_DIGEST
CANARY_WEB_IMAGE=$WEB_DIGEST
CANARY_API_DIGEST=$API_DIGEST
CANARY_WEB_DIGEST=$WEB_DIGEST
RELEASE_BUILD_ID=$BUILD_ID
EOF
chmod 600 "$ENV_FILE"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d canary-postgres
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm canary-migrate \
  sh -lc './node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && apps/api/node_modules/.bin/tsx prisma/seed.ts'
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d canary-api canary-web
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
cp "$ARTIFACT_RECORD" "$STATE_DIR/current-artifact.json"
printf '%s\n' "$ENV_FILE"
