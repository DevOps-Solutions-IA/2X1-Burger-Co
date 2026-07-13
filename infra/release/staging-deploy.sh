#!/usr/bin/env bash
set -euo pipefail

[[ "${API_IMAGE:-}" =~ @sha256:[a-f0-9]{64}$ ]]
[[ "${WEB_IMAGE:-}" =~ @sha256:[a-f0-9]{64}$ ]]
[[ "${RELEASE_COMMIT:-}" =~ ^[a-f0-9]{40}$ ]]
[[ -n "${STAGING_PATH:-}" && -d "$STAGING_PATH" ]]

cd "$STAGING_PATH"
test -x ./infra/scripts/backup.sh
test -x ./infra/scripts/smoke.sh
./infra/scripts/backup.sh

STATE_DIR="${STAGING_RELEASE_STATE_DIR:-$STAGING_PATH/.release-state}"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
if [[ -f "$STATE_DIR/current.env" ]]; then cp "$STATE_DIR/current.env" "$STATE_DIR/previous.env"; fi
cat >"$STATE_DIR/candidate.env" <<EOF
API_IMAGE=$API_IMAGE
WEB_IMAGE=$WEB_IMAGE
RELEASE_COMMIT=$RELEASE_COMMIT
EOF
chmod 600 "$STATE_DIR/candidate.env"

API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" docker compose -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml pull api web
API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" docker compose -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml up -d api web nginx

if ./infra/scripts/smoke.sh; then
  mv "$STATE_DIR/candidate.env" "$STATE_DIR/current.env"
else
  if [[ -f "$STATE_DIR/previous.env" ]]; then
    set -a
    source "$STATE_DIR/previous.env"
    set +a
    API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" docker compose -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml up -d api web nginx
    ./infra/scripts/smoke.sh
  fi
  exit 1
fi
