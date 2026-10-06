#!/usr/bin/env bash
#
# Pruebas de infra/scripts/wait-for-postgres.sh — Reserva 1 de la revisión
# independiente de CVE-2026-14456 (2026-10-05): aislamiento del harness de
# pruebas y rechazo temprano (fail-closed) de destinos no-de-prueba.
#
# Cada caso corre dentro de un "sandbox" descartable (symlinks a los scripts
# reales + un .env propio y aislado), de forma que NUNCA se toca ni se lee
# el .env real del repo ni ningún contenedor/volumen operativo.
#
#   Caso 1 (negativo, mock de docker): DATABASE_URL cuyo nombre de base no
#     termina en _test -> debe rechazar ANTES de invocar `docker compose`.
#   Caso 2 (negativo, mock de docker): DATABASE_URL de prueba bien formado
#     (_test) pero cuyo puerto coincide con el puerto operativo real leído
#     de docker-compose.yml (5432) -> debe rechazar ANTES de invocar
#     `docker compose`.
#   Caso 3 (positivo, Docker real, recursos 100% descartables): DATABASE_URL
#     de prueba válido y en un puerto no estándar -> el script SÍ levanta un
#     Postgres aislado, crea la base, y lo limpiamos al final.
#
# Ninguno de estos casos ejecuta reset/DROP contra una base de datos real,
# y el caso positivo se destruye (`docker compose down -v`) al terminar.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REAL_SCRIPT="$ROOT_DIR/infra/scripts/wait-for-postgres.sh"
REAL_LOAD_ENV="$ROOT_DIR/infra/scripts/load-env.sh"
REAL_COMPOSE_FILE="$ROOT_DIR/infra/scripts/docker-compose.test-postgres.yml"
REAL_DOCKER_COMPOSE_YML="$ROOT_DIR/docker-compose.yml"

pass=0
fail=0

note_pass() { echo "PASS: $1"; pass=$((pass + 1)); }
note_fail() { echo "FAIL: $1"; fail=$((fail + 1)); }

make_sandbox() {
  local sandbox="$1"
  rm -rf "$sandbox"
  mkdir -p "$sandbox/infra/scripts"
  ln -s "$REAL_DOCKER_COMPOSE_YML" "$sandbox/docker-compose.yml"
  ln -s "$REAL_SCRIPT" "$sandbox/infra/scripts/wait-for-postgres.sh"
  ln -s "$REAL_LOAD_ENV" "$sandbox/infra/scripts/load-env.sh"
  ln -s "$REAL_COMPOSE_FILE" "$sandbox/infra/scripts/docker-compose.test-postgres.yml"
}

WORK_DIR="$(mktemp -d)"
cleanup_tmp() { rm -rf "$WORK_DIR"; }
trap cleanup_tmp EXIT

# ---------------------------------------------------------------------------
# Caso 1 y 2: mock de `docker` que solo registra invocaciones y nunca ejecuta
# nada real. Si el log queda vacío, `docker compose` nunca fue invocado.
# ---------------------------------------------------------------------------
MOCK_BIN="$WORK_DIR/mock-bin"
mkdir -p "$MOCK_BIN"
DOCKER_LOG="$WORK_DIR/docker-invocations.log"
: > "$DOCKER_LOG"
cat > "$MOCK_BIN/docker" <<EOF_MOCK
#!/usr/bin/env bash
echo "\$*" >> "$DOCKER_LOG"
exit 1
EOF_MOCK
chmod +x "$MOCK_BIN/docker"

SANDBOX_NEG="$WORK_DIR/sandbox-neg"
make_sandbox "$SANDBOX_NEG"

run_negative_case() {
  local description="$1"
  local env_contents="$2"
  : > "$DOCKER_LOG"
  printf '%s\n' "$env_contents" > "$SANDBOX_NEG/.env"

  local out
  local code=0
  out="$(PATH="$MOCK_BIN:$PATH" bash "$SANDBOX_NEG/infra/scripts/wait-for-postgres.sh" 2>&1)" || code=$?

  if [[ "$code" -ne 0 ]]; then
    note_pass "$description -> rechazado (exit=$code)"
  else
    note_fail "$description -> debía rechazar pero salió con exit 0"
  fi

  if [[ ! -s "$DOCKER_LOG" ]]; then
    note_pass "$description -> docker compose NUNCA fue invocado"
  else
    note_fail "$description -> docker compose SÍ fue invocado (log: $(cat "$DOCKER_LOG"))"
  fi

  echo "   (salida del script: ${out//$'\n'/ | })"
}

