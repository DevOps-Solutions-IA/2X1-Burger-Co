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

Final independent review and exact-SHA remote CI remain required. Real Bold, outbound WhatsApp and auto reply remain off.
