import type { GeocodingProvider } from './geocoding-provider.interface';
import type {
  GeocodeRequest,
  GeocodeResult,
  ReverseGeocodeRequest,
  ReverseGeocodeResult,
} from './provider-types';
import { fetchJsonWithTimeout } from './provider-http';

type NominatimSearchResult = {
  lat: string;
  lon: string;
  display_name?: string;
  address?: {
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
  };
  importance?: number;
  class?: string;
  type?: string;
};

export class NominatimGeocodingProvider implements GeocodingProvider {
  readonly providerName = 'nominatim';

  constructor(
    private readonly timeoutMs: number,
    private readonly userAgent: string,
  ) {}

  async geocodeAddress(request: GeocodeRequest): Promise<GeocodeResult> {
    const normalized = [
      request.addressText,
      request.neighborhood,
      request.city || 'Jamundí',
      request.state || 'Valle del Cauca',
      request.country || 'Colombia',
    ]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(', ');
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '3');
    url.searchParams.set('q', normalized);

    const results = await fetchJsonWithTimeout<NominatimSearchResult[]>(
      this.providerName,
      url.toString(),
      this.timeoutMs,
      'GEOCODING_UNAVAILABLE',
      {
        headers: { 'User-Agent': this.userAgent },
      },
    );

    if (!results.length) {
      return {
        provider: this.providerName,
        latitude: null,
        longitude: null,
        formattedAddress: null,
        neighborhood: null,
        matchQuality: 'NOT_FOUND',
        confidence: 'LOW',
        warnings: ['GEOCODING_NOT_FOUND'],
        rawSummary: null,
      };
    }

    const first = results[0];
    if (!first) {
      return {
        provider: this.providerName,
        latitude: null,
        longitude: null,
        formattedAddress: null,
        neighborhood: null,
        matchQuality: 'NOT_FOUND',
        confidence: 'LOW',
        warnings: ['GEOCODING_NOT_FOUND'],
        rawSummary: null,
      };
    }

    const second = results[1];
    if (second && Math.abs((first.importance ?? 0) - (second.importance ?? 0)) < 0.08) {
      return {
        provider: this.providerName,
        latitude: Number(first.lat),
        longitude: Number(first.lon),
        formattedAddress: first.display_name ?? null,
        neighborhood: extractNeighborhood(first),
        matchQuality: 'AMBIGUOUS',
        confidence: 'LOW',
        warnings: ['GEOCODING_AMBIGUOUS'],
        rawSummary: results.slice(0, 3),
      };
    }

    const importance = first.importance ?? 0;
    const matchQuality = importance >= 0.7 ? 'STRONG' : importance >= 0.4 ? 'PARTIAL' : 'AMBIGUOUS';

    return {
      provider: this.providerName,
      latitude: Number(first.lat),
      longitude: Number(first.lon),
      formattedAddress: first.display_name ?? null,
      neighborhood: extractNeighborhood(first),
      matchQuality,
      confidence: matchQuality === 'STRONG' ? 'HIGH' : matchQuality === 'PARTIAL' ? 'MEDIUM' : 'LOW',
      warnings: matchQuality === 'AMBIGUOUS' ? ['GEOCODING_AMBIGUOUS'] : [],
      rawSummary: first,
    };
  }

  async reverseGeocode(request: ReverseGeocodeRequest): Promise<ReverseGeocodeResult> {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(request.latitude));
    url.searchParams.set('lon', String(request.longitude));

    const result = await fetchJsonWithTimeout<NominatimSearchResult>(
      this.providerName,
      url.toString(),
      this.timeoutMs,
      'GEOCODING_UNAVAILABLE',
      {
        headers: { 'User-Agent': this.userAgent },
      },
    );

    return {
      provider: this.providerName,
      formattedAddress: result.display_name ?? null,
      neighborhood: extractNeighborhood(result),
      confidence: result.display_name ? 'MEDIUM' : 'LOW',
      warnings: result.display_name ? [] : ['GEOCODING_NOT_FOUND'],
      rawSummary: result,
    };
  }
}

function extractNeighborhood(result: NominatimSearchResult) {
  return result.address?.neighbourhood ?? result.address?.suburb ?? result.address?.city ?? result.address?.town ?? null;
}
