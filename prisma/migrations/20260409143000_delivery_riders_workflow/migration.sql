CREATE TYPE "DeliveryWorkflowStatus" AS ENUM (
  'PENDING_ASSIGNMENT',
  'ASSIGNED',
  'IN_TRANSIT',
  'DELIVERED',
  'ISSUE'
);

ALTER TABLE "order_tickets"
ADD COLUMN "delivery_workflow_status" "DeliveryWorkflowStatus",
ADD COLUMN "assigned_rider_id" TEXT,
ADD COLUMN "assigned_rider_at" TIMESTAMP(3),
ADD COLUMN "delivery_dispatched_at" TIMESTAMP(3),
ADD COLUMN "delivery_delivered_at" TIMESTAMP(3),
ADD COLUMN "delivery_issue_at" TIMESTAMP(3);

ALTER TABLE "order_tickets"
ADD CONSTRAINT "order_tickets_assigned_rider_id_fkey"
FOREIGN KEY ("assigned_rider_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "order_tickets_assigned_rider_id_delivery_workflow_status_idx"
ON "order_tickets"("assigned_rider_id", "delivery_workflow_status");

CREATE INDEX "order_tickets_type_delivery_workflow_status_status_idx"
ON "order_tickets"("type", "delivery_workflow_status", "status");

UPDATE "order_tickets"
SET "delivery_workflow_status" = CASE
  WHEN "type" <> 'DELIVERY' THEN NULL
  WHEN "status" = 'PAID' THEN 'DELIVERED'::"DeliveryWorkflowStatus"
  WHEN "status" = 'CANCELLED' THEN 'ISSUE'::"DeliveryWorkflowStatus"
  ELSE 'PENDING_ASSIGNMENT'::"DeliveryWorkflowStatus"
END,
"delivery_delivered_at" = CASE
  WHEN "type" = 'DELIVERY' AND "status" = 'PAID' THEN COALESCE("paidAt", "updatedAt")
  ELSE NULL
END,
"delivery_issue_at" = CASE
  WHEN "type" = 'DELIVERY' AND "status" = 'CANCELLED' THEN COALESCE("cancelledAt", "updatedAt")
  ELSE NULL
END;
