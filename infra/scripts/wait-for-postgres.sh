#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# shellcheck disable=SC1091
source "$ROOT_DIR/infra/scripts/load-env.sh"

# ---------------------------------------------------------------------------
# Reserva 1 — revisión independiente CVE-2026-14456 (2026-10-05)
#
# Hallazgo original: este script hacía `docker compose up -d postgres` SIN
# proyecto/archivo compose dedicado, reutilizando el docker-compose.yml
# principal cuyo servicio "postgres" está hardcodeado a
# 127.0.0.1:5432:5432 — el mismo puerto host que usa el contenedor operativo
# real (p.ej. inventario-postgres-1). Si ese contenedor no estuviera
# corriendo, este script levantaría silenciosamente un Postgres nuevo en el
# puerto compartido. Además nunca llamaba a assert_test_database_url()
# (definida en load-env.sh) antes de mutar nada.
#
# Esta versión FAIL-CLOSED antes de tocar Docker:
#   1) Valida que el DATABASE_URL de destino sea inequívocamente de pruebas
#      (assert_test_database_url: nombre termina en _test y no coincide con
#      la URL operativa).
#   2) Valida que el puerto de destino NO sea el puerto operativo real,
#      leído dinámicamente del docker-compose.yml principal (nunca un
#      literal hardcodeado que pueda quedar desactualizado).
#   3) Usa un proyecto Docker Compose explícito y un archivo compose
#      DEDICADO a pruebas (infra/scripts/docker-compose.test-postgres.yml),
#      jamás el docker-compose.yml operativo.
# Si cualquiera de estas validaciones falla, el script aborta con código de
# salida distinto de 0 ANTES de ejecutar `docker compose up` o cualquier
# conexión real a Postgres.
# ---------------------------------------------------------------------------

fail() {
  echo "wait-for-postgres: $1" >&2
  exit 1
}

# --- 1) Destino inequívocamente de pruebas (se ejecuta ANTES de Docker). ---
if ! assert_test_database_url "$DATABASE_URL"; then
  fail "assert_test_database_url rechazó el DATABASE_URL de destino. Abortando antes de invocar Docker."
fi

# --- Parseo del DATABASE_URL ya validado (sin conectar aún). ---
database_url_no_query="${DATABASE_URL%%\?*}"
database_name="${database_url_no_query##*/}"
authority="${database_url_no_query#*://}"
authority="${authority%%/*}"
hostport="${authority##*@}"
if [[ "$hostport" == *:* ]]; then
  database_port="${hostport##*:}"
  database_host="${hostport%:*}"
else
  database_port="5432"
  database_host="$hostport"
fi

[[ -n "$database_port" ]] || fail "No se pudo determinar el puerto desde DATABASE_URL. Configuración incompleta. Abortando."
[[ "$database_host" == "127.0.0.1" || "$database_host" == "localhost" ]] \
  || fail "DATABASE_URL apunta a un host no local ($database_host). Este harness solo opera contra Postgres local aislado. Abortando."

# --- 2) El puerto de destino nunca puede ser el puerto operativo real. ---
# Se lee dinámicamente del docker-compose.yml principal (nunca un literal
# hardcodeado) para no quedar desactualizado si el compose operativo cambia.
operational_postgres_port() {
  awk '
    /^  postgres:/ { in_pg=1; next }
    in_pg && /^  [A-Za-z]/ { exit }
    in_pg && /^[[:space:]]*- "?127\.0\.0\.1:[0-9]+:[0-9]+"?/ {
      line=$0
      sub(/^[[:space:]]*-[[:space:]]*"?/, "", line)
      sub(/"?[[:space:]]*$/, "", line)
      split(line, parts, ":")
      print parts[2]
      exit
    }
  ' "$ROOT_DIR/docker-compose.yml"
}

OPERATIONAL_PORT="$(operational_postgres_port)"
[[ -n "$OPERATIONAL_PORT" ]] || fail "No se pudo determinar el puerto operativo desde docker-compose.yml. Abortando por seguridad."

if [[ "$database_port" == "$OPERATIONAL_PORT" ]]; then
  fail "El puerto de destino ($database_port) coincide con el puerto operativo real ($OPERATIONAL_PORT, ver docker-compose.yml). Define TEST_DATABASE_URL con un puerto distinto antes de ejecutar pruebas. Abortando antes de Docker."
fi

# --- 3) Proyecto Compose explícito y archivo compose DEDICADO a pruebas. ---
TEST_HARNESS_COMPOSE_PROJECT="${TEST_HARNESS_COMPOSE_PROJECT:-inventario-legacy-test-harness}"
TEST_HARNESS_COMPOSE_FILE="$ROOT_DIR/infra/scripts/docker-compose.test-postgres.yml"

[[ -f "$TEST_HARNESS_COMPOSE_FILE" ]] \
  || fail "Archivo compose dedicado a pruebas no encontrado: $TEST_HARNESS_COMPOSE_FILE"
[[ "$TEST_HARNESS_COMPOSE_PROJECT" == *test-harness* ]] \
  || fail "TEST_HARNESS_COMPOSE_PROJECT ('$TEST_HARNESS_COMPOSE_PROJECT') debe ser un proyecto explícitamente dedicado a pruebas (debe contener 'test-harness'). Abortando."

export TEST_HARNESS_POSTGRES_PORT="$database_port"

compose_test() {
  docker compose -p "$TEST_HARNESS_COMPOSE_PROJECT" -f "$TEST_HARNESS_COMPOSE_FILE" "$@"
}

compose_test up -d postgres >/dev/null

for attempt in {1..30}; do
  if compose_test exec -T postgres pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    compose_test exec -T postgres psql -U postgres -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '${database_name}'" \
      | grep -q 1 || compose_test exec -T postgres psql -U postgres -d postgres -c "CREATE DATABASE \"${database_name}\"" >/dev/null
    exit 0
  fi

  sleep 2
done

fail "PostgreSQL (harness de pruebas aislado, proyecto '$TEST_HARNESS_COMPOSE_PROJECT', puerto $database_port) no se volvió disponible a tiempo."
