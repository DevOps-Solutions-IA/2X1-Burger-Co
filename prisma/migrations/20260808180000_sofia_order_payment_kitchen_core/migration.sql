-- CreateEnum
CREATE TYPE "OrderCheckoutSource" AS ENUM ('SOFIA', 'POS', 'DELIVERY', 'AUTHORIZED_OPERATOR');

-- CreateEnum
CREATE TYPE "OrderCheckoutStatus" AS ENUM ('CONFIRMED', 'PAYMENT_SELECTION_REQUIRED', 'PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'KITCHEN_ELIGIBLE', 'ORDER_CREATED', 'CANCELLED', 'EXPIRED', 'FINANCIAL_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "PaymentIntentProvider" AS ENUM ('BOLD', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'LINK_READY', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED', 'UNKNOWN_RESULT', 'FINANCIAL_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('ACTIVE', 'OPENED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "order_checkouts" (
    "id" TEXT NOT NULL,
    "source" "OrderCheckoutSource" NOT NULL,
    "source_reference" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "sofia_draft_id" TEXT,
    "sofia_draft_version" INTEGER,
    "sofia_draft_hash" TEXT,
    "confirmation_hash" TEXT,
    "customer_id" TEXT,
    "customer_snapshot" JSONB,
    "items_snapshot" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "fulfillment" "OrderTicketType" NOT NULL,
    "payment_preference" "SofiaPaymentPreference" NOT NULL,
    "status" "OrderCheckoutStatus" NOT NULL DEFAULT 'CONFIRMED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "kitchen_eligible_at" TIMESTAMP(3),
    "order_ticket_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "checkout_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider" "PaymentIntentProvider" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "provider_payment_id" TEXT,
    "provider_reference" TEXT,
    "provider_account_hash" TEXT,
    "failure_code" TEXT,
    "expires_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "payment_intent_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "provider_reference" TEXT,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "opened_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transitions" (
    "id" TEXT NOT NULL,
    "payment_intent_id" TEXT NOT NULL,
    "from_status" "PaymentIntentStatus",
    "to_status" "PaymentIntentStatus" NOT NULL,
    "reason_code" TEXT NOT NULL,
    "actor_id" TEXT,
    "webhook_event_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "sanitized_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transitions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "payment_webhook_events"
ADD COLUMN "payment_intent_id" TEXT,
ADD COLUMN "payload_hash" TEXT,
ADD COLUMN "provider_account_hash" TEXT;

-- AlterTable
ALTER TABLE "order_ticket_items"
ADD COLUMN "modifiers_snapshot" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "sale_payments"
ADD COLUMN "payment_intent_id" TEXT;

-- Abort before widening webhook idempotency if current evidence contains a scoped collision.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "payment_webhook_events"
    WHERE "event_id" IS NOT NULL
    GROUP BY "provider", "event_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'payment_webhook_events contains duplicate (provider,event_id) evidence';
  END IF;
END $$;

-- DropIndex (authorized widening from global event identity to provider-scoped identity)
DROP INDEX "payment_webhook_events_event_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "order_checkouts_order_ticket_id_key" ON "order_checkouts"("order_ticket_id");
CREATE UNIQUE INDEX "order_checkouts_source_idempotency_key_key" ON "order_checkouts"("source", "idempotency_key");
CREATE UNIQUE INDEX "order_checkouts_sofia_draft_id_sofia_draft_version_key" ON "order_checkouts"("sofia_draft_id", "sofia_draft_version");
CREATE INDEX "order_checkouts_status_expires_at_idx" ON "order_checkouts"("status", "expires_at");
CREATE INDEX "order_checkouts_customer_id_created_at_idx" ON "order_checkouts"("customer_id", "created_at");
CREATE INDEX "order_checkouts_source_source_reference_idx" ON "order_checkouts"("source", "source_reference");

CREATE UNIQUE INDEX "payment_intents_checkout_id_attempt_number_key" ON "payment_intents"("checkout_id", "attempt_number");
CREATE UNIQUE INDEX "payment_intents_provider_idempotency_key_key" ON "payment_intents"("provider", "idempotency_key");
CREATE UNIQUE INDEX "payment_intents_provider_provider_payment_id_key" ON "payment_intents"("provider", "provider_payment_id");
CREATE INDEX "payment_intents_checkout_id_status_idx" ON "payment_intents"("checkout_id", "status");
CREATE INDEX "payment_intents_status_expires_at_idx" ON "payment_intents"("status", "expires_at");
CREATE INDEX "payment_intents_provider_provider_reference_idx" ON "payment_intents"("provider", "provider_reference");

CREATE UNIQUE INDEX "payment_links_token_hash_key" ON "payment_links"("token_hash");
CREATE INDEX "payment_links_payment_intent_id_status_idx" ON "payment_links"("payment_intent_id", "status");
CREATE INDEX "payment_links_status_expires_at_idx" ON "payment_links"("status", "expires_at");

CREATE UNIQUE INDEX "payment_transitions_webhook_event_id_key" ON "payment_transitions"("webhook_event_id");
CREATE UNIQUE INDEX "payment_transitions_payment_intent_id_idempotency_key_key" ON "payment_transitions"("payment_intent_id", "idempotency_key");
CREATE INDEX "payment_transitions_payment_intent_id_created_at_idx" ON "payment_transitions"("payment_intent_id", "created_at");

CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");
CREATE INDEX "payment_webhook_events_payment_intent_id_received_at_idx" ON "payment_webhook_events"("payment_intent_id", "received_at");
CREATE UNIQUE INDEX "sale_payments_payment_intent_id_key" ON "sale_payments"("payment_intent_id");

-- AddForeignKey
ALTER TABLE "order_checkouts" ADD CONSTRAINT "order_checkouts_sofia_draft_id_fkey" FOREIGN KEY ("sofia_draft_id") REFERENCES "sofia_order_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_checkouts" ADD CONSTRAINT "order_checkouts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_checkouts" ADD CONSTRAINT "order_checkouts_order_ticket_id_fkey" FOREIGN KEY ("order_ticket_id") REFERENCES "order_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "order_checkouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_transitions" ADD CONSTRAINT "payment_transitions_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_transitions" ADD CONSTRAINT "payment_transitions_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "payment_webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
