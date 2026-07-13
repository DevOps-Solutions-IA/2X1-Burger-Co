-- CreateTable
CREATE TABLE "delivery_customers" (
    "id" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT NOT NULL,
    "default_address" TEXT,
    "default_reference" TEXT,
    "last_latitude" DECIMAL(10,7),
    "last_longitude" DECIMAL(10,7),
    "last_zone_label" TEXT,
    "last_distance_km" DECIMAL(8,3),
    "last_location_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_customers_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "order_tickets"
ADD COLUMN "delivery_customer_id" TEXT,
ADD COLUMN "delivery_address_normalized" TEXT,
ADD COLUMN "delivery_latitude" DECIMAL(10,7),
ADD COLUMN "delivery_longitude" DECIMAL(10,7),
ADD COLUMN "delivery_distance_km" DECIMAL(8,3),
ADD COLUMN "delivery_zone_label" TEXT,
ADD COLUMN "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "delivery_location_source" TEXT,
ADD COLUMN "delivery_location_received_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sales"
ADD COLUMN "customerPhone" TEXT,
ADD COLUMN "deliveryFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "deliveryDistanceKm" DECIMAL(8,3),
ADD COLUMN "deliveryZoneLabel" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "delivery_customers_phone_key" ON "delivery_customers"("phone");

-- CreateIndex
CREATE INDEX "delivery_customers_fullName_idx" ON "delivery_customers"("fullName");

-- CreateIndex
CREATE INDEX "order_tickets_delivery_customer_id_idx" ON "order_tickets"("delivery_customer_id");

-- AddForeignKey
ALTER TABLE "order_tickets"
ADD CONSTRAINT "order_tickets_delivery_customer_id_fkey"
FOREIGN KEY ("delivery_customer_id") REFERENCES "delivery_customers"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
