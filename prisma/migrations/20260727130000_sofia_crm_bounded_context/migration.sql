CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "CustomerIdentityType" AS ENUM ('PHONE');
CREATE TYPE "CustomerConsentPurpose" AS ENUM ('MARKETING', 'SERVICE');
CREATE TYPE "CustomerConsentChannel" AS ENUM ('WHATSAPP', 'SMS', 'PHONE');
CREATE TYPE "CustomerConsentStatus" AS ENUM ('GRANTED', 'REVOKED');
CREATE TYPE "CustomerInteractionChannel" AS ENUM ('WHATSAPP', 'PHONE', 'IN_PERSON', 'SYSTEM');
CREATE TYPE "CustomerInteractionDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');
CREATE TYPE "CustomerSegmentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "CustomerCampaignStatus" AS ENUM ('DRAFT', 'BLOCKED', 'CANCELLED');
CREATE TYPE "CustomerCampaignDeliveryStatus" AS ENUM ('PENDING', 'BLOCKED', 'CANCELLED');

CREATE TABLE "crm_customers" (
  "id" TEXT NOT NULL,
  "display_name" TEXT,
  "display_name_normalized" TEXT,
  "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_customer_identities" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "type" "CustomerIdentityType" NOT NULL,
  "value_hash" TEXT NOT NULL,
  "value_masked" TEXT NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "verified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_customer_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_customer_consents" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "purpose" "CustomerConsentPurpose" NOT NULL,
  "channel" "CustomerConsentChannel" NOT NULL,
  "status" "CustomerConsentStatus" NOT NULL,
  "source" TEXT NOT NULL,
  "evidence_hash" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "granted_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_customer_consents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_customer_interactions" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "channel" "CustomerInteractionChannel" NOT NULL,
  "direction" "CustomerInteractionDirection" NOT NULL,
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "actor_id" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_customer_interactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_customer_tags" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_normalized" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_customer_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_customer_tag_assignments" (
  "customer_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  "assigned_by_id" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_customer_tag_assignments_pkey" PRIMARY KEY ("customer_id", "tag_id")
);

CREATE TABLE "crm_customer_segments" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_normalized" TEXT NOT NULL,
  "description" TEXT,
  "status" "CustomerSegmentStatus" NOT NULL DEFAULT 'DRAFT',
  "definition_json" JSONB,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_customer_segments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_customer_segment_memberships" (
  "segment_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_customer_segment_memberships_pkey" PRIMARY KEY ("segment_id", "customer_id")
);

CREATE TABLE "crm_customer_campaigns" (
  "id" TEXT NOT NULL,
  "segment_id" TEXT,
  "name" TEXT NOT NULL,
  "channel" "CustomerConsentChannel" NOT NULL DEFAULT 'WHATSAPP',
  "message_template" TEXT NOT NULL,
  "status" "CustomerCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "blocked_reason" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_customer_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_customer_campaign_deliveries" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "identity_id" TEXT,
  "recipient_masked" TEXT NOT NULL,
  "status" "CustomerCampaignDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "blocked_reason" TEXT,
  "attempted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_customer_campaign_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "delivery_customers" ADD COLUMN "customer_id" TEXT;
ALTER TABLE "whatsapp_conversations" ADD COLUMN "customer_id" TEXT;
ALTER TABLE "sofia_customer_memories" ADD COLUMN "customer_id" TEXT;

CREATE INDEX "crm_customers_display_name_normalized_idx" ON "crm_customers"("display_name_normalized");
CREATE INDEX "crm_customers_status_updated_at_idx" ON "crm_customers"("status", "updated_at");
CREATE UNIQUE INDEX "crm_customer_identities_type_value_hash_key" ON "crm_customer_identities"("type", "value_hash");
CREATE INDEX "crm_customer_identities_customer_id_type_idx" ON "crm_customer_identities"("customer_id", "type");
CREATE UNIQUE INDEX "crm_customer_consents_customer_id_purpose_channel_version_key" ON "crm_customer_consents"("customer_id", "purpose", "channel", "version");
CREATE INDEX "crm_customer_consents_customer_id_purpose_channel_created_a_idx" ON "crm_customer_consents"("customer_id", "purpose", "channel", "created_at");
CREATE INDEX "crm_customer_consents_status_created_at_idx" ON "crm_customer_consents"("status", "created_at");
CREATE INDEX "crm_customer_interactions_customer_id_occurred_at_idx" ON "crm_customer_interactions"("customer_id", "occurred_at");
CREATE INDEX "crm_customer_interactions_kind_occurred_at_idx" ON "crm_customer_interactions"("kind", "occurred_at");
CREATE UNIQUE INDEX "crm_customer_tags_name_normalized_key" ON "crm_customer_tags"("name_normalized");
CREATE INDEX "crm_customer_tag_assignments_tag_id_assigned_at_idx" ON "crm_customer_tag_assignments"("tag_id", "assigned_at");
CREATE UNIQUE INDEX "crm_customer_segments_name_normalized_key" ON "crm_customer_segments"("name_normalized");
CREATE INDEX "crm_customer_segments_status_updated_at_idx" ON "crm_customer_segments"("status", "updated_at");
CREATE INDEX "crm_customer_segment_memberships_customer_id_added_at_idx" ON "crm_customer_segment_memberships"("customer_id", "added_at");
CREATE INDEX "crm_customer_campaigns_status_updated_at_idx" ON "crm_customer_campaigns"("status", "updated_at");
CREATE INDEX "crm_customer_campaigns_segment_id_idx" ON "crm_customer_campaigns"("segment_id");
CREATE UNIQUE INDEX "crm_customer_campaign_deliveries_campaign_id_customer_id_key" ON "crm_customer_campaign_deliveries"("campaign_id", "customer_id");
CREATE INDEX "crm_customer_campaign_deliveries_customer_id_status_idx" ON "crm_customer_campaign_deliveries"("customer_id", "status");
CREATE INDEX "crm_customer_campaign_deliveries_identity_id_idx" ON "crm_customer_campaign_deliveries"("identity_id");
CREATE UNIQUE INDEX "delivery_customers_customer_id_key" ON "delivery_customers"("customer_id");
CREATE INDEX "whatsapp_conversations_customer_id_idx" ON "whatsapp_conversations"("customer_id");
CREATE UNIQUE INDEX "sofia_customer_memories_customer_id_key" ON "sofia_customer_memories"("customer_id");

ALTER TABLE "crm_customer_identities" ADD CONSTRAINT "crm_customer_identities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_customer_consents" ADD CONSTRAINT "crm_customer_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_customer_interactions" ADD CONSTRAINT "crm_customer_interactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_customer_tag_assignments" ADD CONSTRAINT "crm_customer_tag_assignments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_customer_tag_assignments" ADD CONSTRAINT "crm_customer_tag_assignments_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "crm_customer_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_customer_segment_memberships" ADD CONSTRAINT "crm_customer_segment_memberships_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "crm_customer_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_customer_segment_memberships" ADD CONSTRAINT "crm_customer_segment_memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_customer_campaigns" ADD CONSTRAINT "crm_customer_campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "crm_customer_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_customer_campaign_deliveries" ADD CONSTRAINT "crm_customer_campaign_deliveries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "crm_customer_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_customer_campaign_deliveries" ADD CONSTRAINT "crm_customer_campaign_deliveries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_customer_campaign_deliveries" ADD CONSTRAINT "crm_customer_campaign_deliveries_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "crm_customer_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_customers" ADD CONSTRAINT "delivery_customers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sofia_customer_memories" ADD CONSTRAINT "sofia_customer_memories_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
