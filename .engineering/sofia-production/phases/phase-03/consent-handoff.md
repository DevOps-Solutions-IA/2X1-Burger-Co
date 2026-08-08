# Consent and human handoff

## Consent

`CustomerConsent` and `SofiaCrmService.grantOptIn`/`revokeOptIn` provide versioned, audited consent for `MARKETING` or `SERVICE` over `WHATSAPP`, `SMS`, or `PHONE`. `SofiaCustomerMemory.consentState` separately tracks `UNKNOWN`, `IMPLIED_BY_CONVERSATION`, or `OPTED_OUT`.

Neither `processInboundWebhook`, `handleInboundMode`, `createOutboundForMode`, nor `approveSend` queries the latest CRM consent. Therefore consent exists but is disconnected from messaging authorization. An inbound customer message may justify a narrowly scoped service response under owner-approved policy; it must not imply marketing consent. Revocation/opt-out must immediately block outbound automation and prevent AI-generated outbound suggestions from becoming executable.

## Handoff

Supported states in current architecture:

- `SOFIA_ACTIVE` maps to automation allowed only after all other policy gates.
- `HUMAN_REQUIRED` blocks SOFIA and requests operator review.
- `HUMAN_TAKEN` binds an assigned user and blocks SOFIA.
- `SOFIA_PAUSED` blocks SOFIA.
- `RESOLVED` and `ARCHIVED` exist as conversation statuses.
- `PILOT_NOT_ALLOWED` is a free-form human status used by the allowlist gate.

The requested conceptual states map as follows: `AUTOMATION_ALLOWED` -> current active flags; `HUMAN_HANDOFF_REQUIRED` -> `HUMAN_REQUIRED`; `HUMAN_ACTIVE` -> `HUMAN_TAKEN`; `AUTOMATION_PAUSED` -> `SOFIA_PAUSED`; `CLOSED` -> `RESOLVED`/`ARCHIVED`. `OPTED_OUT` exists in consent models, not conversation state. `BLOCKED` has no authoritative conversation state and should remain a policy decision unless a future schema is authorized.

## Gaps and actions

1. `pauseConversation`, `resumeConversation`, `takeOverConversation`, and `releaseConversation` mutate state directly; only the separate `SofiaService.handoffConversation` path writes explicit handoff audit.
2. Release can re-enable SOFIA without checking consent, governance, or assigned-operator ownership.
3. There is no append-only handoff transition history or optimistic version.
4. The `SOFIA_HUMAN_HANDOFF_ENABLED` key is exposed in status but does not form the decision authority.

Design `WhatsappConsentService` as the effective latest-consent reader and `WhatsappHandoffService` as the sole transition authority. Every transition requires actor, previous version, reason, audit, and policy revalidation. Release to automation must fail closed when opted out, globally paused, killed, closed, or unsupported.
