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

ensure_compose_service() {
  local service_name="$1"
  docker compose ps "$service_name" >/dev/null 2>&1 || fail "Docker Compose service '$service_name' is not available."
}
