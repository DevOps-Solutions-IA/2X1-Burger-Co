# Governed conversational response correction

PR #9 review found that Phase 4 had governed input semantics but deterministic customer wording only. Commit `8097313e644b1a8e63ea38c62af7ff90dfd7d528` corrects that boundary without changing commercial decisions or persistence.

The response path is now `CommercialCheckoutService -> immutable CommercialFactEnvelope -> CommercialResponseComposer -> bounded existing Sofia AI provider -> CommercialResponseValidator`. Generation receives resolved facts only, has no tool or state mutation surface, and is available only in existing `dry_run`, `suggest` or `supervised` modes. Disabled, automatic, unavailable, invalid or unsafe generation uses `SafeCommercialResponseTemplates`.

The validator checks exact COP amounts, products, quantities, payment and fulfillment options, and rejects unsupported operational, payment, order, kitchen, ETA, discount, sandbox, secret and internal-metadata claims. The envelope excludes customer IDs, draft IDs/hashes, provider payloads, secrets and hidden reasoning.

Safety state remains unchanged: order creation, payment/Bold mutation, inventory, cash, sales, kitchen, real WhatsApp and auto reply are disabled. No schema change was made; Phase 4 still contains exactly migration 35.
