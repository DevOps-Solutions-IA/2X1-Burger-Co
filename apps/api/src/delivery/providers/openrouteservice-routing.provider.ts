import type { RoutingProvider } from './routing-provider.interface';
import { DeliveryProviderError } from './provider-errors';
import { fetchJsonWithTimeout } from './provider-http';
import type { RouteRequest, RouteResult } from './provider-types';

type OrsDirectionsResponse = {
  routes?: Array<{
    summary?: {
      distance?: number;
      duration?: number;
    };
  }>;
};

export class OpenRouteServiceRoutingProvider implements RoutingProvider {
  readonly providerName = 'openrouteservice';

  constructor(
    private readonly timeoutMs: number,
    private readonly apiKey: string | undefined,
    private readonly baseUrl = 'https://api.openrouteservice.org',
  ) {}

  async getRoute(request: RouteRequest): Promise<RouteResult> {
    if (!this.apiKey) {
      throw new DeliveryProviderError('OpenRouteService API key missing', 'PROVIDER_API_KEY_MISSING', this.providerName);
    }

    const url = `${this.baseUrl}/v2/directions/${profileToOrs(request.profile)}`;
    const response = await fetchJsonWithTimeout<OrsDirectionsResponse>(
      this.providerName,
      url,
      this.timeoutMs,
      'ROUTING_UNAVAILABLE',
      {
        method: 'POST',
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [request.originLongitude, request.originLatitude],
            [request.destinationLongitude, request.destinationLatitude],
          ],
          instructions: false,
        }),
      },
    );
    const route = response.routes?.[0];

    return {
      provider: this.providerName,
      distanceKm: route?.summary?.distance != null ? Number((route.summary.distance / 1000).toFixed(2)) : null,
      durationMinutes: route?.summary?.duration != null ? Math.round(route.summary.duration / 60) : null,
      routeConfidence: route?.summary?.distance != null && route?.summary?.duration != null ? 'HIGH' : 'LOW',
      warnings: route ? [] : ['ROUTING_UNAVAILABLE'],
      geometrySummary: null,
    };
  }
}

function profileToOrs(profile: RouteRequest['profile']) {
  if (profile === 'BICYCLE') return 'cycling-regular';
  if (profile === 'WALKING') return 'foot-walking';
  return 'driving-car';
}
