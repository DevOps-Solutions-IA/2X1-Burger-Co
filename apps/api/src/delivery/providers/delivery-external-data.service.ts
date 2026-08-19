import { Injectable, Optional } from '@nestjs/common';
import type { ExternalCache, ExternalCacheLookup } from './external-cache.interface';
import { InMemoryExternalCache } from './in-memory-external-cache';
import { matchLocalZone } from './local-zone-match';
import { warningFromError } from './provider-errors';
import type { GeocodingProvider } from './geocoding-provider.interface';
import type { RoutingProvider } from './routing-provider.interface';
import type {
  DeliveryContextRequest,
  DeliveryContextResult,
  DeliveryDestinationContext,
  DeliveryOriginContext,
  GeocodeResult,
  ProviderConfidence,
  RouteResult,
  WeatherResult,
} from './provider-types';
import type { WeatherProvider } from './weather-provider.interface';
import { NominatimGeocodingProvider } from './nominatim-geocoding.provider';
import { OpenMeteoWeatherProvider } from './open-meteo-weather.provider';
import { GoogleGeocodingProvider } from './google-geocoding.provider';
import { GoogleRoutesProvider } from './google-routes.provider';
import { OpenRouteServiceGeocodingProvider } from './openrouteservice-geocoding.provider';
import { OpenRouteServiceRoutingProvider } from './openrouteservice-routing.provider';
import { OsrmRoutingProvider } from './osrm-routing.provider';
import { PrismaExternalCache } from './prisma-external-cache';
import { DeliveryProviderUsageService } from './delivery-provider-usage.service';

const WEATHER_TTL_SECONDS = 15 * 60;
const GEOCODE_TTL_SECONDS = 90 * 24 * 60 * 60;
const ROUTE_TTL_SECONDS = 14 * 24 * 60 * 60;

type DeliveryExternalDataProviders = {
  weatherProvider?: WeatherProvider;
  geocodingProvider?: GeocodingProvider;
  routingProvider?: RoutingProvider;
};

type DeliveryExternalDataOptions = DeliveryExternalDataProviders & {
  cache?: ExternalCache;
  providersEnabled?: boolean;
  origin?: {
    latitude?: number | null;
    longitude?: number | null;
    label?: string | null;
    address?: string | null;
  };
};

@Injectable()
export class DeliveryExternalDataService {
  private cache: ExternalCache = new InMemoryExternalCache();
  private providersEnabled = false;
  private weatherProvider?: WeatherProvider;
  private geocodingProvider?: GeocodingProvider;
  private routingProvider?: RoutingProvider;
  private originOverride?: DeliveryExternalDataOptions['origin'];

  constructor(
    @Optional() private readonly prismaExternalCache?: PrismaExternalCache,
    @Optional() private readonly providerUsage?: DeliveryProviderUsageService,
  ) {
    this.configureFromEnvironment();
    if (process.env.DELIVERY_CACHE_ENABLED !== 'false' && this.prismaExternalCache) {
      this.cache = this.prismaExternalCache;
    }
  }

  static createForTesting(options: DeliveryExternalDataOptions) {
    const service = new DeliveryExternalDataService();
    service.cache = options.cache ?? new InMemoryExternalCache();
    service.providersEnabled = options.providersEnabled ?? true;
    service.weatherProvider = options.weatherProvider;
    service.geocodingProvider = options.geocodingProvider;
    service.routingProvider = options.routingProvider;
    service.originOverride = options.origin;
    return service;
  }

