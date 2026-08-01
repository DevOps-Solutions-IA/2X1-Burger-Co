#!/usr/bin/env bash
set -euo pipefail
umask 077

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"
load_runtime_env "${RUNTIME_ENV_FILE:-$ROOT_DIR/.env}"

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
PLAINTEXT_BACKUP_FILE="$BACKUP_DIR/${BACKUP_BASE}.dump"
ENCRYPTED_BACKUP_FILE="${PLAINTEXT_BACKUP_FILE}.gpg"
MIGRATIONS_BEFORE_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-backup-migrations-before.XXXXXX")"
MIGRATIONS_AFTER_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-backup-migrations-after.XXXXXX")"

cleanup_plaintext() {
  rm -f "$PLAINTEXT_BACKUP_FILE" "$MIGRATIONS_BEFORE_FILE" "$MIGRATIONS_AFTER_FILE"
}
trap cleanup_plaintext EXIT

read_applied_migrations() {
  local output_file="$1"
  docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
    psql --username "$DB_USER" --dbname "$DB_NAME" --tuples-only --no-align \
    --command 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;' \
    >"$output_file"
}

read_applied_migrations "$MIGRATIONS_BEFORE_FILE"

info "Creating PostgreSQL custom-format backup for ${DB_NAME}"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_dump \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges >"$PLAINTEXT_BACKUP_FILE"
chmod 600 "$PLAINTEXT_BACKUP_FILE"

read_applied_migrations "$MIGRATIONS_AFTER_FILE"
cmp -s "$MIGRATIONS_BEFORE_FILE" "$MIGRATIONS_AFTER_FILE" \
  || fail "Migration identity changed while the backup was being created."

info "Encrypting backup with the configured GPG recipient"
[[ ! -e "$ENCRYPTED_BACKUP_FILE" ]] || fail "Encrypted backup output already exists."
gpg --batch --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
  --output "$ENCRYPTED_BACKUP_FILE" "$PLAINTEXT_BACKUP_FILE"
chmod 600 "$ENCRYPTED_BACKUP_FILE"
rm -f "$PLAINTEXT_BACKUP_FILE"

write_portable_sha256 "$ENCRYPTED_BACKUP_FILE"
chmod 600 "${ENCRYPTED_BACKUP_FILE}.sha256"
METADATA_FILE="$(node infra/scripts/backup-metadata.mjs create \
  "$ENCRYPTED_BACKUP_FILE" \
  "$MIGRATIONS_BEFORE_FILE" \
  "$DB_NAME" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
write_portable_sha256 "$METADATA_FILE"
chmod 600 "$METADATA_FILE" "${METADATA_FILE}.sha256"
cleanup_plaintext
trap - EXIT
info "Backup stored at $ENCRYPTED_BACKUP_FILE"

info "Pruning backups older than ${BACKUP_RETENTION_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.gpg' -o -name '*.sha256' -o -name '*.metadata.json' \) -mtime +"$BACKUP_RETENTION_DAYS" -delete

mapfile -t backup_files < <(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.gpg' \) | sort -r)
if (( ${#backup_files[@]} > BACKUP_KEEP_COUNT )); then
  for stale_file in "${backup_files[@]:$BACKUP_KEEP_COUNT}"; do
    rm -f "$stale_file" "${stale_file}.sha256" "${stale_file}.metadata.json" "${stale_file}.metadata.json.sha256"
  done
fi

info "Backup routine completed"
