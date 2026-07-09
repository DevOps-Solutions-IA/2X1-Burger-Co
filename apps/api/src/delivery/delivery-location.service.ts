import { Injectable, Optional } from '@nestjs/common';
import type { ExternalCacheLookup } from './providers/external-cache.interface';
import { PrismaExternalCache } from './providers/prisma-external-cache';
import { DeliveryProviderUsageService } from './providers/delivery-provider-usage.service';
import { DeliveryProviderError, warningFromError } from './providers/provider-errors';
import { fetchJsonWithTimeout } from './providers/provider-http';
import { GoogleGeocodingProvider } from './providers/google-geocoding.provider';
import type { DeliveryLocationResolveResult, DeliveryLocationSuggestion } from './providers/provider-types';
import { matchLocalZone } from './providers/local-zone-match';

const PLACE_SEARCH_TTL_SECONDS = 7 * 24 * 60 * 60;
const PLACE_DETAILS_TTL_SECONDS = 30 * 24 * 60 * 60;

type GooglePlaceSearchResponse = {
  places?: GooglePlace[];
};

type GooglePlace = {
  id?: string;
  name?: string;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
};

@Injectable()
export class DeliveryLocationService {
  constructor(
    @Optional() private readonly cache?: PrismaExternalCache,
    @Optional() private readonly providerUsage?: DeliveryProviderUsageService,
  ) {}

  async search(input: {
    query: string;
    city?: string;
    state?: string;
    country?: string;
  }): Promise<{ suggestions: DeliveryLocationSuggestion[]; warnings: string[] }> {
    const warnings = new Set<string>();
    const query = input.query.trim();
    if (query.length < 3) {
      return { suggestions: [], warnings: [] };
    }

    const local = matchLocalZone({ addressText: query, neighborhood: query, reference: query });
    if (local.matched || local.ambiguous) {
      return { suggestions: [], warnings: local.ambiguous ? ['LOCAL_ZONE_AMBIGUOUS'] : [] };
    }

    if (!this.googlePlacesEnabled()) {
      return { suggestions: [], warnings: ['EXTERNAL_PROVIDERS_DISABLED'] };
    }

    const cacheEntry: ExternalCacheLookup = {
      provider: 'google',
      cacheType: 'PLACE_SEARCH',
      cacheKey: [
        'places-v1',
        normalizeCachePart(query),
        normalizeCachePart(input.city || 'Jamundí'),
        normalizeCachePart(input.state || 'Valle del Cauca'),
        normalizeCachePart(input.country || 'Colombia'),
      ].join(':'),
    };
    const cached = await this.readCache<DeliveryLocationSuggestion[]>(cacheEntry, warnings);
    if (cached) {
      return { suggestions: cached, warnings: [...warnings] };
    }

    try {
      const quota = await this.beforeGoogleCall('places');
      quota.warnings.forEach((warning) => warnings.add(warning));
      if (!quota.allowed) {
        return { suggestions: [], warnings: [...warnings] };
      }

      const response = await fetchJsonWithTimeout<GooglePlaceSearchResponse>(
        'google',
        'https://places.googleapis.com/v1/places:searchText',
        this.timeoutMs(),
        'GEOCODING_UNAVAILABLE',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKeyOrThrow(),
            'X-Goog-FieldMask': 'places.id,places.name,places.formattedAddress,places.shortFormattedAddress,places.displayName',
          },
          body: JSON.stringify({
            textQuery: fullQuery(query, input),
            languageCode: 'es-CO',
            regionCode: 'CO',
            pageSize: 5,
            locationBias: {
              circle: {
                center: {
                  latitude: Number(process.env.DELIVERY_ORIGIN_LAT ?? 3.2606),
                  longitude: Number(process.env.DELIVERY_ORIGIN_LNG ?? -76.5397),
                },
                radius: 12000,
              },
            },
          }),
        },
      );

