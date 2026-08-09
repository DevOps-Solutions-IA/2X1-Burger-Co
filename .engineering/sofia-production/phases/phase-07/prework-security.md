# Phase 07 read-only pre-work

Status: HISTORICAL / SUPERSEDED

Source reviewed: `3d70b80dcd2678357906d9856e5bca9fb29834a1`.

No Phase 7 branch or runtime edits were created. Production remains closed.

## Activation blockers

- Critical: canonical Bold webhook evidence can commit before the financial transition and kitchen eligibility; replay of the existing evidence currently skips missing work.
- High: WhatsApp processing bypasses normalized text bounds and the configured per-minute rate limit is unused.
- High: the legacy payment webhook lacks canonical provider-account and exact immutable payment binding.
- High: refresh-token rotation is read/revoke/create rather than one conditional transaction, allowing concurrent descendants.
- High: inbound WhatsApp claims have no lease/attempt/recovery semantics and can remain permanently claimed.
- High: QR receive-only reconnect settings are unused and session ownership is not protected across replicas.
- High: legacy WhatsApp sends use non-atomic audit deduplication and can continue after a local timeout.

## Mock and sandbox findings

- Production-reachable mock provider implementations: 0.
- Production-reachable mock-like, hardcoded PASS or fallback mechanisms: 9 grouped findings.
- Guarded test/sandbox endpoints: 9.
- Unguarded sandbox-labelled recovery endpoint: 1.
- Two database provider defaults still produce `mock` provenance when callers omit provider.
- Two independent Baileys sockets remain; legacy receipt, summary and location acknowledgements can call the socket directly.

## Non-migration remediation

- Retire the legacy payment webhook in favor of canonical exact binding.
- Make refresh rotation a conditional transaction with one winner.
- Consume only normalized inbound text and enforce bounded per-account/sender rate limits.
- Eliminate direct legacy notification sends in favor of outbox, SecureCommand and the Phase 3 gateway.
- Replace synthetic readiness/security PASS claims with executable evidence.
- Guard or remove the unguarded sandbox recovery route and add production database guards to smoke/seed scripts.
- Bound DeepSeek retries and report actual provider health.
- Add SSRF, redirect, timeout, content type and size controls for remote report logos.
- Reject SecureCommand self-approval for operational commands.

No critical/high issue may remain unresolved before Phase 7 merge or production activation.

This pre-work records findings against the Phase 5 baseline only. The Phase 7
security review and executable tests supersede it for the release candidate.
