# Implementation plan

## Designed modules

| Component | Responsibility |
| --- | --- |
| `WhatsappInboundGateway` | Accept verified provider bytes/events and return a sanitized receipt |
| `WhatsappOutboundGateway` | Execute only a claimed secure command through the selected account adapter |
| `WhatsappProviderAdapter` | Provider-specific verify/normalize/send/status/health boundary |
| `WhatsappWebhookVerifier` | Raw-body signature, timestamp/replay window and account binding |
| `WhatsappEventNormalizer` | Emit message, status, or unsupported event DTO; raw payload never escapes |
| `WhatsappInboundDeduplicator` | Atomically claim provider event and return deterministic replay |
| `WhatsappOutboundCommandHandler` | Closed `SOFIA_SEND_WHATSAPP` handler with recipient and approval binding |
| `WhatsappMessagePolicyService` | Consent, purpose, handoff, governance, kill switch, hours and rate policy |
| `WhatsappConsentService` | Resolve latest effective CRM consent by purpose/channel |
| `WhatsappHandoffService` | Versioned, audited transition authority |
| `WhatsappDeliveryStatusService` | Validate monotonic status updates and append history |
| `WhatsappMediaSecurityService` | Metadata validation, quarantine decision and retention |
| `WhatsappProviderHealthService` | Account/session, transport, rate and status capability health |

## DTO boundary

- `InboundMessageEvent`: provider/account IDs, event/message IDs, sender identity hash/mask, type, sanitized text, media envelope reference, occurred time, payload hash.
- `InboundStatusEvent`: provider/account IDs, status event ID, provider message ID, normalized status, occurred time, payload hash.
- `OutboundMessageCommand`: command/outbound/conversation IDs, recipient identity binding, approved text/media reference, purpose, expiry.
- `OutboundMessageResult`: sanitized result code, provider message ID, accepted-at time, retry class, unknown-result flag.
- `DeliveryStatusUpdate`: provider message binding, old/new state, event ID and time.
- `ConsentDecision`: allowed, purpose, consent version, reason code and evaluated time.
- `HandoffDecision`: automation allowed, state/version, assigned actor hash and reason code.
- `ProviderHealthResult`: configured, connected, account bound, receive/send/status capabilities and sanitized blockers.

## Sequenced implementation

1. Approve provider and migration design.
2. Add provider-neutral DTOs, ports and fake deterministic adapter.
3. Add raw-body verifier and account binding.
4. Add event normalizer and atomic deduplicator.
5. Add consent and handoff policy with audit.
6. Add additive schema and dual-read persistence.
7. Connect inbound receive-only with status events excluded from AI.
8. Add delivery status and provider health.
9. Add secure-command outbound handler but keep it disabled.
10. Run isolated contract/security/load tests.
11. Deploy receive-only with automation disabled.
12. Execute the separately authorized activation plan.

No step in this plan enables order, payment, stock, cash, sale, auto reply, or real outbound behavior by itself.
