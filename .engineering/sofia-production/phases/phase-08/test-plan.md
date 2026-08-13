# Phase 8 test plan

Required deterministic gates:

- frozen dependency install, production audit and secret scan;
- Prisma format/validate, fresh `38/38`, representative `37 -> 38`;
- API/Web lint, typecheck and production builds;
- CRM privacy, idempotency, concurrency, stale writes and relational invariants;
- search and route RBAC;
- order/kitchen authority, mutation-before-policy protection and concurrency;
- QR account/business/session binding with receive-only guards;
- frontend semantic states, contrast, focus, keyboard, landmarks and responsive overflow;
- authenticated route workflows for overview, orders, kitchen, customers, conversations, payments, delivery, service, CRM, governance and legacy operations;
- production mock/sandbox/fake-success reachability;
- critical integration, core ephemeral E2E, recovery and artifact reproducibility.

Focused Phase 8 suites must pass twice on the final source SHA. Remote CI must pass all quality, artifact, ephemeral E2E, recovery and rollback jobs before merge.
