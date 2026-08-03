-- CreateEnum
CREATE TYPE "SofiaCommandStatus" AS ENUM ('RECEIVED', 'VALIDATED', 'APPROVAL_REQUIRED', 'APPROVED', 'CLAIMED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SofiaCommandApprovalStatus" AS ENUM ('APPROVED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SofiaCommandAttemptOutcome" AS ENUM ('CLAIMED', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SofiaCommandFailureClass" AS ENUM ('VALIDATION', 'POLICY', 'CONFLICT', 'DEPENDENCY', 'TIMEOUT', 'UNKNOWN_RESULT', 'INTERNAL');

-- CreateTable
CREATE TABLE "sofia_commands" (
    "id" TEXT NOT NULL,
    "command_type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "SofiaCommandStatus" NOT NULL DEFAULT 'RECEIVED',
    "actor_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL DEFAULT 'USER',
    "actor_roles_snapshot" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "expected_version" TEXT,
    "payload_hash" TEXT NOT NULL,
    "policy_hash" TEXT NOT NULL,
    "release_version" TEXT NOT NULL,
    "correlation_id" TEXT,
    "trace_id" TEXT,
    "claim_owner_hash" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failure_class" "SofiaCommandFailureClass",
    "failure_code" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sofia_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sofia_command_approvals" (
    "id" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "approver_actor_id" TEXT NOT NULL,
    "approver_roles_snapshot" JSONB NOT NULL,
    "approval_action" TEXT NOT NULL,
    "status" "SofiaCommandApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "payload_hash" TEXT NOT NULL,
    "expected_version" TEXT,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "source" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "reason_code" TEXT NOT NULL,
    "policy_reference" TEXT NOT NULL,
    "audit_identity" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sofia_command_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sofia_command_attempts" (
    "id" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "approval_id" TEXT,
    "attempt_number" INTEGER NOT NULL,
    "claim_owner_hash" TEXT NOT NULL,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "release_version" TEXT NOT NULL,
    "outcome" "SofiaCommandAttemptOutcome" NOT NULL DEFAULT 'CLAIMED',
    "failure_class" "SofiaCommandFailureClass",
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sofia_command_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sofia_command_results" (
    "id" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "result_code" TEXT NOT NULL,
    "sanitized_payload" JSONB NOT NULL,
    "result_hash" TEXT NOT NULL,
    "domain_reference_ids" JSONB,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redaction_version" INTEGER NOT NULL DEFAULT 1,
    "retention_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sofia_command_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sofia_commands_scope_command_type_idempotency_key_key" ON "sofia_commands"("scope", "command_type", "idempotency_key");
CREATE INDEX "sofia_commands_status_expires_at_idx" ON "sofia_commands"("status", "expires_at");
CREATE INDEX "sofia_commands_status_lease_expires_at_idx" ON "sofia_commands"("status", "lease_expires_at");
CREATE INDEX "sofia_commands_target_type_target_id_created_at_idx" ON "sofia_commands"("target_type", "target_id", "created_at");
CREATE INDEX "sofia_commands_actor_id_created_at_idx" ON "sofia_commands"("actor_id", "created_at");
CREATE INDEX "sofia_commands_correlation_id_idx" ON "sofia_commands"("correlation_id");

CREATE UNIQUE INDEX "sofia_command_approvals_audit_identity_key" ON "sofia_command_approvals"("audit_identity");
CREATE INDEX "sofia_command_approvals_command_id_status_expires_at_idx" ON "sofia_command_approvals"("command_id", "status", "expires_at");
CREATE INDEX "sofia_command_approvals_approver_actor_id_granted_at_idx" ON "sofia_command_approvals"("approver_actor_id", "granted_at");
CREATE INDEX "sofia_command_approvals_status_expires_at_idx" ON "sofia_command_approvals"("status", "expires_at");

CREATE UNIQUE INDEX "sofia_command_attempts_command_id_attempt_number_key" ON "sofia_command_attempts"("command_id", "attempt_number");
CREATE INDEX "sofia_command_attempts_command_id_started_at_idx" ON "sofia_command_attempts"("command_id", "started_at");
CREATE INDEX "sofia_command_attempts_outcome_started_at_idx" ON "sofia_command_attempts"("outcome", "started_at");
CREATE INDEX "sofia_command_attempts_lease_expires_at_outcome_idx" ON "sofia_command_attempts"("lease_expires_at", "outcome");
CREATE INDEX "sofia_command_attempts_approval_id_idx" ON "sofia_command_attempts"("approval_id");

CREATE UNIQUE INDEX "sofia_command_results_command_id_key" ON "sofia_command_results"("command_id");
CREATE INDEX "sofia_command_results_retention_until_idx" ON "sofia_command_results"("retention_until");

-- AddForeignKey
ALTER TABLE "sofia_command_approvals" ADD CONSTRAINT "sofia_command_approvals_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "sofia_commands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "sofia_command_attempts" ADD CONSTRAINT "sofia_command_attempts_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "sofia_commands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "sofia_command_attempts" ADD CONSTRAINT "sofia_command_attempts_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "sofia_command_approvals"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "sofia_command_results" ADD CONSTRAINT "sofia_command_results_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "sofia_commands"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
