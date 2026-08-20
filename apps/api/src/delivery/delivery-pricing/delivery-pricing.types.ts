import type { DeliveryContextResult, LocalZoneMatchResult, ProviderConfidence, WeatherRainIntensity } from '../providers/provider-types';

export type DeliveryPricingStatus =
  | 'AUTO_PRICED'
  | 'LOCAL_FREE'
  | 'NEEDS_ADDRESS_CORRECTION'
  | 'ERROR_RETRYABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'OUT_OF_COVERAGE'
  // LEGACY — audit-only statuses kept for historical rows, not emitted by the automated engine.
  | 'MANUAL_QUOTE_REQUIRED'
  | 'MANUAL_CONFIRMED'
  | 'INVALID_INPUT';

export type DeliveryPricingConfidence = ProviderConfidence;

export type DeliveryZoneType =
  | 'LOCAL_FREE'
  | 'NEAR'
  | 'MEDIUM'
  | 'FAR'
  | 'DIFFICULT_ACCESS'
  | 'OUT_OF_COVERAGE'
  | 'UNKNOWN'
  // LEGACY — audit-only, not used for automated pricing results.
  | 'MANUAL';

export type DeliveryScheduleMode = 'NORMAL' | 'PEAK' | 'NIGHT' | 'WEEKEND_PEAK';

/**
 * SOFIA Address Remediation — canonical checkout-authorization contract (owner-mandated).
 *
 * These 6 fields must remain formally separate booleans/states and must never be re-conflated
 * into a single ad hoc "canCheckout" formula computed independently per caller. See
 * `./delivery-checkout-authorization.ts` for the single pure derivation function
 * (`deriveCheckoutAuthorization`) that produces this shape, and its file header for the full
 * single-source-of-truth wiring across commercial-checkout.service.ts and orders.service.ts.
 *
 * MANDATORY RULE 1: `zoneMatched` (LOCAL_FREE) never by itself implies `addressComplete`.
 * MANDATORY RULE 2: a valid zone never substitutes for a deliverable address.
 */
export type DeliveryCheckoutAuthorization = {
  /** The submitted address/zone reference is structurally valid — not ambiguous, not missing,
   * not an unparseable/not-found geocoding result. */
  addressValid: boolean;
  /** There is enough concrete, courier-actionable detail to reach the destination: a real
   * geocoded point, or a proven genuine complement beyond a bare zone label. Never implied by
   * `zoneMatched` alone. */
  addressComplete: boolean;
  /** The address matched a known named local free-delivery zone alias (Condados / Alborada).
   * Informational / pricing-relevant only — intentionally excluded from the `canCheckout` gate. */
  zoneMatched: boolean;
  /** The resolved destination falls within configured automated delivery coverage (not
   * OUT_OF_COVERAGE / DIFFICULT_ACCESS). Fail-closed: false unless affirmatively proven. */
  coverageAllowed: boolean;
  /** A concrete, finite delivery fee (including a legitimate 0 for a free zone) has been
   * resolved and is available to charge/display. */
  deliveryFeeResolved: boolean;
  /** Pure AND of addressValid/addressComplete/coverageAllowed/deliveryFeeResolved. The ONLY
   * boolean any checkout entrypoint may branch on. Always produced by
   * `deriveCheckoutAuthorization()` — never computed independently. */
  canCheckout: boolean;
};

export type DeliveryWeatherMode = WeatherRainIntensity;

export type DeliveryPricingRequest = {
  orderSubtotal?: number;
  addressText?: string | null;
  neighborhood?: string | null;
  reference?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  location?: {
    provider?: string | null;
    placeId?: string | null;
    formattedAddress?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  } | null;
  latitude?: number | null;
  longitude?: number | null;
  customerId?: string | null;
  requestedAt?: Date | string | null;
  manualFee?: number | null;
  manualReason?: string | null;
  operatorId?: string | null;
  forceManual?: boolean | null;
  weatherMode?: DeliveryWeatherMode | string | null;
  scheduleMode?: DeliveryScheduleMode | string | null;
  context?: DeliveryContextResult | null;
};

export type DeliveryPricingBreakdownItem = {
  code: string;
  label: string;
  amount: number;
  metadata?: Record<string, unknown>;
};

export type DeliveryProviderUsageSummary = {
  weatherProvider?: string | null;
  geocodingProvider?: string | null;
  routingProvider?: string | null;
  cacheWarnings?: string[];
  warnings?: string[];
};

export type DeliveryPricingResult = {
  status: DeliveryPricingStatus;
  pricingStatus: DeliveryPricingStatus;
  suggestedFee: number | null;
  finalFee: number | null;
  currency: 'COP';
  /** @deprecated Kept for backward compatibility with existing readers (delivery-quote.adapter.ts,
   * sofia-domain-contracts.ts DeliveryQuoteDto, tests). Always identical to
   * `checkoutAuthorization.canCheckout` — never set independently. Prefer reading
   * `checkoutAuthorization` directly in new code so the full ADDRESS_VALID / ADDRESS_COMPLETE /
   * ZONE_MATCHED / COVERAGE_ALLOWED / DELIVERY_FEE_RESOLVED breakdown is visible, not just the
   * final AND. */
  canCheckout: boolean;
  /** Canonical checkout-authorization contract — see delivery-checkout-authorization.ts. Always
   * produced by `deriveCheckoutAuthorization()`. */
  checkoutAuthorization: DeliveryCheckoutAuthorization;
  requiresAddressCorrection: boolean;
  reasonCode: string;
  humanMessage: string;
  requiresManualQuote: boolean;
  confidence: DeliveryPricingConfidence;
  zoneType: DeliveryZoneType;
  zoneLabel: string | null;
  localZoneMatch: LocalZoneMatchResult | null;
  zoneMatch: LocalZoneMatchResult | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  estimatedMinutes: number | null;
  weather: {
    rainIntensity: DeliveryWeatherMode;
    surcharge: number;
    provider: string | null;
    unavailable: boolean;
  };
  schedule: {
    mode: DeliveryScheduleMode;
    surcharge: number;
  };
  logistics: {
    zoneType: DeliveryZoneType;
    surcharge: number;
  };
  subtotalBenefit: number;
  manualEdited: boolean;
  manualEditReason: string | null;
  breakdown: DeliveryPricingBreakdownItem[];
  warnings: string[];
  providerUsage: DeliveryProviderUsageSummary;
  providersUsed: DeliveryProviderUsageSummary;
  weatherImpact: {
    rainIntensity: DeliveryWeatherMode;
    surcharge: number;
    provider: string | null;
    unavailable: boolean;
  };
  calculationVersion: '2x1-delivery-pricing-v1';
  auditId?: string | null;
};
