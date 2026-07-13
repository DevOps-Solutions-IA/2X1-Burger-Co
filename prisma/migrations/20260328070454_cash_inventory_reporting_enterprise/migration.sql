-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountScope" AS ENUM ('CRITICAL', 'ALL', 'PRODUCTS', 'INGREDIENTS');

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "classification" TEXT;

-- AlterTable
ALTER TABLE "cash_sessions" ADD COLUMN     "closing_breakdown" JSONB,
ADD COLUMN     "opening_breakdown" JSONB,
ADD COLUMN     "reopen_reason" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "reopened_by_id" TEXT,
ADD COLUMN     "reopened_from_session_id" TEXT;

-- CreateTable
CREATE TABLE "stock_count_sessions" (
    "id" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'COMPLETED',
    "scope" "StockCountScope" NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_count_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "productId" TEXT,
    "expectedStock" DECIMAL(10,3) NOT NULL,
    "countedStock" DECIMAL(10,3) NOT NULL,
    "difference" DECIMAL(10,3) NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_count_sessions_scope_createdAt_idx" ON "stock_count_sessions"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "stock_count_items_sessionId_idx" ON "stock_count_items"("sessionId");

-- CreateIndex
CREATE INDEX "stock_count_items_ingredientId_idx" ON "stock_count_items"("ingredientId");

-- CreateIndex
CREATE INDEX "stock_count_items_productId_idx" ON "stock_count_items"("productId");

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_reopened_by_id_fkey" FOREIGN KEY ("reopened_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_reopened_from_session_id_fkey" FOREIGN KEY ("reopened_from_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "stock_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
