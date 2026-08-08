CREATE TYPE "WhatsappInboundEventKind" AS ENUM ('INBOUND_MESSAGE', 'STATUS_EVENT', 'UNSUPPORTED_EVENT');
CREATE TYPE "WhatsappDeliveryStatus" AS ENUM ('ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN');
CREATE TYPE "WhatsappMediaSecurityStatus" AS ENUM ('METADATA_ONLY', 'QUARANTINED', 'REJECTED', 'CLEARED');

CREATE TABLE "whatsapp_provider_accounts" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "external_account_hash" TEXT NOT NULL,
  "business_identity_hash" TEXT NOT NULL,
  "business_identity_mask" TEXT,
  "session_owner_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DISABLED',
  "configuration_version" INTEGER NOT NULL DEFAULT 1,
  "last_verified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_provider_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "whatsapp_conversations"
  ADD COLUMN "handoff_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "whatsapp_inbound_events"
  ADD COLUMN "account_id" TEXT,
  ADD COLUMN "event_kind" "WhatsappInboundEventKind" NOT NULL DEFAULT 'INBOUND_MESSAGE',
  ADD COLUMN "normalized_payload_hash" TEXT,
  ADD COLUMN "deterministic_result" JSONB;

ALTER TABLE "whatsapp_outbound_messages"
  ADD COLUMN "account_id" TEXT,
  ADD COLUMN "secure_command_id" TEXT,
  ADD COLUMN "recipient_identity_hash" TEXT,
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "unknown_result" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "whatsapp_message_status_events" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "outbound_message_id" TEXT,
  "message_id" TEXT,
  "provider_status_event_id" TEXT NOT NULL,
  "provider_message_id" TEXT NOT NULL,
  "status" "WhatsappDeliveryStatus" NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_message_status_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_handoff_events" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "previous_state" TEXT NOT NULL,
  "next_state" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_handoff_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_media_envelopes" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "provider_reference_hash" TEXT NOT NULL,
  "declared_mime_type" TEXT,
  "detected_mime_type" TEXT,
  "declared_size_bytes" BIGINT,
  "security_status" "WhatsappMediaSecurityStatus" NOT NULL DEFAULT 'METADATA_ONLY',
  "rejection_code" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_media_envelopes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_provider_accounts_provider_external_account_hash_key"
  ON "whatsapp_provider_accounts"("provider", "external_account_hash");
CREATE INDEX "whatsapp_provider_accounts_provider_status_idx"
  ON "whatsapp_provider_accounts"("provider", "status");
CREATE INDEX "whatsapp_provider_accounts_business_identity_hash_idx"
  ON "whatsapp_provider_accounts"("business_identity_hash");

CREATE UNIQUE INDEX "whatsapp_inbound_events_account_id_provider_event_id_key"
  ON "whatsapp_inbound_events"("account_id", "provider_event_id");
CREATE INDEX "whatsapp_inbound_events_account_id_event_kind_received_at_idx"
  ON "whatsapp_inbound_events"("account_id", "event_kind", "received_at");

CREATE UNIQUE INDEX "whatsapp_outbound_messages_secure_command_id_key"
  ON "whatsapp_outbound_messages"("secure_command_id");
CREATE INDEX "whatsapp_outbound_messages_account_id_provider_message_id_idx"
  ON "whatsapp_outbound_messages"("account_id", "provider_message_id");
CREATE INDEX "whatsapp_outbound_messages_recipient_identity_hash_created_at_idx"
  ON "whatsapp_outbound_messages"("recipient_identity_hash", "created_at");

CREATE UNIQUE INDEX "whatsapp_message_status_events_account_id_provider_status_event_id_key"
  ON "whatsapp_message_status_events"("account_id", "provider_status_event_id");
CREATE INDEX "whatsapp_message_status_events_account_id_provider_message_id_occurred_at_idx"
  ON "whatsapp_message_status_events"("account_id", "provider_message_id", "occurred_at");
CREATE INDEX "whatsapp_message_status_events_outbound_message_id_occurred_at_idx"
  ON "whatsapp_message_status_events"("outbound_message_id", "occurred_at");
CREATE INDEX "whatsapp_message_status_events_status_occurred_at_idx"
  ON "whatsapp_message_status_events"("status", "occurred_at");

CREATE UNIQUE INDEX "whatsapp_handoff_events_conversation_id_version_key"
  ON "whatsapp_handoff_events"("conversation_id", "version");
CREATE INDEX "whatsapp_handoff_events_actor_id_created_at_idx"
  ON "whatsapp_handoff_events"("actor_id", "created_at");
CREATE INDEX "whatsapp_handoff_events_next_state_created_at_idx"
  ON "whatsapp_handoff_events"("next_state", "created_at");

CREATE UNIQUE INDEX "whatsapp_media_envelopes_message_id_key"
  ON "whatsapp_media_envelopes"("message_id");
CREATE INDEX "whatsapp_media_envelopes_security_status_expires_at_idx"
  ON "whatsapp_media_envelopes"("security_status", "expires_at");

ALTER TABLE "whatsapp_inbound_events"
  ADD CONSTRAINT "whatsapp_inbound_events_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "whatsapp_provider_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_outbound_messages"
  ADD CONSTRAINT "whatsapp_outbound_messages_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "whatsapp_provider_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "whatsapp_outbound_messages"
  ADD CONSTRAINT "whatsapp_outbound_messages_secure_command_id_fkey"
  FOREIGN KEY ("secure_command_id") REFERENCES "sofia_commands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_message_status_events"
  ADD CONSTRAINT "whatsapp_message_status_events_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "whatsapp_provider_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "whatsapp_message_status_events"
  ADD CONSTRAINT "whatsapp_message_status_events_outbound_message_id_fkey"
  FOREIGN KEY ("outbound_message_id") REFERENCES "whatsapp_outbound_messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "whatsapp_message_status_events"
  ADD CONSTRAINT "whatsapp_message_status_events_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_handoff_events"
  ADD CONSTRAINT "whatsapp_handoff_events_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "whatsapp_handoff_events"
  ADD CONSTRAINT "whatsapp_handoff_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_media_envelopes"
  ADD CONSTRAINT "whatsapp_media_envelopes_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "whatsapp_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
