-- CreateEnum
CREATE TYPE "NotificationIntentStatus" AS ENUM (
  'PENDING',
  'SUPPRESSED',
  'CLAIMED',
  'COMMAND_PENDING',
  'DISPATCHED',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN_RESULT',
  'EXPIRED'
);

-- CreateEnum
CREATE TYPE "CustomerServiceCaseCategory" AS ENUM (
  'LATE_ORDER',
  'WRONG_ITEM',
  'MISSING_ITEM',
  'COLD_FOOD',
  'QUALITY',
  'PAYMENT_PROBLEM',
  'DELIVERY_PROBLEM',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "CustomerServiceCaseStatus" AS ENUM (
  'OPEN',
  'HUMAN_REQUIRED',
  'HUMAN_TAKEN',
  'RESOLVED',
  'CLOSED'
);

-- Extend existing state and inbox records with default-safe recovery metadata.
ALTER TABLE "order_tickets"
  ADD COLUMN "delivery_workflow_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "delivery_location_inbox"
  ADD COLUMN "source_event_key" TEXT,
  ADD COLUMN "payload_hash" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "delivery_issues"
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "payment_webhook_events"
  ADD COLUMN "processing_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processing_lease_owner_hash" TEXT,
  ADD COLUMN "processing_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "next_retry_at" TIMESTAMP(3),
  ADD COLUMN "result_code" TEXT,
  ADD COLUMN "deterministic_result" JSONB,
  ADD COLUMN "last_error_code" TEXT,
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "whatsapp_inbound_events"
  ADD COLUMN "processing_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processing_lease_owner_hash" TEXT,
  ADD COLUMN "processing_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "next_retry_at" TIMESTAMP(3),
  ADD COLUMN "last_error_code" TEXT,
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false;

-- Future writes must provide explicit provider provenance. Historical values are untouched.
ALTER TABLE "whatsapp_conversations" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "whatsapp_messages" ALTER COLUMN "provider" DROP DEFAULT;

-- Append-only delivery transition evidence. OrderTicket remains current-state authority.
CREATE TABLE "delivery_workflow_events" (
  "id" TEXT NOT NULL,
  "order_ticket_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "from_status" "DeliveryWorkflowStatus",
  "to_status" "DeliveryWorkflowStatus" NOT NULL,
  "actor_id" TEXT,
  "reason_code" TEXT NOT NULL,
  "sanitized_metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_workflow_events_pkey" PRIMARY KEY ("id")
);

-- Channel-independent durable notification outbox.
CREATE TABLE "notification_intents" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "source_event_id" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "customer_id" TEXT,
  "conversation_id" TEXT,
  "channel" "CustomerConsentChannel" NOT NULL,
  "purpose" "CustomerConsentPurpose" NOT NULL,
  "fact_envelope" JSONB NOT NULL,
  "fact_hash" TEXT NOT NULL,
  "policy_outcome" TEXT NOT NULL,
  "policy_reason" TEXT,
  "consent_version" INTEGER,
  "handoff_version" INTEGER,
  "status" "NotificationIntentStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claim_owner_hash" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "next_retry_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "outbound_message_id" TEXT,
  "secure_command_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_intents_pkey" PRIMARY KEY ("id")
);

-- Canonical customer complaint/recovery case.
CREATE TABLE "customer_service_cases" (
  "id" TEXT NOT NULL,
  "category" "CustomerServiceCaseCategory" NOT NULL,
  "status" "CustomerServiceCaseStatus" NOT NULL DEFAULT 'OPEN',
  "source" TEXT NOT NULL,
  "source_reference" TEXT NOT NULL,
  "evidence_hash" TEXT NOT NULL,
  "sanitized_summary" TEXT NOT NULL,
  "customer_id" TEXT,
  "conversation_id" TEXT,
  "order_checkout_id" TEXT,
  "order_ticket_id" TEXT,
  "payment_intent_id" TEXT,
  "delivery_issue_id" TEXT,
  "assigned_actor_id" TEXT,
  "resolution_actor_id" TEXT,
  "resolution_code" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  CONSTRAINT "customer_service_cases_pkey" PRIMARY KEY ("id")
);

-- Append-only customer service case history.
CREATE TABLE "customer_service_case_events" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" "CustomerServiceCaseStatus",
  "to_status" "CustomerServiceCaseStatus" NOT NULL,
  "actor_id" TEXT,
  "reason_code" TEXT NOT NULL,
  "sanitized_metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_service_case_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_workflow_events_order_ticket_id_version_key"
  ON "delivery_workflow_events" ("order_ticket_id", "version");
CREATE UNIQUE INDEX "delivery_workflow_events_order_ticket_id_idempotency_key_key"
  ON "delivery_workflow_events" ("order_ticket_id", "idempotency_key");
CREATE INDEX "delivery_workflow_events_order_ticket_id_created_at_idx"
  ON "delivery_workflow_events" ("order_ticket_id", "created_at");
CREATE INDEX "delivery_workflow_events_to_status_created_at_idx"
  ON "delivery_workflow_events" ("to_status", "created_at");
CREATE INDEX "delivery_workflow_events_actor_id_created_at_idx"
  ON "delivery_workflow_events" ("actor_id", "created_at");

CREATE UNIQUE INDEX "notification_intents_outbound_message_id_key"
  ON "notification_intents" ("outbound_message_id");
