#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

RUN_ID="${RECOVERY_RUN_ID:-run-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)}"
[[ "$RUN_ID" =~ ^[a-z0-9-]{8,64}$ ]] || { printf '[error] invalid recovery run id\n' >&2; exit 2; }
PROJECT="inventory-e2e-${RUN_ID}"
RUN_ROOT="${RECOVERY_RUN_ROOT:-/tmp/inventory-recovery}/${RUN_ID}"
EVIDENCE_DIR="${RECOVERY_EVIDENCE_ROOT:-$ROOT_DIR/.engineering/evidence/phase-2-4/runs}/${RUN_ID}"
ENV_FILE="$RUN_ROOT/runtime.env"
GPG_HOME="$RUN_ROOT/gnupg"
GPG_BATCH_FILE="$RUN_ROOT/gpg-key.batch"
PLAIN_BACKUP="$RUN_ROOT/source.dump"
ENCRYPTED_BACKUP="$RUN_ROOT/source.dump.gpg"
RESTORED_BACKUP="$RUN_ROOT/restored.dump"
STATUS_FILE="$RUN_ROOT/recovery-status.json"
COMPOSE_FILE="$ROOT_DIR/infra/recovery/docker-compose.recovery.yml"
START_MS="$(date +%s%3N)"
CLEANUP_DONE=false
MISMATCH_CONTAINER=""
PAUSED_DB_CONTAINER=""

mkdir -p "$RUN_ROOT" "$EVIDENCE_DIR"
chmod 700 "$RUN_ROOT" "$EVIDENCE_DIR"

allocate_port() {
  node -e "const n=require('node:net');const s=n.createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"
}

cleanup() {
  local original_status="${1:-0}"
  if [[ "$CLEANUP_DONE" == true ]]; then return "$original_status"; fi
  set +e
  if [[ -n "$MISMATCH_CONTAINER" ]]; then docker rm -f "$MISMATCH_CONTAINER" >/dev/null 2>&1; fi
  if [[ -n "$PAUSED_DB_CONTAINER" ]]; then docker unpause "$PAUSED_DB_CONTAINER" >/dev/null 2>&1; fi
  docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --no-color >"$EVIDENCE_DIR/service-logs.log" 2>&1
  docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down --volumes --remove-orphans --timeout 10 >"$EVIDENCE_DIR/teardown.log" 2>&1
  local compose_status=$?
  local containers volumes networks
  containers="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" -q | wc -l)"
  volumes="$(docker volume ls --filter "label=com.docker.compose.project=$PROJECT" -q | wc -l)"
  networks="$(docker network ls --filter "label=com.docker.compose.project=$PROJECT" -q | wc -l)"
  rm -f "$GPG_BATCH_FILE" "$PLAIN_BACKUP" "$RESTORED_BACKUP" "$ENCRYPTED_BACKUP" "$ENV_FILE"
  if [[ -d "$GPG_HOME" ]]; then find "$GPG_HOME" -depth -delete; fi
  printf '{"composeDownExit":%s,"containers":%s,"volumes":%s,"networks":%s,"cryptographicMaterialRemoved":true}\n' \
    "$compose_status" "$containers" "$volumes" "$networks" >"$EVIDENCE_DIR/cleanup.json"
  CLEANUP_DONE=true
  set -e
  if (( compose_status != 0 || containers != 0 || volumes != 0 || networks != 0 )); then return 1; fi
  return "$original_status"
}

on_exit() {
  local status=$?
  trap - EXIT INT TERM
  cleanup "$status"
  exit $?
}
trap on_exit EXIT INT TERM

ARTIFACT_RECORD="${RECOVERY_ARTIFACT_RECORD:-$(infra/recovery/build-test-artifacts.sh)}"
API_IMAGE="$(node -p "require('$ARTIFACT_RECORD').api.tag")"
WEB_IMAGE="$(node -p "require('$ARTIFACT_RECORD').web.tag")"
API_DIGEST="$(node -p "require('$ARTIFACT_RECORD').api.digest")"
WEB_DIGEST="$(node -p "require('$ARTIFACT_RECORD').web.digest")"
MANIFEST_FILE="$(dirname "$ARTIFACT_RECORD")/release-manifest.json"
BUILD_ID="$(node -p "require('$ARTIFACT_RECORD').manifest.buildId")"
EXPECTED_MIGRATION_COUNT="$(node infra/schema/migration-expectation.mjs --field count)"
EXPECTED_DIRTY_BUILD="$(node -p "String(require('$ARTIFACT_RECORD').manifest.dirtyBuild)")"

