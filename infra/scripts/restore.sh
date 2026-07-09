#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/restore.sh <backup-file.dump> [--database <name>] [--validate-only]
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
CONTAINER_BACKUP_PATH="/tmp/$(basename "$BACKUP_FILE")"

ensure_compose_service "$POSTGRES_SERVICE"
docker compose cp "$BACKUP_FILE" "${POSTGRES_SERVICE}:${CONTAINER_BACKUP_PATH}" >/dev/null

if [[ -f "${BACKUP_FILE}.sha256" ]]; then
  info "Validating backup checksum"
  sha256sum --check "${BACKUP_FILE}.sha256"
fi

info "Validating backup archive structure"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_restore --list "$CONTAINER_BACKUP_PATH" >/dev/null

cleanup_validation_db() {
  docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
    psql --username "$DB_USER" --dbname postgres \
    -v vdb="$VALIDATION_DB" \
    --command "DROP DATABASE IF EXISTS :\"vdb\";" >/dev/null
  docker compose exec -T "$POSTGRES_SERVICE" rm -f "$CONTAINER_BACKUP_PATH" >/dev/null 2>&1 || true
}

trap cleanup_validation_db EXIT

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

docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  psql --username "$DB_USER" --dbname "$VALIDATION_DB" \
  --command "SELECT COUNT(*) >= 0 FROM information_schema.tables;" >/dev/null

info "Validation restore succeeded"

if [[ "$VALIDATE_ONLY" == "true" ]]; then
  info "Validation-only mode completed"
  exit 0
fi

[[ "${FORCE_RESTORE:-false}" == "true" ]] || fail "Set FORCE_RESTORE=true to restore into ${DB_NAME}."

if [[ "${SKIP_BACKUP_BEFORE_RESTORE:-false}" != "true" ]]; then
  info "Creating safety backup of current database before destructive restore"
  DATABASE_URL="$DATABASE_URL_RUNTIME" ./infra/scripts/backup.sh >/dev/null
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
