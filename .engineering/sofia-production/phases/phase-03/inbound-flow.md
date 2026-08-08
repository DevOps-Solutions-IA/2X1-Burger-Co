# Inbound flow

## Current QR path

1. `SofiaWhatsappQrGatewayService.createRealSocket` creates a Baileys socket.
2. `messages.upsert` invokes `onRealMessagesUpsert`.
3. Own messages, groups, and `status@broadcast` are ignored.
4. Phone, message ID, timestamp, text/caption and coarse type are normalized into a sanitized summary.
5. `SofiaWhatsappService.processInboundWebhook` is called with `trustedBaileysTransport=true` and receive-only headers.
6. `WhatsappProviderFactory` ignores header/route overrides outside tests and resolves configured provider/mode.
7. Event hash and provider identifiers are checked against `WhatsappInboundEvent`; unique constraints arbitrate races.
8. QR pilot allowlist is evaluated.
9. Conversation and inbound message are persisted; media URL is deliberately discarded.
10. Runtime safety checks governance pause and kill switch before analysis.
11. Conversation pause/handoff flags are checked.
12. `SofiaAgentService.processInboundMessage` runs for usable text.
13. A suggested outbound row is created; receive-only never sends.

## Current Hermes path

`POST /integrations/hermes/whatsapp/webhook` -> `SofiaWhatsappService.processInboundWebhook('hermes')` -> HMAC verification -> same persistence/policy path. The verifier currently hashes a reserialization of the parsed body instead of the raw bytes available through Nest `rawBody`; production integration must correct this contract.

## Gate findings

| Requirement | Result | Evidence / gap |
| --- | --- | --- |
| Invalid signature fails closed | Partial | Hermes rejects invalid signature; QR has no public webhook and rejects external QR calls. Hermes canonical bytes are unsafe. |
| Duplicate cannot process twice | Pass with caveat | Event/hash and message unique constraints; duplicate audit rows are synthetic rather than a deterministic receipt model. |
| Status events do not enter AI | Fail | No status-event DTO/normalizer; `SYSTEM` can reach agent with empty text. |
| Sender normalized | Partial | Colombian normalization exists; no account/recipient binding or verified identity state. |
| Unsupported events safe | Partial | groups/status broadcast ignored in QR; unknown provider events lack explicit classification. |
| Governance pause blocks automation | Pass | `SofiaRuntimeSafetyService.evaluate('INBOUND_ANALYSIS')`. |
| Kill switch blocks automation | Pass | Same gate, with kill-switch precedence. |
| Human handoff blocks automation | Pass | `sofiaEnabled`, status, and `humanStatus` checked. |
| Opt-out blocks automation | Fail | CRM consent exists but is not queried by inbound policy. |
| Media treated as untrusted | Partial | URL discarded and no fetch; caption/transcript enters AI without a dedicated media policy decision. |

## Required inbound boundary

`WhatsappInboundGateway` receives provider bytes or trusted in-process events. `WhatsappWebhookVerifier` verifies signature/account identity before parsing. `WhatsappEventNormalizer` emits exactly one of `InboundMessageEvent`, `InboundStatusEvent`, or `UnsupportedEvent`. `WhatsappInboundDeduplicator` atomically claims the provider event. Customer resolution occurs next, followed by `WhatsappConsentService`, `WhatsappHandoffService`, governance/kill-switch policy, persistence, and only then SOFIA analysis. Status and unsupported events must never enter AI.
