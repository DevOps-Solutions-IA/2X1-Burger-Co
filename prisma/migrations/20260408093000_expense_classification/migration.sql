-- Add optional classification to expenses for pre-close checklist and operational traceability.
ALTER TABLE "expenses"
ADD COLUMN IF NOT EXISTS "classification" TEXT;

UPDATE "expenses"
SET "classification" = "concept"
WHERE "classification" IS NULL OR btrim("classification") = '';
