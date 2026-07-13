ALTER TABLE "order_tickets"
ADD COLUMN "assigned_waiter_id" TEXT,
ADD COLUMN "assigned_at" TIMESTAMP(3);

CREATE TABLE "waiter_order_sync_receipts" (
    "id" TEXT NOT NULL,
    "client_mutation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_ticket_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waiter_order_sync_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waiter_order_sync_receipts_client_mutation_id_key" ON "waiter_order_sync_receipts"("client_mutation_id");
CREATE INDEX "waiter_order_sync_receipts_user_id_created_at_idx" ON "waiter_order_sync_receipts"("user_id", "created_at");
CREATE INDEX "waiter_order_sync_receipts_order_ticket_id_created_at_idx" ON "waiter_order_sync_receipts"("order_ticket_id", "created_at");
CREATE INDEX "order_tickets_assigned_waiter_id_status_idx" ON "order_tickets"("assigned_waiter_id", "status");

ALTER TABLE "order_tickets"
ADD CONSTRAINT "order_tickets_assigned_waiter_id_fkey" FOREIGN KEY ("assigned_waiter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "waiter_order_sync_receipts"
ADD CONSTRAINT "waiter_order_sync_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "waiter_order_sync_receipts"
ADD CONSTRAINT "waiter_order_sync_receipts_order_ticket_id_fkey" FOREIGN KEY ("order_ticket_id") REFERENCES "order_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "order_tickets" AS ot
SET
  "assigned_waiter_id" = ot."createdById",
  "assigned_at" = COALESCE(ot."openedAt", ot."createdAt")
FROM "users" u
JOIN "user_roles" ur ON ur."userId" = u."id"
JOIN "roles" r ON r."id" = ur."roleId"
WHERE
  ot."createdById" = u."id"
  AND ot."status" IN ('OPEN', 'IN_PREPARATION', 'SERVED', 'PAYMENT_PENDING')
  AND ot."assigned_waiter_id" IS NULL
  AND r."name" = 'waiter';