  async resolveDeliveryContext(request: DeliveryContextRequest): Promise<DeliveryContextResult> {
    const warnings = new Set<string>();
    const origin = this.resolveOrigin();
    const localZoneMatch = matchLocalZone(request);

    if (!origin.configured) {
      warnings.add('ORIGIN_COORDINATES_MISSING');
    }

    if (localZoneMatch.ambiguous) {
      warnings.add('LOCAL_ZONE_AMBIGUOUS');
    }

    const destination = this.initialDestination(request);
    let geocodingAttempted = false;
    let geocodingResult: GeocodeResult | null = this.locationGeocodingResult(request, destination);

    if (localZoneMatch.ambiguous) {
      return this.buildContextResult({
        origin,
        destination,
        geocodingAttempted,
        geocodingResult,
        routeAttempted: false,
        routeResult: null,
        haversineReferenceKm: null,
        weatherAttempted: false,
        weatherResult: null,
        localZoneMatch,
        warnings,
      });
    }

    // TRUSTED_POST_GEOCODING_ZONE_HANDLING: the bare-zone-label text shortcut only applies as a
    // fallback for when a real point ISN'T already available. If the destination already has
    // valid coordinates at this point (e.g. a client-supplied/already-geocoded location), do not
    // silently skip routing in favor of the text shortcut — fall through to the normal
    // geocoding/routing/pricing pipeline below so the already-available real point drives the
    // result on its own merits. localZoneMatch stays attached to the returned context either way.
    if (localZoneMatch.matched && !hasDestinationCoordinates(destination)) {
      return this.buildContextResult({
        origin,
        destination,
        geocodingAttempted,
        geocodingResult,
        routeAttempted: false,
        routeResult: null,
        haversineReferenceKm: null,
        weatherAttempted: false,
        weatherResult: null,
        localZoneMatch,
        warnings,
      });
    }

    if (!hasDestinationCoordinates(destination) && request.addressText?.trim()) {
      geocodingAttempted = true;
      geocodingResult = await this.resolveGeocoding(request, warnings);
      if (geocodingResult?.matchQuality === 'EXACT' || geocodingResult?.matchQuality === 'STRONG') {
        destination.latitude = geocodingResult.latitude;
        destination.longitude = geocodingResult.longitude;
        destination.neighborhood = geocodingResult.neighborhood ?? destination.neighborhood;
        destination.confidence = geocodingResult.confidence;
      } else if (geocodingResult?.matchQuality === 'AMBIGUOUS') {
        warnings.add('GEOCODING_AMBIGUOUS');
      } else if (geocodingResult?.matchQuality === 'NOT_FOUND') {
        warnings.add('GEOCODING_NOT_FOUND');
      }
    }

    if (!hasDestinationCoordinates(destination) && !request.addressText?.trim()) {
      warnings.add('DESTINATION_MISSING');
    }

    let routeAttempted = false;
    let routeResult: RouteResult | null = null;
    let haversineReferenceKm: number | null = null;

    if (origin.configured && hasDestinationCoordinates(destination)) {
      routeAttempted = true;
      routeResult = await this.resolveRoute(origin, destination, warnings);
      haversineReferenceKm = haversineDistanceKm(
        origin.latitude!,
        origin.longitude!,
        destination.latitude!,
        destination.longitude!,
      );
    }

    let weatherAttempted = false;
    let weatherResult: WeatherResult | null = null;
    if (hasDestinationCoordinates(destination)) {
      weatherAttempted = true;
      weatherResult = await this.resolveWeather(destination, request, warnings);
    }

    const routeUnavailable = routeAttempted && (!routeResult || routeResult.distanceKm == null || routeResult.durationMinutes == null);
    if (routeUnavailable) {
      warnings.add('ROUTING_UNAVAILABLE');
    }

    const requiresManualQuote = this.requiresManualQuote({
      origin,
      destination,
      geocodingResult,
      routeAttempted,
      routeResult,
      warnings,
    });
    return this.buildContextResult({
      origin,
      destination,
      geocodingAttempted,
      geocodingResult,
      routeAttempted,
      routeResult,
      haversineReferenceKm,
      weatherAttempted,
      weatherResult,
      localZoneMatch,
      warnings,
      requiresManualQuote,
    });
  }

