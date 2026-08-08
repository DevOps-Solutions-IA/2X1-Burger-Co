# Catalog and inventory audit

- Product identity and unit price come from `CatalogReadService` persisted active products.
- Prepared-product availability delegates to `RecipeAvailabilityService`.
- Direct-stock availability delegates to `ProductAvailabilityService`.
- Ingredient removals are accepted only when the authoritative recipe exposes the ingredient.
- Additions remain blocked because the current domain does not expose a priced, compatible modifier authority.
- Phase 4 reads availability only. It performs no reservation or decrement.