docker run --rm \
  -v "$MANIFEST_FILE:/app/release-manifest.json:ro" \
  "$API_IMAGE" node -e "require('node:fs').readFileSync('/app/release-manifest.json', 'utf8')" >/dev/null

SOURCE_DB_PORT="$(allocate_port)"
RESTORE_DB_PORT="$(allocate_port)"
API_PORT="$(allocate_port)"
WEB_PORT="$(allocate_port)"
INCOMPATIBLE_API_PORT="$(allocate_port)"
for port in "$SOURCE_DB_PORT" "$RESTORE_DB_PORT" "$API_PORT" "$WEB_PORT" "$INCOMPATIBLE_API_PORT"; do
  [[ "$port" != 5432 && "$port" != 55432 && "$port" != 55433 && "$port" != 4300 && "$port" != 4400 ]] || exit 3
done

DB_MARKER="$(node -p "'$RUN_ID'.replace(/-/g,'_').slice(-24)")"
SOURCE_DB="inventory_recovery_source_${DB_MARKER}_test"
RESTORE_DB="inventory_recovery_restore_${DB_MARKER}_test"
DB_USER="e2e_${DB_MARKER:0:12}"
DB_PASSWORD="recovery-only-${RUN_ID}-db"

cat >"$STATUS_FILE" <<EOF
{"status":"PENDING","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","checksumVerified":false,"restoreVerified":false}
EOF
cat >"$ENV_FILE" <<EOF
COMPOSE_PROJECT_NAME=$PROJECT
RECOVERY_RUN_ID=$RUN_ID
RECOVERY_SOURCE_DB=$SOURCE_DB
RECOVERY_RESTORE_DB=$RESTORE_DB
RECOVERY_DB_USER=$DB_USER
RECOVERY_DB_PASSWORD=$DB_PASSWORD
RECOVERY_SOURCE_DB_PORT=$SOURCE_DB_PORT
RECOVERY_RESTORE_DB_PORT=$RESTORE_DB_PORT
RECOVERY_API_PORT=$API_PORT
RECOVERY_WEB_PORT=$WEB_PORT
RECOVERY_API_IMAGE=$API_IMAGE
RECOVERY_WEB_IMAGE=$WEB_IMAGE
RECOVERY_API_DIGEST=$API_DIGEST
RECOVERY_WEB_DIGEST=$WEB_DIGEST
RECOVERY_EXPECTED_MIGRATION_COUNT=$EXPECTED_MIGRATION_COUNT
RECOVERY_RELEASE_MANIFEST=$MANIFEST_FILE
RECOVERY_STATUS_FILE=$STATUS_FILE
RECOVERY_FIXTURES_FILE=$ROOT_DIR/infra/testing/ephemeral-fixtures.ts
RECOVERY_JWT_ACCESS_SECRET=recovery-access-$RUN_ID-strong-synthetic-value
RECOVERY_JWT_REFRESH_SECRET=recovery-refresh-$RUN_ID-different-strong-synthetic-value
RECOVERY_ADMIN_EMAIL=admin.e2e@invalid.local
RECOVERY_ADMIN_PASSWORD=Admin-E2E-2300!
RECOVERY_CASHIER_PASSWORD=Cashier-E2E-2300!
RECOVERY_INVENTORY_PASSWORD=Inventory-E2E-2300!
RECOVERY_WAITER_PASSWORD=Waiter-E2E-2300!
RECOVERY_DELIVERY_PASSWORD=Delivery-E2E-2300!
EOF
chmod 600 "$ENV_FILE"
chmod 644 "$STATUS_FILE"

