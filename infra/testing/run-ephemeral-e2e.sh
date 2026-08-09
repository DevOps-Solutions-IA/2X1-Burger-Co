#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${EPHEMERAL_TEST_RUN_ID:-run-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)}"
[[ "$RUN_ID" =~ ^[a-z0-9-]{8,64}$ ]] || { printf '[error] invalid run id\n' >&2; exit 2; }
PROJECT="inventory-e2e-${RUN_ID}"
RUN_ROOT="${EPHEMERAL_RUN_ROOT:-/tmp/inventory-ephemeral}/${RUN_ID}"
EVIDENCE_DIR="${EPHEMERAL_EVIDENCE_ROOT:-$ROOT_DIR/.engineering/evidence/phase-2-3/runs}/${RUN_ID}"
ENV_FILE="$RUN_ROOT/runtime.env"
MANIFEST_FILE="$RUN_ROOT/release-manifest.json"
COMPOSE_FILE="$ROOT_DIR/infra/testing/docker-compose.ephemeral.yml"
START_EPOCH="$(date +%s)"
MIGRATION_SECONDS=0
SEED_SECONDS=0
READY_SECONDS=0
TEST_SECONDS=0
CLEANUP_DONE=false

mkdir -p "$RUN_ROOT" "$EVIDENCE_DIR"
chmod 700 "$RUN_ROOT" "$EVIDENCE_DIR"

allocate_port() {
  node -e "const n=require('node:net');const s=n.createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"
}

find_head_image() {
  local repository="$1"
  local head="$2"
  local candidate revision
  while IFS= read -r candidate; do
    [[ "$candidate" == *':<none>' ]] && continue
    revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$candidate" 2>/dev/null || true)"
    if [[ "$revision" == "$head" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}')
  return 1
}

cleanup() {
  local original_status="${1:-0}"
  if [[ "$CLEANUP_DONE" == true ]]; then return "$original_status"; fi
  set +e
  docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --no-color >"$EVIDENCE_DIR/service-logs.log" 2>&1
  docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down --volumes --remove-orphans --timeout 10 >"$EVIDENCE_DIR/teardown.log" 2>&1
  local compose_status=$?
  local orphan_count
  orphan_count="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" -q | wc -l)"
  local volume_count
  volume_count="$(docker volume ls --filter "label=com.docker.compose.project=$PROJECT" -q | wc -l)"
  local network_count
  network_count="$(docker network ls --filter "label=com.docker.compose.project=$PROJECT" -q | wc -l)"
  printf '{"composeDownExit":%s,"containers":%s,"volumes":%s,"networks":%s}\n' \
    "$compose_status" "$orphan_count" "$volume_count" "$network_count" >"$EVIDENCE_DIR/cleanup.json"
  rm -f "$ENV_FILE"
  CLEANUP_DONE=true
  set -e
  if (( compose_status != 0 || orphan_count != 0 || volume_count != 0 || network_count != 0 )); then
    printf '[error] cleanup failed for %s\n' "$RUN_ID" >&2
    return 1
  fi
  return "$original_status"
}

on_exit() {
  local status=$?
  trap - EXIT INT TERM
  cleanup "$status"
  exit $?
}
trap on_exit EXIT INT TERM

HEAD_COMMIT="$(git rev-parse HEAD)"
API_IMAGE="${EPHEMERAL_API_IMAGE:-}"
WEB_IMAGE="${EPHEMERAL_WEB_IMAGE:-}"
if [[ -z "$API_IMAGE" || -z "$WEB_IMAGE" ]]; then
  API_IMAGE="$(find_head_image inventory-fastfood-api "$HEAD_COMMIT" || true)"
  WEB_IMAGE="$(find_head_image inventory-fastfood-web "$HEAD_COMMIT" || true)"
fi
if [[ -z "$API_IMAGE" || -z "$WEB_IMAGE" ]]; then
  if [[ "${EPHEMERAL_BUILD_IF_MISSING:-false}" != true ]]; then
    printf '[error] no API/web artifacts match HEAD; build them or set EPHEMERAL_BUILD_IF_MISSING=true\n' >&2
    exit 3
  fi
  BUILD_RECORD="$(RELEASE_OUTPUT_DIR="$RUN_ROOT/artifacts" infra/release/build-artifacts.sh HEAD | tail -n 1)"
  API_IMAGE="$(node -p "require('$BUILD_RECORD').api.tag")"
  WEB_IMAGE="$(node -p "require('$BUILD_RECORD').web.tag")"
fi

