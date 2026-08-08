# Migration assessment

Migration `20260808040000_sofia_commercial_checkout_core` is the single owner-authorized additive migration. It creates one payment-preference enum and nullable/defaulted fields, optional `SET NULL` relations and bounded indexes on the existing `SofiaOrderDraft`.

Audit: no drop, delete, truncate, backfill, rename or historical migration edit. Fresh PostgreSQL reached 35/35. A representative legacy draft survived with `version=1`, `paymentPreference=UNKNOWN` and new optional fields null. Production remains unchanged.
