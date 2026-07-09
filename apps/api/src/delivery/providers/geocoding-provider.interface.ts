import type {
  GeocodeRequest,
  GeocodeResult,
  ReverseGeocodeRequest,
  ReverseGeocodeResult,
} from './provider-types';

export interface GeocodingProvider {
  readonly providerName: string;
  geocodeAddress(request: GeocodeRequest): Promise<GeocodeResult>;
  reverseGeocode(request: ReverseGeocodeRequest): Promise<ReverseGeocodeResult>;
}
