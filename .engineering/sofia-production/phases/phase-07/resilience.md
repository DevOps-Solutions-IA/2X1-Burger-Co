# Phase 7 resilience evidence

Status: PASS_LOCAL_REMOTE_CI_PENDING

## Verified source mechanisms

- QR session ownership uses an expiring persisted lease, monotonically increasing fencing token and PostgreSQL advisory transaction lock.
- QR callbacks verify current socket and fencing ownership before processing; ownership loss tears down the socket and cancels reconnect work.
- QR reconnect uses bounded exponential delays and releases ownership when disabled or exhausted.
- WhatsApp inbound account/sender rate checks are serialized across replicas and fail closed on invalid limits.
- Notification processing renews its fenced claim before materialization, command receipt and final state transition; lease loss stops processing.
- Refresh-token rotation is atomic and single-winner under concurrency.
- DeepSeek requests use bounded timeout/retry behavior and deterministic rules fallback; provider health no longer reports healthy merely because configuration exists.
- Staging deployment requires a created encrypted backup and a validate-only restore before continuing.
- Production restore forbids bypassing the pre-restore backup.

## Validation

- PostgreSQL multi-replica concurrency/fault/load: PASS, `41/41`.
- QR ownership-loss, fencing and bounded reconnect: PASS.
- Notification lease-loss, renewal, reclaim and unknown-result handling: PASS.
- Refresh-token concurrent rotation single-winner property: PASS.
- Provider timeout, retry and unknown-result handling: PASS.
- Fresh migrations: PASS, `37/37`.
- Legacy `36 -> 37` plus production-frontier rehearsal: PASS.
- Exact-artifact restore drill: PASS, `run-20260809132631-4cecf476`, RPO 0s/RTO 13.335s.
- Observed RPO: 0 seconds. Observed RTO: 13.335 seconds.
- E2E and recovery cleanup: 0 containers, 0 volumes and 0 networks; ephemeral
  cryptographic material removed.

QR ownership deliberately holds a PostgreSQL transaction/advisory lock for a
bounded maximum of 120 seconds while the durable effect is active. This is an
accepted operational tradeoff: it fences a second owner and is bounded by lease
expiry and reconnect policy.
