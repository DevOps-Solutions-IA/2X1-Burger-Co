CREATE TABLE "external_api_cache" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cache_type" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_json" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_api_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_api_cache_provider_cache_type_cache_key_key" ON "external_api_cache"("provider", "cache_type", "cache_key");
CREATE INDEX "external_api_cache_expires_at_idx" ON "external_api_cache"("expires_at");
CREATE INDEX "external_api_cache_provider_idx" ON "external_api_cache"("provider");
CREATE INDEX "external_api_cache_cache_type_idx" ON "external_api_cache"("cache_type");
CREATE INDEX "external_api_cache_status_idx" ON "external_api_cache"("status");
