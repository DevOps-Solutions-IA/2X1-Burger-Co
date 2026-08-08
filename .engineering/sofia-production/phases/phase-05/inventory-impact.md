# Inventory impact

The canonical deduction occurs inside transactional sale creation: products and ingredients are locked, validated and updated in `apps/api/src/modules/sales/sales.service.ts:576-886`. Phase 5 must not introduce a second deduction at checkout, payment intent or kitchen-ticket creation.

Decision: reuse the existing authoritative Sale flow and prove exactly-once inventory effects. A duplicate confirmation, webhook, recovery or kitchen request must never decrement stock twice.
