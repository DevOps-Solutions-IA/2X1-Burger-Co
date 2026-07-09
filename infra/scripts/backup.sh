#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"
load_runtime_env

POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-14}"
DATABASE_URL_RUNTIME="${DATABASE_URL:-}"

[[ -n "$DATABASE_URL_RUNTIME" ]] || fail "DATABASE_URL is required."

DB_NAME="$(parse_database_url_field database "$DATABASE_URL_RUNTIME")"
DB_USER="$(parse_database_url_field username "$DATABASE_URL_RUNTIME")"
DB_PASSWORD="$(parse_database_url_field password "$DATABASE_URL_RUNTIME")"

ensure_compose_service "$POSTGRES_SERVICE"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_BASE="backup-${DB_NAME}-${TIMESTAMP}"
BACKUP_FILE="$BACKUP_DIR/${BACKUP_BASE}.dump"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

info "Creating PostgreSQL custom-format backup for ${DB_NAME}"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  pg_dump \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges >"$BACKUP_FILE"

# Cifrado opcional con GPG
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  info "Cifrando backup con GPG para recipient: $BACKUP_GPG_RECIPIENT"
  if command -v gpg &>/dev/null; then
    gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" \
      --output "${BACKUP_FILE}.gpg" "$BACKUP_FILE" && \
    rm -f "$BACKUP_FILE" && \
    BACKUP_FILE="${BACKUP_FILE}.gpg" && \
    info "Backup cifrado correctamente: $BACKUP_FILE"
  else
    warn "gpg no esta instalado. El backup NO esta cifrado."
  fi
else
  warn "BACKUP_GPG_RECIPIENT no definido. El backup NO esta cifrado. Defina esta variable para cifrar con GPG."
fi

sha256sum "$BACKUP_FILE" >"${BACKUP_FILE}.sha256"
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
