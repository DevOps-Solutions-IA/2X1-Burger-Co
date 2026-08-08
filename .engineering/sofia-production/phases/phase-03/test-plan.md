# Test plan

## Provider and webhook

- Valid raw-byte signature accepted; modified bytes, missing signature, stale timestamp and wrong account rejected.
- QR public webhook rejected; only the in-process transport capability can submit QR events.
- Provider/account/phone mismatch rejected before persistence.
- Mock and header provider selection remain test-only.

## Inbound

- Concurrent duplicate events produce one processing claim and deterministic replay.
- Status, broadcast, own, group, unsupported and malformed events never enter AI.
- Phone normalization and account binding are deterministic.
- Governance pause, kill switch, handoff, opt-out and blocked policy each stop automation.
- Service consent and marketing consent are evaluated separately.

## Outbound

- `SOFIA_SEND_WHATSAPP` remains blocked until explicit activation.
- Approval binds actor, source, recipient, payload, command, account and expiry.
- Replay returns persisted result; conflict cannot resend.
- Provider timeout after possible acceptance becomes unknown-result/human review.
- Delivery/read/failed events are monotonic, deduplicated and cannot poison another account/message.

## Media

- MIME mismatch, oversized content, traversal filename, redirect to private network, malware and unsupported type fail closed.
- Caption/transcript is untrusted and cannot override policy.
- No URL, session credential, token, complete phone or raw payload appears in logs/results.
- Retention removes only authorized media artifacts and preserves audit hashes.

## Regression and environment

- Phase 0 mock/sandbox isolation, Phase 1 domain contracts and Phase 2 command gates pass.
- No order, sale, payment, stock, cash, delivery assignment or outbound side effect.
- Fresh ephemeral migration validation only after separate migration authorization.
- Startup fails on contradictory production flags and missing provider/account binding.
- Teardown proves no temporary database, media, session copy or plaintext secret remains.
