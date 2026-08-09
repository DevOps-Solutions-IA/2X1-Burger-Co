# Phase 06 discovery

Status: `IN_PROGRESS`.

## Verified authorities

- `OrderTicket.status` owns kitchen/order lifecycle truth.
- `OrderTicket.deliveryWorkflowStatus` and rider/timestamp fields own delivery lifecycle truth.
- `OrderCheckout` and Phase 5 policy own checkout and kitchen eligibility.
- `SalesService.createInTransaction` remains the only sale, stock and cash mutation boundary.
- `DeliveryLocationInbox` owns operational location intake; location is logistics-only and cannot change confirmed address, quote, fee or total.
- `WhatsappHandoffService` and its repository transaction own handoff versioning and evidence.
- `WhatsappInboundEvent` owns provider-scoped inbound claims and deterministic replay.
- `SofiaCommand` and `WhatsappOutboundMessage` own secure command/outbound idempotency. Operational command definitions and real sending remain disabled.

## Verified gaps

- Order and delivery transitions lack a centralized legal transition policy and allow invalid jumps/regressions.
- Delivery transition, issue, alert and audit writes are not one atomic durable event operation.
- There is no explicit persisted kitchen-ready event; `SERVED` is semantically ambiguous.
- The legacy WhatsApp module contains a second Baileys location listener and direct socket acknowledgement path outside the Phase 3 gateway.
- Multiple active delivery orders for one sender can select the newest order rather than fail closed.
- `SofiaAgentRepository.requireHuman()` bypasses versioned handoff authority and append-only evidence.
- Complaint detection is duplicated and there is no durable idempotent customer-service case lifecycle.

## Non-migration work available

- Legal transition policies and fail-closed validation.
- Location normalization, bounds/account checks, ambiguous-match rejection and removal of direct provider acknowledgements.
- Handoff transition matrix and removal of direct conversation-state writes.
- Complaint classification and a policy that forbids invented refund, discount, coupon, replacement or compensation.
- Architecture and adversarial tests.

Migration-dependent persistence must not be implemented until the cross-agent assessment is complete and the owner authorizes migration 37.