  private configureFromEnvironment() {
    this.providersEnabled = process.env.DELIVERY_EXTERNAL_PROVIDERS_ENABLED === 'true';
    if (!this.providersEnabled) {
      return;
    }

    const timeoutMs = Number(process.env.DELIVERY_GOOGLE_TIMEOUT_MS ?? process.env.DELIVERY_EXTERNAL_TIMEOUT_MS ?? 3000);
    const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3000;

    if ((process.env.DELIVERY_WEATHER_PROVIDER ?? 'openmeteo') === 'openmeteo') {
      this.weatherProvider = new OpenMeteoWeatherProvider(safeTimeoutMs);
    }
    const geocodingProvider = process.env.DELIVERY_GEOCODING_PROVIDER ?? 'openrouteservice';
    const geocodingFallback = process.env.DELIVERY_GEOCODING_FALLBACK_PROVIDER ?? 'nominatim';
    if (geocodingProvider === 'google' && process.env.DELIVERY_GOOGLE_GEOCODING_ENABLED === 'true') {
      this.geocodingProvider = new GoogleGeocodingProvider(safeTimeoutMs, process.env.GOOGLE_MAPS_API_KEY);
    } else if (geocodingProvider === 'openrouteservice' && process.env.OPENROUTESERVICE_API_KEY) {
      this.geocodingProvider = new OpenRouteServiceGeocodingProvider(
        safeTimeoutMs,
        process.env.OPENROUTESERVICE_API_KEY,
        undefined,
        {
          latitude: parseOptionalNumber(process.env.DELIVERY_ORIGIN_LAT),
          longitude: parseOptionalNumber(process.env.DELIVERY_ORIGIN_LNG),
        },
      );
    } else if (geocodingProvider === 'nominatim' || geocodingFallback === 'nominatim') {
      this.geocodingProvider = new NominatimGeocodingProvider(
        safeTimeoutMs,
        process.env.DELIVERY_GEOCODING_USER_AGENT ?? '2x1burger-delivery-context/1.0',
      );
    }

    const routingProvider = process.env.DELIVERY_ROUTING_PROVIDER ?? 'openrouteservice';
    const routingFallback = process.env.DELIVERY_ROUTING_FALLBACK_PROVIDER ?? 'osrm';
    if (routingProvider === 'google' && process.env.DELIVERY_GOOGLE_ROUTES_ENABLED === 'true') {
      this.routingProvider = new GoogleRoutesProvider(safeTimeoutMs, process.env.GOOGLE_MAPS_API_KEY);
    } else if (routingProvider === 'openrouteservice' && process.env.OPENROUTESERVICE_API_KEY) {
      this.routingProvider = new OpenRouteServiceRoutingProvider(
        safeTimeoutMs,
        process.env.OPENROUTESERVICE_API_KEY,
      );
    } else if (routingProvider === 'osrm' || routingFallback === 'osrm') {
      this.routingProvider = new OsrmRoutingProvider(safeTimeoutMs);
    }
  }

  private resolveOrigin(): DeliveryOriginContext {
    const configuredOrigin = this.originOverride ?? {
      latitude: parseOptionalNumber(process.env.DELIVERY_ORIGIN_LAT),
      longitude: parseOptionalNumber(process.env.DELIVERY_ORIGIN_LNG),
      label: process.env.DELIVERY_ORIGIN_LABEL,
      address: process.env.DELIVERY_ORIGIN_ADDRESS,
    };
    const latitude = configuredOrigin.latitude ?? null;
    const longitude = configuredOrigin.longitude ?? null;

    return {
      latitude,
      longitude,
      label: configuredOrigin.label?.trim() || '2X1 Burger Co',
      address: configuredOrigin.address?.trim() || null,
      configured: isValidCoordinate(latitude, longitude),
    };
  }

  private initialDestination(request: DeliveryContextRequest): DeliveryDestinationContext {
    const hasCoordinates = isValidCoordinate(request.latitude, request.longitude);
    return {
      latitude: hasCoordinates ? request.latitude! : null,
      longitude: hasCoordinates ? request.longitude! : null,
      addressText: request.addressText?.trim() || null,
      neighborhood: request.neighborhood?.trim() || null,
      confidence: hasCoordinates ? request.locationConfidence ?? 'MEDIUM' : 'LOW',
    };
  }

  private locationGeocodingResult(
    request: DeliveryContextRequest,
    destination: DeliveryDestinationContext,
  ): GeocodeResult | null {
    if (!hasDestinationCoordinates(destination) || !request.locationProvider) {
      return null;
    }

    return {
      provider: request.locationProvider,
      latitude: destination.latitude,
      longitude: destination.longitude,
      formattedAddress: request.locationFormattedAddress ?? request.addressText ?? null,
      neighborhood: destination.neighborhood,
      matchQuality: request.locationConfidence === 'LOW' ? 'PARTIAL' : 'EXACT',
      confidence: request.locationConfidence ?? 'HIGH',
      warnings: [],
      rawSummary: request.locationPlaceId ? { placeId: 'set' } : { source: 'location' },
    };
  }

