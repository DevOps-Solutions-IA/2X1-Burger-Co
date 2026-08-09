# Inventory impact

The canonical deduction occurs inside transactional sale creation: products and ingredients are locked, validated and updated in `apps/api/src/modules/sales/sales.service.ts:576-886`. Phase 5 must not introduce a second deduction at checkout, payment intent or kitchen-ticket creation.

Implemented boundary: checkout, payment, kitchen eligibility and ticket creation perform zero stock movements. Existing authoritative Sale close remains the only deduction point. Integration tests prove duplicate checkout/ticket/webhook operations do not move inventory, while the explicit sale-close test creates one authoritative sale movement and binds its verified intent.
