#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

: "${DATABASE_URL:?DATABASE_URL is required}"
[[ "$DATABASE_URL" == *"_test"* ]] || {
  printf '[error] Phase 6 legacy migration requires an isolated _test database URL\n' >&2
  exit 2
}

RUN_SUFFIX="${GITHUB_RUN_ID:-local}_$RANDOM"
DB_NAME="phase6_legacy_${RUN_SUFFIX//[^a-zA-Z0-9_]/_}_test"
DB_NAME="${DB_NAME:0:63}"
ADMIN_URL="$(node -e "const u=new URL(process.argv[1]);u.searchParams.delete('schema');process.stdout.write(u.toString())" "$DATABASE_URL")"
TARGET_URL="$(node -e "const u=new URL(process.argv[1]);u.searchParams.delete('schema');u.pathname='/' + process.argv[2];process.stdout.write(u.toString())" "$DATABASE_URL" "$DB_NAME")"
LEGACY_SCHEMA_DIR="$(mktemp -d /tmp/inventory-prisma-frontier.XXXXXX)"

cleanup() {
  dropdb --if-exists --maintenance-db="$ADMIN_URL" "$DB_NAME" >/dev/null 2>&1 || true
  rm -rf "$LEGACY_SCHEMA_DIR"
}
trap cleanup EXIT INT TERM

cleanup
LEGACY_SCHEMA_DIR="$(mktemp -d /tmp/inventory-prisma-frontier.XXXXXX)"
createdb --maintenance-db="$ADMIN_URL" "$DB_NAME"

