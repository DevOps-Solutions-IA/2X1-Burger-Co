ALTER TABLE "sofia_payment_settings"
  ALTER COLUMN "auto_mark_paid_from_webhook" SET DEFAULT false,
  ALTER COLUMN "online_payment_provider" SET DEFAULT 'NONE',
  ALTER COLUMN "mock_online_payments_enabled" SET DEFAULT false;

UPDATE "sofia_payment_settings"
SET "auto_mark_paid_from_webhook" = false
WHERE "auto_mark_paid_from_webhook" = true;

UPDATE "sofia_payment_settings"
SET
  "online_payment_provider" = 'NONE',
  "mock_online_payments_enabled" = false
WHERE "online_payment_provider" = 'MOCK' OR "mock_online_payments_enabled" = true;
