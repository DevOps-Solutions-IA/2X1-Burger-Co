#!/usr/bin/env bash
set -euo pipefail
umask 077

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"

# Runtime files provide defaults only. Explicit release controls from the caller
# must not be replaced by a mutable .env file.
declare -A CALLER_ENV_VALUES=()
declare -A CALLER_ENV_PRESENT=()
for protected_name in \
  DATABASE_URL BACKUP_DATABASE_URL POSTGRES_SERVICE BACKUP_DIR BACKUP_RETENTION_DAYS \
  BACKUP_KEEP_COUNT BACKUP_GPG_RECIPIENT BACKUP_SOURCE_SHA BACKUP_ENVIRONMENT GNUPGHOME \
  BACKUP_SIGNING_GNUPGHOME BACKUP_GPG_SIGNING_FINGERPRINT; do
  if [[ -v "$protected_name" ]]; then
    CALLER_ENV_PRESENT["$protected_name"]="true"
    CALLER_ENV_VALUES["$protected_name"]="${!protected_name}"
  fi
done
load_runtime_env "${RUNTIME_ENV_FILE:-$ROOT_DIR/.env}"
for protected_name in "${!CALLER_ENV_PRESENT[@]}"; do
  export "$protected_name=${CALLER_ENV_VALUES[$protected_name]}"
done

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-14}"
DATABASE_URL_RUNTIME="${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
BACKUP_SOURCE_SHA="${BACKUP_SOURCE_SHA:-}"
BACKUP_ENVIRONMENT="${BACKUP_ENVIRONMENT:-}"
BACKUP_GNUPGHOME="${GNUPGHOME:-}"
BACKUP_SIGNING_GNUPGHOME="${BACKUP_SIGNING_GNUPGHOME:-}"
BACKUP_GPG_SIGNING_FINGERPRINT="${BACKUP_GPG_SIGNING_FINGERPRINT:-}"