API_REVISION="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$API_IMAGE")"
WEB_REVISION="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$WEB_IMAGE")"
[[ "$API_REVISION" == "$HEAD_COMMIT" && "$WEB_REVISION" == "$HEAD_COMMIT" ]] || {
  printf '[error] artifact revisions do not match HEAD\n' >&2
  exit 4
}
API_DIGEST="$(docker image inspect --format '{{.Id}}' "$API_IMAGE")"
WEB_DIGEST="$(docker image inspect --format '{{.Id}}' "$WEB_IMAGE")"

docker run --rm --network none --entrypoint cat "$API_IMAGE" /app/release-manifest.json >"$MANIFEST_FILE.original"
node - "$MANIFEST_FILE.original" "$MANIFEST_FILE" <<'NODE'
const fs = require('node:fs');
const [input, output] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(input, 'utf8'));
manifest.environment = 'test';
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
NODE

DB_PORT="$(allocate_port)"
API_PORT="$(allocate_port)"
WEB_PORT="$(allocate_port)"
[[ "$DB_PORT" != 5432 && "$DB_PORT" != 55432 && "$DB_PORT" != 55433 ]] || exit 5
DB_MARKER="$(node -p "'$RUN_ID'.replace(/-/g,'_').slice(-24)")"
DB_NAME="inventory_e2e_${DB_MARKER}_test"
DB_USER="e2e_${DB_MARKER:0:12}"
DB_PASSWORD="e2e-only-${RUN_ID}-db"

cat >"$ENV_FILE" <<EOF
COMPOSE_PROJECT_NAME=$PROJECT
EPHEMERAL_TEST_MODE=true
EPHEMERAL_TEST_RUN_ID=$RUN_ID
EPHEMERAL_POSTGRES_DB=$DB_NAME
EPHEMERAL_POSTGRES_USER=$DB_USER
EPHEMERAL_POSTGRES_PASSWORD=$DB_PASSWORD
EPHEMERAL_DB_PORT=$DB_PORT
EPHEMERAL_API_PORT=$API_PORT
EPHEMERAL_WEB_PORT=$WEB_PORT
EPHEMERAL_API_IMAGE=$API_IMAGE
EPHEMERAL_WEB_IMAGE=$WEB_IMAGE
EPHEMERAL_API_DIGEST=$API_DIGEST
EPHEMERAL_WEB_DIGEST=$WEB_DIGEST
EPHEMERAL_RELEASE_MANIFEST=$MANIFEST_FILE
EPHEMERAL_FIXTURES_FILE=$ROOT_DIR/infra/testing/ephemeral-fixtures.ts
EPHEMERAL_JWT_ACCESS_SECRET=e2e-access-$RUN_ID-strong-synthetic-value
EPHEMERAL_JWT_REFRESH_SECRET=e2e-refresh-$RUN_ID-different-strong-synthetic-value
EPHEMERAL_ADMIN_EMAIL=admin.e2e@invalid.local
EPHEMERAL_ADMIN_PASSWORD=Admin-E2E-2300!
EPHEMERAL_CASHIER_PASSWORD=Cashier-E2E-2300!
EPHEMERAL_INVENTORY_PASSWORD=Inventory-E2E-2300!
EPHEMERAL_WAITER_PASSWORD=Waiter-E2E-2300!
EPHEMERAL_DELIVERY_PASSWORD=Delivery-E2E-2300!
EOF
chmod 600 "$ENV_FILE" "$MANIFEST_FILE.original"
chmod 644 "$MANIFEST_FILE"

EXPECTED_DIRTY_BUILD="${EPHEMERAL_EXPECT_DIRTY_BUILD:-false}"
ACTUAL_DIRTY_BUILD="$(node -p "String(require('$MANIFEST_FILE').dirtyBuild)")"
[[ "$ACTUAL_DIRTY_BUILD" == "$EXPECTED_DIRTY_BUILD" ]] || {
  printf '[error] artifact dirty-build identity mismatch\n' >&2
  exit 5
}

docker run --rm \
  -v "$MANIFEST_FILE:/app/release-manifest.json:ro" \
  "$API_IMAGE" node -e "require('node:fs').readFileSync('/app/release-manifest.json', 'utf8')" >/dev/null

