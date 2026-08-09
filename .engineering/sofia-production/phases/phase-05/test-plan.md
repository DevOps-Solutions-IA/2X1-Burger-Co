# Phase 05 test plan

The implementation gate must cover all owner scenarios:

1. Online delivery; 2. COD delivery; 3. online takeaway; 4. pay-at-pickup takeaway.
5. COD→online; 6. pickup-pay→online, both on the same order.
7. Duplicate confirmation; 8. duplicate intent/link; 9. duplicate webhook; 10. concurrent webhook.
11. Wrong amount; 12. wrong currency; 13. wrong order; 14. unknown payment.
15. Failed payment; 16. timeout; 17. unknown result; 18. double payment.
19. Stale attempt; 20. cancelled-order payment.
21. Paid online→kitchen; 22. COD→kitchen; 23. pickup-pay→kitchen.
24. Invalid fulfillment/payment combination; 25. duplicate kitchen creation.
26. Structured ticket modifiers; 27. inventory idempotency; 28. payment cannot mutate price.
29. Screenshot; 30. customer message; 31. prompt injection cannot mark paid.
32. Sandbox impossible in production; 33. mock impossible in production.
34. Receipt binding; 35. secure-command replay; 36. crash/restart recovery.
37. Database concurrency; 38. E2E confirmed draft→checkout→payment mode→ticket.

Required gates: lint, strict typecheck, build, Prisma validation, isolated database migration, focused unit/integration, full regression, RBAC, owned payment frontend E2E, concurrency, recovery and cleanup. Authorized Bold sandbox E2E is conditional on securely available credentials and never runs against production.

Implemented deterministic coverage includes all four fulfillment/payment combinations, exact draft binding, checkout/intent/link/ticket concurrency, scoped webhook uniqueness, signed success, replay, amount/currency/account mismatch, invalid signature, unknown reference, provider failure, terminal checkout payment, unknown result, double success, modifier snapshot, zero pre-sale inventory impact, verified `SalePayment` linkage, production gates, and mock/sandbox architecture boundaries. External Bold sandbox was not used because no credentials or production activation are authorized.
