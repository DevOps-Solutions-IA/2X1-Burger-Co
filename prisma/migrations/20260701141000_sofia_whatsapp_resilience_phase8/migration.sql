ALTER TYPE "WhatsappConversationStatus" ADD VALUE IF NOT EXISTS 'SOFIA_PAUSED';
ALTER TYPE "WhatsappMessageType" ADD VALUE IF NOT EXISTS 'INTERACTIVE';

ALTER TABLE "whatsapp_conversations"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'mock',
  ADD COLUMN IF NOT EXISTS "provider_conversation_id" TEXT,
  ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS "human_status" TEXT NOT NULL DEFAULT 'SOFIA_ACTIVE',
  ADD COLUMN IF NOT EXISTS "last_inbound_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_outbound_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_human_takeover_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_sofia_reply_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "unread_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_message_preview" TEXT,
  ADD COLUMN IF NOT EXISTS "risk_flags" JSONB;

ALTER TABLE "whatsapp_messages"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'mock',
  ADD COLUMN IF NOT EXISTS "provider_message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_timestamp" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "media_mime_type" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "error_message" TEXT;

CREATE TABLE IF NOT EXISTS "whatsapp_inbound_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_event_id" TEXT,
  "provider_message_id" TEXT,
  "phone" TEXT NOT NULL,
  "event_hash" TEXT NOT NULL,
  "raw_payload" JSONB,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "processing_status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "error_message" TEXT,
  CONSTRAINT "whatsapp_inbound_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "whatsapp_outbound_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "inbound_message_id" TEXT,
  "provider" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "local_message_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "media_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP(3),
  "last_error" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),
  "approved_by_id" TEXT,
  "approved_at" TIMESTAMP(3),
  "raw_payload" JSONB,
  CONSTRAINT "whatsapp_outbound_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "whatsapp_conversations_provider_provider_conversation_id_idx" ON "whatsapp_conversations"("provider", "provider_conversation_id");
CREATE INDEX IF NOT EXISTS "whatsapp_conversations_mode_updated_at_idx" ON "whatsapp_conversations"("mode", "updated_at");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_provider_provider_message_id_idx" ON "whatsapp_messages"("provider", "provider_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_status_created_at_idx" ON "whatsapp_messages"("status", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_idempotency_key_key" ON "whatsapp_messages"("idempotency_key") WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_inbound_events_provider_event_id_key" ON "whatsapp_inbound_events"("provider_event_id") WHERE "provider_event_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_inbound_events_provider_event_hash_key" ON "whatsapp_inbound_events"("provider", "event_hash");
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_events_provider_provider_message_id_idx" ON "whatsapp_inbound_events"("provider", "provider_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_events_phone_received_at_idx" ON "whatsapp_inbound_events"("phone", "received_at");
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_events_processing_status_received_at_idx" ON "whatsapp_inbound_events"("processing_status", "received_at");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_outbound_messages_local_message_id_key" ON "whatsapp_outbound_messages"("local_message_id");
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_outbound_messages_idempotency_key_key" ON "whatsapp_outbound_messages"("idempotency_key");
CREATE INDEX IF NOT EXISTS "whatsapp_outbound_messages_conversation_id_created_at_idx" ON "whatsapp_outbound_messages"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_outbound_messages_inbound_message_id_idx" ON "whatsapp_outbound_messages"("inbound_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_outbound_messages_provider_provider_message_id_idx" ON "whatsapp_outbound_messages"("provider", "provider_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_outbound_messages_status_next_retry_at_idx" ON "whatsapp_outbound_messages"("status", "next_retry_at");
CREATE INDEX IF NOT EXISTS "whatsapp_outbound_messages_approved_by_id_idx" ON "whatsapp_outbound_messages"("approved_by_id");

ALTER TABLE "whatsapp_outbound_messages"
  ADD CONSTRAINT "whatsapp_outbound_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_outbound_messages"
  ADD CONSTRAINT "whatsapp_outbound_messages_inbound_message_id_fkey"
  FOREIGN KEY ("inbound_message_id") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_outbound_messages"
  ADD CONSTRAINT "whatsapp_outbound_messages_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
