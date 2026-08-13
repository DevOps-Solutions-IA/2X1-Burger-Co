#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

: "${DATABASE_URL:?DATABASE_URL is required}"
[[ "$DATABASE_URL" == *"_test"* ]] || {
  printf '[error] Phase 8 legacy migration requires an isolated _test database URL\n' >&2
  exit 2
}

RUN_SUFFIX="${GITHUB_RUN_ID:-local}_$RANDOM"
DB_NAME="phase8_legacy_${RUN_SUFFIX//[^a-zA-Z0-9_]/_}_test"
DB_NAME="${DB_NAME:0:63}"
ADMIN_URL="$(node -e "const u=new URL(process.argv[1]);u.searchParams.delete('schema');process.stdout.write(u.toString())" "$DATABASE_URL")"
TARGET_URL="$(node -e "const u=new URL(process.argv[1]);u.searchParams.delete('schema');u.pathname='/' + process.argv[2];process.stdout.write(u.toString())" "$DATABASE_URL" "$DB_NAME")"
FRONTIER_DIR="$(mktemp -d /tmp/inventory-phase8-frontier.XXXXXX)"

cleanup() {
  dropdb --if-exists --maintenance-db="$ADMIN_URL" "$DB_NAME" >/dev/null 2>&1 || true
  rm -rf "$FRONTIER_DIR"
}
trap cleanup EXIT INT TERM

createdb --maintenance-db="$ADMIN_URL" "$DB_NAME"
mkdir -p "$FRONTIER_DIR/migrations"
cp prisma/schema.prisma "$FRONTIER_DIR/schema.prisma"
cp prisma/migrations/migration_lock.toml "$FRONTIER_DIR/migrations/migration_lock.toml"
find prisma/migrations -mindepth 1 -maxdepth 1 -type d | sort | head -n 37 | while IFS= read -r migration; do
  cp -a "$migration" "$FRONTIER_DIR/migrations/"
done

DATABASE_URL="$TARGET_URL" pnpm exec prisma migrate deploy --schema "$FRONTIER_DIR/schema.prisma" >/dev/null
[[ "$(psql "$TARGET_URL" -X -Atqc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')" == 37 ]]

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (id, email, "passwordHash", "fullName", "updatedAt")
VALUES ('phase8-legacy-user', 'phase8-legacy@example.invalid', 'test-only-hash', 'Legacy Operator', CURRENT_TIMESTAMP);

INSERT INTO crm_customers (id, display_name, display_name_normalized, status, updated_at)
VALUES ('phase8-legacy-customer', 'Legacy Customer', 'legacy customer', 'ACTIVE', CURRENT_TIMESTAMP);

INSERT INTO crm_customer_tags (id, name, name_normalized, created_at)
VALUES ('phase8-legacy-tag', 'Legacy', 'legacy', CURRENT_TIMESTAMP);

INSERT INTO crm_customer_tag_assignments (customer_id, tag_id, assigned_at)
VALUES ('phase8-legacy-customer', 'phase8-legacy-tag', CURRENT_TIMESTAMP);
SQL

BEFORE_COUNTS="$(psql "$TARGET_URL" -X -Atqc "SELECT concat((SELECT count(*) FROM users), ':', (SELECT count(*) FROM crm_customers), ':', (SELECT count(*) FROM crm_customer_tags), ':', (SELECT count(*) FROM crm_customer_tag_assignments))")"

DATABASE_URL="$TARGET_URL" pnpm exec prisma migrate deploy --schema prisma/schema.prisma >/dev/null
[[ "$(psql "$TARGET_URL" -X -Atqc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')" == 38 ]]

