ALTER TYPE "WhatsappPaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING_ONLINE_PAYMENT';

ALTER TABLE "sofia_payment_settings"
  ADD COLUMN IF NOT EXISTS "online_payments_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "online_payment_provider" TEXT NOT NULL DEFAULT 'MOCK',
  ADD COLUMN IF NOT EXISTS "mock_online_payments_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "bold_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "payment_link_ttl_minutes" INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS "online_payment_expires_minutes" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "prepare_online_orders_before_paid" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "auto_mark_paid_from_webhook" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "whatsapp_delivery_orders"
  ADD COLUMN IF NOT EXISTS "online_payment_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_payment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_checkout_url" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_status" TEXT,
  ADD COLUMN IF NOT EXISTS "online_payment_created_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "online_payment_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "online_payment_paid_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "webhook_last_event_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "webhook_event_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "payment_failure_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_review_reason" TEXT;

CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
  "id" TEXT NOT NULL,
  "whatsapp_delivery_order_id" TEXT,
  "provider" TEXT NOT NULL,
  "event_id" TEXT,
  "provider_payment_id" TEXT,
  "provider_reference" TEXT,
  "order_reference" TEXT,
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amount" DECIMAL(12,2),
  "currency" TEXT,
  "signature_valid" BOOLEAN NOT NULL DEFAULT false,
  "processed_status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "raw_payload" JSONB,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_webhook_events_event_id_key" ON "payment_webhook_events"("event_id");
CREATE INDEX IF NOT EXISTS "whatsapp_delivery_orders_online_payment_provider_provider_payment_id_idx" ON "whatsapp_delivery_orders"("online_payment_provider", "provider_payment_id");
CREATE INDEX IF NOT EXISTS "whatsapp_delivery_orders_order_reference_provider_reference_idx" ON "whatsapp_delivery_orders"("order_reference", "provider_reference");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_provider_provider_payment_id_idx" ON "payment_webhook_events"("provider", "provider_payment_id");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_provider_provider_reference_idx" ON "payment_webhook_events"("provider", "provider_reference");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_order_reference_received_at_idx" ON "payment_webhook_events"("order_reference", "received_at");
CREATE INDEX IF NOT EXISTS "payment_webhook_events_whatsapp_delivery_order_id_received_at_idx" ON "payment_webhook_events"("whatsapp_delivery_order_id", "received_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_webhook_events_whatsapp_delivery_order_id_fkey'
  ) THEN
    ALTER TABLE "payment_webhook_events"
      ADD CONSTRAINT "payment_webhook_events_whatsapp_delivery_order_id_fkey"
      FOREIGN KEY ("whatsapp_delivery_order_id") REFERENCES "whatsapp_delivery_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
