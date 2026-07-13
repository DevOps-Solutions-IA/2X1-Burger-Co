ALTER TYPE "WhatsappPaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "whatsapp_delivery_orders"
  ADD COLUMN IF NOT EXISTS "manually_verified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manually_verified_by_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_delivery_orders_manually_verified_by_id_fkey'
  ) THEN
    ALTER TABLE "whatsapp_delivery_orders"
      ADD CONSTRAINT "whatsapp_delivery_orders_manually_verified_by_id_fkey"
      FOREIGN KEY ("manually_verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "whatsapp_delivery_orders_manually_verified_by_id_idx"
  ON "whatsapp_delivery_orders"("manually_verified_by_id");

CREATE TABLE IF NOT EXISTS "sofia_payment_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "cash_enabled" BOOLEAN NOT NULL DEFAULT true,
  "nequi_manual_enabled" BOOLEAN NOT NULL DEFAULT true,
  "nequi_manual_phone" TEXT,
  "nequi_manual_holder_name" TEXT,
  "prepare_cash_orders_immediately" BOOLEAN NOT NULL DEFAULT true,
  "prepare_manual_transfer_before_verification" BOOLEAN NOT NULL DEFAULT false,
  "manual_payment_requires_operator" BOOLEAN NOT NULL DEFAULT true,
  "payment_instructions_text" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sofia_payment_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "sofia_payment_settings" ("id")
VALUES ('default')
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "sofia_payment_events" (
  "id" TEXT NOT NULL,
  "whatsapp_delivery_order_id" TEXT NOT NULL,
  "order_ticket_id" TEXT,
  "actor_id" TEXT,
  "event_type" TEXT NOT NULL,
  "payment_method" TEXT,
  "previous_status" "WhatsappPaymentStatus",
  "new_status" "WhatsappPaymentStatus" NOT NULL,
  "message" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sofia_payment_events_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sofia_payment_events_whatsapp_delivery_order_id_fkey'
  ) THEN
    ALTER TABLE "sofia_payment_events"
      ADD CONSTRAINT "sofia_payment_events_whatsapp_delivery_order_id_fkey"
      FOREIGN KEY ("whatsapp_delivery_order_id") REFERENCES "whatsapp_delivery_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sofia_payment_events_actor_id_fkey'
  ) THEN
    ALTER TABLE "sofia_payment_events"
      ADD CONSTRAINT "sofia_payment_events_actor_id_fkey"
      FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "sofia_payment_events_whatsapp_delivery_order_id_created_at_idx"
  ON "sofia_payment_events"("whatsapp_delivery_order_id", "created_at");

CREATE INDEX IF NOT EXISTS "sofia_payment_events_order_ticket_id_created_at_idx"
  ON "sofia_payment_events"("order_ticket_id", "created_at");

CREATE INDEX IF NOT EXISTS "sofia_payment_events_actor_id_created_at_idx"
  ON "sofia_payment_events"("actor_id", "created_at");
