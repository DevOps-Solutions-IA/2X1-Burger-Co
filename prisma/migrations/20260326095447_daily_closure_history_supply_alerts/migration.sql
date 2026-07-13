-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('MOSTRADOR', 'PARA_LLEVAR', 'MESA', 'DOMICILIO');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "channel" "SaleChannel" NOT NULL DEFAULT 'MOSTRADOR',
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "deliveryReference" TEXT,
ADD COLUMN     "tableLabel" TEXT;

-- CreateTable
CREATE TABLE "supplier_notifications" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "whatsappLink" TEXT,
    "payload" JSONB,
    "createdById" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_notifications_supplierId_createdAt_idx" ON "supplier_notifications"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "supplier_notifications_status_createdAt_idx" ON "supplier_notifications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "sales_channel_idx" ON "sales"("channel");

-- AddForeignKey
ALTER TABLE "supplier_notifications" ADD CONSTRAINT "supplier_notifications_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_notifications" ADD CONSTRAINT "supplier_notifications_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