AFTER_COUNTS="$(psql "$TARGET_URL" -X -Atqc "SELECT concat((SELECT count(*) FROM users), ':', (SELECT count(*) FROM crm_customers), ':', (SELECT count(*) FROM crm_customer_tags), ':', (SELECT count(*) FROM crm_customer_tag_assignments))")"
[[ "$BEFORE_COUNTS" == "$AFTER_COUNTS" ]]

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO crm_pipelines (
  id, name, name_normalized, status, created_by_id, version, updated_at
) VALUES (
  'phase8-pipeline-a', 'Pipeline A', 'pipeline a', 'ACTIVE', 'phase8-legacy-user', 0, CURRENT_TIMESTAMP
), (
  'phase8-pipeline-b', 'Pipeline B', 'pipeline b', 'ACTIVE', 'phase8-legacy-user', 0, CURRENT_TIMESTAMP
);

INSERT INTO crm_pipeline_stages (
  id, pipeline_id, name, name_normalized, position, outcome, updated_at
) VALUES (
  'phase8-stage-a', 'phase8-pipeline-a', 'Nuevo', 'nuevo', 1, 'OPEN', CURRENT_TIMESTAMP
), (
  'phase8-stage-b', 'phase8-pipeline-b', 'Nuevo', 'nuevo', 1, 'OPEN', CURRENT_TIMESTAMP
);

INSERT INTO crm_leads (
  id, customer_id, pipeline_id, current_stage_id, source, source_reference,
  title, status, version, updated_at
) VALUES (
  'phase8-lead', 'phase8-legacy-customer', 'phase8-pipeline-a', 'phase8-stage-a',
  'AUTHORIZED_OPERATOR', 'phase8-source-ref', 'Legacy-compatible lead', 'NEW', 0, CURRENT_TIMESTAMP
);

INSERT INTO crm_tasks (
  id, customer_id, source, source_reference, type, status, priority, title,
  version, updated_at
) VALUES (
  'phase8-task', 'phase8-legacy-customer', 'PHASE8_TEST', 'phase8-task-ref',
  'TASK', 'OPEN', 'MEDIUM', 'Migration rehearsal task', 0, CURRENT_TIMESTAMP
);

INSERT INTO crm_notes (
  id, customer_id, source, source_reference, body, content_hash
) VALUES (
  'phase8-note', 'phase8-legacy-customer', 'PHASE8_TEST', 'phase8-note-ref',
  'Sanitized migration rehearsal note', 'phase8-content-hash'
);
SQL

if psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null 2>&1
INSERT INTO crm_leads (
  id, customer_id, pipeline_id, current_stage_id, source, source_reference,
  title, status, version, updated_at
) VALUES (
  'phase8-invalid-lead', 'phase8-legacy-customer', 'phase8-pipeline-a', 'phase8-stage-b',
  'AUTHORIZED_OPERATOR', 'phase8-invalid-ref', 'Invalid cross-pipeline lead', 'NEW', 0, CURRENT_TIMESTAMP
);
SQL
then
  printf '[error] cross-pipeline stage binding was accepted\n' >&2
  exit 4
fi

psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM crm_customers WHERE id = 'phase8-legacy-customer') <> 1
     OR (SELECT COUNT(*) FROM crm_customer_tag_assignments
         WHERE customer_id = 'phase8-legacy-customer' AND tag_id = 'phase8-legacy-tag') <> 1 THEN
    RAISE EXCEPTION 'legacy CRM rows were not preserved';
  END IF;
  IF (SELECT COUNT(*) FROM crm_leads WHERE id = 'phase8-lead') <> 1
     OR (SELECT pipeline_id FROM crm_leads WHERE id = 'phase8-lead') <> 'phase8-pipeline-a'
     OR (SELECT current_stage_id FROM crm_leads WHERE id = 'phase8-lead') <> 'phase8-stage-a' THEN
    RAISE EXCEPTION 'canonical lead binding is invalid';
  END IF;
  IF (SELECT COUNT(*) FROM crm_tasks WHERE id = 'phase8-task') <> 1
     OR (SELECT COUNT(*) FROM crm_notes WHERE id = 'phase8-note') <> 1 THEN
    RAISE EXCEPTION 'CRM task/note persistence is invalid';
  END IF;
END $$;
SQL

printf '{"status":"PASS","from":37,"to":38,"legacyRowsPreserved":4,"crossPipelineBindingsRejected":true}\n'
