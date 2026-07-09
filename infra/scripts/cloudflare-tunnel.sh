#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"
load_runtime_env

COMMAND="${1:-status}"

require_cloudflare_env() {
  [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]] || fail "Missing CLOUDFLARE_TUNNEL_TOKEN in .env"
  [[ -n "${CLOUDFLARE_TUNNEL_HOSTNAME:-}" ]] || fail "Missing CLOUDFLARE_TUNNEL_HOSTNAME in .env"
}

require_local_stack_ready() {
  ensure_compose_service nginx
  ensure_compose_service api
  ensure_compose_service web

  curl -fsS http://127.0.0.1/api/health >/dev/null || fail "Local API health check failed through nginx"
  curl -fsS http://127.0.0.1/login >/dev/null || fail "Local web login check failed through nginx"
  curl -fsS http://127.0.0.1/waiter/login >/dev/null || fail "Local waiter login check failed through nginx"
}

print_status() {
  docker compose ps cloudflared

  if [[ -n "${CLOUDFLARE_TUNNEL_HOSTNAME:-}" ]]; then
    info "Public hostname esperado: https://${CLOUDFLARE_TUNNEL_HOSTNAME}"
  fi
}

case "$COMMAND" in
  start)
    require_cloudflare_env
    docker compose --profile cloudflare up -d cloudflared
    print_status
    ;;
  stop)
    docker compose --profile cloudflare stop cloudflared
    print_status
    ;;
  restart)
    require_cloudflare_env
    docker compose --profile cloudflare up -d --force-recreate cloudflared
    print_status
    ;;
  logs)
    docker compose --profile cloudflare logs -f cloudflared
    ;;
  status)
    print_status
    ;;
  readiness)
    require_local_stack_ready
    info "Stack local listo para túnel persistente."
    if [[ -n "${CLOUDFLARE_TUNNEL_HOSTNAME:-}" ]]; then
      info "Hostname configurado: https://${CLOUDFLARE_TUNNEL_HOSTNAME}"
    else
      warn "Falta CLOUDFLARE_TUNNEL_HOSTNAME para activar un túnel nombrado."
    fi
    if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
      info "Token configurado."
    else
      warn "Falta CLOUDFLARE_TUNNEL_TOKEN para activar un túnel nombrado."
    fi
    ;;
  validate)
    require_cloudflare_env
    require_local_stack_ready
    info "Configuración Cloudflare lista para túnel nombrado."
    info "Hostname: https://${CLOUDFLARE_TUNNEL_HOSTNAME}"
    ;;
  *)
    fail "Uso: $0 {start|stop|restart|logs|status|readiness|validate}"
    ;;
esac
