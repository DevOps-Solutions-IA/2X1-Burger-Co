import type { RouteRequest, RouteResult } from './provider-types';

export interface RoutingProvider {
  readonly providerName: string;
  getRoute(request: RouteRequest): Promise<RouteResult>;
}
