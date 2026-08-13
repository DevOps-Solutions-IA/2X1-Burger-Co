-- Phase 8 CRM product core. Additive only: no existing data is rewritten.
CREATE TYPE "CrmLeadSource" AS ENUM ('WHATSAPP', 'POS', 'DELIVERY', 'CUSTOMER_SERVICE', 'AUTHORIZED_OPERATOR');
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'QUALIFIED', 'ACTIVE', 'WON', 'LOST', 'ARCHIVED');
CREATE TYPE "CrmPipelineStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "CrmPipelineStageOutcome" AS ENUM ('OPEN', 'WON', 'LOST');
CREATE TYPE "CrmTaskType" AS ENUM ('TASK', 'FOLLOW_UP');
CREATE TYPE "CrmTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "CrmTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TABLE "crm_pipelines" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "description" TEXT,
    "status" "CrmPipelineStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_pipeline_stages" (
    "id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "outcome" "CrmPipelineStageOutcome" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "current_stage_id" TEXT NOT NULL,
    "source" "CrmLeadSource" NOT NULL,
    "source_reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "owner_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "qualified_at" TIMESTAMP(3),
    "won_at" TIMESTAMP(3),
    "lost_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_lead_stage_history" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "from_stage_id" TEXT,
    "to_stage_id" TEXT NOT NULL,
    "from_status" "CrmLeadStatus",
    "to_status" "CrmLeadStatus" NOT NULL,
    "actor_id" TEXT,
    "reason_code" TEXT NOT NULL,
    "sanitized_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_lead_stage_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_tasks" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "customer_service_case_id" TEXT,
    "source" TEXT NOT NULL,
    "source_reference" TEXT NOT NULL,
    "type" "CrmTaskType" NOT NULL,
    "status" "CrmTaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "CrmTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "sanitized_description" TEXT,
    "assigned_to_id" TEXT,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_notes" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "customer_service_case_id" TEXT,
    "source" TEXT NOT NULL,
    "source_reference" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "author_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_pipelines_name_normalized_key" ON "crm_pipelines"("name_normalized");
CREATE INDEX "crm_pipelines_status_updated_at_idx" ON "crm_pipelines"("status", "updated_at");
CREATE INDEX "crm_pipelines_created_by_id_created_at_idx" ON "crm_pipelines"("created_by_id", "created_at");
CREATE INDEX "crm_pipeline_stages_pipeline_id_outcome_position_idx" ON "crm_pipeline_stages"("pipeline_id", "outcome", "position");
CREATE UNIQUE INDEX "crm_pipeline_stages_pipeline_id_position_key" ON "crm_pipeline_stages"("pipeline_id", "position");
CREATE UNIQUE INDEX "crm_pipeline_stages_pipeline_id_name_normalized_key" ON "crm_pipeline_stages"("pipeline_id", "name_normalized");
CREATE INDEX "crm_leads_pipeline_id_current_stage_id_status_idx" ON "crm_leads"("pipeline_id", "current_stage_id", "status");
CREATE INDEX "crm_leads_customer_id_updated_at_idx" ON "crm_leads"("customer_id", "updated_at");
CREATE INDEX "crm_leads_owner_id_status_updated_at_idx" ON "crm_leads"("owner_id", "status", "updated_at");
CREATE UNIQUE INDEX "crm_leads_source_source_reference_key" ON "crm_leads"("source", "source_reference");
CREATE INDEX "crm_lead_stage_history_lead_id_created_at_idx" ON "crm_lead_stage_history"("lead_id", "created_at");
CREATE INDEX "crm_lead_stage_history_to_stage_id_created_at_idx" ON "crm_lead_stage_history"("to_stage_id", "created_at");
CREATE UNIQUE INDEX "crm_lead_stage_history_lead_id_version_key" ON "crm_lead_stage_history"("lead_id", "version");
CREATE UNIQUE INDEX "crm_lead_stage_history_lead_id_idempotency_key_key" ON "crm_lead_stage_history"("lead_id", "idempotency_key");
CREATE INDEX "crm_tasks_status_due_at_idx" ON "crm_tasks"("status", "due_at");
CREATE INDEX "crm_tasks_assigned_to_id_status_due_at_idx" ON "crm_tasks"("assigned_to_id", "status", "due_at");
CREATE INDEX "crm_tasks_customer_id_created_at_idx" ON "crm_tasks"("customer_id", "created_at");
CREATE INDEX "crm_tasks_lead_id_status_idx" ON "crm_tasks"("lead_id", "status");
CREATE INDEX "crm_tasks_customer_service_case_id_status_idx" ON "crm_tasks"("customer_service_case_id", "status");
CREATE UNIQUE INDEX "crm_tasks_source_source_reference_key" ON "crm_tasks"("source", "source_reference");
CREATE INDEX "crm_notes_customer_id_created_at_idx" ON "crm_notes"("customer_id", "created_at");
CREATE INDEX "crm_notes_lead_id_created_at_idx" ON "crm_notes"("lead_id", "created_at");
CREATE INDEX "crm_notes_customer_service_case_id_created_at_idx" ON "crm_notes"("customer_service_case_id", "created_at");
CREATE INDEX "crm_notes_author_id_created_at_idx" ON "crm_notes"("author_id", "created_at");
CREATE UNIQUE INDEX "crm_notes_source_source_reference_key" ON "crm_notes"("source", "source_reference");

ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "crm_lead_stage_history" ADD CONSTRAINT "crm_lead_stage_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "crm_lead_stage_history" ADD CONSTRAINT "crm_lead_stage_history_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "crm_lead_stage_history" ADD CONSTRAINT "crm_lead_stage_history_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "crm_lead_stage_history" ADD CONSTRAINT "crm_lead_stage_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_customer_service_case_id_fkey" FOREIGN KEY ("customer_service_case_id") REFERENCES "customer_service_cases"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "crm_customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_customer_service_case_id_fkey" FOREIGN KEY ("customer_service_case_id") REFERENCES "customer_service_cases"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