      const suggestions = (response.places ?? [])
        .map(toSuggestion)
        .filter((suggestion): suggestion is DeliveryLocationSuggestion => Boolean(suggestion))
        .slice(0, 5);
      await this.providerUsage?.recordSuccess('google', 'places').catch(() => undefined);
      await this.writeCache(cacheEntry, suggestions, PLACE_SEARCH_TTL_SECONDS, warnings);
      return { suggestions, warnings: [...warnings] };
    } catch (error) {
      warnings.add(warningFromError(error, 'GEOCODING_UNAVAILABLE'));
      await this.providerUsage?.recordError('google', 'places', warningFromError(error, 'GEOCODING_UNAVAILABLE')).catch(() => undefined);
      return { suggestions: [], warnings: [...warnings] };
    }
  }

  async resolve(input: {
    provider?: string;
    placeId?: string;
    fallbackText?: string;
  }): Promise<DeliveryLocationResolveResult & { warnings: string[]; humanMessage?: string }> {
    const warnings = new Set<string>();
    if (!this.googleResolveEnabled()) {
      return blockedResolve(['EXTERNAL_PROVIDERS_DISABLED']);
    }

    if (input.placeId) {
      const cacheEntry: ExternalCacheLookup = {
        provider: 'google',
        cacheType: 'PLACE_DETAILS',
        cacheKey: `details-v1:${normalizeCachePart(input.placeId)}`,
      };
      const cached = await this.readCache<DeliveryLocationResolveResult>(cacheEntry, warnings);
      if (cached) {
        return { ...cached, warnings: [...warnings] };
      }

      try {
        const quota = await this.beforeGoogleCall('place-details');
        quota.warnings.forEach((warning) => warnings.add(warning));
        if (!quota.allowed) return blockedResolve([...warnings]);

        const placeName = input.placeId.startsWith('places/') ? input.placeId : `places/${input.placeId}`;
        const place = await fetchJsonWithTimeout<GooglePlace>(
          'google',
          `https://places.googleapis.com/v1/${encodeURIComponentPlaceName(placeName)}`,
          this.timeoutMs(),
          'GEOCODING_UNAVAILABLE',
          {
            headers: {
              'X-Goog-Api-Key': this.apiKeyOrThrow(),
              'X-Goog-FieldMask': 'id,name,formattedAddress,displayName,location',
            },
          },
        );
        const resolved = toResolvedLocation(place);
        await this.providerUsage?.recordSuccess('google', 'place-details').catch(() => undefined);
        await this.writeCache(cacheEntry, resolved, PLACE_DETAILS_TTL_SECONDS, warnings);
        return { ...resolved, warnings: [...warnings] };
      } catch (error) {
        warnings.add(warningFromError(error, 'GEOCODING_UNAVAILABLE'));
        await this.providerUsage?.recordError('google', 'place-details', warningFromError(error, 'GEOCODING_UNAVAILABLE')).catch(() => undefined);
        return blockedResolve([...warnings]);
      }
    }

    if (input.fallbackText?.trim()) {
      return this.resolveByFallbackText(input.fallbackText.trim(), warnings);
    }

    return blockedResolve(['DESTINATION_MISSING']);
  }

  private async resolveByFallbackText(fallbackText: string, warnings: Set<string>) {
    try {
      const quota = await this.beforeGoogleCall('geocoding');
      quota.warnings.forEach((warning) => warnings.add(warning));
      if (!quota.allowed) return blockedResolve([...warnings]);
      const geocoder = new GoogleGeocodingProvider(this.timeoutMs(), this.apiKeyOrThrow());
      const result = await geocoder.geocodeAddress({
        addressText: fallbackText,
        city: 'Jamundí',
        state: 'Valle del Cauca',
        country: 'Colombia',
      });
      if (result.latitude == null || result.longitude == null || result.confidence === 'LOW') {
        return blockedResolve(['GEOCODING_NOT_FOUND']);
      }
      await this.providerUsage?.recordSuccess('google', 'geocoding').catch(() => undefined);
      return {
        provider: 'google',
        placeId: null,
        formattedAddress: result.formattedAddress ?? null,
        latitude: result.latitude,
        longitude: result.longitude,
        confidence: result.confidence,
        warnings: [...warnings],
      };
    } catch (error) {
      warnings.add(warningFromError(error, 'GEOCODING_UNAVAILABLE'));
      await this.providerUsage?.recordError('google', 'geocoding', warningFromError(error, 'GEOCODING_UNAVAILABLE')).catch(() => undefined);
      return blockedResolve([...warnings]);
    }
  }

  private googlePlacesEnabled() {
    return process.env.DELIVERY_PLACES_PROVIDER === 'google' && process.env.DELIVERY_GOOGLE_PLACES_ENABLED === 'true' && Boolean(process.env.GOOGLE_MAPS_API_KEY);
  }

  private googleResolveEnabled() {
    return process.env.DELIVERY_GOOGLE_GEOCODING_ENABLED === 'true' && Boolean(process.env.GOOGLE_MAPS_API_KEY);
  }

  private apiKeyOrThrow() {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      throw new DeliveryProviderError('Google Maps API key missing', 'PROVIDER_API_KEY_MISSING', 'google');
    }
    return key;
  }

  private timeoutMs() {
    const value = Number(process.env.DELIVERY_GOOGLE_TIMEOUT_MS ?? process.env.DELIVERY_EXTERNAL_TIMEOUT_MS ?? 3000);
    return Number.isFinite(value) && value > 0 ? value : 3000;
  }

  private async beforeGoogleCall(endpoint: string) {
    if (!this.providerUsage) return { allowed: true, warnings: [] as string[] };
    return this.providerUsage.beforeCall('google', endpoint, optionalPositiveNumber(process.env.DELIVERY_GOOGLE_DAILY_LIMIT));
  }

  private async readCache<T>(entry: ExternalCacheLookup, warnings: Set<string>) {
    if (!this.cache) return null;
    try {
      return await this.cache.get<T>(entry);
    } catch {
      warnings.add('CACHE_UNAVAILABLE');
      return null;
    }
  }

  private async writeCache<T>(entry: ExternalCacheLookup, value: T, ttlSeconds: number, warnings: Set<string>) {
    if (!this.cache) return;
    try {
      await this.cache.set(entry, value, ttlSeconds);
    } catch {
      warnings.add('CACHE_UNAVAILABLE');
    }
  }
}

