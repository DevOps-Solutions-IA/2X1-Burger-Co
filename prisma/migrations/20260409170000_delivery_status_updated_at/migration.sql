ALTER TABLE "order_tickets"
ADD COLUMN "delivery_status_updated_at" TIMESTAMP(3);

UPDATE "order_tickets"
SET "delivery_status_updated_at" = CASE
  WHEN "type" = 'DELIVERY' THEN COALESCE("delivery_delivered_at", "delivery_issue_at", "delivery_dispatched_at", "assigned_rider_at", "updatedAt")
  ELSE NULL
END;
