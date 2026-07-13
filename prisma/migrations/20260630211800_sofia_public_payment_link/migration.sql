ALTER TABLE "whatsapp_delivery_orders"
  ADD COLUMN "public_payment_token" TEXT,
  ADD COLUMN "public_payment_token_expires_at" TIMESTAMP(3),
  ADD COLUMN "payment_link_created_at" TIMESTAMP(3),
  ADD COLUMN "payment_link_last_opened_at" TIMESTAMP(3),
  ADD COLUMN "payment_link_open_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payment_method_selected_at" TIMESTAMP(3),
  ADD COLUMN "order_reference" TEXT;

CREATE UNIQUE INDEX "whatsapp_delivery_orders_public_payment_token_key"
  ON "whatsapp_delivery_orders"("public_payment_token");

CREATE UNIQUE INDEX "whatsapp_delivery_orders_order_reference_key"
  ON "whatsapp_delivery_orders"("order_reference");

CREATE INDEX "whatsapp_delivery_orders_public_payment_token_expires_at_idx"
  ON "whatsapp_delivery_orders"("public_payment_token_expires_at");
