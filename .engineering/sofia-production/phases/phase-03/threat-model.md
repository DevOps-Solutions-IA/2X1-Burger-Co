# WhatsApp threat model

All failures default to persistence-only or human review; none may enable automatic outbound or an operational domain mutation.

| # | Threat | Current control | Gap | Required control | Fail-closed behavior | Test strategy |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Forged webhook | Hermes HMAC; QR external calls rejected | Hermes signs reserialized JSON | Raw-byte HMAC and account binding | 401, sanitized rejected-event audit | Byte mutation and missing signature |
| 2 | Replayed webhook | Unique event/hash constraints | Replay window and deterministic receipt absent | Timestamp/nonce window plus atomic claim | Return prior receipt, no AI | Concurrent and delayed replay |
| 3 | Duplicate delivery | Outbound idempotency key | Provider acceptance/DB update window | Secure command replay and provider lookup | Unknown result, no blind resend | Timeout after acceptance |
| 4 | Stolen token/session | Secret env/session directory | No provider-account revocation workflow | Encrypted scoped storage, rotation, session revoke | Disable adapter and alert | Revoked credential fixture |
| 5 | Leaked verify token | No Meta handshake in current provider | Future provider ambiguity | Keep verify token secret and compare constant-time | Reject handshake | Wrong/missing token |
| 6 | Wrong app/webhook secret | Hermes fails when absent | No rotation overlap/version | Versioned secret references and rotation window | Adapter unhealthy, inbound rejected | Old/new/wrong secret |
| 7 | Sender spoofing | Transport sender/JID normalization | No verified sender/account binding projection | Bind sender to verified provider event and account | Store rejected evidence only | Payload sender mismatch |
| 8 | Recipient mismatch | Outbound row has conversation phone | No consent identity/version binding | Hash-bound recipient, conversation, account and command | Command conflict | Swap recipient after approval |
| 9 | Outbound replay | Unique outbound key | Direct approve/retry bypasses Phase 2 | Secure command idempotency/result replay | Return result, no send | Repeat approval and retry |
| 10 | Opt-out violation | CRM consent records | Messaging path does not query consent | Purpose-aware latest-consent policy | No suggestion execution/send | Revoke between approval and claim |
| 11 | Handoff violation | Conversation flags block AI | Release lacks full policy/audit | Versioned transition authority and pre-handler check | Keep human ownership | Concurrent takeover/release |
| 12 | Governance bypass | Runtime safety gate | Not bound to every future adapter call | Policy at receive, approval, claim and handler | Block and audit | Pause at each lifecycle stage |
| 13 | Kill-switch bypass | Kill switch has precedence | Separate transport stacks | Shared safety port required by all sends | Block adapter invocation | Activate before handler |
| 14 | Provider timeout | Abort/timeout in Hermes/core service | Unknown acceptance state | Explicit unknown-result class and status query | Human review, no retry | Response lost after acceptance |
| 15 | Unknown provider result | Provider ID/status fields | `getMessageStatus` always unknown | Provider capability and reconciliation protocol | Terminal review state | Ambiguous provider response |
| 16 | Rate-limit exhaustion | Controller throttle 120/minute | Configured SOFIA rate key unused; no per-account/provider budget | Layered IP/account/sender/provider token buckets | 429 before AI/send | Burst and distributed sender tests |
| 17 | Webhook flooding | Global throttler | DB/AI work can still amplify | Cheap verify/dedup before persistence/AI, bounded queues | Shed load safely | Valid duplicate flood |
| 18 | Malformed payload | Basic parser defaults | No schema/version DTO | Strict provider schema and bounded fields | 400, no conversation/AI | Fuzz nested/oversized JSON |
| 19 | Status poisoning | No status-event path | Status can be misclassified as message | Separate signed normalizer and monotonic status service | Reject/unmatched status | Cross-message/account status |
| 20 | Wrong business account | Live socket user shown | Not persisted/checked per event | Approved account/phone binding | Adapter unhealthy/reject event | Account mismatch fixture |
| 21 | Wrong phone number | Masked live phone only | No owner-approved identity version | Phone hash/mask plus configuration version | Connection blocked | Session linked to wrong number |
| 22 | Media malware | Media not downloaded | Future fetch path undefined | Quarantine, scan, type/size limits | Human review; no model access | EICAR-style safe fixture |
| 23 | Oversized media | No download currently | No declared limits | Stream byte limit and timeout | Abort/delete quarantine | Oversized stream |
| 24 | Prompt injection | Media/text treated as user input | No WhatsApp-specific injection boundary | Untrusted-content envelope; policy/tools cannot be overridden | Suggestion only/handoff | Tool-like hostile text/caption |
| 25 | PII leakage | Sanitizers, URL discarded, masked logs | Raw message/event rows retain phone/body | Field classification, retention, minimized logs/results | Redacted audit/error | Nested phone/address/token fixtures |
| 26 | Session file traversal | Canonical path/child validation | Two session storage implementations | One hardened session owner and mode `0700` | Startup blocked | Symlink/traversal fixtures |
| 27 | Unauthorized operator send | JWT/Roles on admin routes | Direct retry lacks actor parameter/audit; no durable approval | Phase 2 approval with permission revalidation | 403/blocked command | Role and stolen approval tests |
| 28 | Concurrent send claims | `updateMany` status claim | Not durable across command/outbound state | Phase 2 atomic claim/lease | One winner | Parallel approval/retry |
| 29 | Data-retention failure | Policy exists, destructive run blocked | WhatsApp body/status/media retention not enforced | Audited expiry job and legal hold | No deletion without explicit authority | Dry-run and scoped deletion tests |
| 30 | Duplicate transport ownership | Two Baileys services | Sessions can diverge or compete | Explicit ownership and non-overlapping configuration | Refuse dual SOFIA activation | Startup dual-owner test |

Threat count: `30`.
