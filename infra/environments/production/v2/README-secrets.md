# Production V2 Secrets

This directory contains templates and local-only generated material for AUDIT-7B.

Files:

- `.env.production.v2.example`: safe example with placeholders.
- `.env.production.v2.template`: redacted generated template.
- `.env.production.v2`: generated real local secret file, chmod `600`, intentionally ignored.
- `backup-public-key.asc`: public GPG key only. Safe to copy to the server.

Private GPG key:

- Location: `/home/wundah/.gnupg-2x1burger-backup-audit7b`
- Permissions must stay `700`.
- Do not copy the private key to the production server.
- Do not print or commit the private key.

Validation requirements:

- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be different.
- `ADMIN_PASSWORD` must be temporary, strong, and replaced after first login.
- No value may use `DevAdmin12345*`, `Admin12345*`, `postgres/postgres`, or `change-this-*`.
- `NODE_ENV=production`, `ENABLE_HTTPS=true`, and `COOKIE_SECURE=true` are mandatory.