run_negative_case "nombre de base sin sufijo _test" "$(cat <<'EOF'
DATABASE_URL=postgresql://postgres:postgres@localhost:55998/inventory_fastfood_system?schema=public
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55998/inventory_fastfood_system?schema=public
EOF
)"

run_negative_case "DATABASE_URL de prueba (_test) en el puerto operativo real (5432)" "$(cat <<'EOF'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inventory_dev?schema=public
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inventory_dev_test?schema=public
EOF
)"

# ---------------------------------------------------------------------------
# Caso 3 (positivo): Docker real, recursos 100% descartables, puerto no
# estándar. Se destruye al final (down -v) y se confirma que el contenedor
# operativo real nunca se tocó.
# ---------------------------------------------------------------------------
if [[ "${WAIT_FOR_POSTGRES_TEST_SKIP_REAL_DOCKER:-0}" == "1" ]]; then
  echo "WAIT_FOR_POSTGRES_TEST_SKIP_REAL_DOCKER=1: se omite el caso positivo con Docker real."
else
  SANDBOX_POS="$WORK_DIR/sandbox-pos"
  make_sandbox "$SANDBOX_POS"

  POSITIVE_PORT="${WAIT_FOR_POSTGRES_TEST_PORT:-55979}"
  POSITIVE_DB="inventory_wait_for_postgres_selftest_test"
  POSITIVE_PROJECT="inventario-legacy-test-harness-selftest-$$"

  cat > "$SANDBOX_POS/.env" <<EOF_ENV
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inventory_dev?schema=public
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${POSITIVE_PORT}/${POSITIVE_DB}?schema=public
EOF_ENV

  cleanup_positive() {
    TEST_HARNESS_POSTGRES_PORT="$POSITIVE_PORT" \
      docker compose -p "$POSITIVE_PROJECT" -f "$SANDBOX_POS/infra/scripts/docker-compose.test-postgres.yml" \
      down -v >/dev/null 2>&1 || true
  }
  trap 'cleanup_positive; cleanup_tmp' EXIT

  positive_code=0
  TEST_HARNESS_COMPOSE_PROJECT="$POSITIVE_PROJECT" \
    bash "$SANDBOX_POS/infra/scripts/wait-for-postgres.sh" || positive_code=$?

  if [[ "$positive_code" -eq 0 ]]; then
    note_pass "destino de prueba válido (puerto no estándar) -> exit 0"
  else
    note_fail "destino de prueba válido debía completar con exit 0 (exit=$positive_code)"
  fi

  if TEST_HARNESS_POSTGRES_PORT="$POSITIVE_PORT" \
     docker compose -p "$POSITIVE_PROJECT" -f "$SANDBOX_POS/infra/scripts/docker-compose.test-postgres.yml" \
     exec -T postgres psql -U postgres -d postgres -tc \
     "SELECT 1 FROM pg_database WHERE datname = '${POSITIVE_DB}'" 2>/dev/null | grep -q 1; then
    note_pass "la base de prueba aislada fue creada dentro del contenedor descartable"
  else
    note_fail "no se encontró la base de prueba esperada dentro del contenedor descartable"
  fi

  if docker ps --format '{{.Names}}' | grep -qx 'inventario-postgres-1'; then
    if docker exec inventario-postgres-1 psql -U postgres -d postgres -tc \
       "SELECT 1 FROM pg_database WHERE datname = '${POSITIVE_DB}'" 2>/dev/null | grep -q 1; then
      note_fail "SEGURIDAD: la base de prueba terminó en el contenedor OPERATIVO (inventario-postgres-1)"
    else
      note_pass "el contenedor operativo (inventario-postgres-1) no contiene la base de prueba (aislamiento confirmado)"
    fi
  else
    echo "   (inventario-postgres-1 no está corriendo en este host; se omite la verificación cruzada)"
  fi

  cleanup_positive
  trap cleanup_tmp EXIT

  if docker ps -a --filter "name=$POSITIVE_PROJECT" --format '{{.Names}}' | grep -q .; then
    note_fail "quedaron contenedores del harness descartable sin limpiar ($POSITIVE_PROJECT)"
  else
    note_pass "el harness descartable fue destruido por completo (down -v)"
  fi
fi

echo "---"
echo "Resumen: $pass OK / $fail FALLOS"
[[ "$fail" -eq 0 ]]
