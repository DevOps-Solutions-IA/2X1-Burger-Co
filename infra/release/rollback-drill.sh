#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/release/docker-compose.canary.yml"
BASELINE="${1:?Usage: rollback-drill.sh <baseline-record> <candidate-record> [state-dir]}"
CANDIDATE="${2:?Usage: rollback-drill.sh <baseline-record> <candidate-record> [state-dir]}"
STATE_DIR="${3:-/tmp/inventory-fastfood-canary}"
RESULT="$STATE_DIR/rollback-drill.json"
CURRENT_STAGE="initialization"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

now_ms() {
  node -p 'Date.now()'
}

elapsed_ms() {
  printf '%s' "$(($(now_ms) - $1))"
}

record_field() {
  node -p "require(process.argv[1])$2" "$1"
}

validate_record() {
  node - "$1" <<'NODE'
const record = require(process.argv[2]);
for (const target of ['api', 'web']) {
  if (!/^sha256:[a-f0-9]{64}$/.test(record[target]?.digest ?? '')) {
    throw new Error(`${target} digest is not an immutable local content digest`);
  }
}
if (record.manifest?.dirtyBuild !== false) throw new Error('Rollback artifacts must come from a clean build');
NODE
}

run_override_or() {
  local override="$1" default_function="$2"
  shift 2
  if [[ -n "$override" ]]; then
    [[ -x "$override" ]] || { echo "Required rollback hook is not executable: $override" >&2; return 1; }
    "$override" "$@"
  else
    "$default_function" "$@"
  fi
}

default_deploy() {
  "$ROOT_DIR/infra/release/canary-deploy.sh" "$1" "$2" >/dev/null
}

default_smoke() {
  "$ROOT_DIR/infra/release/canary-smoke.sh" "$1" "$2" >/dev/null
}