  private buildContextResult(input: {
    origin: DeliveryOriginContext;
    destination: DeliveryDestinationContext;
    geocodingAttempted: boolean;
    geocodingResult: GeocodeResult | null;
    routeAttempted: boolean;
    routeResult: RouteResult | null;
    haversineReferenceKm: number | null;
    weatherAttempted: boolean;
    weatherResult: WeatherResult | null;
    localZoneMatch: ReturnType<typeof matchLocalZone>;
    warnings: Set<string>;
    requiresManualQuote?: boolean;
  }): DeliveryContextResult {
    const requiresManualQuote = input.requiresManualQuote ?? this.requiresManualQuote({
      origin: input.origin,
      destination: input.destination,
      geocodingResult: input.geocodingResult,
      routeAttempted: input.routeAttempted,
      routeResult: input.routeResult,
      warnings: input.warnings,
    });
    const confidence = this.resolveOverallConfidence(input.origin, input.destination, input.geocodingResult, input.routeResult, input.warnings);

    return {
      origin: input.origin,
      destination: input.destination,
      geocoding: {
        attempted: input.geocodingAttempted,
        result: input.geocodingResult,
      },
      route: {
        attempted: input.routeAttempted,
        distanceKm: input.routeResult?.distanceKm ?? null,
        durationMinutes: input.routeResult?.durationMinutes ?? null,
        result: input.routeResult,
        haversineReferenceKm: input.haversineReferenceKm,
      },
      weather: {
        attempted: input.weatherAttempted,
        isRaining: input.weatherResult?.isRaining ?? null,
        rainIntensity: input.weatherResult?.rainIntensity ?? 'UNKNOWN',
        result: input.weatherResult,
      },
      localZoneMatch: input.localZoneMatch,
      confidence,
      requiresManualQuote,
      warnings: [...input.warnings],
    };
  }

  private async resolveGeocoding(request: DeliveryContextRequest, warnings: Set<string>) {
    if (!this.providersEnabled || !this.geocodingProvider) {
      warnings.add('EXTERNAL_PROVIDERS_DISABLED');
      return null;
    }

    const origin = this.resolveOrigin();
    const city = request.city?.trim() || process.env.DELIVERY_DEFAULT_CITY?.trim() || 'Jamundí';
    const state = request.state?.trim() || process.env.DELIVERY_DEFAULT_STATE?.trim() || 'Valle del Cauca';
    const country = request.country?.trim() || process.env.DELIVERY_DEFAULT_COUNTRY?.trim() || 'Colombia';
    const cacheEntry: ExternalCacheLookup = {
      provider: this.geocodingProvider.providerName,
      cacheType: 'GEOCODE_ADDRESS',
      cacheKey: [
        'address-v3',
        normalizeCachePart(request.addressText),
        normalizeCachePart(request.neighborhood),
        normalizeCachePart(request.reference),
        normalizeCachePart(city),
        normalizeCachePart(state),
        normalizeCachePart(country),
        'boundary-country:COL',
        origin.configured ? roundCoordinate(origin.latitude!) : 'origin-missing',
        origin.configured ? roundCoordinate(origin.longitude!) : 'origin-missing',
      ].join(':'),
    };
    const cached = await this.readCache<GeocodeResult>(cacheEntry, warnings);
    if (cached) {
      return cached;
    }

    try {
      const quota = await this.beforeProviderCall(this.geocodingProvider.providerName, 'geocoding');
      quota.warnings.forEach((warning) => warnings.add(warning));
      if (!quota.allowed) {
        return null;
      }
      const result = await this.geocodingProvider.geocodeAddress({
        addressText: request.addressText ?? '',
        city,
        state,
        country,
        neighborhood: request.neighborhood,
        reference: request.reference,
      });
      await this.providerUsage?.recordSuccess(this.geocodingProvider.providerName, 'geocoding').catch(() => undefined);
      await this.writeCache(cacheEntry, result, GEOCODE_TTL_SECONDS, warnings);
      return result;
    } catch (error) {
      warnings.add(warningFromError(error, 'GEOCODING_UNAVAILABLE'));
      await this.providerUsage?.recordError(this.geocodingProvider.providerName, 'geocoding', warningFromError(error, 'GEOCODING_UNAVAILABLE')).catch(() => undefined);
      return null;
    }
  }

