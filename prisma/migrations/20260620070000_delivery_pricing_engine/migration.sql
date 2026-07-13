ALTER TABLE "order_tickets"
ADD COLUMN "delivery_fee_suggested" DECIMAL(12,2),
ADD COLUMN "delivery_fee_edited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "delivery_fee_edit_reason" TEXT,
ADD COLUMN "delivery_pricing_status" TEXT,
ADD COLUMN "delivery_pricing_confidence" TEXT,
ADD COLUMN "delivery_pricing_breakdown" JSONB,
ADD COLUMN "delivery_calculation_version" TEXT,
ADD COLUMN "delivery_requires_manual_quote" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "delivery_route_provider" TEXT,
ADD COLUMN "delivery_weather_provider" TEXT,
ADD COLUMN "delivery_geocoding_provider" TEXT,
ADD COLUMN "delivery_estimated_minutes" DECIMAL(8,2);

ALTER TABLE "sales"
ADD COLUMN "delivery_fee_suggested" DECIMAL(12,2),
ADD COLUMN "delivery_fee_edited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "delivery_fee_edit_reason" TEXT,
ADD COLUMN "delivery_pricing_breakdown" JSONB,
ADD COLUMN "delivery_calculation_version" TEXT;

CREATE TABLE "delivery_provider_usage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "usage_date" DATE NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "last_status" TEXT,
    "last_error_code" TEXT,
    "last_error_at" TIMESTAMP(3),
    "circuit_open_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_provider_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_provider_usage_provider_endpoint_usage_date_key" ON "delivery_provider_usage"("provider", "endpoint", "usage_date");
CREATE INDEX "delivery_provider_usage_provider_idx" ON "delivery_provider_usage"("provider");
CREATE INDEX "delivery_provider_usage_endpoint_idx" ON "delivery_provider_usage"("endpoint");
CREATE INDEX "delivery_provider_usage_usage_date_idx" ON "delivery_provider_usage"("usage_date");
CREATE INDEX "delivery_provider_usage_circuit_open_until_idx" ON "delivery_provider_usage"("circuit_open_until");

CREATE TABLE "delivery_pricing_audits" (
    "id" TEXT NOT NULL,
    "order_ticket_id" TEXT,
    "sale_id" TEXT,
    "customer_id" TEXT,
    "operator_id" TEXT,
    "request_json" JSONB NOT NULL,
    "result_json" JSONB NOT NULL,
    "suggested_fee" DECIMAL(12,2),
    "final_fee" DECIMAL(12,2),
    "manual_edited" BOOLEAN NOT NULL DEFAULT false,
    "manual_edit_reason" TEXT,
    "calculation_version" TEXT NOT NULL,
    "provider_summary_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_pricing_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delivery_pricing_audits_order_ticket_id_idx" ON "delivery_pricing_audits"("order_ticket_id");
CREATE INDEX "delivery_pricing_audits_sale_id_idx" ON "delivery_pricing_audits"("sale_id");
CREATE INDEX "delivery_pricing_audits_customer_id_idx" ON "delivery_pricing_audits"("customer_id");
CREATE INDEX "delivery_pricing_audits_operator_id_idx" ON "delivery_pricing_audits"("operator_id");
CREATE INDEX "delivery_pricing_audits_created_at_idx" ON "delivery_pricing_audits"("created_at");
