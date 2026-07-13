DO $$ BEGIN
  CREATE TYPE "SofiaPromptStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SofiaCatalogItemType" AS ENUM ('OFFER', 'PRODUCT', 'ADDITION', 'BEVERAGE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SofiaCatalogItemStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SofiaCatalogPriceSource" AS ENUM ('PRODUCT', 'MANUAL', 'NONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SofiaMemoryConsentState" AS ENUM ('UNKNOWN', 'IMPLIED_BY_CONVERSATION', 'OPTED_OUT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "sofia_prompt_versions" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "SofiaPromptStatus" NOT NULL DEFAULT 'DRAFT',
  "prompt_text" TEXT NOT NULL,
  "system_rules_json" JSONB,
  "commercial_rules_json" JSONB,
  "safety_rules_json" JSONB,
  "created_by" TEXT,
  "approved_by" TEXT,
  "activated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sofia_prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sofia_commercial_catalog_items" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "SofiaCatalogItemType" NOT NULL,
  "status" "SofiaCatalogItemStatus" NOT NULL DEFAULT 'ACTIVE',
  "linked_product_id" TEXT,
  "linked_product_name" TEXT,
  "price_source" "SofiaCatalogPriceSource" NOT NULL DEFAULT 'NONE',
  "manual_price" DECIMAL(12,2),
  "image_url" TEXT,
  "short_description" TEXT,
  "composition_json" JSONB,
  "aliases_json" JSONB,
  "upsell_rules_json" JSONB,
  "prohibited_claims_json" JSONB,
  "sort_order" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sofia_commercial_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sofia_customer_memories" (
  "id" TEXT NOT NULL,
  "phone_normalized" TEXT NOT NULL,
  "display_name" TEXT,
  "last_known_address" TEXT,
  "preferred_payment_method" TEXT,
  "last_order_summary_json" JSONB,
  "preferences_json" JSONB,
  "risk_flags_json" JSONB,
  "memory_summary" TEXT,
  "last_interaction_at" TIMESTAMP(3),
  "consent_state" "SofiaMemoryConsentState" NOT NULL DEFAULT 'UNKNOWN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sofia_customer_memories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sofia_conversation_memories" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "customer_memory_id" TEXT,
  "current_intent" TEXT,
  "current_order_intent_json" JSONB,
  "missing_fields_json" JSONB,
  "last_product_discussed" TEXT,
  "memory_summary" TEXT,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sofia_conversation_memories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sofia_commercial_rule_events" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "customer_memory_id" TEXT,
  "rule_code" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "action_taken" TEXT NOT NULL,
  "details_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sofia_commercial_rule_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sofia_prompt_versions_version_key" ON "sofia_prompt_versions"("version");
CREATE INDEX IF NOT EXISTS "sofia_prompt_versions_status_updated_at_idx" ON "sofia_prompt_versions"("status", "updated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "sofia_commercial_catalog_items_slug_key" ON "sofia_commercial_catalog_items"("slug");
CREATE INDEX IF NOT EXISTS "sofia_commercial_catalog_items_type_status_sort_order_idx" ON "sofia_commercial_catalog_items"("type", "status", "sort_order");
CREATE INDEX IF NOT EXISTS "sofia_commercial_catalog_items_linked_product_id_idx" ON "sofia_commercial_catalog_items"("linked_product_id");

CREATE UNIQUE INDEX IF NOT EXISTS "sofia_customer_memories_phone_normalized_key" ON "sofia_customer_memories"("phone_normalized");
CREATE INDEX IF NOT EXISTS "sofia_customer_memories_last_interaction_at_idx" ON "sofia_customer_memories"("last_interaction_at");

CREATE UNIQUE INDEX IF NOT EXISTS "sofia_conversation_memories_conversation_id_key" ON "sofia_conversation_memories"("conversation_id");
CREATE INDEX IF NOT EXISTS "sofia_conversation_memories_customer_memory_id_idx" ON "sofia_conversation_memories"("customer_memory_id");
CREATE INDEX IF NOT EXISTS "sofia_conversation_memories_expires_at_idx" ON "sofia_conversation_memories"("expires_at");

CREATE INDEX IF NOT EXISTS "sofia_commercial_rule_events_conversation_id_created_at_idx" ON "sofia_commercial_rule_events"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "sofia_commercial_rule_events_customer_memory_id_created_at_idx" ON "sofia_commercial_rule_events"("customer_memory_id", "created_at");
CREATE INDEX IF NOT EXISTS "sofia_commercial_rule_events_rule_code_created_at_idx" ON "sofia_commercial_rule_events"("rule_code", "created_at");

ALTER TABLE "sofia_conversation_memories"
  ADD CONSTRAINT "sofia_conversation_memories_customer_memory_id_fkey"
  FOREIGN KEY ("customer_memory_id") REFERENCES "sofia_customer_memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sofia_commercial_rule_events"
  ADD CONSTRAINT "sofia_commercial_rule_events_customer_memory_id_fkey"
  FOREIGN KEY ("customer_memory_id") REFERENCES "sofia_customer_memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
