# Message model audit

## Reusable models

| Model | Existing strengths | Missing production property |
| --- | --- | --- |
| `WhatsappConversation` | Customer relation, provider conversation ID, mode, assignment, pause/handoff timestamps | Provider account binding, consent decision snapshot, automation state enum, closure reason/version |
| `WhatsappMessage` | Direction/type, provider ID/time, idempotency, AI metadata | Provider account, event kind, reply relation, status version, retention/redaction class |
| `WhatsappInboundEvent` | Unique provider event and provider/hash, processing state | Account scope, event kind, schema version, normalized hash, receipt/result, expiry |
| `WhatsappOutboundMessage` | Unique local/idempotency IDs, attempts, approval actor, provider ID | Secure command/approval IDs, recipient hash/version, provider account, unknown-result state, status history |
| `CustomerConsent` | Versioned purpose/channel grant/revoke with evidence hash | Direct policy lookup is absent from messaging path; no effective-state projection |
| `SofiaCustomerMemory` | Consent state and memory retention concept | Duplicates CRM consent semantics and is not authoritative for messaging permission |
| `SofiaCommand*` | Durable idempotency, approval, attempt and result | No WhatsApp handler or outbound relation enabled |

## Migration assessment inputs

The current schema cannot safely represent provider account identity, inbound message versus status events, append-only delivery status, secure-command linkage, recipient binding, or media quarantine metadata. Reusing free-form `status`, `humanStatus`, and JSON fields would make production invariants unverifiable.

The future migration should be additive and bounded. Candidate additions are a provider account/config projection without secrets, an inbound event-kind/account binding, an outbound command/recipient binding, append-only message status events, and media metadata/quarantine records. Existing message content and customer PII must not be duplicated.

No schema file or migration was changed during discovery.