  private async resolveRoute(
    origin: DeliveryOriginContext,
    destination: DeliveryDestinationContext,
    warnings: Set<string>,
  ) {
    if (!this.providersEnabled || !this.routingProvider) {
      warnings.add('EXTERNAL_PROVIDERS_DISABLED');
      return null;
    }

    const cacheEntry: ExternalCacheLookup = {
      provider: this.routingProvider.providerName,
      cacheType: 'ROUTE_DISTANCE',
      cacheKey: [
        'route',
        roundCoordinate(origin.latitude!),
        roundCoordinate(origin.longitude!),
        roundCoordinate(destination.latitude!),
        roundCoordinate(destination.longitude!),
        'MOTORCYCLE',
      ].join(':'),
    };
    const cached = await this.readCache<RouteResult>(cacheEntry, warnings);
    if (cached) {
      return cached;
    }

    try {
      const quota = await this.beforeProviderCall(this.routingProvider.providerName, 'routing');
      quota.warnings.forEach((warning) => warnings.add(warning));
      if (!quota.allowed) {
        return null;
      }
      const result = await this.routingProvider.getRoute({
        originLatitude: origin.latitude!,
        originLongitude: origin.longitude!,
        destinationLatitude: destination.latitude!,
        destinationLongitude: destination.longitude!,
        profile: 'MOTORCYCLE',
      });
      await this.providerUsage?.recordSuccess(this.routingProvider.providerName, 'routing').catch(() => undefined);
      await this.writeCache(cacheEntry, result, ROUTE_TTL_SECONDS, warnings);
      return result;
    } catch (error) {
      warnings.add(warningFromError(error, 'ROUTING_UNAVAILABLE'));
      await this.providerUsage?.recordError(this.routingProvider.providerName, 'routing', warningFromError(error, 'ROUTING_UNAVAILABLE')).catch(() => undefined);
      return null;
    }
  }

  private async resolveWeather(
    destination: DeliveryDestinationContext,
    request: DeliveryContextRequest,
    warnings: Set<string>,
  ) {
    if (!this.providersEnabled || !this.weatherProvider) {
      warnings.add('EXTERNAL_PROVIDERS_DISABLED');
      return null;
    }

    const cacheEntry: ExternalCacheLookup = {
      provider: this.weatherProvider.providerName,
      cacheType: 'WEATHER_CURRENT',
      cacheKey: `current:${roundCoordinate(destination.latitude!)}:${roundCoordinate(destination.longitude!)}`,
    };
    const cached = await this.readCache<WeatherResult>(cacheEntry, warnings);
    if (cached) {
      return cached;
    }

    try {
      const quota = await this.beforeProviderCall(this.weatherProvider.providerName, 'weather');
      quota.warnings.forEach((warning) => warnings.add(warning));
      if (!quota.allowed) {
        return null;
      }
      const result = await this.weatherProvider.getCurrentWeather({
        latitude: destination.latitude!,
        longitude: destination.longitude!,
        requestedAt: request.requestedAt,
        timezone: 'America/Bogota',
      });
      await this.providerUsage?.recordSuccess(this.weatherProvider.providerName, 'weather').catch(() => undefined);
      await this.writeCache(cacheEntry, result, WEATHER_TTL_SECONDS, warnings);
      return result;
    } catch (error) {
      warnings.add(warningFromError(error, 'WEATHER_UNAVAILABLE'));
      await this.providerUsage?.recordError(this.weatherProvider.providerName, 'weather', warningFromError(error, 'WEATHER_UNAVAILABLE')).catch(() => undefined);
      return null;
    }
  }

