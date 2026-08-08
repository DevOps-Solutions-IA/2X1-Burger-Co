# Phase 3 security verification

| Control | Evidence | Result |
| --- | --- | --- |
| Production mock rejection | Environment validation and architecture tests | PASS |
| Raw-body Hermes HMAC | `rawBody` verification tests include byte changes and missing/invalid signatures | PASS |
| Provider/account binding | Expected account, business identity, session owner and connection state are checked | PASS |
| Inbound replay | Unique provider/account/event constraint plus transactional claim | PASS |
| Status isolation | Normalized status events route only to delivery-status persistence | PASS |
| Consent | Latest effective consent and revocation govern purpose-specific automation | PASS |
| Handoff | Versioned authority with legal transitions and runtime revalidation | PASS |
| Media | Metadata-only envelope; unsupported/untrusted media is quarantined or handed off | PASS |
| Outbound | Secure-command target/payload/recipient/account binding; handler disabled | PASS |
| Secret/PII redaction | Focused nested redaction and response-boundary tests | PASS |
| Governance and kill switch | Rechecked immediately before the disabled operational boundary | PASS |

## Fail-closed limits

- There is no malware scanner; media is not fetched or sent to AI automatically.
- An unknown provider send result is not blindly retried.
- Provider/session identifiers are stored only as hashes or sanitized masks; credentials and session material are excluded.
- Production requires an explicit valid provider configuration. There is no real-to-mock, QR-to-Hermes, or error-to-test fallback.

