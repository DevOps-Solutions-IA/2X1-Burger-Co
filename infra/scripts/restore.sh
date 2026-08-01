#!/usr/bin/env bash
set -euo pipefail
umask 077

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/restore.sh <backup-file.dump.gpg> [--database <name>] [--validate-only]
EOF
}

[[ $# -ge 1 ]] || { usage; exit 1; }

BACKUP_FILE="$1"
shift
TARGET_DATABASE=""
VALIDATE_ONLY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database)
      [[ $# -ge 2 ]] || fail "--database requires a value."
      TARGET_DATABASE="$2"
      shift 2
      ;;
    --validate-only)
      VALIDATE_ONLY="true"
      shift
      ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ -f "$BACKUP_FILE" ]] || fail "Backup file not found."
[[ "$BACKUP_FILE" == *.gpg ]] || fail "Only encrypted .gpg backups are accepted."
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
METADATA_FILE="${BACKUP_FILE}.metadata.json"
METADATA_CHECKSUM_FILE="${METADATA_FILE}.sha256"
[[ -f "$CHECKSUM_FILE" ]] || fail "Backup checksum is required."
[[ -f "$METADATA_FILE" ]] || fail "Backup metadata is required."
[[ -f "$METADATA_CHECKSUM_FILE" ]] || fail "Backup metadata checksum is required."
command -v gpg >/dev/null 2>&1 || fail "gpg is required to restore encrypted backups."

cd "$ROOT_DIR"
load_runtime_env "${RUNTIME_ENV_FILE:-$ROOT_DIR/.env}"

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
DATABASE_URL_RUNTIME="${DATABASE_URL:-}"
[[ -n "$DATABASE_URL_RUNTIME" ]] || fail "DATABASE_URL is required."

PRODUCTION_DB="$(parse_database_url_field database "$DATABASE_URL_RUNTIME")"
DB_USER="$(parse_database_url_field username "$DATABASE_URL_RUNTIME")"
DB_PASSWORD="$(parse_database_url_field password "$DATABASE_URL_RUNTIME")"
validate_db_name "$PRODUCTION_DB"

if [[ "$VALIDATE_ONLY" == "true" && -n "$TARGET_DATABASE" ]]; then
  fail "--database cannot be combined with --validate-only."
fi

DB_NAME="${TARGET_DATABASE:-$PRODUCTION_DB}"
validate_db_name "$DB_NAME"

VALIDATION_PREFIX="${PRODUCTION_DB:0:24}_restore_validation"
VALIDATION_DB="${VALIDATION_PREFIX}_$(date +%s)_$$_${RANDOM}"
validate_db_name "$VALIDATION_DB"
assert_validation_database_safe "$PRODUCTION_DB" "$VALIDATION_DB"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/inventory-restore.XXXXXX")"
DECRYPTED_BACKUP_FILE="$TEMP_DIR/backup.dump"
APPLIED_MIGRATIONS_FILE="$TEMP_DIR/applied-migrations.txt"
CONTAINER_BACKUP_PATH="/tmp/inventory-restore-$$_${RANDOM}.dump"
VALIDATION_DB_CREATED="false"

ensure_compose_service "$POSTGRES_SERVICE"

cleanup_restore_validation() {
  local exit_status=$?
  trap - EXIT INT TERM HUP
  set +e
  if [[ "$VALIDATION_DB_CREATED" == "true" ]]; then
    docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
      dropdb --username "$DB_USER" --if-exists --force "$VALIDATION_DB" >/dev/null 2>&1
  fi
  docker compose exec -T "$POSTGRES_SERVICE" rm -f "$CONTAINER_BACKUP_PATH" >/dev/null 2>&1
  find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type f -delete >/dev/null 2>&1
  rmdir "$TEMP_DIR" >/dev/null 2>&1
  exit "$exit_status"
}

trap cleanup_restore_validation EXIT
trap 'exit 130' INT TERM HUP

info "Validating encrypted backup and metadata checksums"
verify_sha256_file "$BACKUP_FILE" "$CHECKSUM_FILE"
verify_sha256_file "$METADATA_FILE" "$METADATA_CHECKSUM_FILE"
IFS=$'\t' read -r EXPECTED_MIGRATION_COUNT EXPECTED_MIGRATION_DIGEST \
  < <(node infra/scripts/backup-metadata.mjs verify "$BACKUP_FILE" "$METADATA_FILE")

