# Phase 8 domain audit

Phase 8 adds presentation and CRM work management without replacing existing transactional authorities.

| Truth | Canonical authority |
| --- | --- |
| Catalog, price, availability | existing catalog and inventory services |
| Customer and identity | `Customer`, identity and consent services |
| Order and kitchen | `OrderTicket`, versioned `OrdersService` transitions |
| Checkout and payment | `OrderCheckout`, `PaymentIntent`, verified payment services |
| Delivery | versioned ticket workflow plus append-only events |
| Complaint and recovery | `CustomerServiceCase` |
| Conversation and handoff | WhatsApp production conversation services |
| CRM pipeline and lead | `CrmPipeline`, `CrmLead`, append-only stage history |
| CRM task/follow-up | `CrmTask` with a controlled type |
| CRM note | append-only `CrmNote` |
| UI wording and read models | frontend only; never transactional truth |

Global search is permission-filtered by the canonical role policy. Customer 360 and timelines compose bounded reads and do not copy payment, order, delivery or consent state.
