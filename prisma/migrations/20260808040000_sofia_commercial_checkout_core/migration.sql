-- CreateEnum
CREATE TYPE "SofiaPaymentPreference" AS ENUM ('UNKNOWN', 'ONLINE', 'CASH_ON_DELIVERY', 'PAY_AT_PICKUP');

-- AlterTable
ALTER TABLE "sofia_order_drafts"
ADD COLUMN "customer_id" TEXT,
ADD COLUMN "fulfillment" "OrderTicketType",
ADD COLUMN "payment_preference" "SofiaPaymentPreference" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "draft_hash" TEXT,
ADD COLUMN "expires_at" TIMESTAMP(3),
ADD COLUMN "confirmed_at" TIMESTAMP(3),
ADD COLUMN "confirmation_hash" TEXT,
ADD COLUMN "address_confirmed_at" TIMESTAMP(3),
ADD COLUMN "delivery_quote_audit_id" TEXT,
ADD COLUMN "delivery_quote_version" INTEGER,
ADD COLUMN "delivery_quote_expires_at" TIMESTAMP(3),
ADD COLUMN "availability_snapshot" JSONB,
ADD COLUMN "availability_checked_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sofia_order_drafts_conversation_id_status_expires_at_idx"
ON "sofia_order_drafts"("conversation_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "sofia_order_drafts_customer_id_status_idx"
ON "sofia_order_drafts"("customer_id", "status");

-- CreateIndex
CREATE INDEX "sofia_order_drafts_status_expires_at_idx"
ON "sofia_order_drafts"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "sofia_order_drafts"
ADD CONSTRAINT "sofia_order_drafts_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sofia_order_drafts"
ADD CONSTRAINT "sofia_order_drafts_delivery_quote_audit_id_fkey"
FOREIGN KEY ("delivery_quote_audit_id") REFERENCES "delivery_pricing_audits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
