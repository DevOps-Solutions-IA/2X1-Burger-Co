#!/usr/bin/env bash
set -euo pipefail

# Rehearses the additive migration 20260817120000_sofia_ai_suggestion_correlation
# (frontier 38 -> 39) in isolation, the same way phase6-legacy-migration.sh and
# phase8-legacy-migration.sh rehearse their own frontiers. This migration only
# adds a nullable FK (whatsapp_outbound_messages.auto_safe_decision_event_id ->
# sofia_auto_safe_decision_events) plus its index: no data transformation, no
# new constraint beyond the FK itself, no destructive change.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

: "${DATABASE_URL:?DATABASE_URL is required}"
[[ "$DATABASE_URL" == *"_test"* ]] || {
  printf '[error] Sofia AI suggestion correlation rehearsal requires an isolated _test database URL\n' >&2
  exit 2
}

RUN_SUFFIX="${GITHUB_RUN_ID:-local}_$RANDOM"
DB_NAME="sofia_ai_corr_${RUN_SUFFIX//[^a-zA-Z0-9_]/_}_test"
DB_NAME="${DB_NAME:0:63}"
ADMIN_URL="$(node -e "const u=new URL(process.argv[1]);u.searchParams.delete('schema');process.stdout.write(u.toString())" "$DATABASE_URL")"
TARGET_URL="$(node -e "const u=new URL(process.argv[1]);u.searchParams.delete('schema');u.pathname='/' + process.argv[2];process.stdout.write(u.toString())" "$DATABASE_URL" "$DB_NAME")"
FRONTIER_DIR="$(mktemp -d /tmp/inventory-sofia-ai-corr-frontier.XXXXXX)"

cleanup() {
  dropdb --if-exists --maintenance-db="$ADMIN_URL" "$DB_NAME" >/dev/null 2>&1 || true
  rm -rf "$FRONTIER_DIR"
}
trap cleanup EXIT INT TERM

createdb --maintenance-db="$ADMIN_URL" "$DB_NAME"

deploy_frontier() {
  local frontier="$1"
  local schema_root="$FRONTIER_DIR/frontier-$frontier"
  mkdir -p "$schema_root/migrations"
  cp prisma/schema.prisma "$schema_root/schema.prisma"
  cp prisma/migrations/migration_lock.toml "$schema_root/migrations/migration_lock.toml"
  find prisma/migrations -mindepth 1 -maxdepth 1 -type d | sort | head -n "$frontier" | while IFS= read -r migration; do
    cp -a "$migration" "$schema_root/migrations/"
  done
  DATABASE_URL="$TARGET_URL" pnpm exec prisma migrate deploy --schema "$schema_root/schema.prisma" >/dev/null
  local applied
  applied="$(psql "$TARGET_URL" -X -Atqc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
  [[ "$applied" == "$frontier" ]] || {
    printf '[error] expected Prisma frontier %s, found %s\n' "$frontier" "$applied" >&2
    exit 3
  }
}

