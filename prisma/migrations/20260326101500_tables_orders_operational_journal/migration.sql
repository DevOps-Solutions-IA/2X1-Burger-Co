-- CreateEnum
CREATE TYPE "DiningTableStatus" AS ENUM ('FREE', 'OCCUPIED', 'RESERVED', 'PAYMENT_PENDING', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "OrderTicketStatus" AS ENUM ('OPEN', 'IN_PREPARATION', 'SERVED', 'PAYMENT_PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderTicketType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'COUNTER');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "orderTicketId" TEXT;

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "area" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "status" "DiningTableStatus" NOT NULL DEFAULT 'FREE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_tickets" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "OrderTicketStatus" NOT NULL DEFAULT 'OPEN',
    "type" "OrderTicketType" NOT NULL DEFAULT 'COUNTER',
    "customerName" TEXT,
    "customerPhone" TEXT,
    "deliveryReference" TEXT,
    "tableId" TEXT,
    "cashSessionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "servedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_ticket_items" (
    "id" TEXT NOT NULL,
    "orderTicketId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_ticket_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_label_key" ON "dining_tables"("label");

-- CreateIndex
CREATE INDEX "dining_tables_status_isActive_idx" ON "dining_tables"("status", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "order_tickets_number_key" ON "order_tickets"("number");

-- CreateIndex
CREATE INDEX "order_tickets_status_openedAt_idx" ON "order_tickets"("status", "openedAt");

-- CreateIndex
CREATE INDEX "order_tickets_tableId_status_idx" ON "order_tickets"("tableId", "status");

-- CreateIndex
CREATE INDEX "order_tickets_cashSessionId_status_idx" ON "order_tickets"("cashSessionId", "status");

-- CreateIndex
CREATE INDEX "order_ticket_items_orderTicketId_idx" ON "order_ticket_items"("orderTicketId");

-- CreateIndex
CREATE INDEX "order_ticket_items_productId_idx" ON "order_ticket_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orderTicketId_key" ON "sales"("orderTicketId");

-- CreateIndex
CREATE INDEX "sales_orderTicketId_idx" ON "sales"("orderTicketId");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_orderTicketId_fkey" FOREIGN KEY ("orderTicketId") REFERENCES "order_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tickets" ADD CONSTRAINT "order_tickets_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tickets" ADD CONSTRAINT "order_tickets_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tickets" ADD CONSTRAINT "order_tickets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_ticket_items" ADD CONSTRAINT "order_ticket_items_orderTicketId_fkey" FOREIGN KEY ("orderTicketId") REFERENCES "order_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_ticket_items" ADD CONSTRAINT "order_ticket_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
