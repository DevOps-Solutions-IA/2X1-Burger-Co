#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ENV_FILE="$ROOT_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT_DIR/.env.example"
fi

# Parser seguro de KEY=VALUE (NO usar source para evitar shell injection)
load_runtime_env_safe() {
  local env_file="$1"
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

load_runtime_env_safe "$ENV_FILE"

derive_test_database_url() {
  local source_url="$1"
  local base="${source_url%%\?*}"
  local suffix=""
  if [[ "$source_url" == *\?* ]]; then
    suffix="?${source_url#*\?}"
  fi

  local db_name="${base##*/}"
  local prefix="${base%/*}"

  if [[ "$db_name" == *_test ]]; then
    printf '%s%s\n' "$base" "$suffix"
    return
  fi

  printf '%s/%s_test%s\n' "$prefix" "$db_name" "$suffix"
}

DEFAULT_DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/inventory_fastfood_system?schema=public}"
TEST_DATABASE_URL="${TEST_DATABASE_URL:-$(derive_test_database_url "$DEFAULT_DATABASE_URL")}"
APP_DATABASE_URL="$DEFAULT_DATABASE_URL"

assert_test_database_url() {
  local candidate_url="${1:-${DATABASE_URL:-}}"

  if [[ -z "$candidate_url" ]]; then
    echo "DATABASE_URL no está definida para entorno de pruebas." >&2
    return 1
  fi

  local base="${candidate_url%%\?*}"
  local db_name="${base##*/}"

  if [[ "$candidate_url" == "$APP_DATABASE_URL" && "$APP_DATABASE_URL" != "$TEST_DATABASE_URL" ]]; then
    echo "La URL de pruebas coincide con la base operativa. Abortando." >&2
    return 1
  fi

  if [[ "$db_name" != *_test ]]; then
    echo "La base de pruebas debe terminar en _test. Recibido: $db_name" >&2
    return 1
  fi
}

export DATABASE_URL="$TEST_DATABASE_URL"
export APP_DATABASE_URL="$APP_DATABASE_URL"
export TEST_DATABASE_URL="$TEST_DATABASE_URL"
export NODE_ENV="${NODE_ENV:-test}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-test-access-secret-only-for-local-e2e-2026-2x1burger-strong-value}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-test-refresh-secret-only-for-local-e2e-2026-2x1burger-different-strong-value}"
