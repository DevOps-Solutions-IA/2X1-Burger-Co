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
BACKUP_SIGNATURE_FILE="${BACKUP_FILE}.sig"
METADATA_SIGNATURE_FILE="${METADATA_FILE}.sig"
[[ -f "$CHECKSUM_FILE" ]] || fail "Backup checksum is required."
[[ -f "$METADATA_FILE" ]] || fail "Backup metadata is required."
[[ -f "$METADATA_CHECKSUM_FILE" ]] || fail "Backup metadata checksum is required."
command -v gpg >/dev/null 2>&1 || fail "gpg is required to restore encrypted backups."

cd "$ROOT_DIR"

# Runtime files provide defaults only. A caller's release controls remain
# authoritative even if the selected .env contains conflicting values.
declare -A CALLER_ENV_VALUES=()
declare -A CALLER_ENV_PRESENT=()
for protected_name in \
  DATABASE_URL POSTGRES_SERVICE REQUIRE_BACKUP_METADATA_V2 EXPECTED_BACKUP_SOURCE_SHA \
  EXPECTED_SOURCE_SHA EXPECTED_BACKUP_RECIPIENT_FINGERPRINT EXPECTED_BACKUP_SIGNING_FINGERPRINT \
  EXPECTED_BACKUP_ENVIRONMENT EXPECTED_BACKUP_DATABASE_IDENTITY_HASH GNUPGHOME \
  BACKUP_SIGNING_GNUPGHOME FORCE_RESTORE SKIP_BACKUP_BEFORE_RESTORE NODE_ENV; do
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
DATABASE_URL_RUNTIME="${DATABASE_URL:-}"
REQUIRE_BACKUP_METADATA_V2="${REQUIRE_BACKUP_METADATA_V2:-false}"
EXPECTED_BACKUP_SOURCE_SHA="${EXPECTED_BACKUP_SOURCE_SHA:-${EXPECTED_SOURCE_SHA:-}}"
EXPECTED_BACKUP_RECIPIENT_FINGERPRINT="${EXPECTED_BACKUP_RECIPIENT_FINGERPRINT:-}"
EXPECTED_BACKUP_SIGNING_FINGERPRINT="${EXPECTED_BACKUP_SIGNING_FINGERPRINT:-}"
EXPECTED_BACKUP_ENVIRONMENT="${EXPECTED_BACKUP_ENVIRONMENT:-}"
EXPECTED_BACKUP_DATABASE_IDENTITY_HASH="${EXPECTED_BACKUP_DATABASE_IDENTITY_HASH:-}"
RESTORE_GNUPGHOME="${GNUPGHOME:-}"
BACKUP_SIGNING_GNUPGHOME="${BACKUP_SIGNING_GNUPGHOME:-}"
[[ -n "$DATABASE_URL_RUNTIME" ]] || fail "DATABASE_URL is required."
[[ "$REQUIRE_BACKUP_METADATA_V2" == "true" || "$REQUIRE_BACKUP_METADATA_V2" == "false" ]] \
  || fail "REQUIRE_BACKUP_METADATA_V2 must be true or false."

