#!/usr/bin/env bash
set -euo pipefail
umask 077

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"
load_runtime_env

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-14}"
DATABASE_URL_RUNTIME="${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"

[[ -n "$DATABASE_URL_RUNTIME" ]] || fail "DATABASE_URL is required."
[[ -n "$BACKUP_GPG_RECIPIENT" ]] || fail "BACKUP_GPG_RECIPIENT is required; unencrypted backups are prohibited."
command -v gpg >/dev/null 2>&1 || fail "gpg is required for encrypted backups."

DB_NAME="$(parse_database_url_field database "$DATABASE_URL_RUNTIME")"
DB_USER="$(parse_database_url_field username "$DATABASE_URL_RUNTIME")"
DB_PASSWORD="$(parse_database_url_field password "$DATABASE_URL_RUNTIME")"

ensure_compose_service "$POSTGRES_SERVICE"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_BASE="backup-${DB_NAME}-${TIMESTAMP}"
BACKUP_FILE="$BACKUP_DIR/${BACKUP_BASE}.dump"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

cleanup_plaintext() {
  rm -f "$BACKUP_FILE"
}
trap cleanup_plaintext EXIT

info "Creating PostgreSQL custom-format backup for ${DB_NAME}"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_dump \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges >"$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

ENCRYPTED_BACKUP_FILE="${BACKUP_FILE}.gpg"
info "Encrypting backup with the configured GPG recipient"
gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
  --output "$ENCRYPTED_BACKUP_FILE" "$BACKUP_FILE"
chmod 600 "$ENCRYPTED_BACKUP_FILE"
rm -f "$BACKUP_FILE"
BACKUP_FILE="$ENCRYPTED_BACKUP_FILE"
trap - EXIT

write_portable_sha256 "$BACKUP_FILE"
chmod 600 "${BACKUP_FILE}.sha256"
info "Backup stored at $BACKUP_FILE"

info "Pruning backups older than ${BACKUP_RETENTION_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.gpg' -o -name '*.sha256' \) -mtime +"$BACKUP_RETENTION_DAYS" -delete

mapfile -t backup_files < <(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.gpg' \) | sort -r)
if (( ${#backup_files[@]} > BACKUP_KEEP_COUNT )); then
  for stale_file in "${backup_files[@]:$BACKUP_KEEP_COUNT}"; do
    rm -f "$stale_file" "${stale_file}.sha256"
  done
fi

info "Backup routine completed"
