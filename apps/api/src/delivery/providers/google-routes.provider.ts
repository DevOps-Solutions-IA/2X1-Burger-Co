import type { RoutingProvider } from './routing-provider.interface';
import { DeliveryProviderError } from './provider-errors';
import { fetchJsonWithTimeout } from './provider-http';
import type { RouteRequest, RouteResult } from './provider-types';

type GoogleRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
  }>;
};

export class GoogleRoutesProvider implements RoutingProvider {
  readonly providerName = 'google';

  constructor(
    private readonly timeoutMs: number,
    private readonly apiKey: string | undefined,
    private readonly baseUrl = 'https://routes.googleapis.com/directions/v2:computeRoutes',
  ) {}

  async getRoute(request: RouteRequest): Promise<RouteResult> {
    if (!this.apiKey) {
      throw new DeliveryProviderError('Google Maps API key missing', 'PROVIDER_API_KEY_MISSING', this.providerName);
    }

    const response = await fetchJsonWithTimeout<GoogleRoutesResponse>(
      this.providerName,
      this.baseUrl,
      this.timeoutMs,
      'ROUTING_UNAVAILABLE',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: request.originLatitude,
                longitude: request.originLongitude,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: request.destinationLatitude,
                longitude: request.destinationLongitude,
              },
            },
          },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
          languageCode: 'es-CO',
          units: 'METRIC',
        }),
      },
    );

    const route = response.routes?.[0];
    const durationSeconds = parseGoogleDurationSeconds(route?.duration);
    return {
      provider: this.providerName,
      distanceKm: route?.distanceMeters != null ? Number((route.distanceMeters / 1000).toFixed(2)) : null,
      durationMinutes: durationSeconds != null ? Math.max(1, Math.round(durationSeconds / 60)) : null,
      routeConfidence: route?.distanceMeters != null && durationSeconds != null ? 'HIGH' : 'LOW',
      warnings: route ? [] : ['ROUTING_UNAVAILABLE'],
      geometrySummary: route ? { source: 'google-routes' } : null,
    };
  }
}

function parseGoogleDurationSeconds(value: string | null | undefined) {
  if (!value) return null;
  const numeric = Number(value.replace(/s$/, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}