export EPHEMERAL_TEST_MODE=true EPHEMERAL_TEST_RUN_ID="$RUN_ID" EPHEMERAL_DB_PORT="$DB_PORT" COMPOSE_PROJECT_NAME="$PROJECT"
export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:$DB_PORT/$DB_NAME?schema=public"
node infra/testing/db-guard.mjs >"$EVIDENCE_DIR/db-guard.json"
node --test infra/testing/db-guard.test.mjs >"$EVIDENCE_DIR/db-guard-tests.log"
EPHEMERAL_RBAC_SOURCE_OUTPUT="$EVIDENCE_DIR/rbac-source-audit.json" \
  node infra/testing/rbac-source-audit.mjs >"$EVIDENCE_DIR/rbac-source-audit.log"

cat >"$EVIDENCE_DIR/snapshot.json" <<EOF
{"runId":"$RUN_ID","project":"$PROJECT","head":"$HEAD_COMMIT","apiImage":"$API_IMAGE","webImage":"$WEB_IMAGE","apiDigest":"$API_DIGEST","webDigest":"$WEB_DIGEST","ports":{"db":$DB_PORT,"api":$API_PORT,"web":$WEB_PORT},"operationalResourcesMounted":false,"realSessionsMounted":false,"externalProvidersEnabled":false}
EOF

compose=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${compose[@]}" config >"$EVIDENCE_DIR/compose-sanitized.yml"
sed -i -E 's/(PASSWORD|SECRET|DATABASE_URL):.*/\1: [REDACTED]/' "$EVIDENCE_DIR/compose-sanitized.yml"

"${compose[@]}" up -d ephemeral-postgres >"$EVIDENCE_DIR/postgres-start.log" 2>&1
MIGRATION_START="$(date +%s)"
"${compose[@]}" run --rm ephemeral-tools /app/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma >"$EVIDENCE_DIR/migrations.log" 2>&1
"${compose[@]}" run --rm ephemeral-tools /app/node_modules/.bin/prisma migrate status --schema prisma/schema.prisma >>"$EVIDENCE_DIR/migrations.log" 2>&1
MIGRATION_SECONDS=$(( $(date +%s) - MIGRATION_START ))

SEED_START="$(date +%s)"
"${compose[@]}" run --rm ephemeral-tools /app/apps/api/node_modules/.bin/tsx prisma/seed.ts >"$EVIDENCE_DIR/base-seed.log" 2>&1
"${compose[@]}" run --rm ephemeral-tools /app/apps/api/node_modules/.bin/tsx infra/testing/ephemeral-fixtures.ts >"$EVIDENCE_DIR/fixture-seed.log" 2>&1
SEED_SECONDS=$(( $(date +%s) - SEED_START ))

MIGRATION_COUNT="$("${compose[@]}" exec -T ephemeral-postgres psql -U "$DB_USER" -d "$DB_NAME" -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
EXPECTED_MIGRATION_COUNT="$(node infra/schema/migration-expectation.mjs --field count)"
[[ "$MIGRATION_COUNT" == "$EXPECTED_MIGRATION_COUNT" ]] || {
  printf '[error] expected %s migrations from source, got %s\n' "$EXPECTED_MIGRATION_COUNT" "$MIGRATION_COUNT" >&2
  exit 6
}

if [[ "${EPHEMERAL_FAIL_AT:-}" == after-seed ]]; then
  printf '[error] injected failure after seed\n' >&2
  exit 70
fi

