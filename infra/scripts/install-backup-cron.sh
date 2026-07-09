#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"
load_runtime_env

CRON_SCHEDULE="${BACKUP_CRON_SCHEDULE:-0 2 * * *}"
CRON_COMMAND="cd $ROOT_DIR && ./infra/scripts/backup.sh >> $ROOT_DIR/backups/backup.log 2>&1"

command -v crontab >/dev/null 2>&1 || fail "crontab is not available on this host."

TMP_CRON="$(mktemp)"
crontab -l 2>/dev/null \
  | grep -v "$ROOT_DIR/infra/scripts/backup.sh" \
  | grep -v "cd $ROOT_DIR && ./infra/scripts/backup.sh" >"$TMP_CRON" || true
printf '%s %s\n' "$CRON_SCHEDULE" "$CRON_COMMAND" >>"$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"

info "Installed backup cron: $CRON_SCHEDULE"
