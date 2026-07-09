import type { GeocodingProvider } from './geocoding-provider.interface';
import { DeliveryProviderError } from './provider-errors';
import { fetchJsonWithTimeout } from './provider-http';
import type { GeocodeRequest, GeocodeResult, ReverseGeocodeRequest, ReverseGeocodeResult } from './provider-types';

type OrsGeocodeFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    label?: string;
    confidence?: number;
    neighbourhood?: string;
    locality?: string;
  };
};

type OrsGeocodeResponse = {
  features?: OrsGeocodeFeature[];
};

export class OpenRouteServiceGeocodingProvider implements GeocodingProvider {
  readonly providerName = 'openrouteservice';

  constructor(
    private readonly timeoutMs: number,
    private readonly apiKey: string | undefined,
    private readonly baseUrl = 'https://api.openrouteservice.org',
    private readonly focus?: { latitude?: number | null; longitude?: number | null },
  ) {}

  async geocodeAddress(request: GeocodeRequest): Promise<GeocodeResult> {
    if (!this.apiKey) {
      throw new DeliveryProviderError('OpenRouteService API key missing', 'PROVIDER_API_KEY_MISSING', this.providerName);
    }

    const attempts = buildGeocodeAttempts(request);
    let bestResult: GeocodeResult | null = null;

    for (const text of attempts) {
      const result = await this.fetchGeocodeAttempt(text);
      if (result.matchQuality === 'EXACT' || result.matchQuality === 'STRONG') {
        return result;
      }
      if (!bestResult || scoreMatchQuality(result.matchQuality) > scoreMatchQuality(bestResult.matchQuality)) {
        bestResult = result;
      }
    }

    return bestResult ?? {
      provider: this.providerName,
      latitude: null,
      longitude: null,
      formattedAddress: null,
      neighborhood: null,
      matchQuality: 'NOT_FOUND',
      confidence: 'LOW',
      warnings: ['GEOCODING_NOT_FOUND'],
      rawSummary: { count: 0 },
    };
  }

  private async fetchGeocodeAttempt(text: string): Promise<GeocodeResult> {
    if (!this.apiKey) {
      throw new DeliveryProviderError('OpenRouteService API key missing', 'PROVIDER_API_KEY_MISSING', this.providerName);
    }

    const url = new URL(`${this.baseUrl}/geocode/search`);
    url.searchParams.set('text', text);
    url.searchParams.set('size', '3');
    url.searchParams.set('boundary.country', 'COL');
    if (isValidCoordinate(this.focus?.latitude, this.focus?.longitude)) {
      url.searchParams.set('focus.point.lat', String(this.focus!.latitude));
      url.searchParams.set('focus.point.lon', String(this.focus!.longitude));
    }

    const response = await fetchJsonWithTimeout<OrsGeocodeResponse>(
      this.providerName,
      url.toString(),
      this.timeoutMs,
      'GEOCODING_UNAVAILABLE',
      {
        headers: { Authorization: this.apiKey },
      },
    );

    const features = response.features ?? [];
    const first = features[0];
    if (!first?.geometry?.coordinates) {
      return {
        provider: this.providerName,
        latitude: null,
        longitude: null,
        formattedAddress: null,
        neighborhood: null,
        matchQuality: 'NOT_FOUND',
        confidence: 'LOW',
        warnings: ['GEOCODING_NOT_FOUND'],
        rawSummary: { count: features.length },
      };
    }

    const confidenceScore = first.properties?.confidence ?? 0;
    const secondConfidence = features[1]?.properties?.confidence ?? 0;
    const ambiguous = secondConfidence > 0 && Math.abs(confidenceScore - secondConfidence) < 0.08;
    const matchQuality = ambiguous ? 'AMBIGUOUS' : confidenceScore >= 0.85 ? 'EXACT' : confidenceScore >= 0.65 ? 'STRONG' : confidenceScore >= 0.4 ? 'PARTIAL' : 'AMBIGUOUS';
    const [longitude, latitude] = first.geometry.coordinates;

    return {
      provider: this.providerName,
      latitude,
      longitude,
      formattedAddress: first.properties?.label ?? null,
      neighborhood: first.properties?.neighbourhood ?? first.properties?.locality ?? null,
      matchQuality,
      confidence: matchQuality === 'EXACT' || matchQuality === 'STRONG' ? 'HIGH' : matchQuality === 'PARTIAL' ? 'MEDIUM' : 'LOW',
      warnings: matchQuality === 'AMBIGUOUS' ? ['GEOCODING_AMBIGUOUS'] : [],
      rawSummary: { confidence: confidenceScore, label: first.properties?.label, queryParts: redactedQuerySummary(text) },
    };
  }

  async reverseGeocode(request: ReverseGeocodeRequest): Promise<ReverseGeocodeResult> {
    if (!this.apiKey) {
      throw new DeliveryProviderError('OpenRouteService API key missing', 'PROVIDER_API_KEY_MISSING', this.providerName);
    }

    const url = new URL(`${this.baseUrl}/geocode/reverse`);
    url.searchParams.set('point.lon', String(request.longitude));
    url.searchParams.set('point.lat', String(request.latitude));
    url.searchParams.set('size', '1');

    const response = await fetchJsonWithTimeout<OrsGeocodeResponse>(
      this.providerName,
      url.toString(),
      this.timeoutMs,
      'GEOCODING_UNAVAILABLE',
      {
        headers: { Authorization: this.apiKey },
      },
    );
    const first = response.features?.[0];

    return {
      provider: this.providerName,
      formattedAddress: first?.properties?.label ?? null,
      neighborhood: first?.properties?.neighbourhood ?? first?.properties?.locality ?? null,
      confidence: first ? 'MEDIUM' : 'LOW',
      warnings: first ? [] : ['GEOCODING_NOT_FOUND'],
      rawSummary: first ? { label: first.properties?.label } : null,
    };
  }
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

function buildGeocodeAttempts(request: GeocodeRequest) {
  const addressText = normalizePart(request.addressText);
  const neighborhood = normalizePart(request.neighborhood);
  const reference = normalizePart(request.reference);
  const city = normalizePart(request.city) || 'Jamundí';
  const state = normalizePart(request.state) || 'Valle del Cauca';
  const country = normalizePart(request.country) || 'Colombia';
  return uniqueNonEmpty([
    joinAddressParts(addressText, neighborhood, city, state, country),
    joinAddressParts(addressText, city, state, country),
    joinAddressParts(neighborhood, city, state, country),
    joinAddressParts(reference, neighborhood, city, state, country),
  ]);
}

function joinAddressParts(...parts: Array<string | null>) {
  return parts.filter(Boolean).join(', ');
}

function normalizePart(value: string | null | undefined) {
  return value?.trim() || null;
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function scoreMatchQuality(quality: GeocodeResult['matchQuality']) {
  if (quality === 'EXACT') return 5;
  if (quality === 'STRONG') return 4;
  if (quality === 'PARTIAL') return 3;
  if (quality === 'AMBIGUOUS') return 2;
  return 1;
}

function redactedQuerySummary(text: string) {
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  return {
    parts: parts.length,
    city: parts.length >= 3 ? parts[parts.length - 3] : null,
    state: parts.length >= 2 ? parts[parts.length - 2] : null,
    country: parts.length >= 1 ? parts[parts.length - 1] : null,
  };
}
