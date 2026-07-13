-- Non-destructive purchase reconciliation fields for cash/digital reporting.
ALTER TABLE "purchases" ADD COLUMN "paymentMethodId" TEXT;
ALTER TABLE "purchases" ADD COLUMN "cashSessionId" TEXT;

CREATE INDEX "purchases_paymentMethodId_idx" ON "purchases"("paymentMethodId");
CREATE INDEX "purchases_cashSessionId_idx" ON "purchases"("cashSessionId");

ALTER TABLE "purchases" ADD CONSTRAINT "purchases_paymentMethodId_fkey"
  FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchases" ADD CONSTRAINT "purchases_cashSessionId_fkey"
  FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
