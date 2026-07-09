#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

cd "$ROOT_DIR"
load_runtime_env

DOMAIN_VALUE="${DOMAIN:-}"
SSL_EMAIL_VALUE="${SSL_EMAIL:-}"

[[ -n "$DOMAIN_VALUE" ]] || fail "DOMAIN is required in .env"
[[ -n "$SSL_EMAIL_VALUE" ]] || fail "SSL_EMAIL is required in .env"

mkdir -p infra/nginx/acme infra/nginx/certs infra/nginx/generated

ENABLE_HTTPS=false "$ROOT_DIR/infra/scripts/render-nginx-conf.sh" "$ROOT_DIR/.env"
docker compose up -d nginx

info "Requesting Let's Encrypt certificate for $DOMAIN_VALUE"
docker run --rm \
  -v "$ROOT_DIR/infra/nginx/certs:/etc/letsencrypt" \
  -v "$ROOT_DIR/infra/nginx/acme:/var/www/certbot" \
  certbot/certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$SSL_EMAIL_VALUE" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  -d "$DOMAIN_VALUE"

ENABLE_HTTPS=true "$ROOT_DIR/infra/scripts/render-nginx-conf.sh" "$ROOT_DIR/.env"
docker compose up -d nginx
info "HTTPS provisioned for $DOMAIN_VALUE"

# Configurar renovacion automatica de certificados via cron
setup_cert_renewal() {
  local cron_job="0 3 * * * docker run --rm \\
  -v $ROOT_DIR/infra/nginx/certs:/etc/letsencrypt \\
  -v $ROOT_DIR/infra/nginx/acme:/var/www/certbot \\
  certbot/certbot renew --quiet --no-self-upgrade && \\
  cd $ROOT_DIR && ENABLE_HTTPS=true $ROOT_DIR/infra/scripts/render-nginx-conf.sh $ROOT_DIR/.env && \\
  docker compose exec nginx nginx -s reload >/dev/null 2>&1"

  if command -v crontab &>/dev/null; then
    local existing_cron
    existing_cron="$(crontab -l 2>/dev/null || true)"
    if ! echo "$existing_cron" | grep -q "certbot renew"; then
      (echo "$existing_cron"; echo "$cron_job") | crontab -
      info "Cron job de renovacion de certificados instalado (diario a las 3:00 AM)"
    else
      info "Cron job de renovacion de certificados ya existe"
    fi
  else
    warn "crontab no disponible. Instale cron manualmente o ejecute certbot renew periodicamente."
    info "Comando de renovacion manual:"
    info "  docker run --rm -v $ROOT_DIR/infra/nginx/certs:/etc/letsencrypt -v $ROOT_DIR/infra/nginx/acme:/var/www/certbot certbot/certbot renew"
    info "  cd $ROOT_DIR && ENABLE_HTTPS=true infra/scripts/render-nginx-conf.sh .env && docker compose exec nginx nginx -s reload"
  fi
}

setup_cert_renewal
