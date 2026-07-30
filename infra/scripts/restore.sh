#!/usr/bin/env bash
set -euo pipefail
umask 077

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/restore.sh <backup-file.dump.gpg> [--database <name>] [--validate-only]
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

BACKUP_FILE="$1"
shift || true

TARGET_DATABASE=""
VALIDATE_ONLY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database)
      TARGET_DATABASE="${2:-}"
      shift 2
      ;;
    --validate-only)
      VALIDATE_ONLY="true"
      shift
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ -f "$BACKUP_FILE" ]] || fail "Backup file not found: $BACKUP_FILE"
[[ "$BACKUP_FILE" == *.gpg ]] || fail "Only encrypted .gpg backups are accepted."
[[ -f "${BACKUP_FILE}.sha256" ]] || fail "Backup checksum is required: ${BACKUP_FILE}.sha256"
command -v gpg >/dev/null 2>&1 || fail "gpg is required to restore encrypted backups."

cd "$ROOT_DIR"
load_runtime_env

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
DATABASE_URL_RUNTIME="${DATABASE_URL:-}"
[[ -n "$DATABASE_URL_RUNTIME" ]] || fail "DATABASE_URL is required."

# Validacion estricta de nombre de base de datos para prevenir SQL injection
validate_db_name() {
  local name="$1"
  if [[ ! "$name" =~ ^[a-zA-Z_][a-zA-Z0-9_]+$ ]]; then
    fail "Nombre de base de datos invalido (debe ser solo letras, numeros y underscore): $name"
  fi
}

DB_NAME="${TARGET_DATABASE:-$(parse_database_url_field database "$DATABASE_URL_RUNTIME")}"
validate_db_name "$DB_NAME"
DB_USER="$(parse_database_url_field username "$DATABASE_URL_RUNTIME")"
DB_PASSWORD="$(parse_database_url_field password "$DATABASE_URL_RUNTIME")"
VALIDATION_DB="${DB_NAME}_restore_validation_$(date +%s)"
validate_db_name "$VALIDATION_DB"
DECRYPTED_BACKUP_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-restore.XXXXXX.dump")"
EXPECTED_MIGRATIONS_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-expected-migrations.XXXXXX")"
APPLIED_MIGRATIONS_FILE="$(mktemp "${TMPDIR:-/tmp}/inventory-applied-migrations.XXXXXX")"
chmod 600 "$DECRYPTED_BACKUP_FILE"
CONTAINER_BACKUP_PATH="/tmp/$(basename "$DECRYPTED_BACKUP_FILE")"

ensure_compose_service "$POSTGRES_SERVICE"
cleanup_validation_db() {
  docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
    psql --username "$DB_USER" --dbname postgres \
    -v vdb="$VALIDATION_DB" \
    --command "DROP DATABASE IF EXISTS :\"vdb\";" >/dev/null 2>&1 || true
  docker compose exec -T "$POSTGRES_SERVICE" rm -f "$CONTAINER_BACKUP_PATH" >/dev/null 2>&1 || true
  rm -f "$DECRYPTED_BACKUP_FILE" "$EXPECTED_MIGRATIONS_FILE" "$APPLIED_MIGRATIONS_FILE"
}
trap cleanup_validation_db EXIT

info "Validating encrypted backup checksum"
verify_sha256_file "$BACKUP_FILE"

info "Decrypting backup into a protected temporary file"
gpg --batch --quiet --decrypt --output "$DECRYPTED_BACKUP_FILE" "$BACKUP_FILE"
docker compose cp "$DECRYPTED_BACKUP_FILE" "${POSTGRES_SERVICE}:${CONTAINER_BACKUP_PATH}" >/dev/null

info "Validating backup archive structure"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_restore --list "$CONTAINER_BACKUP_PATH" >/dev/null

info "Restoring backup into validation database $VALIDATION_DB"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  psql --username "$DB_USER" --dbname postgres \
  -v vdb="$VALIDATION_DB" >/dev/null <<SQL
DROP DATABASE IF EXISTS :"vdb";
CREATE DATABASE :"vdb";
SQL

docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_restore \
    --username "$DB_USER" \
    --dbname "$VALIDATION_DB" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges "$CONTAINER_BACKUP_PATH" >/dev/null

find prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort >"$EXPECTED_MIGRATIONS_FILE"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  psql --username "$DB_USER" --dbname "$VALIDATION_DB" --tuples-only --no-align \
  --command 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;' \
  >"$APPLIED_MIGRATIONS_FILE"
diff -u "$EXPECTED_MIGRATIONS_FILE" "$APPLIED_MIGRATIONS_FILE" >/dev/null \
  || fail "Restored schema migrations do not match the release source."

CRITICAL_TABLES_PRESENT="$(docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  psql --username "$DB_USER" --dbname "$VALIDATION_DB" --tuples-only --no-align \
  --command "SELECT count(*) FROM unnest(ARRAY['users','sales','cash_sessions','order_tickets','inventory_movements','audit_logs']) AS required_table WHERE to_regclass('public.' || required_table) IS NOT NULL;")"
[[ "$CRITICAL_TABLES_PRESENT" == "6" ]] || fail "Restored database is missing critical application tables."

info "Validation restore succeeded"

if [[ "$VALIDATE_ONLY" == "true" ]]; then
  info "Validation-only mode completed"
  exit 0
fi

[[ "${FORCE_RESTORE:-false}" == "true" ]] || fail "Set FORCE_RESTORE=true to restore into ${DB_NAME}."

if [[ "${SKIP_BACKUP_BEFORE_RESTORE:-false}" != "true" ]]; then
  TARGET_EXISTS="$(docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
    psql --username "$DB_USER" --dbname postgres --tuples-only --no-align \
    -v target_db="$DB_NAME" --command "SELECT count(*) FROM pg_database WHERE datname = :'target_db';")"
  if [[ "$TARGET_EXISTS" == "1" ]]; then
    info "Creating safety backup of the exact target database before destructive restore"
    TARGET_DATABASE_URL="$(database_url_for_database "$DATABASE_URL_RUNTIME" "$DB_NAME")"
    BACKUP_DATABASE_URL="$TARGET_DATABASE_URL" ./infra/scripts/backup.sh >/dev/null
  fi
else
  warn "Restore sin backup previo por SKIP_BACKUP_BEFORE_RESTORE=true"
fi

info "Restoring backup into target database $DB_NAME"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  psql --username "$DB_USER" --dbname postgres \
  -v target_db="$DB_NAME" <<SQL >/dev/null
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'target_db'
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS :"target_db";
CREATE DATABASE :"target_db";
SQL

docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_restore \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges "$CONTAINER_BACKUP_PATH" >/dev/null

info "Restore completed successfully"
