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

if [[ "${NODE_ENV:-development}" == "production" ]]; then
  REQUIRE_HTTPS=true ./infra/scripts/render-nginx-conf.sh "$ROOT_DIR/.env"
else
  ./infra/scripts/render-nginx-conf.sh "$ROOT_DIR/.env"
fi

validate_image_reference "${API_IMAGE:-}"
validate_image_reference "${WEB_IMAGE:-}"
[[ "${RELEASE_COMMIT:-}" =~ ^[a-f0-9]{40}$ ]] || fail "RELEASE_COMMIT must be a full commit SHA."

info "Delegating deployment to the immutable staging release pipeline"
exec env \
  API_IMAGE="$API_IMAGE" \
  WEB_IMAGE="$WEB_IMAGE" \
  RELEASE_COMMIT="$RELEASE_COMMIT" \
  STAGING_PATH="$ROOT_DIR" \
  "$ROOT_DIR/infra/release/staging-deploy.sh"
