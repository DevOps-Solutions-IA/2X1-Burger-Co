export type ProviderConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type WeatherRainIntensity = 'NONE' | 'LIGHT' | 'MODERATE' | 'HEAVY' | 'UNKNOWN';

export type WeatherRequest = {
  latitude: number;
  longitude: number;
  requestedAt?: Date;
  timezone?: string;
};

export type WeatherResult = {
  provider: string;
  isRaining: boolean | null;
  precipitationMm: number | null;
  rainIntensity: WeatherRainIntensity;
  weatherCode?: number | string | null;
  temperatureC?: number | null;
  confidence: ProviderConfidence;
  fetchedAt: Date;
  warnings: string[];
  rawSummary?: unknown;
};

export type GeocodeRequest = {
  addressText: string;
  city?: string;
  state?: string;
  country?: string;
  neighborhood?: string;
  reference?: string;
};

export type GeocodeMatchQuality = 'EXACT' | 'STRONG' | 'PARTIAL' | 'AMBIGUOUS' | 'NOT_FOUND';

export type GeocodeResult = {
  provider: string;
  latitude: number | null;
  longitude: number | null;
  formattedAddress?: string | null;
  neighborhood?: string | null;
  matchQuality: GeocodeMatchQuality;
  confidence: ProviderConfidence;
  warnings: string[];
  rawSummary?: unknown;
};

export type ReverseGeocodeRequest = {
  latitude: number;
  longitude: number;
};

export type ReverseGeocodeResult = {
  provider: string;
  formattedAddress: string | null;
  neighborhood?: string | null;
  confidence: ProviderConfidence;
  warnings: string[];
  rawSummary?: unknown;
};

export type RouteProfile = 'DRIVING' | 'MOTORCYCLE' | 'BICYCLE' | 'WALKING';

export type RouteRequest = {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  profile: RouteProfile;
};

export type RouteResult = {
  provider: string;
  distanceKm: number | null;
  durationMinutes: number | null;
  routeConfidence: ProviderConfidence;
  warnings: string[];
  geometrySummary?: unknown;
};

export type ExternalCacheType = 'WEATHER_CURRENT' | 'GEOCODE_ADDRESS' | 'ROUTE_DISTANCE' | 'PLACE_SEARCH' | 'PLACE_DETAILS';

export type DeliveryLocationConfidence = ProviderConfidence;

export type DeliveryLocationSuggestion = {
  provider: string;
  placeId: string;
  label: string;
  mainText: string;
  secondaryText: string;
  confidence: DeliveryLocationConfidence;
};

export type DeliveryLocationResolveResult = {
  provider: string;
  placeId?: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  confidence: DeliveryLocationConfidence;
};

export type ExternalCacheEntry<T = unknown> = {
  provider: string;
  cacheType: ExternalCacheType;
  cacheKey: string;
  value: T;
  expiresAt: Date;
};

export type DeliveryContextRequest = {
  customerId?: string;
  addressText?: string;
  neighborhood?: string;
  reference?: string;
  latitude?: number;
  longitude?: number;
  orderSubtotal?: number;
  requestedAt?: Date;
  city?: string;
  state?: string;
  country?: string;
  locationProvider?: string;
  locationPlaceId?: string;
  locationFormattedAddress?: string;
  locationConfidence?: ProviderConfidence;
};

export type DeliveryOriginContext = {
  latitude: number | null;
  longitude: number | null;
  label: string;
  address: string | null;
  configured: boolean;
};

export type DeliveryDestinationContext = {
  latitude: number | null;
  longitude: number | null;
  addressText: string | null;
  neighborhood: string | null;
  confidence: ProviderConfidence;
};

export type LocalZoneMatchResult = {
  matched: boolean;
  zoneLabel: string | null;
  confidence: ProviderConfidence;
  ambiguous: boolean;
  reason: string;
};

export type DeliveryContextResult = {
  origin: DeliveryOriginContext;
  destination: DeliveryDestinationContext;
  geocoding: {
    attempted: boolean;
    result: GeocodeResult | null;
  };
  route: {
    attempted: boolean;
    distanceKm: number | null;
    durationMinutes: number | null;
    result: RouteResult | null;
    haversineReferenceKm: number | null;
  };
  weather: {
    attempted: boolean;
    isRaining: boolean | null;
    rainIntensity: WeatherRainIntensity;
    result: WeatherResult | null;
  };
  localZoneMatch: LocalZoneMatchResult;
  confidence: ProviderConfidence;
  requiresManualQuote: boolean;
  warnings: string[];
};
