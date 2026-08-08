# Kitchen integration

Existing canonical statuses are sufficient: `OPEN`, `IN_PREPARATION`, `SERVED`, `PAYMENT_PENDING`, `PAID`, `CANCELLED`; ticket types include `TAKEAWAY` and `DELIVERY` (`prisma/schema.prisma:51-65`). No `READY_FOR_PICKUP` migration is justified; presentation can translate `SERVED` by fulfillment type.

`OrderTicketItem` stores notes but no structured modifier snapshot (`prisma/schema.prisma:1674-1689`). Kitchen must never parse WhatsApp prose. A single policy authority must decide eligibility:

- online: verified and applied `PAID`;
- delivery COD: authorized confirmed COD;
- takeaway pay-at-pickup: authorized confirmed pickup payment.

Ticket creation must be idempotent and map structured items/modifiers to exactly one canonical `OrderTicket`.