CREATE UNIQUE INDEX "notification_intents_secure_command_id_key"
  ON "notification_intents" ("secure_command_id");
CREATE UNIQUE INDEX "notification_intents_aggregate_type_source_event_id_channel_key"
  ON "notification_intents" ("aggregate_type", "source_event_id", "channel", "purpose");
CREATE INDEX "notification_intents_status_next_retry_at_lease_expires_at_idx"
  ON "notification_intents" ("status", "next_retry_at", "lease_expires_at");
CREATE INDEX "notification_intents_aggregate_type_aggregate_id_aggregate__idx"
  ON "notification_intents" ("aggregate_type", "aggregate_id", "aggregate_version");
CREATE INDEX "notification_intents_conversation_id_created_at_idx"
  ON "notification_intents" ("conversation_id", "created_at");
CREATE INDEX "notification_intents_customer_id_created_at_idx"
  ON "notification_intents" ("customer_id", "created_at");

CREATE UNIQUE INDEX "customer_service_cases_source_source_reference_key"
  ON "customer_service_cases" ("source", "source_reference");
CREATE INDEX "customer_service_cases_status_created_at_idx"
  ON "customer_service_cases" ("status", "created_at");
CREATE INDEX "customer_service_cases_category_status_idx"
  ON "customer_service_cases" ("category", "status");
CREATE INDEX "customer_service_cases_customer_id_created_at_idx"
  ON "customer_service_cases" ("customer_id", "created_at");
CREATE INDEX "customer_service_cases_order_ticket_id_status_idx"
  ON "customer_service_cases" ("order_ticket_id", "status");
CREATE INDEX "customer_service_cases_conversation_id_status_idx"
  ON "customer_service_cases" ("conversation_id", "status");
CREATE INDEX "customer_service_cases_payment_intent_id_status_idx"
  ON "customer_service_cases" ("payment_intent_id", "status");

CREATE UNIQUE INDEX "customer_service_case_events_case_id_version_key"
  ON "customer_service_case_events" ("case_id", "version");
CREATE UNIQUE INDEX "customer_service_case_events_case_id_idempotency_key_key"
  ON "customer_service_case_events" ("case_id", "idempotency_key");
CREATE INDEX "customer_service_case_events_case_id_created_at_idx"
  ON "customer_service_case_events" ("case_id", "created_at");
CREATE INDEX "customer_service_case_events_actor_id_created_at_idx"
  ON "customer_service_case_events" ("actor_id", "created_at");

CREATE UNIQUE INDEX "delivery_issues_order_ticket_id_idempotency_key_key"
  ON "delivery_issues" ("order_ticket_id", "idempotency_key");
CREATE UNIQUE INDEX "delivery_location_inbox_source_event_key_key"
  ON "delivery_location_inbox" ("source_event_key");
CREATE INDEX "payment_webhook_events_processed_status_next_retry_at_proce_idx"
  ON "payment_webhook_events" ("processed_status", "next_retry_at", "processing_lease_expires_at");
CREATE INDEX "whatsapp_inbound_events_processing_status_next_retry_at_pro_idx"
  ON "whatsapp_inbound_events" ("processing_status", "next_retry_at", "processing_lease_expires_at");

ALTER TABLE "delivery_workflow_events"
  ADD CONSTRAINT "delivery_workflow_events_order_ticket_id_fkey"
  FOREIGN KEY ("order_ticket_id") REFERENCES "order_tickets" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "delivery_workflow_events"
  ADD CONSTRAINT "delivery_workflow_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "notification_intents"
  ADD CONSTRAINT "notification_intents_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "crm_customers" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "notification_intents"
  ADD CONSTRAINT "notification_intents_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "notification_intents"
  ADD CONSTRAINT "notification_intents_outbound_message_id_fkey"
  FOREIGN KEY ("outbound_message_id") REFERENCES "whatsapp_outbound_messages" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "notification_intents"
  ADD CONSTRAINT "notification_intents_secure_command_id_fkey"
  FOREIGN KEY ("secure_command_id") REFERENCES "sofia_commands" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "customer_service_cases"
  ADD CONSTRAINT "customer_service_cases_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "crm_customers" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "customer_service_cases"
  ADD CONSTRAINT "customer_service_cases_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "customer_service_cases"
  ADD CONSTRAINT "customer_service_cases_order_checkout_id_fkey"
  FOREIGN KEY ("order_checkout_id") REFERENCES "order_checkouts" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "customer_service_cases"
  ADD CONSTRAINT "customer_service_cases_order_ticket_id_fkey"
  FOREIGN KEY ("order_ticket_id") REFERENCES "order_tickets" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "customer_service_cases"
  ADD CONSTRAINT "customer_service_cases_payment_intent_id_fkey"
  FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "customer_service_cases"
  ADD CONSTRAINT "customer_service_cases_delivery_issue_id_fkey"
  FOREIGN KEY ("delivery_issue_id") REFERENCES "delivery_issues" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "customer_service_cases"
  ADD CONSTRAINT "customer_service_cases_assigned_actor_id_fkey"
  FOREIGN KEY ("assigned_actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "customer_service_cases"
  ADD CONSTRAINT "customer_service_cases_resolution_actor_id_fkey"
  FOREIGN KEY ("resolution_actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "customer_service_case_events"
  ADD CONSTRAINT "customer_service_case_events_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "customer_service_cases" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "customer_service_case_events"
  ADD CONSTRAINT "customer_service_case_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
