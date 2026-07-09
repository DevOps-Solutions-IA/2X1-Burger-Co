#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"
load_runtime_env

required_vars=(
  DATABASE_URL
  JWT_ACCESS_SECRET
  JWT_REFRESH_SECRET
  APP_URL
  CORS_ORIGIN
)

for variable_name in "${required_vars[@]}"; do
  value="${!variable_name:-}"
  [[ -n "$value" ]] || fail "Missing required environment variable: $variable_name"
done

if [[ "$JWT_ACCESS_SECRET" == change-this-* || "$JWT_REFRESH_SECRET" == change-this-* ]]; then
  fail "Replace placeholder JWT secrets before deploying."
fi

./infra/scripts/render-nginx-conf.sh "$ROOT_DIR/.env"

if [[ "${ALLOW_UNSAFE_DEPLOY:-false}" == "true" ]]; then
  warn "Deploy ejecutado sin backup previo por ALLOW_UNSAFE_DEPLOY=true"
else
  ./infra/scripts/backup.sh
fi

docker compose build api web
docker compose up -d postgres api web nginx

docker compose exec -T api pnpm --filter @inventory-fastfood/api prisma:migrate:deploy
pnpm --dir apps/api exec node ../../infra/scripts/sync-role-permissions.mjs

if [[ "${CLOUDFLARE_TUNNEL_ENABLED:-false}" == "true" ]]; then
  ./infra/scripts/cloudflare-tunnel.sh restart
fi

./infra/scripts/smoke.sh
info "Deploy completed successfully"
