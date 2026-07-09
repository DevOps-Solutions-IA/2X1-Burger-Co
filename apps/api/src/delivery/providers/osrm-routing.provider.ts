import type { RoutingProvider } from './routing-provider.interface';
import type { RouteRequest, RouteResult } from './provider-types';
import { fetchJsonWithTimeout } from './provider-http';

type OsrmRouteResponse = {
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: unknown;
  }>;
};

export class OsrmRoutingProvider implements RoutingProvider {
  readonly providerName = 'osrm';

  constructor(
    private readonly timeoutMs: number,
    private readonly baseUrl = 'https://router.project-osrm.org',
  ) {}

  async getRoute(request: RouteRequest): Promise<RouteResult> {
    const coordinates = [
      `${request.originLongitude},${request.originLatitude}`,
      `${request.destinationLongitude},${request.destinationLatitude}`,
    ].join(';');
    const profile = request.profile === 'WALKING' ? 'foot' : request.profile === 'BICYCLE' ? 'bike' : 'driving';
    const url = `${this.baseUrl}/route/v1/${profile}/${coordinates}?overview=false`;

    const response = await fetchJsonWithTimeout<OsrmRouteResponse>(
      this.providerName,
      url,
      this.timeoutMs,
      'ROUTING_UNAVAILABLE',
    );
    const route = response.routes?.[0];

    return {
      provider: this.providerName,
      distanceKm: route?.distance != null ? Number((route.distance / 1000).toFixed(2)) : null,
      durationMinutes: route?.duration != null ? Math.round(route.duration / 60) : null,
      routeConfidence: route?.distance != null && route?.duration != null ? 'HIGH' : 'LOW',
      warnings: route ? [] : ['ROUTING_UNAVAILABLE'],
      geometrySummary: route?.geometry ?? null,
    };
  }
}