[[ -n "$DATABASE_URL_RUNTIME" ]] || fail "DATABASE_URL is required."
[[ "$BACKUP_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "BACKUP_SOURCE_SHA must be a full 40-character source SHA."
[[ "$BACKUP_ENVIRONMENT" =~ ^[a-z][a-z0-9_-]{1,31}$ ]] || fail "BACKUP_ENVIRONMENT is required and has an invalid format."
[[ "$BACKUP_GPG_RECIPIENT" =~ ^[A-F0-9]{40}$ ]] || fail "BACKUP_GPG_RECIPIENT must be a full uppercase fingerprint."
[[ -n "$BACKUP_GNUPGHOME" && "$BACKUP_GNUPGHOME" == /* && -d "$BACKUP_GNUPGHOME" ]] \
  || fail "GNUPGHOME must explicitly reference an existing absolute directory."
[[ "$(stat -c '%a' "$BACKUP_GNUPGHOME")" == "700" ]] || fail "GNUPGHOME must have mode 700."
[[ "$BACKUP_GPG_SIGNING_FINGERPRINT" =~ ^[A-F0-9]{40}$ ]] \
  || fail "BACKUP_GPG_SIGNING_FINGERPRINT must be a full uppercase fingerprint."
[[ -n "$BACKUP_SIGNING_GNUPGHOME" && "$BACKUP_SIGNING_GNUPGHOME" == /* && -d "$BACKUP_SIGNING_GNUPGHOME" ]] \
  || fail "BACKUP_SIGNING_GNUPGHOME must explicitly reference an existing absolute directory."
[[ "$(stat -c '%a' "$BACKUP_SIGNING_GNUPGHOME")" == "700" ]] \
  || fail "BACKUP_SIGNING_GNUPGHOME must have mode 700."
command -v gpg >/dev/null 2>&1 || fail "gpg is required for encrypted backups."
command -v flock >/dev/null 2>&1 || fail "flock is required for serialized backups."

RESOLVED_GPG_FINGERPRINT="$(GNUPGHOME="$BACKUP_GNUPGHOME" gpg --batch --with-colons --list-keys -- "$BACKUP_GPG_RECIPIENT" 2>/dev/null \
  | awk -F: '$1 == "fpr" { print $10; exit }')"
[[ "$RESOLVED_GPG_FINGERPRINT" == "$BACKUP_GPG_RECIPIENT" ]] \
  || fail "The configured GPG keyring does not contain the exact backup recipient fingerprint."
RESOLVED_SIGNING_FINGERPRINT="$(GNUPGHOME="$BACKUP_SIGNING_GNUPGHOME" gpg --batch --with-colons \
  --list-secret-keys -- "$BACKUP_GPG_SIGNING_FINGERPRINT" 2>/dev/null \
  | awk -F: '$1 == "fpr" { print $10; exit }')"
[[ "$RESOLVED_SIGNING_FINGERPRINT" == "$BACKUP_GPG_SIGNING_FINGERPRINT" ]] \
  || fail "The signing keyring does not contain the exact backup signing secret key."

DB_NAME="$(parse_database_url_field database "$DATABASE_URL_RUNTIME")"
DB_HOST="$(parse_database_url_field hostname "$DATABASE_URL_RUNTIME")"
DB_PORT="$(parse_database_url_field port "$DATABASE_URL_RUNTIME")"
DB_USER="$(parse_database_url_field username "$DATABASE_URL_RUNTIME")"
DB_PASSWORD="$(parse_database_url_field password "$DATABASE_URL_RUNTIME")"

ensure_compose_service "$POSTGRES_SERVICE"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup-${BACKUP_ENVIRONMENT}.lock"
flock -n 9 || fail "Another backup for this environment is already running."

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_BASE="backup-${BACKUP_ENVIRONMENT}-${TIMESTAMP}"
ENCRYPTED_BACKUP_FILE="$BACKUP_DIR/${BACKUP_BASE}.dump.gpg"
ENCRYPTED_BACKUP_PARTIAL="${ENCRYPTED_BACKUP_FILE}.partial.$$"
BACKUP_SIGNATURE_FILE="${ENCRYPTED_BACKUP_FILE}.sig"
METADATA_FILE="${ENCRYPTED_BACKUP_FILE}.metadata.json"
MIGRATIONS_BEFORE_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-backup-migrations-before.XXXXXX")"
MIGRATIONS_AFTER_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-backup-migrations-after.XXXXXX")"
DATABASE_IDENTITY_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-backup-database-identity.XXXXXX")"
BACKUP_COMPLETED="false"

cleanup_backup() {
  rm -f "$ENCRYPTED_BACKUP_PARTIAL" "$MIGRATIONS_BEFORE_FILE" "$MIGRATIONS_AFTER_FILE" "$DATABASE_IDENTITY_FILE"
  if [[ "$BACKUP_COMPLETED" != "true" ]]; then
    rm -f "$ENCRYPTED_BACKUP_FILE" "${ENCRYPTED_BACKUP_FILE}.sha256" "$BACKUP_SIGNATURE_FILE" \
      "$METADATA_FILE" "${METADATA_FILE}.sha256" "${METADATA_FILE}.sig"
  fi
}
trap cleanup_backup EXIT

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

info "Streaming PostgreSQL custom-format backup directly into GPG encryption for ${DB_NAME}"
[[ ! -e "$ENCRYPTED_BACKUP_FILE" && ! -e "$ENCRYPTED_BACKUP_PARTIAL" ]] \
  || fail "Encrypted backup output already exists."
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_dump \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
  | GNUPGHOME="$BACKUP_GNUPGHOME" gpg --batch --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
      --output "$ENCRYPTED_BACKUP_PARTIAL"
chmod 600 "$ENCRYPTED_BACKUP_PARTIAL"
mv "$ENCRYPTED_BACKUP_PARTIAL" "$ENCRYPTED_BACKUP_FILE"

read_applied_migrations "$MIGRATIONS_AFTER_FILE"
CLUSTER_SYSTEM_IDENTIFIER_AFTER="$(read_cluster_system_identifier)"
cmp -s "$MIGRATIONS_BEFORE_FILE" "$MIGRATIONS_AFTER_FILE" \
  || fail "Migration identity changed while the backup was being created."
[[ "$CLUSTER_SYSTEM_IDENTIFIER_AFTER" == "$CLUSTER_SYSTEM_IDENTIFIER_BEFORE" ]] \
  || fail "PostgreSQL cluster identity changed while the backup was being created."

write_portable_sha256 "$ENCRYPTED_BACKUP_FILE"
chmod 600 "${ENCRYPTED_BACKUP_FILE}.sha256"
CREATED_METADATA_FILE="$(node infra/scripts/backup-metadata.mjs create \
  "$ENCRYPTED_BACKUP_FILE" \
  "$MIGRATIONS_BEFORE_FILE" \
  "$DATABASE_IDENTITY_FILE" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$BACKUP_SOURCE_SHA" \
  "$BACKUP_GPG_RECIPIENT" \
  "$BACKUP_GPG_SIGNING_FINGERPRINT" \
  "$BACKUP_ENVIRONMENT")"
[[ "$CREATED_METADATA_FILE" == "$METADATA_FILE" ]] || fail "Backup metadata path is not canonical."
write_portable_sha256 "$METADATA_FILE"
chmod 600 "$METADATA_FILE" "${METADATA_FILE}.sha256"
info "Signing encrypted backup and metadata with the authoritative custody key"
GNUPGHOME="$BACKUP_SIGNING_GNUPGHOME" gpg --local-user "$BACKUP_GPG_SIGNING_FINGERPRINT" \
  --detach-sign --output "$BACKUP_SIGNATURE_FILE" "$ENCRYPTED_BACKUP_FILE"
GNUPGHOME="$BACKUP_SIGNING_GNUPGHOME" gpg --local-user "$BACKUP_GPG_SIGNING_FINGERPRINT" \
  --detach-sign --output "${METADATA_FILE}.sig" "$METADATA_FILE"
chmod 600 "$BACKUP_SIGNATURE_FILE" "${METADATA_FILE}.sig"
BACKUP_COMPLETED="true"
cleanup_backup
trap - EXIT
info "Backup stored at $ENCRYPTED_BACKUP_FILE"

info "Pruning backups older than ${BACKUP_RETENTION_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.gpg' -o -name '*.sha256' -o -name '*.metadata.json' -o -name '*.sig' \) -mtime +"$BACKUP_RETENTION_DAYS" -delete

mapfile -t backup_files < <(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.gpg' \) | sort -r)
if (( ${#backup_files[@]} > BACKUP_KEEP_COUNT )); then
  for stale_file in "${backup_files[@]:$BACKUP_KEEP_COUNT}"; do
    rm -f "$stale_file" "${stale_file}.sha256" "${stale_file}.sig" \
      "${stale_file}.metadata.json" "${stale_file}.metadata.json.sha256" "${stale_file}.metadata.json.sig"
  done
fi

info "Backup routine completed"