deploy_frontier() {
  local frontier="$1"
  local schema_root="$LEGACY_SCHEMA_DIR/frontier-$frontier"
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

# Rehearse the actual production frontier with rows that really predate the
# Sofia commercial and payment schemas.
deploy_frontier 33

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (id, email, "passwordHash", "fullName", "updatedAt")
VALUES ('legacy-user-1', 'legacy@example.invalid', 'legacy-test-hash', 'Legacy Operator', CURRENT_TIMESTAMP);

INSERT INTO cash_sessions (id, "openedById", "openingAmount", "updatedAt")
VALUES ('legacy-cash-1', 'legacy-user-1', 0, CURRENT_TIMESTAMP);

INSERT INTO order_tickets (
  id, number, status, type, "cashSessionId", "createdById", subtotal, "updatedAt",
  delivery_workflow_status
) VALUES (
  'legacy-ticket-1', 'LEGACY-001', 'SERVED', 'DELIVERY', 'legacy-cash-1',
  'legacy-user-1', 30000, CURRENT_TIMESTAMP, 'ASSIGNED'
);

INSERT INTO delivery_issues (
  id, order_ticket_id, issue_type, status, summary, reported_by_id, "updatedAt"
) VALUES (
  'legacy-delivery-issue-1', 'legacy-ticket-1', 'ROUTE_INCIDENT', 'OPEN',
  'Legacy route issue', 'legacy-user-1', CURRENT_TIMESTAMP
);

INSERT INTO sales (
  id, number, status, subtotal, total, "createdById", "cashSessionId",
  "orderTicketId", channel, "updatedAt"
) VALUES (
  'legacy-sale-1', 'LEGACY-SALE-001', 'PAID', 30000, 30000,
  'legacy-user-1', 'legacy-cash-1', 'legacy-ticket-1', 'DOMICILIO', CURRENT_TIMESTAMP
);

INSERT INTO payment_methods (id, name, code, "updatedAt")
VALUES ('legacy-payment-method-1', 'Legacy online', 'LEGACY_ONLINE', CURRENT_TIMESTAMP);

INSERT INTO whatsapp_conversations (
  id, phone, status, source, provider, mode, sofia_enabled, human_status,
  unread_count, created_at, updated_at
) VALUES (
  'legacy-conversation-1', '0000000000', 'ACTIVE', 'WHATSAPP', 'mock', 'disabled',
  FALSE, 'SOFIA_PAUSED', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO whatsapp_messages (
  id, conversation_id, direction, type, provider, body, status, created_at
) VALUES (
  'legacy-message-row-1', 'legacy-conversation-1', 'INBOUND', 'TEXT', 'mock',
  'legacy sanitized message', 'RECEIVED', CURRENT_TIMESTAMP
);

INSERT INTO delivery_location_inbox (
  id, latitude, longitude, match_status, received_at, "createdAt", "updatedAt"
) VALUES (
  'legacy-location-1', 4.6000000, -74.0800000, 'PENDING',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO sofia_order_drafts (
  id, status, items_snapshot, subtotal, delivery_fee, total, updated_at
) VALUES (
  'legacy-draft-1', 'DRAFT', '[]'::jsonb, 0, 0, 0, CURRENT_TIMESTAMP
);
SQL

# Cross Phase 4 and Phase 5 before creating records that depend on those
# schemas. The original frontier-33 rows remain in place throughout.
deploy_frontier 36

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO order_checkouts (
  id, source, source_reference, idempotency_key, items_snapshot,
  subtotal, delivery_fee, total, fulfillment, payment_preference,
  status, order_ticket_id, updated_at
) VALUES (
  'legacy-checkout-1', 'POS', 'legacy-source-1', 'legacy-checkout-idempotency-1', '[]'::jsonb,
  25000, 5000, 30000, 'DELIVERY', 'ONLINE',
  'PAYMENT_PENDING', 'legacy-ticket-1', CURRENT_TIMESTAMP
);

INSERT INTO payment_intents (
  id, checkout_id, attempt_number, idempotency_key, provider,
  amount, currency, status, provider_payment_id, provider_reference,
  provider_account_hash, updated_at
) VALUES (
  'legacy-intent-1', 'legacy-checkout-1', 1, 'legacy-payment-intent-1', 'BOLD',
  30000, 'COP', 'PENDING', 'legacy-provider-payment-1', 'legacy-checkout-1',
  'legacy-account-hash', CURRENT_TIMESTAMP
);

INSERT INTO payment_webhook_events (
  id, provider, event_id, event_type, status, signature_valid,
  payload_hash, provider_account_hash, processed_status, raw_payload
) VALUES (
  'legacy-webhook-1', 'BOLD', 'legacy-event-1', 'PAYMENT', 'PENDING', TRUE,
  'legacy-payload-hash', 'legacy-account-hash', 'RECEIVED', '{"legacy":true}'::jsonb
);

INSERT INTO payment_webhook_events (
  id, payment_intent_id, provider, event_id, provider_payment_id,
  provider_reference, event_type, status, amount, currency,
  signature_valid, payload_hash, provider_account_hash, processed_status, raw_payload
) VALUES (
  'legacy-webhook-applied-1', 'legacy-intent-1', 'BOLD', 'legacy-event-applied-1',
  'legacy-provider-payment-1', 'legacy-checkout-1', 'PAYMENT', 'APPROVED', 30000, 'COP',
  TRUE, 'legacy-applied-payload-hash', 'legacy-account-hash', 'COMPLETED', '{"legacy":true}'::jsonb
);

INSERT INTO payment_transitions (
  id, payment_intent_id, from_status, to_status, reason_code,
  webhook_event_id, idempotency_key, sanitized_metadata
) VALUES (
  'legacy-transition-1', 'legacy-intent-1', 'CREATED', 'PENDING',
  'LEGACY_PAYMENT_PENDING', 'legacy-webhook-applied-1',
  'legacy-transition-idempotency-1', '{"legacy":true}'::jsonb
);

INSERT INTO sale_payments (
  id, "saleId", "paymentMethodId", amount, payment_intent_id
) VALUES (
  'legacy-sale-payment-1', 'legacy-sale-1', 'legacy-payment-method-1', 30000, 'legacy-intent-1'
);

INSERT INTO whatsapp_inbound_events (
  id, provider, provider_event_id, provider_message_id, phone,
  event_hash, raw_payload, processing_status, normalized_payload_hash
) VALUES (
  'legacy-inbound-1', 'qr_gateway', 'legacy-provider-event-1', 'legacy-message-1',
  '0000000000', 'legacy-event-hash', '{"redacted":true}'::jsonb, 'RECEIVED', 'legacy-normalized-hash'
);
SQL

# Keep this Phase 6 rehearsal pinned to its own migration frontier even when
# later additive phases exist in the repository.
deploy_frontier 37

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM payment_webhook_events WHERE id = 'legacy-webhook-1') <> 1 THEN
    RAISE EXCEPTION 'legacy payment webhook row was not preserved';
  END IF;
  IF (SELECT COUNT(*) FROM order_tickets WHERE id = 'legacy-ticket-1') <> 1
     OR (SELECT delivery_workflow_version FROM order_tickets WHERE id = 'legacy-ticket-1') <> 0 THEN
    RAISE EXCEPTION 'legacy order ticket was not preserved safely';
  END IF;
  IF (SELECT COUNT(*) FROM sofia_order_drafts WHERE id = 'legacy-draft-1') <> 1
     OR (SELECT version FROM sofia_order_drafts WHERE id = 'legacy-draft-1') <> 1
     OR (SELECT payment_preference FROM sofia_order_drafts WHERE id = 'legacy-draft-1') <> 'UNKNOWN'
     OR (SELECT draft_hash FROM sofia_order_drafts WHERE id = 'legacy-draft-1') IS NOT NULL
     OR (SELECT confirmation_hash FROM sofia_order_drafts WHERE id = 'legacy-draft-1') IS NOT NULL THEN
    RAISE EXCEPTION 'frontier-33 Sofia draft compatibility was not preserved';
  END IF;
  IF (SELECT COUNT(*) FROM order_checkouts WHERE id = 'legacy-checkout-1') <> 1
     OR (SELECT order_ticket_id FROM order_checkouts WHERE id = 'legacy-checkout-1') <> 'legacy-ticket-1' THEN
    RAISE EXCEPTION 'legacy checkout binding was not preserved';
  END IF;
  IF (SELECT COUNT(*) FROM payment_intents WHERE id = 'legacy-intent-1') <> 1
     OR (SELECT checkout_id FROM payment_intents WHERE id = 'legacy-intent-1') <> 'legacy-checkout-1' THEN
    RAISE EXCEPTION 'legacy payment intent was not preserved';
  END IF;
  IF (SELECT COUNT(*) FROM payment_transitions WHERE id = 'legacy-transition-1') <> 1
     OR (SELECT webhook_event_id FROM payment_transitions WHERE id = 'legacy-transition-1') <> 'legacy-webhook-applied-1' THEN
    RAISE EXCEPTION 'legacy payment transition evidence was not preserved';
  END IF;
  IF (SELECT COUNT(*) FROM delivery_issues WHERE id = 'legacy-delivery-issue-1') <> 1
     OR (SELECT version FROM delivery_issues WHERE id = 'legacy-delivery-issue-1') <> 0 THEN
    RAISE EXCEPTION 'legacy delivery issue was not preserved safely';
  END IF;
  IF (SELECT COUNT(*) FROM sales WHERE id = 'legacy-sale-1') <> 1
     OR (SELECT COUNT(*) FROM sale_payments WHERE id = 'legacy-sale-payment-1') <> 1
     OR (SELECT payment_intent_id FROM sale_payments WHERE id = 'legacy-sale-payment-1') <> 'legacy-intent-1' THEN
    RAISE EXCEPTION 'legacy sale/payment binding was not preserved';
  END IF;
  IF (SELECT processing_attempts FROM payment_webhook_events WHERE id = 'legacy-webhook-1') <> 0
     OR (SELECT retryable FROM payment_webhook_events WHERE id = 'legacy-webhook-1') THEN
    RAISE EXCEPTION 'legacy payment recovery defaults are unsafe';
  END IF;
  IF (SELECT COUNT(*) FROM whatsapp_inbound_events WHERE id = 'legacy-inbound-1') <> 1 THEN
    RAISE EXCEPTION 'legacy WhatsApp inbound row was not preserved';
  END IF;
  IF (SELECT processing_attempts FROM whatsapp_inbound_events WHERE id = 'legacy-inbound-1') <> 0
     OR (SELECT retryable FROM whatsapp_inbound_events WHERE id = 'legacy-inbound-1') THEN
    RAISE EXCEPTION 'legacy inbound recovery defaults are unsafe';
  END IF;
  IF (SELECT version FROM delivery_location_inbox WHERE id = 'legacy-location-1') <> 0 THEN
    RAISE EXCEPTION 'legacy delivery location version default is unsafe';
  END IF;
  IF (SELECT provider FROM whatsapp_conversations WHERE id = 'legacy-conversation-1') <> 'mock'
     OR (SELECT provider FROM whatsapp_messages WHERE id = 'legacy-message-row-1') <> 'mock' THEN
    RAISE EXCEPTION 'legacy provider provenance was rewritten';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('whatsapp_conversations', 'whatsapp_messages')
      AND column_name = 'provider'
      AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'future provider provenance still has an implicit default';
  END IF;
END $$;
SQL

printf '{"status":"PASS","productionFrontier":33,"representativeFrontier":36,"to":37,"frontier33RowsInserted":true,"legacyAuthoritiesPreserved":13,"historicalProviderValuesRewritten":0}\n'
