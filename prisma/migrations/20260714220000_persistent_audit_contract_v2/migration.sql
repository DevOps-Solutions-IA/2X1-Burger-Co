ALTER TABLE "audit_logs"
  ADD COLUMN "event_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "event_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "actor_id" TEXT,
  ADD COLUMN "actor_type" TEXT NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "actor_role" TEXT,
  ADD COLUMN "entity_type" TEXT,
  ADD COLUMN "result" TEXT NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "reason_code" TEXT,
  ADD COLUMN "reason_text" TEXT,
  ADD COLUMN "request_id" TEXT,
  ADD COLUMN "correlation_id" TEXT,
  ADD COLUMN "trace_id" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "before" JSONB,
  ADD COLUMN "after" JSONB,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "environment_name" TEXT,
  ADD COLUMN "release_version" TEXT;

CREATE INDEX "audit_logs_event_timestamp_idx" ON "audit_logs"("event_timestamp");
CREATE INDEX "audit_logs_actor_id_event_timestamp_idx" ON "audit_logs"("actor_id", "event_timestamp");
CREATE INDEX "audit_logs_actor_role_event_timestamp_idx" ON "audit_logs"("actor_role", "event_timestamp");
CREATE INDEX "audit_logs_module_action_event_timestamp_idx" ON "audit_logs"("module", "action", "event_timestamp");
CREATE INDEX "audit_logs_entity_type_entityId_event_timestamp_idx" ON "audit_logs"("entity_type", "entityId", "event_timestamp");
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");
CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs"("correlation_id");
CREATE INDEX "audit_logs_idempotency_key_idx" ON "audit_logs"("idempotency_key");