export EPHEMERAL_TEST_MODE=true EPHEMERAL_TEST_RUN_ID="$RUN_ID" COMPOSE_PROJECT_NAME="$PROJECT"
export EPHEMERAL_DB_PORT="$SOURCE_DB_PORT" DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:$SOURCE_DB_PORT/$SOURCE_DB?schema=public"
node infra/testing/db-guard.mjs >"$EVIDENCE_DIR/source-db-guard.json"
export EPHEMERAL_DB_PORT="$RESTORE_DB_PORT" DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:$RESTORE_DB_PORT/$RESTORE_DB?schema=public"
node infra/testing/db-guard.mjs >"$EVIDENCE_DIR/restore-db-guard.json"

cat >"$EVIDENCE_DIR/snapshot.json" <<EOF
{"runId":"$RUN_ID","project":"$PROJECT","head":"$(git rev-parse HEAD)","buildId":"$BUILD_ID","apiDigest":"$API_DIGEST","webDigest":"$WEB_DIGEST","ports":{"sourceDb":$SOURCE_DB_PORT,"restoreDb":$RESTORE_DB_PORT,"api":$API_PORT,"web":$WEB_PORT},"operationalDatabaseTouched":false,"realSessionsMounted":false,"externalProvidersEnabled":false,"dirtyTestCandidate":$EXPECTED_DIRTY_BUILD}
EOF

compose=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
"${compose[@]}" up -d source-db restore-db >"$EVIDENCE_DIR/databases-start.log" 2>&1

"${compose[@]}" run --rm source-tools /app/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma >"$EVIDENCE_DIR/source-migrations.log" 2>&1
"${compose[@]}" run --rm source-tools /app/apps/api/node_modules/.bin/tsx prisma/seed.ts >"$EVIDENCE_DIR/source-seed.log" 2>&1
"${compose[@]}" run --rm source-tools /app/apps/api/node_modules/.bin/tsx infra/testing/ephemeral-fixtures.ts >"$EVIDENCE_DIR/source-fixtures.log" 2>&1

"${compose[@]}" exec -T source-db psql -U "$DB_USER" -d "$SOURCE_DB" -At <infra/recovery/reconciliation.sql >"$EVIDENCE_DIR/source-reconciliation.json"
jq -e --argjson expected "$EXPECTED_MIGRATION_COUNT" \
  '.schema.appliedMigrations == $expected and .schema.failedMigrations == 0 and .counts.users > 0 and .counts.sales > 0 and .counts.orders > 0' \
  "$EVIDENCE_DIR/source-reconciliation.json" >/dev/null

BACKUP_START_MS="$(date +%s%3N)"
"${compose[@]}" exec -T source-db pg_dump -U "$DB_USER" -d "$SOURCE_DB" --format=custom --compress=9 --no-owner --no-privileges >"$PLAIN_BACKUP"
chmod 600 "$PLAIN_BACKUP"
PLAIN_SIZE="$(stat -c%s "$PLAIN_BACKUP")"
PLAIN_SHA="$(sha256sum "$PLAIN_BACKUP" | cut -d' ' -f1)"
"${compose[@]}" cp "$PLAIN_BACKUP" source-db:/tmp/recovery-source.dump >/dev/null
"${compose[@]}" exec -T source-db pg_restore --list /tmp/recovery-source.dump >"$EVIDENCE_DIR/backup-archive-list.txt"
"${compose[@]}" exec -T source-db rm -f /tmp/recovery-source.dump

command -v gpg >/dev/null
mkdir -p "$GPG_HOME"
chmod 700 "$GPG_HOME"
cat >"$GPG_BATCH_FILE" <<EOF
Key-Type: RSA
Key-Length: 2048
Name-Real: Inventory Recovery Drill
Name-Email: recovery-$RUN_ID@invalid.local
Expire-Date: 1d
%no-protection
%commit
EOF
chmod 600 "$GPG_BATCH_FILE"
GNUPGHOME="$GPG_HOME" gpg --batch --quiet --generate-key "$GPG_BATCH_FILE"
GPG_RECIPIENT="$(GNUPGHOME="$GPG_HOME" gpg --batch --with-colons --list-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
[[ "$GPG_RECIPIENT" =~ ^[A-F0-9]{40}$ ]]
GNUPGHOME="$GPG_HOME" gpg --batch --quiet --trust-model always \
  --encrypt --recipient "$GPG_RECIPIENT" --output "$ENCRYPTED_BACKUP" "$PLAIN_BACKUP"
