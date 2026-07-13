-- Table groups and waiter table ownership.
-- Additive migration: existing tables/orders remain valid.

CREATE TABLE "table_groups" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "area" TEXT,
  "color" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "table_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "table_groups_name_key" ON "table_groups"("name");
CREATE INDEX "table_groups_is_active_idx" ON "table_groups"("is_active");

ALTER TABLE "dining_tables" ADD COLUMN "group_id" TEXT;
CREATE INDEX "dining_tables_group_id_idx" ON "dining_tables"("group_id");
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "table_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "waiter_table_group_assignments" (
  "id" TEXT NOT NULL,
  "waiter_id" TEXT NOT NULL,
  "table_group_id" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assigned_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "waiter_table_group_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waiter_table_group_assignments_waiter_id_table_group_id_is_active_key"
  ON "waiter_table_group_assignments"("waiter_id", "table_group_id", "is_active");
CREATE INDEX "waiter_table_group_assignments_table_group_id_is_active_idx"
  ON "waiter_table_group_assignments"("table_group_id", "is_active");
CREATE INDEX "waiter_table_group_assignments_waiter_id_is_active_idx"
  ON "waiter_table_group_assignments"("waiter_id", "is_active");
ALTER TABLE "waiter_table_group_assignments"
  ADD CONSTRAINT "waiter_table_group_assignments_waiter_id_fkey"
  FOREIGN KEY ("waiter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "waiter_table_group_assignments"
  ADD CONSTRAINT "waiter_table_group_assignments_table_group_id_fkey"
  FOREIGN KEY ("table_group_id") REFERENCES "table_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "waiter_table_group_assignments"
  ADD CONSTRAINT "waiter_table_group_assignments_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "waiter_table_assignments" (
  "id" TEXT NOT NULL,
  "waiter_id" TEXT NOT NULL,
  "table_id" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assigned_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "waiter_table_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waiter_table_assignments_waiter_id_table_id_is_active_key"
  ON "waiter_table_assignments"("waiter_id", "table_id", "is_active");
CREATE INDEX "waiter_table_assignments_table_id_is_active_idx"
  ON "waiter_table_assignments"("table_id", "is_active");
CREATE INDEX "waiter_table_assignments_waiter_id_is_active_idx"
  ON "waiter_table_assignments"("waiter_id", "is_active");
ALTER TABLE "waiter_table_assignments"
  ADD CONSTRAINT "waiter_table_assignments_waiter_id_fkey"
  FOREIGN KEY ("waiter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "waiter_table_assignments"
  ADD CONSTRAINT "waiter_table_assignments_table_id_fkey"
  FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "waiter_table_assignments"
  ADD CONSTRAINT "waiter_table_assignments_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_tickets" ADD COLUMN "waiter_name_snapshot" TEXT;
ALTER TABLE "order_tickets" ADD COLUMN "waiter_access_name_snapshot" TEXT;
