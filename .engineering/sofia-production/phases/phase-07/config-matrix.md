# Phase 7 configuration matrix

Status: SOURCE_VALIDATED_DEPLOYMENT_ATTESTATION_PENDING

This matrix records repository/program state, not secret-bearing runtime values. No .env or credential source was read.

| Control | Verified safe state | Source behavior | Release requirement |
| --- | --- | --- | --- |
| Production deployment | false | No production deployment was performed. | Requires separate owner authorization. |
| Real Bold | false | Provider selection has no mock default; production Bold endpoint is constrained. | Real provider probe and owner approval remain PENDING; do not activate. |
| Automatic WhatsApp | false | Real send remains blocked at the canonical provider boundary. | Keep real send, auto reply and Auto Safe disabled. |
| SOFIA_PRODUCTION_ENABLED | false | Defaults false; production validation cross-checks unsafe combinations. | Must remain false for this candidate. |
| WHATSAPP_QR_ALLOW_REAL_SEND | false | Defaults false and readiness checks declared safety. | Must remain false. |
| SOFIA_AUTO_REPLY_ENABLED | false | Defaults false and production validation guards activation. | Must remain false. |
| SOFIA_AUTO_SAFE_ENABLED | false | Defaults false and production validation guards activation. | Must remain false. |
| PHASE5_TEST_OPERATIONAL_ENABLED | false | Production validation rejects true. | Must remain false outside isolated tests. |
| PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED | false | Safe example default is false; fault/restart recovery tests pass. | Production activation remains PENDING. |
| NOTIFICATION_OUTBOX_WORKER_ENABLED | false | Added as an explicit safe example default. | Activation, reconciliation and alert drill are PENDING. |
| Production transport | HTTPS required | Secure cookies, HTTPS public URLs and origin-only HTTPS CORS are enforced. | Deployment-specific attestation is PENDING. |
| Migration frontier | 37 | Exactly 37 migration directories are present; Phase 7 adds none. | Fresh apply is PASS; production application remains unauthorized. |

Source-level fail-closed configuration validation passed. Deployment-specific
values, secret injection, provider account binding, alert routing and runtime
attestation remain owner-controlled activation gates. No secret value is recorded.