load_canary_environment() {
  local env_file="$STATE_DIR/canary.env"
  [[ -f "$env_file" ]] || { echo "Canary environment not found" >&2; return 1; }
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

default_inject_failure() {
  load_canary_environment
  docker compose --env-file "$STATE_DIR/canary.env" -f "$COMPOSE_FILE" \
    stop --timeout 1 canary-api canary-web >/dev/null

  local service container running
  for service in canary-api canary-web; do
    container="$(docker compose --env-file "$STATE_DIR/canary.env" -f "$COMPOSE_FILE" ps -q "$service")"
    [[ -n "$container" ]] || continue
    running="$(docker inspect --format '{{.State.Running}}' "$container")"
    [[ "$running" == false ]] || { echo "$service remained running after failure injection" >&2; return 1; }
  done
}

default_verify_images() {
  local record="$1"
  load_canary_environment

  local service target expected container actual
  for service in canary-api canary-web; do
    target="${service#canary-}"
    expected="$(record_field "$record" ".$target.digest")"
    container="$(docker compose --env-file "$STATE_DIR/canary.env" -f "$COMPOSE_FILE" ps -q "$service")"
    [[ -n "$container" ]] || { echo "$service has no active container" >&2; return 1; }
    actual="$(docker inspect --format '{{.Image}}' "$container")"
    [[ "$actual" == "$expected" ]] || {
      echo "$service is not running the retained $target digest" >&2
      return 1
    }
  done
}

default_rpo_snapshot() {
  load_canary_environment
  docker compose --env-file "$STATE_DIR/canary.env" -f "$COMPOSE_FILE" exec -T canary-postgres \
    psql -X -qAt -v ON_ERROR_STOP=1 -U "$CANARY_POSTGRES_USER" -d "$CANARY_POSTGRES_DB" <<'SQL'
DO $rpo_preflight$
DECLARE
  required_table text;
  missing_tables text[] := ARRAY[]::text[];
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'products',
    'ingredients',
    'inventory_movements',
    'cash_sessions',
    'cash_movements',
    'sales',
    'sale_items',
    'sale_payments',
    'order_tickets',
    'order_ticket_items',
    'order_checkouts',
    'payment_intents',
    'payment_links',
    'payment_transitions',
    'payment_webhook_events',
    'delivery_workflow_events',
    'delivery_issues',
    'delivery_location_inbox',
    'notification_intents',
    'crm_customer_consents',
    'whatsapp_conversations',
    'sofia_commands',
    'whatsapp_messages',
    'whatsapp_inbound_events',
    'whatsapp_outbound_messages',
    'whatsapp_message_status_events',
    'whatsapp_delivery_orders',
    'whatsapp_handoff_events',
    'customer_service_cases',
    'customer_service_case_events'
  ] LOOP
    IF to_regclass(format('%I.%I', 'public', required_table)) IS NULL THEN
      missing_tables := array_append(missing_tables, required_table);
    END IF;
  END LOOP;

  IF cardinality(missing_tables) > 0 THEN
    RAISE EXCEPTION 'RPO snapshot requires missing tables: %', array_to_string(missing_tables, ', ');
  END IF;
END
$rpo_preflight$;

SELECT jsonb_build_object(
  'snapshotSchemaVersion', 2,
  'products', (SELECT jsonb_build_object('count', count(*), 'currentStock', coalesce(sum("currentStock"), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM products t),
  'ingredients', (SELECT jsonb_build_object('count', count(*), 'currentStock', coalesce(sum("currentStock"), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM ingredients t),
  'inventoryMovements', (SELECT jsonb_build_object('count', count(*), 'quantity', coalesce(sum(quantity), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM inventory_movements t),
  'cashSessions', (SELECT jsonb_build_object('count', count(*), 'openingAmount', coalesce(sum("openingAmount"), 0)::text, 'closingAmount', coalesce(sum("closingAmount"), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM cash_sessions t),
  'cashMovements', (SELECT jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM cash_movements t),
  'sales', (SELECT jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM sales t),
  'saleItems', (SELECT jsonb_build_object('count', count(*), 'quantity', coalesce(sum(quantity), 0)::text, 'total', coalesce(sum("totalPrice"), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM sale_items t),
  'salePayments', (SELECT jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM sale_payments t),
  'orderTickets', (SELECT jsonb_build_object('count', count(*), 'subtotal', coalesce(sum(subtotal), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM order_tickets t),
  'orderTicketItems', (SELECT jsonb_build_object('count', count(*), 'quantity', coalesce(sum(quantity), 0)::text, 'total', coalesce(sum("totalPrice"), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM order_ticket_items t),
  'checkouts', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM order_checkouts t),
  'paymentIntents', (SELECT jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)::text, 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM payment_intents t),
  'paymentLinks', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM payment_links t),
  'paymentTransitions', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM payment_transitions t),
  'paymentWebhooks', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM payment_webhook_events t),
  'deliveryWorkflowEvents', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM delivery_workflow_events t),
  'deliveryIssues', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM delivery_issues t),
  'deliveryLocations', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM delivery_location_inbox t),
  'notificationIntents', (SELECT jsonb_build_object('count', count(*), 'attempts', coalesce(sum(attempts), 0), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM notification_intents t),
  'customerConsents', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM crm_customer_consents t),
  'whatsappConversations', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM whatsapp_conversations t),
  'secureCommands', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM sofia_commands t),
  'whatsappMessages', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM whatsapp_messages t),
  'whatsappInboundEvents', (SELECT jsonb_build_object('count', count(*), 'processingAttempts', coalesce(sum(processing_attempts), 0), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM whatsapp_inbound_events t),
  'whatsappOutboundMessages', (SELECT jsonb_build_object('count', count(*), 'attempts', coalesce(sum(attempts), 0), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM whatsapp_outbound_messages t),
  'whatsappStatusEvents', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM whatsapp_message_status_events t),
  'whatsappDeliveryOrders', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM whatsapp_delivery_orders t),
  'whatsappHandoffEvents', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM whatsapp_handoff_events t),
  'customerServiceCases', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM customer_service_cases t),
  'customerServiceCaseEvents', (SELECT jsonb_build_object('count', count(*), 'rows', md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))) FROM customer_service_case_events t)
)::text;
SQL
}

deploy() {
  run_override_or "${ROLLBACK_DEPLOY_COMMAND:-}" default_deploy "$1" "$STATE_DIR"
}

smoke() {
  run_override_or "${ROLLBACK_SMOKE_COMMAND:-}" default_smoke "$1" "$STATE_DIR"
}

inject_failure() {
  run_override_or "${ROLLBACK_FAILURE_INJECTION_COMMAND:-}" default_inject_failure "$CANDIDATE" "$STATE_DIR"
}

verify_images() {
  run_override_or "${ROLLBACK_VERIFY_IMAGES_COMMAND:-}" default_verify_images "$1" "$STATE_DIR"
}

rpo_snapshot() {
  run_override_or "${ROLLBACK_RPO_SNAPSHOT_COMMAND:-}" default_rpo_snapshot "$STATE_DIR"
}

