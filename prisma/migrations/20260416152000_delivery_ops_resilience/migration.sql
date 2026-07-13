-- Create enums for delivery ops resilience
CREATE TYPE "DeliveryLocationInboxStatus" AS ENUM ('PENDING', 'APPLIED', 'REQUIRES_REVIEW', 'IGNORED');
CREATE TYPE "OperationalAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "OperationalAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "DeliveryIssueType" AS ENUM (
  'CUSTOMER_UNREACHABLE',
  'INCOMPLETE_ADDRESS',
  'LOCATION_MISMATCH',
  'PAYMENT_PENDING',
  'DELIVERY_REJECTED',
  'ROUTE_INCIDENT',
  'OTHER'
);
CREATE TYPE "DeliveryIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- Create delivery location inbox
CREATE TABLE "delivery_location_inbox" (
  "id" TEXT NOT NULL,
  "raw_sender_jid" TEXT,
  "participant_jid" TEXT,
  "remote_jid" TEXT,
  "normalized_sender_phone" TEXT,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "raw_payload" JSONB,
  "match_status" "DeliveryLocationInboxStatus" NOT NULL DEFAULT 'PENDING',
  "matched_order_id" TEXT,
  "matched_customer_id" TEXT,
  "matched_rule" TEXT,
  "processing_notes" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "delivery_location_inbox_pkey" PRIMARY KEY ("id")
);

-- Create delivery issues
CREATE TABLE "delivery_issues" (
  "id" TEXT NOT NULL,
  "order_ticket_id" TEXT NOT NULL,
  "issue_type" "DeliveryIssueType" NOT NULL,
  "status" "DeliveryIssueStatus" NOT NULL DEFAULT 'OPEN',
  "summary" TEXT NOT NULL,
  "details" TEXT,
  "reported_by_id" TEXT NOT NULL,
  "resolved_by_id" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),

  CONSTRAINT "delivery_issues_pkey" PRIMARY KEY ("id")
);

-- Create operational alerts
CREATE TABLE "operational_alerts" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "severity" "OperationalAlertSeverity" NOT NULL,
  "status" "OperationalAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "actor_id" TEXT,
  "resolved_by_id" TEXT,
  "delivery_location_inbox_id" TEXT,
  "delivery_issue_id" TEXT,
  "metadata" JSONB,
  "acknowledged_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "delivery_location_inbox_match_status_received_at_idx" ON "delivery_location_inbox"("match_status", "received_at");
CREATE INDEX "delivery_location_inbox_normalized_sender_phone_received_at_idx" ON "delivery_location_inbox"("normalized_sender_phone", "received_at");
CREATE INDEX "delivery_location_inbox_matched_order_id_received_at_idx" ON "delivery_location_inbox"("matched_order_id", "received_at");

CREATE INDEX "delivery_issues_order_ticket_id_status_createdAt_idx" ON "delivery_issues"("order_ticket_id", "status", "createdAt");
CREATE INDEX "delivery_issues_reported_by_id_createdAt_idx" ON "delivery_issues"("reported_by_id", "createdAt");

CREATE INDEX "operational_alerts_status_createdAt_idx" ON "operational_alerts"("status", "createdAt");
CREATE INDEX "operational_alerts_module_status_createdAt_idx" ON "operational_alerts"("module", "status", "createdAt");
CREATE INDEX "operational_alerts_entity_type_entity_id_idx" ON "operational_alerts"("entity_type", "entity_id");
CREATE INDEX "operational_alerts_severity_status_createdAt_idx" ON "operational_alerts"("severity", "status", "createdAt");

ALTER TABLE "delivery_location_inbox"
  ADD CONSTRAINT "delivery_location_inbox_matched_order_id_fkey"
  FOREIGN KEY ("matched_order_id") REFERENCES "order_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_location_inbox"
  ADD CONSTRAINT "delivery_location_inbox_matched_customer_id_fkey"
  FOREIGN KEY ("matched_customer_id") REFERENCES "delivery_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_issues"
  ADD CONSTRAINT "delivery_issues_order_ticket_id_fkey"
  FOREIGN KEY ("order_ticket_id") REFERENCES "order_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delivery_issues"
  ADD CONSTRAINT "delivery_issues_reported_by_id_fkey"
  FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_issues"
  ADD CONSTRAINT "delivery_issues_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "operational_alerts"
  ADD CONSTRAINT "operational_alerts_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "operational_alerts"
  ADD CONSTRAINT "operational_alerts_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "operational_alerts"
  ADD CONSTRAINT "operational_alerts_delivery_location_inbox_id_fkey"
  FOREIGN KEY ("delivery_location_inbox_id") REFERENCES "delivery_location_inbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "operational_alerts"
  ADD CONSTRAINT "operational_alerts_delivery_issue_id_fkey"
  FOREIGN KEY ("delivery_issue_id") REFERENCES "delivery_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
