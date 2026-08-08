# SOFIA Phase 3 discovery

## Baseline

- Repository: `DevOps-Solutions-IA/2X1-Burger-Co`
- Branch: `feature/sofia-03-whatsapp-production`
- Base: `01e078745ed82807efa6b93b600c3fbbd64c01ab`
- Production executable: `9e21178a7cc7aa6e0651f8e4b31521cb518608ac`
- Production migrations: `33/33`
- Scope: code discovery and design only. No runtime activation, credentials, migration, deployment, or provider registration.

The principal checkout was fast-forwarded to `origin/main` with divergence `0 0`. Known untracked audit evidence and encrypted backups were preserved. Production API, Web, Nginx and PostgreSQL remained healthy without restart; readiness reported `33/33`, and release metadata remained on the authorized executable SHA. The SHA difference is documentation-only.

## Executive finding

The intended SOFIA transport is the Baileys-based QR gateway, not Meta Cloud API or Twilio. `WhatsappProviderFactory` supports `qr_gateway`, `hermes`, `mock`, and `none`, while `.env.example` selects `qr_gateway` with `receive_only`. `SofiaWhatsappQrGatewayService.createRealSocket` creates the Baileys socket and forwards individual inbound events internally to `SofiaWhatsappService.processInboundWebhook`. The QR provider's outbound methods always return `BLOCKED_REAL_SEND_DISABLED`.

The repository also contains a second Baileys stack, `WhatsappService`, for operator-triggered receipts, delivery summaries, groups, and inbound delivery locations. It is not a SOFIA provider adapter and must not become an implicit SOFIA outbound bypass.

## Capability matrix

| Capability | File and symbol | Current behavior | Persistence | Production risk | Phase 3 action |
| --- | --- | --- | --- | --- | --- |
| Provider selection | `apps/api/src/modules/sofia/whatsapp/whatsapp-provider.factory.ts`, `WhatsappProviderFactory` | Configuration-only outside tests; mock is rejected | None | Hermes and QR semantics differ | Select one production adapter explicitly; retain fail-closed factory |
| QR transport | `.../qr-gateway/sofia-whatsapp-qr-gateway.service.ts`, `createRealSocket` | Baileys session, QR, receive-only inbound | Session files plus sanitized `Setting` state | Unofficial session transport; duplicate stack | Isolate credentials/session, account binding, health, lifecycle |
| Public inbound | `apps/api/src/modules/sofia/sofia-whatsapp.controller.ts` | Hermes HMAC route; QR public route is rejected unless internal transport flag exists | Inbound event/message rows | Hermes signs reserialized JSON, not raw bytes | Raw-body verifier and event-type normalization |
| Inbound dedup | `SofiaWhatsappService.processInboundWebhook` | Unique event/hash and message idempotency keys | `WhatsappInboundEvent`, `WhatsappMessage` | Duplicate marker creates extra event rows | Dedicated atomic deduplicator and deterministic receipt |
| Customer resolution | `SofiaWhatsappService.resolveCrmCustomer` | Resolves or creates CRM identity | CRM customer/identity and conversation relation | Consent not evaluated before AI | Add policy lookup after resolution and before SOFIA |
| Conversation policy | `handleInboundMode` | Pause, kill switch, allowlist and handoff block automation | Conversation plus settings/audit | Consent and status-event gates absent | Central message policy decision |
| Suggested outbound | `createOutboundForMode` | Persists `SUGGESTED` in receive-only | `WhatsappOutboundMessage` | Not linked to secure command | Create command only after explicit operator action |
| Outbound approval | `approveSend` | RBAC endpoint plus runtime gate, then direct provider call | Outbound row | Bypasses durable Phase 2 approval/claim/result | Replace with closed `SOFIA_SEND_WHATSAPP` handler in a later authorized implementation |
| Delivery status | `WhatsappProviderAdapter.getMessageStatus` | Always `UNKNOWN`; no status event pipeline | Provider message ID only | No authoritative delivered/read/failed lifecycle | Add normalized status gateway and append-only events |
| Consent | `SofiaCrmService.grantOptIn`/`revokeOptIn` | Versioned, audited admin records | `CustomerConsent` | Inbound/outbound WhatsApp path does not consult latest consent | Add purpose-aware consent policy |
| Human handoff | `takeOverConversation`, `releaseConversation`, `handoffConversation` | Conversation flags block SOFIA | Conversation row | Some mutations lack direct audit/history | Append handoff transitions and audit every transition |
| Media | QR upsert plus `handleInboundMode` | Captions/text only; media URL discarded; untranscribed audio/image escalates | MIME only and sanitized summary | No size/type/scanning service | Quarantine metadata, do not fetch by default |
| Core operational WhatsApp | `apps/api/src/modules/whatsapp/whatsapp.service.ts` | Baileys receipts, delivery summaries, group sends and location capture | Audit and delivery inbox | Separate send path outside secure command | Keep domain-owned and prohibit SOFIA imports |

## Verified gaps

1. No provider-neutral distinction between inbound messages and delivery/status events.
2. No raw-body signature contract for Hermes despite Nest raw body support.
3. No persisted provider account/phone binding checked on every event.
4. No consent or opt-out decision in the inbound path before AI.
5. No durable handoff transition history; several direct state mutations are unaudited.
6. No secure-command-backed outbound handler; the command type is explicitly blocked.
7. No delivery/read status history, status monotonicity, or poisoning defense.
8. No provider-neutral retry/unknown-result protocol tied to Phase 2 results.
9. No media quarantine, bounds, allowlist, malware scan, or retention enforcement.
10. No single transport owner: SOFIA QR and operational WhatsApp each create Baileys sockets.

## Preserved safety state

`CommandHandlerRegistry` keeps `SOFIA_SEND_WHATSAPP` disabled. `SofiaRuntimeSafetyService` reports effective real send, auto reply, auto safe, and production as false. Production `/health/metrics` confirmed all four effective flags false. No operational action was executed during discovery.
