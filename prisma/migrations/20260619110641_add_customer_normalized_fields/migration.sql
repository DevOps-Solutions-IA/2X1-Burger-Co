-- AlterTable
ALTER TABLE "delivery_customers" ADD COLUMN     "default_address_normalized" TEXT,
ADD COLUMN     "full_name_normalized" TEXT,
ADD COLUMN     "phone_normalized" TEXT;

-- CreateIndex
CREATE INDEX "delivery_customers_phone_normalized_idx" ON "delivery_customers"("phone_normalized");
