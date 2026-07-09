import type { GeocodingProvider } from './geocoding-provider.interface';
import { DeliveryProviderError } from './provider-errors';
import { fetchJsonWithTimeout } from './provider-http';
import type { GeocodeRequest, GeocodeResult, ReverseGeocodeRequest, ReverseGeocodeResult } from './provider-types';

type GoogleGeocodeResponse = {
  status?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
      location_type?: string;
    };
    address_components?: Array<{
      long_name?: string;
      types?: string[];
    }>;
  }>;
};

type GoogleAddressComponent = NonNullable<NonNullable<GoogleGeocodeResponse['results']>[number]['address_components']>[number];

export class GoogleGeocodingProvider implements GeocodingProvider {
  readonly providerName = 'google';

  constructor(
    private readonly timeoutMs: number,
    private readonly apiKey: string | undefined,
    private readonly baseUrl = 'https://maps.googleapis.com/maps/api/geocode/json',
  ) {}

  async geocodeAddress(request: GeocodeRequest): Promise<GeocodeResult> {
    if (!this.apiKey) {
      throw new DeliveryProviderError('Google Maps API key missing', 'PROVIDER_API_KEY_MISSING', this.providerName);
    }

    const query = buildGeocodeText(request);
    const url = new URL(this.baseUrl);
    url.searchParams.set('address', query);
    url.searchParams.set('components', 'country:CO');
    url.searchParams.set('language', 'es');
    url.searchParams.set('region', 'co');
    url.searchParams.set('key', this.apiKey);

    const response = await fetchJsonWithTimeout<GoogleGeocodeResponse>(
      this.providerName,
      url.toString(),
      this.timeoutMs,
      'GEOCODING_UNAVAILABLE',
    );

    return mapGoogleGeocodeResponse(response, this.providerName);
  }

  async reverseGeocode(request: ReverseGeocodeRequest): Promise<ReverseGeocodeResult> {
    if (!this.apiKey) {
      throw new DeliveryProviderError('Google Maps API key missing', 'PROVIDER_API_KEY_MISSING', this.providerName);
    }

    const url = new URL(this.baseUrl);
    url.searchParams.set('latlng', `${request.latitude},${request.longitude}`);
    url.searchParams.set('language', 'es');
    url.searchParams.set('key', this.apiKey);

    const response = await fetchJsonWithTimeout<GoogleGeocodeResponse>(
      this.providerName,
      url.toString(),
      this.timeoutMs,
      'GEOCODING_UNAVAILABLE',
    );
    const result = response.results?.[0];

    return {
      provider: this.providerName,
      formattedAddress: result?.formatted_address ?? null,
      neighborhood: extractNeighborhood(result?.address_components),
      confidence: result ? 'MEDIUM' : 'LOW',
      warnings: result ? [] : ['GEOCODING_NOT_FOUND'],
      rawSummary: result ? { locationType: result.geometry?.location_type } : null,
    };
  }
}

function buildGeocodeText(request: GeocodeRequest) {
  const city = request.city?.trim() || 'Jamundí';
  const state = request.state?.trim() || 'Valle del Cauca';
  const country = request.country?.trim() || 'Colombia';
  return [request.addressText, request.neighborhood, city, state, country]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
}

export function mapGoogleGeocodeResponse(response: GoogleGeocodeResponse, provider = 'google'): GeocodeResult {
  if (response.status && response.status !== 'OK' && response.status !== 'ZERO_RESULTS') {
    throw new DeliveryProviderError('Google geocoding unavailable', 'GEOCODING_UNAVAILABLE', provider);
  }

  const result = response.results?.[0];
  const location = result?.geometry?.location;
  if (!result || location?.lat == null || location.lng == null) {
    return {
      provider,
      latitude: null,
      longitude: null,
      formattedAddress: null,
      neighborhood: null,
      matchQuality: 'NOT_FOUND',
      confidence: 'LOW',
      warnings: ['GEOCODING_NOT_FOUND'],
      rawSummary: { status: response.status ?? 'EMPTY' },
    };
  }

  const locationType = result.geometry?.location_type;
  const matchQuality = locationType === 'ROOFTOP' || locationType === 'GEOMETRIC_CENTER' ? 'EXACT' : 'STRONG';
  return {
    provider,
    latitude: location.lat,
    longitude: location.lng,
    formattedAddress: result.formatted_address ?? null,
    neighborhood: extractNeighborhood(result.address_components),
    matchQuality,
    confidence: 'HIGH',
    warnings: [],
    rawSummary: {
      locationType,
      components: result.address_components?.length ?? 0,
    },
  };
}

function extractNeighborhood(components: GoogleAddressComponent[] | undefined) {
  if (!Array.isArray(components)) return null;
  const candidate = components.find((component) =>
    component.types?.some((type) => ['neighborhood', 'sublocality', 'locality'].includes(type)),
  );
  return candidate?.long_name ?? null;
}
