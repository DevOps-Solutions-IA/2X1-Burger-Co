export type DeliveryProviderWarning =
  | 'WEATHER_UNAVAILABLE'
  | 'GEOCODING_UNAVAILABLE'
  | 'GEOCODING_AMBIGUOUS'
  | 'GEOCODING_NOT_FOUND'
  | 'ROUTING_UNAVAILABLE'
  | 'ORIGIN_COORDINATES_MISSING'
  | 'DESTINATION_MISSING'
  | 'DESTINATION_COORDINATES_LOW_CONFIDENCE'
  | 'EXTERNAL_PROVIDERS_DISABLED'
  | 'CACHE_UNAVAILABLE'
  | 'PROVIDER_API_KEY_MISSING'
  | 'PROVIDER_QUOTA_SOFT_LIMIT'
  | 'PROVIDER_QUOTA_HARD_LIMIT'
  | 'PROVIDER_CIRCUIT_OPEN'
  | 'PROVIDER_USAGE_UNAVAILABLE';

export class DeliveryProviderError extends Error {
  constructor(
    message: string,
    public readonly warning: DeliveryProviderWarning,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = 'DeliveryProviderError';
  }
}

export class DeliveryProviderTimeoutError extends DeliveryProviderError {
  constructor(provider: string, warning: DeliveryProviderWarning, message = 'External provider timeout') {
    super(message, warning, provider);
    this.name = 'DeliveryProviderTimeoutError';
  }
}

export function warningFromError(error: unknown, fallback: DeliveryProviderWarning) {
  if (error instanceof DeliveryProviderError) {
    return error.warning;
  }

  return fallback;
}
