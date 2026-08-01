# Sandbox and mock inventory

The tracked-source scan produced 938 candidate lines across 107 files. Every candidate was traced by import, controller registration, provider factory, environment selection, or test ownership. `UNKNOWN_REQUIRES_REVIEW` is zero.

| ID | File / symbol | Type | Runtime reachable before | Production selectable before | Dependencies | Current purpose | Classification | Action | Risk | Test required |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SM-01 | `apps/api/src/modules/sofia/payments/payment-provider.factory.ts` `resolve` | provider factory | yes | yes by direct selection | payment service | select payment adapter | TEST_ONLY | reject MOCK outside test | critical | provider isolation |
| SM-02 | `apps/api/src/modules/sofia/payments/mock-payment.provider.ts` | provider | yes | possible outside production env | factory | deterministic payment simulation | TEST_ONLY | construct only in test | critical | fake webhook and provider tests |
| SM-03 | `apps/api/src/modules/sofia/whatsapp/whatsapp-provider.factory.ts` | provider factory | yes | configuration dependent | WhatsApp service | select outbound adapter | TEST_ONLY / RETAIN_PRODUCTION | reject mock outside test; retain real and null-safe adapters | critical | mock rejection and real selection |
| SM-04 | `apps/api/src/modules/sofia/sofia-payment-webhooks.controller.ts` | dev controller | yes | yes when old controller is deployed | payment service | mock webhook injection | TEST_ONLY | guard every handler outside test | critical | route metadata and mutation rejection |
| SM-05 | `apps/api/src/modules/sofia/sofia.controller.ts` sandbox/test handlers | commercial/dev routes | yes | yes in old image | Sofia services | sandbox, AI test, mock inbound/outbound | TEST_ONLY | guard every handler outside test | critical | guard wiring |
| SM-06 | `apps/api/src/modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.controller.ts` test handlers | dev routes | yes | yes in old image | QR gateway | test inbound/send | TEST_ONLY | guard outside test | critical | guard wiring |
| SM-07 | `apps/api/src/modules/sofia/sofia-agent.service.ts` `processSandboxMessage` | sandbox application path | yes | yes in old image | conversation/order draft | sandbox conversation | TEST_ONLY | reject outside test | high | sandbox isolation |
| SM-08 | `apps/api/src/modules/sofia/sofia.service.ts` `createDeliveryOrderFromDraft` | mutation path | yes | yes in old image | Prisma/audit | converts draft to operational delivery | MIGRATE_TO_REAL_SERVICE | block all non-test conversion in Phase 0 | critical | no DB call before rejection |
| SM-09 | `DELIVERY_FEE_SANDBOX` in Sofia agent | hardcoded fee | sandbox flow | could reach draft conversion before | sandbox draft | deterministic laboratory fee | TEST_ONLY | isolate with sandbox flow and mutation block | critical | fake fee persistence block |
| SM-10 | `apps/web/src/app/(app)/sofia/sandbox/page.tsx` | frontend route | yes | yes | Sofia API | sandbox UI | REMOVE | deleted | high | route absence/build |
| SM-11 | `apps/web/src/app/pagos/mock/[reference]/page.tsx` | frontend route | yes | yes | mock payment API | fake payment UI | REMOVE | deleted | critical | route absence/build |
| SM-12 | QR test controls in `apps/web/src/app/(app)/sofia/whatsapp-qr/page.tsx` | frontend controls | yes | yes | QR test endpoints | operator test send/inbound | REMOVE | deleted | critical | component/build |
| SM-13 | `NullWhatsappProvider`, runtime safety and allowlist controls | fail-safe controls | yes | yes | runtime services | prevent effects when disabled | RETAIN_SECURITY_CONTROL | preserve | low | regression |
| SM-14 | mock AI scenarios guarded by test environment | deterministic AI | test only | no | AI adapter tests | deterministic assertions | TEST_ONLY | retain under tests | low | test environment acceptance |
| SM-15 | hardcoded opening-hour and featured-offer descriptors | operational shortcut | read path | yes in old image | catalog/assistant | messaging hints | MIGRATE_TO_REAL_SERVICE | cannot mutate price/availability; replace with authoritative settings in a later authorized phase | medium | no production mutation |
| SM-16 | historical mock/sandbox classifications in persistence and governance | audit data | yes | no provider selection | reporting/audit | preserve historical provenance | RETAIN_SECURITY_CONTROL | retain and keep non-operational | low | MOCK_ADMIN non-operation |

Generated outputs, dependencies, backups, screenshots, caches, and audit artifacts were excluded from source classification.

