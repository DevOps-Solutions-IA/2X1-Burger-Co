/*
  Fixes:
  - Change CashSession -> OrderTicket cascade to restrict
  - Add composite index on AuditLog (userId, createdAt)
  - Add index on Product (currentStock)
  - Add @updatedAt to RefreshToken, PurchaseItem, StockCountItem
*/

-- DropForeignKey
ALTER TABLE "order_tickets" DROP CONSTRAINT "order_tickets_cashSessionId_fkey";

-- AlterTable: add updatedAt columns (nullable first for backfill)
ALTER TABLE "refresh_tokens" ADD COLUMN "updatedAt" TIMESTAMP(3);
ALTER TABLE "purchase_items" ADD COLUMN "updatedAt" TIMESTAMP(3);
ALTER TABLE "stock_count_items" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Backfill existing rows with createdAt value
UPDATE "refresh_tokens" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
UPDATE "purchase_items" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
UPDATE "stock_count_items" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- Set columns to NOT NULL after backfill
ALTER TABLE "refresh_tokens" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "purchase_items" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "stock_count_items" ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "products_currentStock_idx" ON "products"("currentStock");

-- AddForeignKey with RESTRICT
ALTER TABLE "order_tickets" ADD CONSTRAINT "order_tickets_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
