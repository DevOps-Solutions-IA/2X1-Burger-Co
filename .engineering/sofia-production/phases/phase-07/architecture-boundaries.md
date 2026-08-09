# Phase 7 architecture boundaries

Status: PASS

## Verified source boundaries

- Canonical payment authority: ORDER_CHECKOUT_PAYMENT_ORCHESTRATION. Legacy Sofia public payment, operator payment mutation and mock webhook paths are retired and cannot serve as a second payment authority.
- Canonical WhatsApp socket authority: SofiaWhatsappQrGatewayService. The legacy WhatsappService exposes retired operations and contains no Baileys transport ownership.
- Real outbound authority remains blocked at the canonical QR adapter boundary; notification workers materialize policy-bound SecureCommands rather than calling the provider directly.
- Notification ownership is fenced by durable intent version, owner hash and lease expiry.
- QR ownership is fenced across replicas by persisted lease and fencing token.
- Operational command approval is distinct from request ownership when the command is operational and approval-required.
- Health telemetry reads aggregate operational state and does not become a mutation authority.
- Report asset retrieval is isolated behind SafeRemoteAssetFetcher; report generation degrades by omitting an unsafe/unavailable logo.
- Cash close no longer invokes the legacy WhatsApp transport; its response marks that dispatch as skipped.

## Boundary verification

- Architecture and production-boundary suites passed in both focused Phase 7 runs.
- Direct provider sends outside the canonical QR gateway: 0.
- SOFIA orchestration imports of PrismaService: 0 violations.
- Production-reachable mock providers: 0.
- Production-reachable sandbox paths: 0.
- Independent architecture sign-off: PASS against the runtime candidate.

Authoritative truth remains singular for catalog, price, availability, customer,
delivery quote, draft, checkout, payment intent, payment truth, sale, cash,
inventory, kitchen, delivery, consent, handoff, WhatsApp send and AI wording.
