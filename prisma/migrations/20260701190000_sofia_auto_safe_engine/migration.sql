CREATE TABLE IF NOT EXISTS "sofia_auto_safe_decision_events" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "customer_memory_id" TEXT,
  "prompt_version_id" TEXT,
  "status" TEXT NOT NULL,
  "risk_level" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "should_send" BOOLEAN NOT NULL DEFAULT false,
  "reason_codes_json" JSONB NOT NULL,
  "blocking_reasons_json" JSONB,
  "warnings_json" JSONB,
  "input_summary_json" JSONB,
  "output_summary_json" JSONB,
  "safety_guard_summary_json" JSONB,
  "final_reply_preview" TEXT,
  "channel_mode" TEXT,
  "is_sandbox" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sofia_auto_safe_decision_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sofia_auto_safe_decision_events_conversation_id_created_at_idx"
  ON "sofia_auto_safe_decision_events"("conversation_id", "created_at");

CREATE INDEX IF NOT EXISTS "sofia_auto_safe_decision_events_customer_memory_id_created_at_idx"
  ON "sofia_auto_safe_decision_events"("customer_memory_id", "created_at");

CREATE INDEX IF NOT EXISTS "sofia_auto_safe_decision_events_prompt_version_id_created_at_idx"
  ON "sofia_auto_safe_decision_events"("prompt_version_id", "created_at");

CREATE INDEX IF NOT EXISTS "sofia_auto_safe_decision_events_status_created_at_idx"
  ON "sofia_auto_safe_decision_events"("status", "created_at");

ALTER TABLE "sofia_auto_safe_decision_events"
  ADD CONSTRAINT "sofia_auto_safe_decision_events_customer_memory_id_fkey"
  FOREIGN KEY ("customer_memory_id") REFERENCES "sofia_customer_memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sofia_auto_safe_decision_events"
  ADD CONSTRAINT "sofia_auto_safe_decision_events_prompt_version_id_fkey"
  FOREIGN KEY ("prompt_version_id") REFERENCES "sofia_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
