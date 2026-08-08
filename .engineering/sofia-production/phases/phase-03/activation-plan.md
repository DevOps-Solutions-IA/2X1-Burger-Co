# Future activation plan

This sequence is design only and was not executed.

1. Owner supplies provider/account values through the approved secret channel.
2. Validate configuration and exact account/phone binding with no secret output.
3. Deploy webhook/transport with automation and outbound disabled.
4. Complete provider verification handshake or QR session binding.
5. Run valid/invalid signature and account mismatch tests.
6. Persist one owner-controlled inbound event without AI side effects.
7. Replay the same event and prove deterministic deduplication.
8. Process a status event and prove it never reaches AI.
9. Prepare one allowlisted test-recipient outbound command; do not send yet.
10. Obtain explicit human approval and execute through `SecureCommandService`.
11. Validate provider accepted, delivered/read or controlled unknown result.
12. Validate service/marketing opt-out immediately blocks subsequent sends.
13. Validate human takeover and release policy.
14. Activate governance pause and prove inbound automation/outbound stop.
15. Activate kill switch and prove precedence.
16. Run a limited owner-approved canary with bounded rate and observation.
17. Obtain owner review of evidence and residual risks.
18. Perform controlled production activation under a separate authorization.

Rollback at every step disables the handler first, preserves inbound evidence, invalidates provider sending capability, and leaves order/payment/stock/cash/sale mutations disabled.
