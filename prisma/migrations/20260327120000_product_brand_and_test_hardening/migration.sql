CREATE TYPE "ProductBrand" AS ENUM ('HOUSE', 'COCA_COLA', 'POSTOBON', 'HIT', 'OTHER');

ALTER TABLE "products"
ADD COLUMN "brand" "ProductBrand" NOT NULL DEFAULT 'HOUSE';

UPDATE "products"
SET "brand" = 'COCA_COLA'
WHERE "code" LIKE 'CC-%'
   OR "code" LIKE 'SPR-%'
   OR "code" LIKE 'FAN-%'
   OR "code" LIKE 'QUA-%'
   OR "code" LIKE 'DAS-%'
   OR "code" LIKE 'BRI-%';

UPDATE "products"
SET "brand" = 'POSTOBON'
WHERE "code" LIKE 'PST-%'
   OR "code" LIKE 'AQUA-%';

UPDATE "products"
SET "brand" = 'HIT'
WHERE "code" LIKE 'HITP-%'
   OR "code" LIKE 'HITB-%';

CREATE INDEX "products_brand_idx" ON "products"("brand");