[[ ! -e "$DECRYPTED_BACKUP_FILE" ]] || fail "Temporary decrypted output already exists."
info "Decrypting backup into a unique protected temporary path"
gpg --batch --quiet --decrypt --output "$DECRYPTED_BACKUP_FILE" "$BACKUP_FILE"
chmod 600 "$DECRYPTED_BACKUP_FILE"
docker compose cp "$DECRYPTED_BACKUP_FILE" "${POSTGRES_SERVICE}:${CONTAINER_BACKUP_PATH}" >/dev/null

info "Validating backup archive structure"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_restore --list "$CONTAINER_BACKUP_PATH" >/dev/null

VALIDATION_DB_EXISTS="$(docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  psql --username "$DB_USER" --dbname postgres --tuples-only --no-align \
  --set=validation_db="$VALIDATION_DB" \
  --command "SELECT count(*) FROM pg_database WHERE datname = :'validation_db';")"
[[ "$VALIDATION_DB_EXISTS" == "0" ]] || fail "Generated validation database already exists."

info "Creating isolated validation database"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  createdb --username "$DB_USER" "$VALIDATION_DB"
VALIDATION_DB_CREATED="true"

info "Restoring encrypted backup into the isolated validation database"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_restore \
    --username "$DB_USER" \
    --dbname "$VALIDATION_DB" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges "$CONTAINER_BACKUP_PATH" >/dev/null

docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  psql --username "$DB_USER" --dbname "$VALIDATION_DB" --tuples-only --no-align \
  --command 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;' \
  | sed '/^[[:space:]]*$/d' | sort >"$APPLIED_MIGRATIONS_FILE"

RESTORED_MIGRATION_COUNT="$(wc -l <"$APPLIED_MIGRATIONS_FILE" | tr -d ' ')"
RESTORED_MIGRATION_DIGEST="$(sha256sum "$APPLIED_MIGRATIONS_FILE" | awk '{print $1}')"
[[ "$RESTORED_MIGRATION_COUNT" == "$EXPECTED_MIGRATION_COUNT" ]] \
  || fail "Restored migration count does not match backup creation metadata."
[[ "$RESTORED_MIGRATION_DIGEST" == "$EXPECTED_MIGRATION_DIGEST" ]] \
  || fail "Restored migration identity does not match backup creation metadata."

CRITICAL_TABLES_PRESENT="$(docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  psql --username "$DB_USER" --dbname "$VALIDATION_DB" --tuples-only --no-align \
  --command "SELECT count(*) FROM unnest(ARRAY['users','sales','cash_sessions','order_tickets','inventory_movements','audit_logs']) AS required_table WHERE to_regclass('public.' || required_table) IS NOT NULL;")"
[[ "$CRITICAL_TABLES_PRESENT" == "6" ]] || fail "Restored database is missing critical application tables."

info "Validation restore succeeded with ${RESTORED_MIGRATION_COUNT} recorded migrations"

if [[ "$VALIDATE_ONLY" == "true" ]]; then
  info "Validation-only mode completed"
  exit 0
fi

[[ "${FORCE_RESTORE:-false}" == "true" ]] || fail "FORCE_RESTORE=true is required for a target restore."

if [[ "${SKIP_BACKUP_BEFORE_RESTORE:-false}" != "true" ]]; then
  TARGET_EXISTS="$(docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
    psql --username "$DB_USER" --dbname postgres --tuples-only --no-align \
    --set=target_db="$DB_NAME" \
    --command "SELECT count(*) FROM pg_database WHERE datname = :'target_db';")"
  if [[ "$TARGET_EXISTS" == "1" ]]; then
    info "Creating a safety backup of the target database before restore"
    TARGET_DATABASE_URL="$(database_url_for_database "$DATABASE_URL_RUNTIME" "$DB_NAME")"
    BACKUP_DATABASE_URL="$TARGET_DATABASE_URL" ./infra/scripts/backup.sh >/dev/null
  fi
else
  warn "Target restore requested without a safety backup."
fi

info "Restoring backup into the explicitly authorized target database"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  dropdb --username "$DB_USER" --if-exists --force "$DB_NAME"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  createdb --username "$DB_USER" "$DB_NAME"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_restore \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges "$CONTAINER_BACKUP_PATH" >/dev/null

info "Restore completed successfully"
