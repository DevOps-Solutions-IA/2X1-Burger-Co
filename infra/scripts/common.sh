#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

info() {
  printf '[info] %s\n' "$*"
}

warn() {
  printf '[warn] %s\n' "$*" >&2
}

fail() {
  printf '[error] %s\n' "$*" >&2
  exit 1
}

# Parser seguro de .env (NO usar source para evitar shell injection)
load_runtime_env() {
  local env_file="${1:-$ROOT_DIR/.env}"

  if [[ ! -f "$env_file" ]]; then
    fail "Missing env file: $env_file"
  fi

  while IFS='=' read -r key value; do
    # Ignorar comentarios y lineas vacias
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    # Limpiar key
    key=$(echo "$key" | xargs)
    # Validar key: solo letras, numeros, underscore, empieza con letra o underscore
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "WARNING: omitiendo clave de entorno invalida: $key" >&2
      continue
    fi
    # Limpiar value (quitar espacios y comillas)
    value=$(echo "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    export "$key"="$value"
  done < "$env_file"
}

parse_database_url_field() {
  local field="$1"
  local database_url="$2"

  node -e "
    const databaseUrl = process.argv[1];
    const field = process.argv[2];
    const parsed = new URL(databaseUrl);
    const value =
      field === 'database'
        ? parsed.pathname.replace(/^\\//, '')
        : field === 'hostname'
          ? parsed.hostname
          : field === 'port'
            ? parsed.port || '5432'
            : field === 'username'
              ? decodeURIComponent(parsed.username)
              : field === 'password'
                ? decodeURIComponent(parsed.password)
                : '';
    if (!value) process.exit(1);
    process.stdout.write(String(value));
  " "$database_url" "$field"
}

database_url_for_database() {
  local database_url="$1"
  local database_name="$2"

  [[ "$database_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]+$ ]] || fail "Invalid database name."
  node -e "
    const parsed = new URL(process.argv[1]);
    parsed.pathname = '/' + process.argv[2];
    process.stdout.write(parsed.toString());
  " "$database_url" "$database_name"
}

validate_db_name() {
  local database_name="$1"
  [[ "$database_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]+$ ]] \
    || fail "Invalid database name."
}

assert_validation_database_safe() {
  local production_database="$1"
  local validation_database="$2"

  validate_db_name "$production_database"
  validate_db_name "$validation_database"
  [[ "$validation_database" != "$production_database" ]] \
    || fail "Validation database must not be the production database."
  [[ "$validation_database" == *_restore_validation_* ]] \
    || fail "Validation database must use the protected restore-validation namespace."
}

validate_image_reference() {
  local image_reference="$1"
  [[ "$image_reference" =~ ^[a-z0-9]+([._-][a-z0-9]+)*(:[0-9]+)?(/[a-z0-9]+([._-][a-z0-9]+)*)+@sha256:[a-f0-9]{64}$ ]] \
    || fail "Image reference must be a lowercase registry path pinned by sha256 digest."
}

write_portable_sha256() {
  local file_path="$1"
  local checksum_path="${2:-${file_path}.sha256}"
  local file_directory file_name checksum_name
  file_directory="$(cd "$(dirname "$file_path")" && pwd)"
  file_name="$(basename "$file_path")"
  checksum_name="$(basename "$checksum_path")"
  (cd "$file_directory" && sha256sum "$file_name" >"$checksum_name")
}

verify_sha256_file() {
  local file_path="$1"
  local checksum_path="${2:-${file_path}.sha256}"
  local expected_checksum actual_checksum record_count
  record_count="$(awk 'NF { count += 1 } END { print count + 0 }' "$checksum_path")"
  [[ "$record_count" == "1" ]] || fail "Checksum file must contain exactly one record."
  expected_checksum="$(awk 'NF { print $1 }' "$checksum_path")"
  [[ "$expected_checksum" =~ ^[a-f0-9]{64}$ ]] || fail "Checksum format is invalid."
  actual_checksum="$(sha256sum "$file_path" | awk '{ print $1 }')"
  [[ "$actual_checksum" == "$expected_checksum" ]] || fail "Checksum verification failed."
}

ensure_compose_service() {
  local service_name="$1"
  docker compose ps "$service_name" >/dev/null 2>&1 || fail "Docker Compose service '$service_name' is not available."
}
