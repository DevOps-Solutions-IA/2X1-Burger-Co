# Mock and sandbox audit

Test fakes and admin sandbox fixtures remain explicitly test/dev scoped. Production provider selection has no real-to-mock, QR-to-Hermes or provider-error fallback. Phase 4 adds no provider implementation or environment flag.

- Production-reachable mocks: 0
- Production-reachable sandbox fallbacks: 0
- Real WhatsApp sends: 0
