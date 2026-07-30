# Contract Failures - Closed in Source

| ID | Contract | Expected | Observed baseline | Root cause and minimal correction |
| --- | --- | --- | --- | --- |
| REG-01 | WhatsApp location without usable sender phone | Existing delivery pricing/location snapshot remains unchanged | Test expected `deliveryLocationSource=null`; fixture already contained `address_zone_estimate` | `buildDeliveryPricingSnapshot` intentionally assigns `address_zone_estimate` at order creation. Compare every location field to `originalOrder`, not to invented nulls. |
| REG-02 | Sofia enterprise governance with QR disabled | Honest disabled/not-ready QR state | Test expected `qrGatewayReady=true`; runtime returned false | Current contract defines ready as real adapter plus CONNECTED/QR_READY. Expect false while disabled; keep receive-only capability separate. |
| REG-03 | QR connect while gateway disabled | Fail-closed response without bootstrap | Test expected HTTP 201; runtime returned HTTP 400 | `getQrRuntimeGate` deliberately rejects before socket/session bootstrap and audits the block. Expect 400 and `QR_GATEWAY_DISABLED`. |
| REG-04 | Delivery receipt second-send idempotency | Duplicate revision does not contact transport | Global outbound safety rejected the test before idempotency assertion | Test still mocked removed `assertEnabled` path. Mock `assertOutboundAllowed` only inside this idempotency test; separate safety tests retain real blocking assertions. |

Baseline command: the Phase 2026-07-28 ephemeral regression executed RBAC, Delivery Phase A and critical suites with `--runInBand --detectOpenHandles`; result 153/157.

All four failures were reproduced independently against an isolated 32-migration database. The changes preserve production safety and adjust only stale test setup/expectations to the demonstrated contracts.

## Validation

- Each corrected contract: 10/10 consecutive PASS.
- Related group: 3/3 consecutive PASS.
- Stable source regression: 157/157 PASS in 563.447 s.
- No production flag, transport or external provider was enabled.
- REG-04 still has separate outbound safety coverage; only the idempotency test bypasses the gate with an internal spy.