snapshot_digest() {
  node -e "const {createHash}=require('crypto');let s='';process.stdin.on('data',c=>s+=c).on('end',()=>process.stdout.write('sha256:'+createHash('sha256').update(s).digest('hex')))"
}

write_failure() {
  local exit_code="$1"
  trap - ERR
  set +e
  node - "$RESULT" "$CURRENT_STAGE" "$exit_code" <<'NODE'
const fs = require('fs');
const [output, stage, exitCode] = process.argv.slice(2);
fs.writeFileSync(output, JSON.stringify({
  status: 'FAIL',
  failedStage: stage,
  exitCode: Number(exitCode),
  databaseRollbackPerformed: false,
  rebuildDuringRollback: false,
}, null, 2) + '\n');
NODE
  exit "$exit_code"
}
trap 'write_failure "$?"' ERR

CURRENT_STAGE="artifact-validation"
validate_record "$BASELINE"
validate_record "$CANDIDATE"
baseline_pair="$(record_field "$BASELINE" '.api.digest')|$(record_field "$BASELINE" '.web.digest')"
candidate_pair="$(record_field "$CANDIDATE" '.api.digest')|$(record_field "$CANDIDATE" '.web.digest')"
[[ "$baseline_pair" != "$candidate_pair" ]] || { echo "Rollback candidate is identical to the baseline" >&2; false; }

CURRENT_STAGE="baseline-deploy"
started="$(now_ms)"
deploy "$BASELINE"
smoke "$BASELINE"
verify_images "$BASELINE"
baseline_initial_ms="$(elapsed_ms "$started")"

CURRENT_STAGE="candidate-deploy"
started="$(now_ms)"
deploy "$CANDIDATE"
smoke "$CANDIDATE"
verify_images "$CANDIDATE"
candidate_ms="$(elapsed_ms "$started")"

CURRENT_STAGE="rpo-snapshot-before-failure"
rpo_before="$(rpo_snapshot)"
[[ -n "$rpo_before" ]] || { echo "RPO snapshot hook returned no evidence" >&2; false; }
rpo_before_digest="$(printf '%s' "$rpo_before" | snapshot_digest)"

CURRENT_STAGE="failure-injection"
started="$(now_ms)"
inject_failure
if smoke "$CANDIDATE" >/dev/null 2>&1; then
  echo "Injected application failure was not detected by smoke" >&2
  false
fi
failure_detection_ms="$(elapsed_ms "$started")"

CURRENT_STAGE="rollback"
started="$(now_ms)"
deploy "$BASELINE"
smoke "$BASELINE"
verify_images "$BASELINE"
rpo_after="$(rpo_snapshot)"
[[ -n "$rpo_after" ]] || { echo "Post-rollback RPO snapshot hook returned no evidence" >&2; false; }
rpo_after_digest="$(printf '%s' "$rpo_after" | snapshot_digest)"
[[ "$rpo_after" == "$rpo_before" ]] || { echo "RPO invariant changed during application rollback" >&2; false; }
rollback_rto_ms="$(elapsed_ms "$started")"

CURRENT_STAGE="result"
node - "$RESULT" "$BASELINE" "$CANDIDATE" "$baseline_initial_ms" "$candidate_ms" \
  "$failure_detection_ms" "$rollback_rto_ms" "$rpo_before_digest" "$rpo_after_digest" <<'NODE'
const fs = require('fs');
const [output, baselinePath, candidatePath, baselineInitial, candidate, failureDetection, rollbackRto, rpoBefore, rpoAfter] = process.argv.slice(2);
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const candidateRecord = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
fs.writeFileSync(output, JSON.stringify({
  status: 'PASS',
  mechanism: 'local-content-digest',
  failureInjected: true,
  failureSmokeRejected: true,
  baseline: { apiDigest: baseline.api.digest, webDigest: baseline.web.digest },
  candidate: { apiDigest: candidateRecord.api.digest, webDigest: candidateRecord.web.digest },
  rollbackVerified: { api: true, web: true },
  durationsMilliseconds: {
    baselineInitial: Number(baselineInitial),
    candidate: Number(candidate),
    failureDetection: Number(failureDetection),
    rollbackRto: Number(rollbackRto),
  },
  rtoMilliseconds: Number(rollbackRto),
  rpo: { status: 'PASS', beforeDigest: rpoBefore, afterDigest: rpoAfter },
  databaseRollbackPerformed: false,
  rebuildDuringRollback: false,
  candidateRestoredAfterRollback: false,
}, null, 2) + '\n');
NODE
trap - ERR
cat "$RESULT"
