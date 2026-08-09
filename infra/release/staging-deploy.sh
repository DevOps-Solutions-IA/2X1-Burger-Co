#!/usr/bin/env bash
set -euo pipefail

[[ -n "${STAGING_PATH:-}" && -d "$STAGING_PATH" ]]
[[ "$STAGING_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$STAGING_PATH" != *".."* ]]
source "$STAGING_PATH/infra/scripts/common.sh"

validate_image_reference "${API_IMAGE:-}"
validate_image_reference "${WEB_IMAGE:-}"
[[ "${RELEASE_COMMIT:-}" =~ ^[a-f0-9]{40}$ ]]

API_DIGEST="${API_IMAGE##*@}"
WEB_DIGEST="${WEB_IMAGE##*@}"

cd "$STAGING_PATH"
test -x ./infra/scripts/backup.sh
test -x ./infra/scripts/restore.sh
test -x ./infra/scripts/smoke.sh
BACKUP_OUTPUT="$(./infra/scripts/backup.sh)"
printf '%s\n' "$BACKUP_OUTPUT"
BACKUP_FILE="$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^\[info\] Backup stored at //p' | tail -n 1)"
[[ -n "$BACKUP_FILE" && "$BACKUP_FILE" == *.dump.gpg && -f "$BACKUP_FILE" ]]
./infra/scripts/restore.sh "$BACKUP_FILE" --validate-only

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

API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" API_DIGEST="$API_DIGEST" WEB_DIGEST="$WEB_DIGEST" \
  docker compose -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml pull api web
API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" API_DIGEST="$API_DIGEST" WEB_DIGEST="$WEB_DIGEST" \
  docker compose -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml run --rm --no-deps api \
  sh -lc './node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma'
API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" API_DIGEST="$API_DIGEST" WEB_DIGEST="$WEB_DIGEST" \
  docker compose -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml up -d api web nginx

if EXPECTED_RELEASE_COMMIT="$RELEASE_COMMIT" EXPECTED_API_DIGEST="$API_DIGEST" EXPECTED_WEB_DIGEST="$WEB_DIGEST" ./infra/scripts/smoke.sh; then
  mv "$STATE_DIR/candidate.env" "$STATE_DIR/current.env"
else
  if [[ -f "$STATE_DIR/previous.env" ]]; then
    PREVIOUS_API_IMAGE="$(awk -F= '$1 == "API_IMAGE" { print substr($0, index($0, "=") + 1) }' "$STATE_DIR/previous.env")"
    PREVIOUS_WEB_IMAGE="$(awk -F= '$1 == "WEB_IMAGE" { print substr($0, index($0, "=") + 1) }' "$STATE_DIR/previous.env")"
    PREVIOUS_RELEASE_COMMIT="$(awk -F= '$1 == "RELEASE_COMMIT" { print substr($0, index($0, "=") + 1) }' "$STATE_DIR/previous.env")"
    validate_image_reference "$PREVIOUS_API_IMAGE"
    validate_image_reference "$PREVIOUS_WEB_IMAGE"
    [[ "$PREVIOUS_RELEASE_COMMIT" =~ ^[a-f0-9]{40}$ ]]
    PREVIOUS_API_DIGEST="${PREVIOUS_API_IMAGE##*@}"
    PREVIOUS_WEB_DIGEST="${PREVIOUS_WEB_IMAGE##*@}"
    API_IMAGE="$PREVIOUS_API_IMAGE" WEB_IMAGE="$PREVIOUS_WEB_IMAGE" API_DIGEST="$PREVIOUS_API_DIGEST" WEB_DIGEST="$PREVIOUS_WEB_DIGEST" \
      docker compose -f docker-compose.yml -f infra/release/docker-compose.staging-images.yml up -d api web nginx
    EXPECTED_RELEASE_COMMIT="$PREVIOUS_RELEASE_COMMIT" EXPECTED_API_DIGEST="$PREVIOUS_API_DIGEST" EXPECTED_WEB_DIGEST="$PREVIOUS_WEB_DIGEST" \
      ./infra/scripts/smoke.sh
  fi
  exit 1
fi
