ALTER TABLE "users"
ADD COLUMN "access_name" TEXT,
ADD COLUMN "access_code_hash" TEXT;

CREATE UNIQUE INDEX "users_access_name_key" ON "users"("access_name");
