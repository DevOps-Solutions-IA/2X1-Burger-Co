# Phase 01 production verification

## Release identity

- Source commit: `0c2c2cbc88cadba2304f32079641c77e25e499cb`
- Build ID: `0.1.0-0c2c2cbc88ca-1785632235`
- API image digest: `sha256:6fec5261d5eabb8491ab93f4f3a28fab891ba5622b177b5f97a913af03fe6806`
- Web image digest: `sha256:8e586be7d70eba2edacd4925155a53f63c988f5d383a0ab83aab4c5388e79d14`
- Dirty build: `false`
- Secret scan: PASS
- Isolated canary: PASS with 32 migrations and exact release identity

## Backup and restore

- Encrypted backup: `backup-inventory_fastfood_system-20260801-200229.dump.gpg`
- Size: `1,491,950` bytes
- SHA-256: `a76b7bb7cef9e5ba12daedc6a39c5fa96748a8604683b8acc42e60925e7ef690`
- Checksum verification: PASS
- Restore into unique temporary database: PASS
- Restored migration identity: `32/32`
- Temporary database cleanup: PASS
- Plaintext cleanup: PASS

## Runtime result

API, Web, Nginx, and PostgreSQL are healthy. Readiness reports `MIGRATION_FILE_ONLY_DRIFT_ATTESTED`, 32 applied and 32 expected migrations, and safety compatibility PASS. API and Web restart counts remained zero during observation.

Runtime probes verified authentication, authorized admin reads, governance pause, and all effective SOFIA mutation flags false. Sandbox commercial, Auto Safe, mock inbound/outbound, QR test inbound/send, and mock payment routes returned fail-closed responses. The legacy delivery-order conversion returned `SOFIA_PROD_DELIVERY_ORDER_CREATION_FORBIDDEN`; mock payment selection returned `SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN`.

Operational counts before and after deployment were unchanged: products `26`, order tickets `1,211`, sales `827`, WhatsApp delivery orders `103`, payment webhook events `28`, and outbound messages with `SENT` status `35`. No real outbound, payment mutation, stock mutation, cash mutation, sale mutation, data loss, schema error, crash loop, or critical log event was observed.

Rollback remains available through the retained prior API and Web image digests. No rollback was required.