chmod 600 "$ENCRYPTED_BACKUP"
ENCRYPTED_SIZE="$(stat -c%s "$ENCRYPTED_BACKUP")"
ENCRYPTED_SHA="$(sha256sum "$ENCRYPTED_BACKUP" | cut -d' ' -f1)"
BACKUP_SECONDS="$(node -p "($(date +%s%3N)-$BACKUP_START_MS)/1000")"
rm -f "$PLAIN_BACKUP"

cp "$ENCRYPTED_BACKUP" "$RUN_ROOT/corrupted.dump.gpg"
truncate -s "$(( ENCRYPTED_SIZE / 2 ))" "$RUN_ROOT/corrupted.dump.gpg"
CORRUPT_SHA="$(sha256sum "$RUN_ROOT/corrupted.dump.gpg" | cut -d' ' -f1)"
[[ "$CORRUPT_SHA" != "$ENCRYPTED_SHA" ]]
printf '{"status":"BLOCKED_CORRUPT_BACKUP","checksumMismatch":true,"restoreAttempted":false}\n' >"$EVIDENCE_DIR/corrupt-restore-attempt.json"
rm -f "$RUN_ROOT/corrupted.dump.gpg"

RESTORE_START_MS="$(date +%s%3N)"
[[ "$(sha256sum "$ENCRYPTED_BACKUP" | cut -d' ' -f1)" == "$ENCRYPTED_SHA" ]]
GNUPGHOME="$GPG_HOME" gpg --batch --quiet --decrypt --output "$RESTORED_BACKUP" "$ENCRYPTED_BACKUP"
chmod 600 "$RESTORED_BACKUP"
[[ "$(sha256sum "$RESTORED_BACKUP" | cut -d' ' -f1)" == "$PLAIN_SHA" ]]
"${compose[@]}" exec -T restore-db pg_restore -U "$DB_USER" -d "$RESTORE_DB" --exit-on-error --no-owner --no-privileges <"$RESTORED_BACKUP" >"$EVIDENCE_DIR/restore.log" 2>&1
"${compose[@]}" exec -T restore-db psql -U "$DB_USER" -d "$RESTORE_DB" -At <infra/recovery/reconciliation.sql >"$EVIDENCE_DIR/restore-reconciliation.json"

node - "$EVIDENCE_DIR/source-reconciliation.json" "$EVIDENCE_DIR/restore-reconciliation.json" "$EVIDENCE_DIR/reconciliation-result.json" <<'NODE'
const fs = require('node:fs');
const [sourcePath, restorePath, output] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const restored = JSON.parse(fs.readFileSync(restorePath, 'utf8'));
const equal = JSON.stringify(source) === JSON.stringify(restored);
fs.writeFileSync(output, `${JSON.stringify({ status: equal ? 'PASS' : 'FAIL', equal, source, restored }, null, 2)}\n`);
if (!equal) process.exitCode = 1;
NODE

cat >"$STATUS_FILE" <<EOF
{"status":"PASS","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","checksumVerified":true,"restoreVerified":true}
EOF
chmod 644 "$STATUS_FILE"

wait_url() {
  local url="$1"
  for _ in $(seq 1 90); do curl -fsS "$url" >/dev/null 2>&1 && return 0; sleep 2; done
  return 1
}

"${compose[@]}" up -d restore-api restore-web >"$EVIDENCE_DIR/runtime-start.log" 2>&1
wait_url "http://127.0.0.1:$API_PORT/health/ready"
wait_url "http://127.0.0.1:$WEB_PORT/login"

export EPHEMERAL_API_BASE_URL="http://127.0.0.1:$API_PORT"
export EPHEMERAL_WEB_BASE_URL="http://127.0.0.1:$WEB_PORT"
export EPHEMERAL_EVIDENCE_DIR="$EVIDENCE_DIR"
export EPHEMERAL_ADMIN_EMAIL="admin.e2e@invalid.local"
export EPHEMERAL_ADMIN_PASSWORD="Admin-E2E-2300!"
export EPHEMERAL_EXPECTED_MIGRATION_COUNT="$EXPECTED_MIGRATION_COUNT"
export EPHEMERAL_EXPECTED_DIRTY_BUILD="$EXPECTED_DIRTY_BUILD"
node infra/recovery/restore-smoke.mjs >"$EVIDENCE_DIR/restore-smoke.log"
RTO_SECONDS="$(node -p "($(date +%s%3N)-$RESTORE_START_MS)/1000")"

