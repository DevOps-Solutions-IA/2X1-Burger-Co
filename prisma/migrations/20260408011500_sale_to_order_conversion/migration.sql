-- Track audited conversion of an already paid direct sale into a new open order ticket.
-- The original sale remains immutable enough for audit, while reports ignore it once its status is changed.
CREATE TABLE "sale_conversions" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "orderTicketId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "convertedById" TEXT NOT NULL,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_conversions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sale_conversions_saleId_key" ON "sale_conversions"("saleId");
CREATE UNIQUE INDEX "sale_conversions_orderTicketId_key" ON "sale_conversions"("orderTicketId");
CREATE INDEX "sale_conversions_convertedAt_idx" ON "sale_conversions"("convertedAt");
CREATE INDEX "sale_conversions_convertedById_idx" ON "sale_conversions"("convertedById");

ALTER TABLE "sale_conversions" ADD CONSTRAINT "sale_conversions_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_conversions" ADD CONSTRAINT "sale_conversions_orderTicketId_fkey" FOREIGN KEY ("orderTicketId") REFERENCES "order_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_conversions" ADD CONSTRAINT "sale_conversions_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
