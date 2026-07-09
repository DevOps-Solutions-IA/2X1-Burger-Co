#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"

ENV_FILE="${1:-$ROOT_DIR/.env}"
load_runtime_env "$ENV_FILE"

SERVER_NAME="${DOMAIN:-_}"
# Validacion estricta de dominio para prevenir template injection en nginx
if [[ "$SERVER_NAME" != "_" ]]; then
  if [[ ! "$SERVER_NAME" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$ ]]; then
    fail "Nombre de dominio invalido: $SERVER_NAME"
  fi
fi

GENERATED_DIR="$ROOT_DIR/infra/nginx/generated"
HTTP_TEMPLATE="$ROOT_DIR/infra/nginx/templates/http.conf.template"
HTTPS_TEMPLATE="$ROOT_DIR/infra/nginx/templates/https.conf.template"
OUTPUT_FILE="$GENERATED_DIR/default.conf"
CERT_PATH="$ROOT_DIR/infra/nginx/certs/live/${SERVER_NAME}/fullchain.pem"

mkdir -p "$GENERATED_DIR" "$ROOT_DIR/infra/nginx/acme" "$ROOT_DIR/infra/nginx/certs"

TEMPLATE_FILE="$HTTP_TEMPLATE"
if [[ "${ENABLE_HTTPS:-false}" == "true" && "$SERVER_NAME" != "_" && -f "$CERT_PATH" ]]; then
  TEMPLATE_FILE="$HTTPS_TEMPLATE"
fi

# Usar awk con delimitador no especial en vez de sed con '/' como delimitador
awk '{ gsub(/__SERVER_NAME__/, "'"$SERVER_NAME"'"); print }' "$TEMPLATE_FILE" >"$OUTPUT_FILE"
info "Rendered nginx config at $OUTPUT_FILE from $(basename "$TEMPLATE_FILE")"
