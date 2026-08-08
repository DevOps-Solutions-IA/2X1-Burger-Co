# Security review

- Customer text is untrusted and cannot set price, payment status, stock or authorization.
- Adversarial phrases requesting zero price, fake payment, credentials, sandbox bypass or skipped confirmation require handoff.
- Audit payloads contain bounded identifiers and commercial state, not secrets or raw provider payloads.
- Draft and confirmation hashes prevent stale semantic confirmation.
- Dependency failures and unknown availability fail closed.
- Production-selectable mock and sandbox fallbacks remain zero by Phase 0-3 architecture gates.
