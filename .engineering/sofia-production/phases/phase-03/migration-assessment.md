# Migration assessment

`MIGRATION_REQUIRED: YES`

## Reason

Production-ready WhatsApp cannot be proven with the current free-form status fields and missing account/event/status/command bindings. An additive migration is required before implementation, but is not authorized in this discovery phase.

## Proposed bounded changes

| Area | Proposed change | Constraint/index |
| --- | --- | --- |
| Provider identity | `WhatsappProviderAccount` with provider, external account hash, phone hash/mask, status and config version; no secrets | unique provider + external account hash; status index |
| Inbound event | Add account ID, event kind, provider schema version and normalized payload hash | unique account + provider event ID; processing/expiry index |
| Outbound binding | Add secure command ID, approval ID, recipient identity hash/version, account ID and unknown-result marker | unique command ID; account/provider message index |
| Delivery status | New append-only `WhatsappMessageStatusEvent` | unique account + provider status event ID; message/time and status/time indexes |
| Handoff history | New append-only `WhatsappHandoffEvent` or reuse audited transition projection with explicit version | conversation/version unique; actor/time index |
| Media metadata | Optional `WhatsappMediaEnvelope` containing hashes, declared/detected MIME, size, scan state and expiry; no content/URL secrets | message and scan/expiry indexes |

## Data policy

- PII classification: phone/account identifiers are sensitive; store hashes and last-four masks where possible.
- Message bodies remain in existing model and require an explicit retention policy.
- Raw provider payloads are not copied into new models.
- Provider credentials and Baileys session material never enter Prisma.

## Delivery properties

- Zero downtime: feasible with nullable additive columns/tables and dual-read deployment before constraints become authoritative.
- Backfill: only bounded derivation of account/message references after separate review; no speculative PII reconstruction.
- Rollback impact: application rollback ignores additive tables/columns; data written by new release remains inert.
- Migration authorization: `false`.
- Migration created: no.
