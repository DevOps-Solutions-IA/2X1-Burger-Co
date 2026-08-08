# Kitchen integration

Existing canonical statuses are sufficient: `OPEN`, `IN_PREPARATION`, `SERVED`, `PAYMENT_PENDING`, `PAID`, `CANCELLED`; ticket types include `TAKEAWAY` and `DELIVERY` (`prisma/schema.prisma:51-65`). No `READY_FOR_PICKUP` migration is justified; presentation can translate `SERVED` by fulfillment type.

Migration 36 adds `OrderTicketItem.modifiersSnapshot` as non-null JSONB default `[]`. Canonical ticket creation copies bounded modifier structures, so kitchen never parses WhatsApp prose. `CheckoutPolicyService` is the single eligibility authority:

- online: exactly one verified `PaymentIntent.SUCCEEDED`;
- delivery COD: authorized confirmed COD;
- takeaway pay-at-pickup: authorized confirmed pickup payment.

Ticket creation locks the checkout, attaches one `OrderTicket`, and deterministically replays. It is available only through Phase 5 test gates; production remains disabled.
