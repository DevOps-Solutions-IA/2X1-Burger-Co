# Payment domain audit

The existing payment-link service is bound to `WhatsappDeliveryOrder` (`apps/api/src/modules/sofia/sofia-payment-link.service.ts:184-208`). Link generation replaces a single public token rather than reusing a durable intent (`:333-401`); public selection and provider creation mutate the same WhatsApp-specific row (`:479-663`). The current schema therefore represents one mutable payment slot, not multiple safe attempts.

The owned frontend at `apps/web/src/app/pagos/[token]/page.tsx` is reusable, but its API types and endpoints are Sofia-specific. Phase 5 must adapt this frontend to a canonical order/payment contract, not build a second frontend or provider stack.

Phase 5 closes those gaps with canonical `OrderCheckout`, `PaymentIntent`, `PaymentLink`, and `PaymentTransition` persistence. Payment preference remains separate from financial status. Cash obligations do not create fake provider attempts. Online links persist only token hashes and reuse the existing Bold adapter and 2X1 payment page.

The historical Sofia payment-link service remains for compatibility, but the canonical module does not route through its mutable WhatsApp order state. Future channel callers must use the canonical checkout/payment boundary.
