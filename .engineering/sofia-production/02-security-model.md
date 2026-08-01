# Phase 0 security model

## Boundaries

- `NODE_ENV=test` is the only environment allowed to select mock payment, mock WhatsApp, mock webhook, sandbox message processing, or test-only controllers.
- Production startup validation rejects mock WhatsApp, automatic reply, auto-safe, real-send, and SOFIA production activation combinations with sanitized reason codes.
- Controller guards return a sanitized not-found response outside tests.
- Payment and delivery mutations fail before persistence when invoked from simulated SOFIA paths.
- Existing allowlists, signature validation, idempotency, audit controls, receive-only behavior, and kill switches remain intact.

## Residual release boundary

These controls are verified in the branch candidate but are not present in the currently running principal image. Production activation remains prohibited until a separately authorized deployment verifies route absence and provider selection against the deployed digest.