READY_START="$(date +%s)"
"${compose[@]}" up -d ephemeral-api ephemeral-web >"$EVIDENCE_DIR/runtime-start.log" 2>&1
wait_url() {
  local url="$1"
  for _ in $(seq 1 60); do
    curl -fsS "$url" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
wait_url "http://127.0.0.1:$API_PORT/health/ready"
wait_url "http://127.0.0.1:$WEB_PORT/login"
READY_SECONDS=$(( $(date +%s) - READY_START ))

if [[ "${EPHEMERAL_FAIL_AT:-}" == after-runtime ]]; then
  printf '[error] injected failure after runtime\n' >&2
  exit 71
fi

export EPHEMERAL_API_BASE_URL="http://127.0.0.1:$API_PORT"
export EPHEMERAL_WEB_BASE_URL="http://127.0.0.1:$WEB_PORT"
export EPHEMERAL_EVIDENCE_DIR="$EVIDENCE_DIR"
export EPHEMERAL_PLAYWRIGHT_OUTPUT="$EVIDENCE_DIR/playwright"
export EPHEMERAL_ADMIN_EMAIL="admin.e2e@invalid.local"
export EPHEMERAL_ADMIN_PASSWORD="Admin-E2E-2300!"
export EPHEMERAL_CASHIER_EMAIL="cashier@2x1burgerco.local"
export EPHEMERAL_CASHIER_PASSWORD="Cashier-E2E-2300!"
export EPHEMERAL_INVENTORY_EMAIL="inventory@2x1burgerco.local"
export EPHEMERAL_INVENTORY_PASSWORD="Inventory-E2E-2300!"
export JWT_ACCESS_SECRET="e2e-access-$RUN_ID-strong-synthetic-value"

TEST_START="$(date +%s)"
node infra/testing/contract-tests.mjs | tee "$EVIDENCE_DIR/contracts.log"
node infra/testing/rbac-tests.mjs | tee "$EVIDENCE_DIR/rbac.log"
if [[ "${EPHEMERAL_INCLUDE_CORE_OPERATIONAL:-false}" == true ]]; then
  node infra/testing/core-operational-e2e.mjs | tee "$EVIDENCE_DIR/core-operational.log"
else
  node infra/testing/business-smoke.mjs | tee "$EVIDENCE_DIR/business-smoke.log"
fi
CANARY_API_BASE_URL="$EPHEMERAL_API_BASE_URL" \
CANARY_ADMIN_EMAIL="$EPHEMERAL_ADMIN_EMAIL" \
CANARY_ADMIN_PASSWORD="$EPHEMERAL_ADMIN_PASSWORD" \
CANARY_SAFETY_ALLOWED_PHONES="573000002301,573000002302,573000002303" \
  node infra/release/runtime-safety-smoke.mjs >"$EVIDENCE_DIR/runtime-safety.log"
pnpm exec playwright test --config infra/testing/playwright.ephemeral.config.ts >"$EVIDENCE_DIR/playwright.log" 2>&1
TEST_SECONDS=$(( $(date +%s) - TEST_START ))

if [[ "${EPHEMERAL_FAIL_AT:-}" == after-tests ]]; then
  printf '[error] injected failure after tests\n' >&2
  exit 72
fi

API_VERSION="$(curl -fsS "http://127.0.0.1:$API_PORT/version")"
WEB_VERSION="$(curl -fsS "http://127.0.0.1:$WEB_PORT/version")"
node - "$API_VERSION" "$WEB_VERSION" "$HEAD_COMMIT" <<'NODE'
const [apiRaw, webRaw, head] = process.argv.slice(2);
const api = JSON.parse(apiRaw); const web = JSON.parse(webRaw);
if (api.commitSha !== head || web.commitSha !== head || api.buildId !== web.buildId || api.environment !== web.environment || !['test', 'e2e'].includes(api.environment)) {
  throw new Error('Runtime release identity mismatch.');
}
if ('dirtyBuild' in api || 'dirtyBuild' in web) {
  throw new Error('Runtime version contract exposes dirty-build metadata.');
}
NODE

if [[ "${EPHEMERAL_INCLUDE_API_REGRESSION:-false}" == true ]]; then
  "${compose[@]}" stop ephemeral-web ephemeral-api >"$EVIDENCE_DIR/regression-runtime-stop.log" 2>&1
  export TEST_DATABASE_URL="$DATABASE_URL"
  export RELEASE_MANIFEST_PATH="$MANIFEST_FILE"
  export JWT_ACCESS_SECRET="e2e-access-$RUN_ID-strong-synthetic-value"
  export JWT_REFRESH_SECRET="e2e-refresh-$RUN_ID-different-strong-synthetic-value"
  export ADMIN_PASSWORD="$EPHEMERAL_ADMIN_PASSWORD"
  pnpm --dir apps/api exec jest \
    src/modules/auth/rbac-auth.spec.ts \
    src/tests/delivery-receipt-phase-a.spec.ts \
    src/tests/app.critical.spec.ts \
    --runInBand --detectOpenHandles >"$EVIDENCE_DIR/api-regression.log" 2>&1
fi

TOTAL_SECONDS=$(( $(date +%s) - START_EPOCH ))
cat >"$EVIDENCE_DIR/run-summary.json" <<EOF
{"status":"PASS","runId":"$RUN_ID","head":"$HEAD_COMMIT","migrationCount":$MIGRATION_COUNT,"timingsSeconds":{"migrations":$MIGRATION_SECONDS,"seed":$SEED_SECONDS,"ready":$READY_SECONDS,"tests":$TEST_SECONDS,"total":$TOTAL_SECONDS},"realWhatsapp":"OFF","productionModified":false,"operationalDatabaseTouched":false}
EOF

cleanup 0
trap - EXIT INT TERM
printf 'EPHEMERAL_RUN=%s STATUS=PASS EVIDENCE=%s\n' "$RUN_ID" "$EVIDENCE_DIR"