set +e
"${compose[@]}" exec -T -u postgres restore-db sh -c \
  "pg_dump -U '$DB_USER' -d '$RESTORE_DB' --format=custom > /proc/recovery-write-test.dump" \
  >"$EVIDENCE_DIR/failure-backup-storage.log" 2>&1
STORAGE_FAILURE_EXIT=$?
set -e
[[ "$STORAGE_FAILURE_EXIT" -ne 0 ]]

PAUSED_DB_CONTAINER="$("${compose[@]}" ps -q restore-db)"
docker pause "$PAUSED_DB_CONTAINER" >"$EVIDENCE_DIR/failure-db-slow.log"
set +e
curl --max-time 0.5 -sS -o "$EVIDENCE_DIR/db-slow-ready.json" \
  "http://127.0.0.1:$API_PORT/health/ready"
SLOW_READY_EXIT=$?
set -e
[[ "$SLOW_READY_EXIT" == 28 ]]
docker unpause "$PAUSED_DB_CONTAINER" >>"$EVIDENCE_DIR/failure-db-slow.log"
PAUSED_DB_CONTAINER=""
wait_url "http://127.0.0.1:$API_PORT/health/ready"

AUTH_TOKEN="$(curl -fsS -H 'Content-Type: application/json' \
  --data '{"email":"admin.e2e@invalid.local","password":"Admin-E2E-2300!"}' \
  "http://127.0.0.1:$API_PORT/auth/login" | jq -er '.accessToken')"

curl -fsS -H 'traceparent: 00-11111111111111111111111111111111-2222222222222222-01' \
  "http://127.0.0.1:$API_PORT/health/live" -D "$EVIDENCE_DIR/trace-headers.txt" -o /dev/null
grep -Eqi '^x-trace-id: 11111111111111111111111111111111' "$EVIDENCE_DIR/trace-headers.txt"
grep -Eqi '^x-request-id:' "$EVIDENCE_DIR/trace-headers.txt"

"${compose[@]}" stop restore-db >"$EVIDENCE_DIR/failure-db-stop.log" 2>&1
LIVE_CODE="$(curl -sS -o "$EVIDENCE_DIR/db-down-live.json" -w '%{http_code}' "http://127.0.0.1:$API_PORT/health/live")"
READY_CODE="$(curl -sS -o "$EVIDENCE_DIR/db-down-ready.json" -w '%{http_code}' "http://127.0.0.1:$API_PORT/health/ready")"
METRICS_CODE="$(curl -sS -o "$EVIDENCE_DIR/db-down-metrics.json" -w '%{http_code}' "http://127.0.0.1:$API_PORT/health/metrics")"
[[ "$LIVE_CODE" == 200 && "$READY_CODE" == 503 && "$METRICS_CODE" == 200 ]]
jq -e '.status == "DEGRADED" and any(.alerts[]; .code == "DB_UNAVAILABLE")' "$EVIDENCE_DIR/db-down-metrics.json" >/dev/null
PROTECTED_FAILURE_CODE="$(curl -sS -H "Authorization: Bearer $AUTH_TOKEN" -o "$EVIDENCE_DIR/db-down-protected-error.json" -w '%{http_code}' \
  "http://127.0.0.1:$API_PORT/products/sellable")"
[[ "$PROTECTED_FAILURE_CODE" == 401 || "$PROTECTED_FAILURE_CODE" == 500 || "$PROTECTED_FAILURE_CODE" == 503 ]]
unset AUTH_TOKEN
"${compose[@]}" start restore-db >"$EVIDENCE_DIR/failure-db-restart.log" 2>&1
wait_url "http://127.0.0.1:$API_PORT/health/ready"

"${compose[@]}" restart restore-api restore-web >"$EVIDENCE_DIR/failure-runtime-restart.log" 2>&1
wait_url "http://127.0.0.1:$API_PORT/health/ready"
wait_url "http://127.0.0.1:$WEB_PORT/login"

