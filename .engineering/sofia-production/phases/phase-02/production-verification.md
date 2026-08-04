# Phase 02 production verification

## Release identity

- Source and main commit: `9e21178a7cc7aa6e0651f8e4b31521cb518608ac`
- Build ID: `0.1.0-9e21178a7cc7-1785798879`
- API image: `sha256:fefe9f6a9f0ebbccafe643c85d0b83629aa6a9e7decaa7d26a77bfad881443dd`
- Web image: `sha256:1432748154c8f4ce318b6e844e65699f01cf1147b17dfa79e2c6885676f89b6f`
- Dirty build: `false`
- Image secret/backup scan: PASS

## Runtime gates

API, Web, Nginx and PostgreSQL are healthy. Liveness is `ALIVE`; readiness is `READY`, with `33/33` migrations, verified migration identity, the accepted initial FILE_ONLY_DRIFT attestation and safety compatibility PASS. API and Web expose the exact main commit and matching build ID.

The production image registry exposes only the non-operational `SOFIA_INTERNAL_VALIDATE` handler. Eight operational command types remain disabled. Runtime effective flags report real sending, auto reply, auto safe, production and WhatsApp PAID as false. Global governance pause remains active, the kill switch remains available, and mock/sandbox routes are unavailable.

Operational counters before and after migration/deployment are identical: products `26`, order tickets `1,211`, sales `827`, WhatsApp delivery orders `103`, inventory movements `5,409`, cash movements `899`, SOFIA payment events `126`, outbound messages `53`, and sent outbound messages `35`. Secure-command, approval, attempt and result rows remain `0`. No schema error, crash loop, critical error, data loss or unexpected outbound was detected.

After a five-minute controlled observation, all four services remained healthy with restart count `0`; readiness remained `READY` at `33/33`, and migration/schema/crash/fatal log pattern counts remained zero.

Static/runtime safety tests passed `10/10`; secure-command lifecycle, idempotency, approval, policy, redaction, migration and architecture tests passed `47/47`. CI also passed ephemeral E2E and recovery drill.
