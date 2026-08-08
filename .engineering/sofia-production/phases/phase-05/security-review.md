# Security review

Mandatory invariants:

1. One source idempotency key and one confirmed draft binding produce one checkout/order.
2. Domain revalidates catalog price, availability, fulfillment and totals.
3. Customer message, screenshot, prompt injection or operator prose cannot mark paid.
4. Online success requires authentic Bold event plus exact intent/order/account/amount/currency/state binding.
5. Duplicate/concurrent events produce one transition; uncertain results are never blind-retried.
6. Double success requires financial review, not automatic refund.
7. Cancelled or stale attempts cannot operationally pay an order.
8. Kitchen eligibility is centralized and ticket creation is idempotent.
9. Inventory changes once through authoritative Sale behavior.
10. Production cannot select mock, sandbox or test webhook.

No secret was read or emitted by this audit. Bold credentials remain unconfigured in this worktree.
