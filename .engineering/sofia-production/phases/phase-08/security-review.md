# Phase 8 security review

Review scope includes CRM privacy and idempotency, frontend and search RBAC, financial rendering, kitchen mutation authority, QR binding, accessibility of high-risk controls, mock isolation and forbidden operational effects.

Resolved during implementation:

- payment/support search leakage to cashier roles;
- durable credential and cookie redaction gaps;
- deterministic CRM lost-response handling;
- cross-pipeline lead-stage binding;
- generic and waiter kitchen-state bypasses;
- QR identity based on non-independent observations;
- inaccessible drawers/dialogs and unlabeled financial controls;
- frontend CRM actions shown to read-only roles.

Final local review also verified:

- checkout financial-review state overrides isolated payment-intent success in every Phase 8 read surface;
- every Sofia controller action declares its own capability and does not inherit an unrelated broad permission;
- customer phone redaction covers Colombian formatted variants before audit or UI exposure;
- CRM note/task replay is source-scoped, actor-bound and cannot mutate a later version;
- authenticated route accessibility covers phone, tablet and desktop with no document-level overflow;
- malformed kitchen modifier evidence is never converted to an empty modifier
  list and cannot leave stale transition targets operable;
- the release artifact includes deterministic Next manifests rather than excluding changing runtime files.

Exact-SHA remote CI and pull-request review remain required. Real Bold, outbound WhatsApp and auto reply remain off.