  private async beforeProviderCall(provider: string, endpoint: 'weather' | 'geocoding' | 'routing') {
    const limit = providerDailyLimit(provider, endpoint);
    if (!this.providerUsage) {
      return { allowed: true, warnings: [] as string[] };
    }

    try {
      return await this.providerUsage.beforeCall(provider, endpoint, limit);
    } catch {
      return { allowed: true, warnings: ['PROVIDER_USAGE_UNAVAILABLE'] };
    }
  }

  private requiresManualQuote(input: {
    origin: DeliveryOriginContext;
    destination: DeliveryDestinationContext;
    geocodingResult: GeocodeResult | null;
    routeAttempted: boolean;
    routeResult: RouteResult | null;
    warnings: Set<string>;
  }) {
    if (!input.origin.configured) return true;
    if (!hasDestinationCoordinates(input.destination)) return true;
    if (input.geocodingResult?.matchQuality === 'AMBIGUOUS' || input.geocodingResult?.matchQuality === 'NOT_FOUND') return true;
    if (input.routeAttempted && (!input.routeResult || input.routeResult.distanceKm == null)) return true;
    if (input.warnings.has('DESTINATION_MISSING')) return true;
    return false;
  }

  private resolveOverallConfidence(
    origin: DeliveryOriginContext,
    destination: DeliveryDestinationContext,
    geocodingResult: GeocodeResult | null,
    routeResult: RouteResult | null,
    warnings: Set<string>,
  ): ProviderConfidence {
    if (!origin.configured || !hasDestinationCoordinates(destination)) return 'LOW';
    if (warnings.has('GEOCODING_AMBIGUOUS') || warnings.has('GEOCODING_NOT_FOUND')) return 'LOW';
    if (routeResult?.routeConfidence === 'HIGH' && (geocodingResult?.confidence === 'HIGH' || destination.confidence === 'MEDIUM')) {
      return 'HIGH';
    }
    if (routeResult?.routeConfidence === 'MEDIUM' || geocodingResult?.confidence === 'MEDIUM') return 'MEDIUM';
    return 'LOW';
  }

  private async readCache<T>(entry: ExternalCacheLookup, warnings: Set<string>) {
    try {
      return await this.cache.get<T>(entry);
    } catch {
      warnings.add('CACHE_UNAVAILABLE');
      return null;
    }
  }

  private async writeCache<T>(entry: ExternalCacheLookup, value: T, ttlSeconds: number, warnings: Set<string>) {
    try {
      await this.cache.set(entry, value, ttlSeconds);
    } catch {
      warnings.add('CACHE_UNAVAILABLE');
    }
  }
}

function parseOptionalNumber(value: string | number | null | undefined) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isValidCoordinate(latitude: number | null | undefined, longitude: number | null | undefined) {
  return (
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function hasDestinationCoordinates(destination: DeliveryDestinationContext) {
  return isValidCoordinate(destination.latitude, destination.longitude);
}

function normalizeCachePart(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function roundCoordinate(value: number) {
  return value.toFixed(5);
}

function haversineDistanceKm(originLat: number, originLng: number, destinationLat: number, destinationLng: number) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(destinationLat - originLat);
  const dLng = toRadians(destinationLng - originLng);
  const lat1 = toRadians(originLat);
  const lat2 = toRadians(destinationLat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusKm * c).toFixed(2));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function providerDailyLimit(provider: string, endpoint: 'weather' | 'geocoding' | 'routing') {
  if (provider === 'google') {
    return optionalPositiveNumber(process.env.DELIVERY_GOOGLE_DAILY_LIMIT);
  }
  if (provider === 'openmeteo') {
    return optionalPositiveNumber(process.env.DELIVERY_OPENMETEO_DAILY_LIMIT);
  }
  if (provider === 'openrouteservice' && endpoint === 'geocoding') {
    return optionalPositiveNumber(process.env.DELIVERY_OPENROUTESERVICE_GEOCODING_DAILY_LIMIT);
  }
  if (provider === 'openrouteservice' && endpoint === 'routing') {
    return optionalPositiveNumber(process.env.DELIVERY_OPENROUTESERVICE_DIRECTIONS_DAILY_LIMIT);
  }
  return null;
}

function optionalPositiveNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
