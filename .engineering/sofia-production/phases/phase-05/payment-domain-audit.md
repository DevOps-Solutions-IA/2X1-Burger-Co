# Payment domain audit

The existing payment-link service is bound to `WhatsappDeliveryOrder` (`apps/api/src/modules/sofia/sofia-payment-link.service.ts:184-208`). Link generation replaces a single public token rather than reusing a durable intent (`:333-401`); public selection and provider creation mutate the same WhatsApp-specific row (`:479-663`). The current schema therefore represents one mutable payment slot, not multiple safe attempts.

The owned frontend at `apps/web/src/app/pagos/[token]/page.tsx` is reusable, but its API types and endpoints are Sofia-specific. Phase 5 must adapt this frontend to a canonical order/payment contract, not build a second frontend or provider stack.

Missing domain concepts: durable payment intent, link lifecycle, multiple attempts, uncertain result, append-only transition history, double-payment review and a channel-independent order binding.