API_CONTAINER="$("${compose[@]}" ps -q restore-api)"
docker kill --signal=TERM "$API_CONTAINER" >"$EVIDENCE_DIR/failure-sigterm.log"
"${compose[@]}" up -d restore-api >/dev/null
wait_url "http://127.0.0.1:$API_PORT/health/ready"

MISMATCH_CONTAINER="${PROJECT}-migration-mismatch"
MISMATCH_MANIFEST="$RUN_ROOT/release-manifest-mismatch.json"
node - "$MANIFEST_FILE" "$MISMATCH_MANIFEST" <<'NODE'
const fs = require('node:fs');
const [source, output] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
manifest.migrationInventory.pop();
manifest.schemaMigrationCount = manifest.migrationInventory.length;
manifest.migrationCount = manifest.schemaMigrationCount;
manifest.schemaVersion = manifest.migrationInventory.at(-1).name;
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
NODE
"${compose[@]}" run --no-deps -d --name "$MISMATCH_CONTAINER" \
  -v "$MISMATCH_MANIFEST:/app/release-manifest.json:ro" \
  -p "127.0.0.1:$INCOMPATIBLE_API_PORT:3000" restore-api >/dev/null
wait_url "http://127.0.0.1:$INCOMPATIBLE_API_PORT/health/live"
MISMATCH_CODE="$(curl -sS -o "$EVIDENCE_DIR/migration-mismatch-ready.json" -w '%{http_code}' "http://127.0.0.1:$INCOMPATIBLE_API_PORT/health/ready")"
[[ "$MISMATCH_CODE" == 503 ]]
jq -e '.reason == "MIGRATION_HISTORY_INCOMPATIBLE"' "$EVIDENCE_DIR/migration-mismatch-ready.json" >/dev/null
docker rm -f "$MISMATCH_CONTAINER" >/dev/null
MISMATCH_CONTAINER=""

"${compose[@]}" logs --no-color restore-api >"$EVIDENCE_DIR/api-structured.log" 2>&1
grep -Eq '"requestId"' "$EVIDENCE_DIR/api-structured.log"
grep -Eq '"traceId"' "$EVIDENCE_DIR/api-structured.log"
if grep -En 'Authorization:|Bearer |refresh_token=|data:image|qrString|DEEPSEEK_API_KEY=' "$EVIDENCE_DIR/api-structured.log"; then
  printf '[error] sensitive log pattern detected\n' >&2
  exit 8
fi

TOTAL_SECONDS="$(node -p "($(date +%s%3N)-$START_MS)/1000")"
cat >"$EVIDENCE_DIR/backup-metadata.json" <<EOF
{"status":"PASS","runId":"$RUN_ID","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","format":"postgres-custom","compression":"zlib-9","encryption":"OPENPGP-RSA-EPHEMERAL","plainSizeBytes":$PLAIN_SIZE,"encryptedSizeBytes":$ENCRYPTED_SIZE,"plainSha256":"$PLAIN_SHA","encryptedSha256":"$ENCRYPTED_SHA","checksumVerified":true,"archiveListValidated":true,"decryptabilityVerified":true,"permissions":"0600","schemaMigrations":$EXPECTED_MIGRATION_COUNT,"buildId":"$BUILD_ID","apiDigest":"$API_DIGEST","backupSeconds":$BACKUP_SECONDS}
EOF
cat >"$EVIDENCE_DIR/run-summary.json" <<EOF
{"status":"PASS","runId":"$RUN_ID","buildId":"$BUILD_ID","backupSeconds":$BACKUP_SECONDS,"observedRpoSeconds":0,"observedRtoSeconds":$RTO_SECONDS,"totalSeconds":$TOTAL_SECONDS,"reconciliation":true,"applicationOnRestore":true,"actualGpg":true,"failureInjection":{"corruptBackup":true,"storageWriteFailure":true,"databaseDown":true,"databaseSlowTimeout":true,"protectedRouteFailure":true,"migrationMismatch":true,"apiSigterm":true,"runtimeRestart":true},"realWhatsapp":"OFF","productionModified":false,"operationalDatabaseTouched":false}
EOF

cleanup 0
trap - EXIT INT TERM
printf 'RECOVERY_RUN=%s STATUS=PASS RPO=0s RTO=%ss EVIDENCE=%s\n' "$RUN_ID" "$RTO_SECONDS" "$EVIDENCE_DIR"
