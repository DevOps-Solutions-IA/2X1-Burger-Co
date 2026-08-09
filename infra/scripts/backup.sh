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
BACKUP_SOURCE_SHA="${BACKUP_SOURCE_SHA:-}"
BACKUP_ENVIRONMENT="${BACKUP_ENVIRONMENT:-}"
BACKUP_GNUPGHOME="${GNUPGHOME:-}"

[[ -n "$DATABASE_URL_RUNTIME" ]] || fail "DATABASE_URL is required."
[[ "$BACKUP_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "BACKUP_SOURCE_SHA must be a full 40-character source SHA."
[[ "$BACKUP_ENVIRONMENT" =~ ^[a-z][a-z0-9_-]{1,31}$ ]] || fail "BACKUP_ENVIRONMENT is required and has an invalid format."
[[ "$BACKUP_GPG_RECIPIENT" =~ ^[A-F0-9]{40}$ ]] || fail "BACKUP_GPG_RECIPIENT must be a full uppercase fingerprint."
[[ -n "$BACKUP_GNUPGHOME" && "$BACKUP_GNUPGHOME" == /* && -d "$BACKUP_GNUPGHOME" ]] \
  || fail "GNUPGHOME must explicitly reference an existing absolute directory."
[[ "$(stat -c '%a' "$BACKUP_GNUPGHOME")" == "700" ]] || fail "GNUPGHOME must have mode 700."
command -v gpg >/dev/null 2>&1 || fail "gpg is required for encrypted backups."

RESOLVED_GPG_FINGERPRINT="$(GNUPGHOME="$BACKUP_GNUPGHOME" gpg --batch --with-colons --list-keys -- "$BACKUP_GPG_RECIPIENT" 2>/dev/null \
  | awk -F: '$1 == "fpr" { print $10; exit }')"
[[ "$RESOLVED_GPG_FINGERPRINT" == "$BACKUP_GPG_RECIPIENT" ]] \
  || fail "The configured GPG keyring does not contain the exact backup recipient fingerprint."

DB_NAME="$(parse_database_url_field database "$DATABASE_URL_RUNTIME")"
DB_HOST="$(parse_database_url_field hostname "$DATABASE_URL_RUNTIME")"
DB_PORT="$(parse_database_url_field port "$DATABASE_URL_RUNTIME")"
DB_USER="$(parse_database_url_field username "$DATABASE_URL_RUNTIME")"
DB_PASSWORD="$(parse_database_url_field password "$DATABASE_URL_RUNTIME")"

ensure_compose_service "$POSTGRES_SERVICE"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_BASE="backup-${BACKUP_ENVIRONMENT}-${TIMESTAMP}"
PLAINTEXT_BACKUP_FILE="$BACKUP_DIR/${BACKUP_BASE}.dump"
ENCRYPTED_BACKUP_FILE="${PLAINTEXT_BACKUP_FILE}.gpg"
MIGRATIONS_BEFORE_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-backup-migrations-before.XXXXXX")"
MIGRATIONS_AFTER_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-backup-migrations-after.XXXXXX")"
DATABASE_IDENTITY_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-backup-database-identity.XXXXXX")"

cleanup_plaintext() {
  rm -f "$PLAINTEXT_BACKUP_FILE" "$MIGRATIONS_BEFORE_FILE" "$MIGRATIONS_AFTER_FILE" "$DATABASE_IDENTITY_FILE"
}
trap cleanup_plaintext EXIT

read_applied_migrations() {
  local output_file="$1"
  docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
    psql --username "$DB_USER" --dbname "$DB_NAME" --tuples-only --no-align \
    --command 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;' \
    >"$output_file"
}

read_cluster_system_identifier() {
  docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
    psql --username "$DB_USER" --dbname "$DB_NAME" --tuples-only --no-align \
    --command 'SELECT system_identifier::text FROM pg_control_system();' \
    | sed '/^[[:space:]]*$/d'
}

read_applied_migrations "$MIGRATIONS_BEFORE_FILE"
CLUSTER_SYSTEM_IDENTIFIER_BEFORE="$(read_cluster_system_identifier)"
[[ "$CLUSTER_SYSTEM_IDENTIFIER_BEFORE" =~ ^[0-9]+$ ]] \
  || fail "PostgreSQL cluster identity could not be established."
printf 'host=%s\nport=%s\ndatabase=%s\ncluster=%s\n' \
  "$DB_HOST" "$DB_PORT" "$DB_NAME" "$CLUSTER_SYSTEM_IDENTIFIER_BEFORE" >"$DATABASE_IDENTITY_FILE"
chmod 600 "$DATABASE_IDENTITY_FILE"

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
CLUSTER_SYSTEM_IDENTIFIER_AFTER="$(read_cluster_system_identifier)"
cmp -s "$MIGRATIONS_BEFORE_FILE" "$MIGRATIONS_AFTER_FILE" \
  || fail "Migration identity changed while the backup was being created."
[[ "$CLUSTER_SYSTEM_IDENTIFIER_AFTER" == "$CLUSTER_SYSTEM_IDENTIFIER_BEFORE" ]] \
  || fail "PostgreSQL cluster identity changed while the backup was being created."

info "Encrypting backup with the configured GPG recipient"
[[ ! -e "$ENCRYPTED_BACKUP_FILE" ]] || fail "Encrypted backup output already exists."
GNUPGHOME="$BACKUP_GNUPGHOME" gpg --batch --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
  --output "$ENCRYPTED_BACKUP_FILE" "$PLAINTEXT_BACKUP_FILE"
chmod 600 "$ENCRYPTED_BACKUP_FILE"
rm -f "$PLAINTEXT_BACKUP_FILE"

write_portable_sha256 "$ENCRYPTED_BACKUP_FILE"
chmod 600 "${ENCRYPTED_BACKUP_FILE}.sha256"
METADATA_FILE="$(node infra/scripts/backup-metadata.mjs create \
  "$ENCRYPTED_BACKUP_FILE" \
  "$MIGRATIONS_BEFORE_FILE" \
  "$DATABASE_IDENTITY_FILE" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$BACKUP_SOURCE_SHA" \
  "$BACKUP_GPG_RECIPIENT" \
  "$BACKUP_ENVIRONMENT")"
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
