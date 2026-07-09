/**
 * LEGACY - NOT ACTIVE - DO NOT USE FOR FINAL DELIVERY PRICING.
 *
 * AUDIT-8G.0 disabled the old frontend alias/band estimator because it could
 * silently assign delivery fees. AUDIT-8G.1 must replace this with the
 * enterprise delivery pricing engine contract.
 */
export function resolveDeliveryEstimate(_reference: string | null | undefined) {
  return null;
}
