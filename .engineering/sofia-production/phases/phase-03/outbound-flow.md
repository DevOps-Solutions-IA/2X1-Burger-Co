# Outbound flow

## Current behavior

`SofiaWhatsappService.createOutboundForMode` persists `WhatsappOutboundMessage`. Receive-only produces `SUGGESTED`; supervised produces `APPROVAL_PENDING`. `approveSend` performs an RBAC-protected admin action, checks runtime safety, claims the row with `updateMany`, and calls the provider directly. `retryOutbound` follows the same direct path. Neither method uses `SecureCommandService` or durable Phase 2 approval binding.

The QR adapter cannot send. Hermes can send HTTP requests with an `Idempotency-Key`, but the provider result and database update are non-atomic. A timeout after provider acceptance is an unresolved-result window. There is no delivery/read status pipeline.

## Target path

SOFIA suggestion -> operator review -> `SecureCommandService.receive` -> durable human approval -> policy revalidation -> closed `WhatsappOutboundCommandHandler` -> provider adapter -> sanitized result persistence -> delivery status events.

| Property | Phase 3 design |
| --- | --- |
| Command type | `SOFIA_SEND_WHATSAPP` |
| Handler status now | Disabled in `CommandHandlerRegistry` |
| Approval required | Yes, explicit authenticated human; inbound text is never approval |
| Idempotency key | Scope + conversation ID + outbound ID + content hash + recipient identity version |
| Payload hash | Canonical sanitized command, not raw provider payload |
| Recipient binding | Customer identity hash, conversation, provider account and masked destination |
| Provider message ID | Persist only after adapter result; unique per provider/account when present |
| Result storage | Phase 2 sanitized command result plus outbound projection |
| Retry policy | Replay command result first; retry only explicit retryable failures with no accepted provider ID |
| Unknown-result policy | Query provider status where supported; otherwise human review, never blind resend |
| Audit | Suggestion, approval, policy, claim, adapter attempt, result/status, conflict and replay |

## Non-negotiable boundary

No outbound handler is enabled by this plan. `WhatsappService` remains domain-owned for existing operator workflows and cannot be injected as a shortcut into SOFIA orchestration. A future implementation must remove direct SOFIA provider calls before activation, while preserving `SOFIA_SEND_WHATSAPP` fail-closed until a separate activation authorization.
