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
  canCheckout: boolean;
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