deploy_frontier 38

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO whatsapp_conversations (
  id, phone, status, source, provider, mode, sofia_enabled, human_status,
  unread_count, created_at, updated_at
) VALUES (
  'sofia-ai-corr-conversation-1', '0000000001', 'ACTIVE', 'WHATSAPP', 'mock', 'disabled',
  FALSE, 'SOFIA_PAUSED', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO whatsapp_messages (
  id, conversation_id, direction, type, provider, body, status, created_at
) VALUES (
  'sofia-ai-corr-message-1', 'sofia-ai-corr-conversation-1', 'INBOUND', 'TEXT', 'mock',
  'legacy sanitized message', 'RECEIVED', CURRENT_TIMESTAMP
);

INSERT INTO whatsapp_outbound_messages (
  id, conversation_id, provider, local_message_id, body, status, idempotency_key, created_at
) VALUES (
  'sofia-ai-corr-outbound-1', 'sofia-ai-corr-conversation-1', 'mock',
  'sofia-ai-corr-local-1', 'legacy sanitized reply', 'SUGGESTED',
  'sofia-ai-corr-idempotency-1', CURRENT_TIMESTAMP
);

INSERT INTO sofia_auto_safe_decision_events (
  id, conversation_id, status, risk_level, reason_codes_json, channel_mode, is_sandbox, created_at
) VALUES (
  'sofia-ai-corr-decision-1', 'sofia-ai-corr-conversation-1', 'AUTO_SAFE_APPROVED', 'LOW',
  '["PASS_ALL_RULES"]'::jsonb, 'whatsapp_adapter', FALSE, CURRENT_TIMESTAMP
);
SQL

BEFORE_COUNTS="$(psql "$TARGET_URL" -X -Atqc "SELECT concat((SELECT count(*) FROM whatsapp_conversations), ':', (SELECT count(*) FROM whatsapp_messages), ':', (SELECT count(*) FROM whatsapp_outbound_messages), ':', (SELECT count(*) FROM sofia_auto_safe_decision_events))")"

# Keep this rehearsal pinned to frontier 39 explicitly (38 + this one additive
# migration), regardless of any later migration added after it in the future.
deploy_frontier 39

AFTER_COUNTS="$(psql "$TARGET_URL" -X -Atqc "SELECT concat((SELECT count(*) FROM whatsapp_conversations), ':', (SELECT count(*) FROM whatsapp_messages), ':', (SELECT count(*) FROM whatsapp_outbound_messages), ':', (SELECT count(*) FROM sofia_auto_safe_decision_events))")"
[[ "$BEFORE_COUNTS" == "$AFTER_COUNTS" ]]

LEGACY_CORRELATION="$(psql "$TARGET_URL" -X -Atqc "SELECT auto_safe_decision_event_id FROM whatsapp_outbound_messages WHERE id = 'sofia-ai-corr-outbound-1'")"
[[ -z "$LEGACY_CORRELATION" ]] || {
  printf '[error] pre-migration outbound row unexpectedly gained a correlation\n' >&2
  exit 4
}

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO whatsapp_outbound_messages (
  id, conversation_id, provider, local_message_id, body, status, idempotency_key,
  created_at, auto_safe_decision_event_id
) VALUES (
  'sofia-ai-corr-outbound-2', 'sofia-ai-corr-conversation-1', 'mock',
  'sofia-ai-corr-local-2', 'new correlated reply', 'SUGGESTED',
  'sofia-ai-corr-idempotency-2', CURRENT_TIMESTAMP, 'sofia-ai-corr-decision-1'
);
SQL

if psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 -c "INSERT INTO whatsapp_outbound_messages (id, conversation_id, provider, local_message_id, body, status, idempotency_key, created_at, auto_safe_decision_event_id) VALUES ('sofia-ai-corr-outbound-invalid', 'sofia-ai-corr-conversation-1', 'mock', 'sofia-ai-corr-local-invalid', 'invalid fk reply', 'SUGGESTED', 'sofia-ai-corr-idempotency-invalid', CURRENT_TIMESTAMP, 'nonexistent-decision-event');" >/dev/null 2>&1
then
  printf '[error] a suggestion correlated to a nonexistent decision event was accepted\n' >&2
  exit 4
fi

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 -c "DELETE FROM sofia_auto_safe_decision_events WHERE id = 'sofia-ai-corr-decision-1';"

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM whatsapp_outbound_messages WHERE id = 'sofia-ai-corr-outbound-2') <> 1 THEN
    RAISE EXCEPTION 'suggestion row was unexpectedly deleted when its decision event was removed';
  END IF;
  IF (SELECT auto_safe_decision_event_id FROM whatsapp_outbound_messages WHERE id = 'sofia-ai-corr-outbound-2') IS NOT NULL THEN
    RAISE EXCEPTION 'decision event deletion did not SET NULL on the correlated suggestion';
  END IF;
END $$;
SQL

printf '{"status":"PASS","from":38,"to":39,"migration":"20260817120000_sofia_ai_suggestion_correlation","legacyRowsPreserved":true,"invalidCorrelationRejected":true,"onDeleteSetNullVerified":true}\n'