if [[ -n "$EXPECTED_BACKUP_SOURCE_SHA" && ! "$EXPECTED_BACKUP_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  fail "EXPECTED_BACKUP_SOURCE_SHA must be a full 40-character source SHA."
fi
if [[ -n "$EXPECTED_BACKUP_RECIPIENT_FINGERPRINT" && ! "$EXPECTED_BACKUP_RECIPIENT_FINGERPRINT" =~ ^[A-F0-9]{40}$ ]]; then
  fail "EXPECTED_BACKUP_RECIPIENT_FINGERPRINT must be a full uppercase fingerprint."
fi
if [[ -n "$EXPECTED_BACKUP_SIGNING_FINGERPRINT" && ! "$EXPECTED_BACKUP_SIGNING_FINGERPRINT" =~ ^[A-F0-9]{40}$ ]]; then
  fail "EXPECTED_BACKUP_SIGNING_FINGERPRINT must be a full uppercase fingerprint."
fi
if [[ -n "$EXPECTED_BACKUP_ENVIRONMENT" && ! "$EXPECTED_BACKUP_ENVIRONMENT" =~ ^[a-z][a-z0-9_-]{1,31}$ ]]; then
  fail "EXPECTED_BACKUP_ENVIRONMENT has an invalid format."
fi
if [[ -n "$EXPECTED_BACKUP_DATABASE_IDENTITY_HASH" && ! "$EXPECTED_BACKUP_DATABASE_IDENTITY_HASH" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  fail "EXPECTED_BACKUP_DATABASE_IDENTITY_HASH has an invalid format."
fi

REQUIRED_METADATA_VERSION=""
if [[ "$REQUIRE_BACKUP_METADATA_V2" == "true" ]]; then
  [[ -n "$EXPECTED_BACKUP_SOURCE_SHA" ]] || fail "EXPECTED_BACKUP_SOURCE_SHA is required for metadata v2 release validation."
  [[ -n "$EXPECTED_BACKUP_RECIPIENT_FINGERPRINT" ]] \
    || fail "EXPECTED_BACKUP_RECIPIENT_FINGERPRINT is required for metadata v2 release validation."
  [[ -n "$EXPECTED_BACKUP_SIGNING_FINGERPRINT" ]] \
    || fail "EXPECTED_BACKUP_SIGNING_FINGERPRINT is required for metadata v2 release validation."
  [[ -n "$EXPECTED_BACKUP_ENVIRONMENT" ]] || fail "EXPECTED_BACKUP_ENVIRONMENT is required for metadata v2 release validation."
  [[ -n "$EXPECTED_BACKUP_DATABASE_IDENTITY_HASH" ]] \
    || fail "EXPECTED_BACKUP_DATABASE_IDENTITY_HASH is required for metadata v2 release validation."
  [[ -n "$RESTORE_GNUPGHOME" && "$RESTORE_GNUPGHOME" == /* && -d "$RESTORE_GNUPGHOME" ]] \
    || fail "GNUPGHOME must explicitly reference an existing absolute directory for metadata v2 release validation."
  [[ "$(stat -c '%a' "$RESTORE_GNUPGHOME")" == "700" ]] || fail "GNUPGHOME must have mode 700."
  RESOLVED_SECRET_FINGERPRINT="$(GNUPGHOME="$RESTORE_GNUPGHOME" gpg --batch --with-colons \
    --list-secret-keys -- "$EXPECTED_BACKUP_RECIPIENT_FINGERPRINT" 2>/dev/null \
    | awk -F: '$1 == "fpr" { print $10; exit }')"
  [[ "$RESOLVED_SECRET_FINGERPRINT" == "$EXPECTED_BACKUP_RECIPIENT_FINGERPRINT" ]] \
    || fail "The configured GPG keyring does not contain the exact expected backup secret key."
  REQUIRED_METADATA_VERSION="2"
fi

PRODUCTION_DB="$(parse_database_url_field database "$DATABASE_URL_RUNTIME")"
DB_USER="$(parse_database_url_field username "$DATABASE_URL_RUNTIME")"
DB_PASSWORD="$(parse_database_url_field password "$DATABASE_URL_RUNTIME")"
validate_db_name "$PRODUCTION_DB"

if [[ "$VALIDATE_ONLY" == "true" && -n "$TARGET_DATABASE" ]]; then
  fail "--database cannot be combined with --validate-only."
fi

DB_NAME="${TARGET_DATABASE:-$PRODUCTION_DB}"
validate_db_name "$DB_NAME"

VALIDATION_PREFIX="${PRODUCTION_DB:0:16}_restore_validation"
VALIDATION_DB="${VALIDATION_PREFIX}_$(date +%s)_$$_${RANDOM}"
validate_db_name "$VALIDATION_DB"
assert_validation_database_safe "$PRODUCTION_DB" "$VALIDATION_DB"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/inventory-restore.XXXXXX")"
APPLIED_MIGRATIONS_FILE="$TEMP_DIR/applied-migrations.txt"
VALIDATION_DB_CREATED="false"

ensure_compose_service "$POSTGRES_SERVICE"

database_exists() {
  local database_name="$1"
  validate_db_name "$database_name"
  docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
    psql --username "$DB_USER" --dbname postgres --tuples-only --no-align \
    --command 'SELECT datname FROM pg_database ORDER BY datname;' \
    | awk -v expected="$database_name" '$0 == expected { found = 1 } END { print found ? 1 : 0 }'
}

cleanup_restore_validation() {
  local exit_status=$?
  trap - EXIT INT TERM HUP
  set +e
  if [[ "$VALIDATION_DB_CREATED" == "true" ]]; then
    docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
      dropdb --username "$DB_USER" --if-exists --force "$VALIDATION_DB" >/dev/null 2>&1
  fi
  find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type f -delete >/dev/null 2>&1
  rmdir "$TEMP_DIR" >/dev/null 2>&1
  exit "$exit_status"
}

trap cleanup_restore_validation EXIT
trap 'exit 130' INT TERM HUP

verify_detached_signature() {
  local signature_file="$1"
  local signed_file="$2"
  local signature_status signer_fingerprint
  if ! signature_status="$(GNUPGHOME="$BACKUP_SIGNING_GNUPGHOME" gpg --batch --status-fd 1 \
    --verify "$signature_file" "$signed_file" 2>/dev/null)"; then
    fail "Detached backup signature verification failed."
  fi
  signer_fingerprint="$(awk '$1 == "[GNUPG:]" && $2 == "VALIDSIG" { print $3; exit }' <<<"$signature_status")"
  [[ "$signer_fingerprint" == "$EXPECTED_BACKUP_SIGNING_FINGERPRINT" ]] \
    || fail "Detached backup signature signer does not match the expected custody fingerprint."
}

decrypt_backup_stream() {
  if [[ -n "$RESTORE_GNUPGHOME" ]]; then
    GNUPGHOME="$RESTORE_GNUPGHOME" gpg --quiet --decrypt -- "$BACKUP_FILE"
  else
    gpg --quiet --decrypt -- "$BACKUP_FILE"
  fi
}

METADATA_DECLARED_VERSION="$(node -e '
  const fs = require("node:fs");
  const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (parsed.formatVersion !== 1 && parsed.formatVersion !== 2) process.exit(1);
  process.stdout.write(String(parsed.formatVersion));
' "$METADATA_FILE")" || fail "Backup metadata format is invalid."

SIGNATURE_REQUIRED="false"
if [[ "$REQUIRE_BACKUP_METADATA_V2" == "true" || "$METADATA_DECLARED_VERSION" == "2" ]]; then
  SIGNATURE_REQUIRED="true"
fi
if [[ "$SIGNATURE_REQUIRED" == "true" ]]; then
  [[ -f "$BACKUP_SIGNATURE_FILE" && -f "$METADATA_SIGNATURE_FILE" ]] \
    || fail "Detached signatures are required for metadata v2 release backups."
  [[ -n "$BACKUP_SIGNING_GNUPGHOME" && "$BACKUP_SIGNING_GNUPGHOME" == /* && -d "$BACKUP_SIGNING_GNUPGHOME" ]] \
    || fail "BACKUP_SIGNING_GNUPGHOME must explicitly reference an existing absolute directory."
  [[ "$(stat -c '%a' "$BACKUP_SIGNING_GNUPGHOME")" == "700" ]] \
    || fail "BACKUP_SIGNING_GNUPGHOME must have mode 700."
  [[ -n "$EXPECTED_BACKUP_SIGNING_FINGERPRINT" ]] \
    || fail "EXPECTED_BACKUP_SIGNING_FINGERPRINT is required for signed backup verification."
  RESOLVED_SIGNING_FINGERPRINT="$(GNUPGHOME="$BACKUP_SIGNING_GNUPGHOME" gpg --batch --with-colons \
    --list-keys -- "$EXPECTED_BACKUP_SIGNING_FINGERPRINT" 2>/dev/null \
    | awk -F: '$1 == "fpr" { print $10; exit }')"
  [[ "$RESOLVED_SIGNING_FINGERPRINT" == "$EXPECTED_BACKUP_SIGNING_FINGERPRINT" ]] \
    || fail "The signature keyring does not contain the exact expected signing public key."
  info "Verifying authoritative detached signatures before decryption"
  verify_detached_signature "$BACKUP_SIGNATURE_FILE" "$BACKUP_FILE"
  verify_detached_signature "$METADATA_SIGNATURE_FILE" "$METADATA_FILE"
fi

info "Validating encrypted backup and metadata checksums"
verify_sha256_file "$BACKUP_FILE" "$CHECKSUM_FILE"
verify_sha256_file "$METADATA_FILE" "$METADATA_CHECKSUM_FILE"
IFS=$'\t' read -r EXPECTED_MIGRATION_COUNT EXPECTED_MIGRATION_DIGEST METADATA_FORMAT_VERSION \
  METADATA_SOURCE_SHA METADATA_RECIPIENT_FINGERPRINT METADATA_SIGNING_FINGERPRINT METADATA_ENVIRONMENT \
  METADATA_DATABASE_IDENTITY_HASH \
  < <(node infra/scripts/backup-metadata.mjs verify \
    "$BACKUP_FILE" \
    "$METADATA_FILE" \
    "$EXPECTED_BACKUP_SOURCE_SHA" \
    "$EXPECTED_BACKUP_RECIPIENT_FINGERPRINT" \
    "$EXPECTED_BACKUP_SIGNING_FINGERPRINT" \
    "$EXPECTED_BACKUP_ENVIRONMENT" \
    "$EXPECTED_BACKUP_DATABASE_IDENTITY_HASH" \
    "$REQUIRED_METADATA_VERSION")
[[ "$METADATA_FORMAT_VERSION" == "1" || "$METADATA_FORMAT_VERSION" == "2" ]] \
  || fail "Backup metadata format is invalid."

info "Validating decrypted archive structure through a plaintext-free stream"
decrypt_backup_stream \
  | docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
      pg_restore --list >/dev/null

VALIDATION_DB_EXISTS="$(database_exists "$VALIDATION_DB")"
[[ "$VALIDATION_DB_EXISTS" == "0" ]] || fail "Generated validation database already exists."

info "Creating isolated validation database"
docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
  createdb --username "$DB_USER" "$VALIDATION_DB"
VALIDATION_DB_CREATED="true"

info "Restoring encrypted backup into the isolated validation database"
decrypt_backup_stream \
  | docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
      pg_restore \
        --username "$DB_USER" \
        --dbname "$VALIDATION_DB" \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges >/dev/null

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

if [[ "${NODE_ENV:-}" == "production" && "${SKIP_BACKUP_BEFORE_RESTORE:-false}" == "true" ]]; then
  fail "SKIP_BACKUP_BEFORE_RESTORE is forbidden in production."
fi

if [[ "${SKIP_BACKUP_BEFORE_RESTORE:-false}" != "true" ]]; then
  TARGET_EXISTS="$(database_exists "$DB_NAME")"
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
decrypt_backup_stream \
  | docker compose exec -T "$POSTGRES_SERVICE" env PGPASSWORD="$DB_PASSWORD" \
      pg_restore \
        --username "$DB_USER" \
        --dbname "$DB_NAME" \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges >/dev/null

info "Restore completed successfully"