function fullQuery(query: string, input: { city?: string; state?: string; country?: string }) {
  return [query, input.city || 'Jamundí', input.state || 'Valle del Cauca', input.country || 'Colombia']
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

function toSuggestion(place: GooglePlace): DeliveryLocationSuggestion | null {
  const placeId = place.id ?? place.name?.replace(/^places\//, '');
  const label = place.formattedAddress ?? place.shortFormattedAddress ?? place.displayName?.text;
  if (!placeId || !label) return null;
  const mainText = place.displayName?.text ?? label.split(',')[0]?.trim() ?? label;
  const secondaryText = label.split(',').slice(1).join(',').trim() || 'Jamundí, Valle del Cauca';
  return {
    provider: 'google',
    placeId,
    label,
    mainText,
    secondaryText,
    confidence: 'HIGH',
  };
}

function toResolvedLocation(place: GooglePlace): DeliveryLocationResolveResult {
  const latitude = place.location?.latitude ?? null;
  const longitude = place.location?.longitude ?? null;
  return {
    provider: 'google',
    placeId: place.id ?? place.name?.replace(/^places\//, '') ?? null,
    formattedAddress: place.formattedAddress ?? place.shortFormattedAddress ?? place.displayName?.text ?? null,
    latitude,
    longitude,
    confidence: latitude != null && longitude != null ? 'HIGH' : 'LOW',
  };
}

function blockedResolve(warnings: string[]): DeliveryLocationResolveResult & { warnings: string[]; humanMessage: string } {
  return {
    provider: 'google',
    placeId: null,
    formattedAddress: null,
    latitude: null,
    longitude: null,
    confidence: 'LOW',
    warnings,
    humanMessage: 'Selecciona una dirección sugerida o agrega más detalle.',
  };
}

function normalizeCachePart(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function encodeURIComponentPlaceName(placeName: string) {
  return placeName.split('/').map(encodeURIComponent).join('/');
}

function optionalPositiveNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
