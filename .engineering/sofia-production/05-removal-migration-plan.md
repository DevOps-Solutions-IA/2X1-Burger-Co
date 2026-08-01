# Removal and migration plan

## Completed in candidate

- Removed frontend sandbox and mock-payment routes and QR test controls.
- Guarded backend dev, sandbox, mock webhook, mock inbound/outbound, AI test, and QR test routes outside `NODE_ENV=test`.
- Rejected mock payment and WhatsApp providers outside tests.
- Blocked simulated delivery conversion before persistence.
- Added fail-closed production startup validation.

## Preserved

- Null/fail-safe providers, receive-only mode, allowlists, idempotency, webhook signature verification, audit history, and test-only deterministic mocks.

## Deferred with explicit boundary

- Replace hardcoded business-hour and offer descriptors with authoritative domain settings only in an owner-authorized phase. They cannot override product price/availability or execute production mutations after Phase 0 controls.
- Deploy the candidate and verify authenticated route absence/provider rejection before Phase 0 can be GO.

