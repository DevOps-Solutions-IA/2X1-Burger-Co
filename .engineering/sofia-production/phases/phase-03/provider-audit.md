# Provider audit

## Resolution

- Provider status: `RESOLVED`
- Intended SOFIA provider type: Baileys QR gateway (`@whiskeysockets/baileys` `7.0.0-rc13`)
- Current mode: `receive_only`
- Current outbound capability: blocked by `SofiaWhatsappQrGatewayProvider.blockedSend`
- Alternative adapter: Hermes HTTP/HMAC scaffold, configured only when all required keys exist
- Test-only adapter: mock, rejected outside `NODE_ENV=test`

Evidence: `apps/api/src/modules/sofia/whatsapp/whatsapp-provider.factory.ts`, `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts`, `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.provider.ts`, and `apps/api/package.json`.

## Provider comparison

| Property | QR gateway | Hermes |
| --- | --- | --- |
| Inbound source | In-process Baileys `messages.upsert` | HTTP `POST /integrations/hermes/whatsapp/webhook` |
| Verification | Trusted internal callback flag; public QR webhook rejected | `x-hermes-signature` HMAC-SHA256 |
| Signature defect | Not applicable to in-process callback | Uses `JSON.stringify(parsedBody)`, not `request.rawBody` |
| Account binding | Live socket user ID only, not persisted policy binding | `HERMES_PHONE_NUMBER_ID` declared but not checked |
| Message types | text, captioned image/video, audio, interactive, location mapped to system | text, image, audio, interactive |
| Status events | Not consumed | Not distinguished from messages |
| Outbound | Always blocked in SOFIA QR adapter | HTTP `/messages` with idempotency header |
| Retry | None in adapter | Service-level retries around outbound records; provider timeout exists |
| Health | QR state derived from live socket and runtime gate | Configuration presence only |
| Unknown result | Failed/unknown window remains | Timeout can occur after provider acceptance |

## Configuration keys

Names only:

- `WHATSAPP_PROVIDER`
- `WHATSAPP_MODE`
- `WHATSAPP_QR_ENABLED`
- `WHATSAPP_QR_SESSION_NAME`
- `WHATSAPP_QR_SESSION_PATH`
- `WHATSAPP_QR_RECONNECT_ENABLED`
- `WHATSAPP_QR_MAX_RECONNECT_ATTEMPTS`
- `WHATSAPP_QR_ALLOW_RECEIVE`
- `WHATSAPP_QR_ALLOW_REAL_SEND`
- `WHATSAPP_QR_SANDBOX_ONLY`
- `SOFIA_QR_PILOT_ALLOWLIST_ENABLED`
- `SOFIA_QR_PILOT_ALLOWED_PHONES`
- `SOFIA_QR_PILOT_RECEIVE_ONLY`
- `SOFIA_QR_PILOT_REAL_SEND`
- `SOFIA_AUTO_REPLY_ENABLED`
- `SOFIA_HUMAN_HANDOFF_ENABLED`
- `SOFIA_REPLY_OUTSIDE_HOURS`
- `SOFIA_WHATSAPP_RATE_LIMIT_PER_MINUTE`
- `SOFIA_WHATSAPP_DEDUP_TTL_MINUTES`
- `HERMES_BASE_URL`
- `HERMES_API_TOKEN`
- `HERMES_WEBHOOK_SECRET`
- `HERMES_PHONE_NUMBER_ID`
- `HERMES_TIMEOUT_MS`
- `HERMES_MAX_RETRIES`

## Owner values required before any activation

For the code-supported QR architecture: dedicated WhatsApp Business account/number, approved session owner, sanitized session name, protected session storage location, explicit receive allowlist/canary recipient set, retention decision, opt-in evidence policy, handoff operators, and emergency contacts. No API token is required by Baileys, but the encrypted session credentials are secret material.

If the owner instead selects Hermes, a separately reviewed provider contract is required plus base URL, API token secret reference, webhook secret reference, exact phone-number/account identity, signature specification, token rotation procedure, provider status-event schema, test recipient, and provider rate limits. The existing Hermes scaffold is not sufficient evidence of production readiness.

## Decision

Use a single `WhatsappProviderAdapter` boundary. Do not permit simultaneous SOFIA QR and Hermes activation. Keep the operational `WhatsappService` outside this boundary unless a later migration plan explicitly consolidates transport ownership without changing its domain behavior.
