/**
 * A6 RED TEAM finding (round 4) — FIXED in round 4's final closure (A7).
 *
 * `resolveDeliverySnapshot` (orders.service.ts:4610) used to merge an incoming delivery coordinate
 * update with the ORDER'S EXISTING persisted coordinate independently per axis:
 *
 *   const explicitLatitude = input.latitude ?? null;
 *   const explicitLongitude = input.longitude ?? null;
 *   const existingLatitude = !referenceChanged && input.existing?.deliveryLatitude != null ? Number(...) : null;
 *   const existingLongitude = !referenceChanged && input.existing?.deliveryLongitude != null ? Number(...) : null;
 *   const latitude = explicitLatitude ?? existingLatitude;
 *   const longitude = explicitLongitude ?? existingLongitude;
 *
 * Both `deliveryLatitude`/`deliveryLongitude` are independently `@IsOptional()` on
 * `CreateOrderTicketDto`/`UpdateOrderTicketDto` (dto files, no `@IsDefined` pairing / no
 * cross-field validator requiring both-or-neither). This means a caller can submit ONLY
 * `deliveryLatitude` (a brand-new value) while omitting `deliveryLongitude`, and — as long as the
 * delivery reference text is unchanged (`referenceChanged === false`) — the system pairs the NEW
 * latitude with the OLD longitude from a previous, unrelated geocoding/pin event. The resulting
 * "point" was never independently geocoded or pinned as a pair; it is a synthetic hybrid of two
 * different points in time, yet the engine treats it as `hasRealPoint = true` (a single, trusted,
 * already-resolved point) and computes a real route/fee/coverage decision against it.
 *
 * This test proves the pairing bug is real and quantifies the impact: an order originally priced
 * for a real point ~42km away (correctly OUT_OF_COVERAGE) can be walked, via a same-reference-text
 * partial coordinate update, into a fabricated nearby point that is NOT the customer's real
 * location, silently becoming AUTO_PRICED/cheap or even mistakenly zone-adjacent — with no
 * geocoding, no route confirmation, no customer confirmation of the merged point ever having
 * occurred as a pair.
 *
 * Reachable via: legacy POS only (orders.service.ts create/update delivery order flows). SOFIA's
 * commercial-checkout flow does not go through this order-edit merge path.
 */

import { OrdersService } from './orders.service';
import { DeliveryPricingService } from '../../delivery/delivery-pricing/delivery-pricing.service';
import { DeliveryExternalDataService } from '../../delivery/providers/delivery-external-data.service';
import { InMemoryExternalCache } from '../../delivery/providers/in-memory-external-cache';
import { PrismaService } from '../../prisma/prisma.service';
import type { RouteResult, WeatherResult } from '../../delivery/providers/provider-types';
import type { RoutingProvider } from '../../delivery/providers/routing-provider.interface';
import type { WeatherProvider } from '../../delivery/providers/weather-provider.interface';

const origin = { latitude: 3.2601, longitude: -76.5405, label: '2X1 Burger Co', address: 'Local principal' };
// True original point: ~42km away (far outside coverage).
const TRUE_FAR_LATITUDE = 3.62;
const TRUE_FAR_LONGITUDE = -76.15;
// A nearby point (well inside auto-priced coverage, ~2km away).
const NEAR_LATITUDE = 3.255;
const NEAR_LONGITUDE = -76.545;

function buildWeatherProvider(): WeatherProvider {
  const result: WeatherResult = {
    provider: 'mock-weather', isRaining: false, precipitationMm: 0, rainIntensity: 'NONE',
    confidence: 'HIGH', fetchedAt: new Date('2026-08-20T12:00:00.000Z'), warnings: [],
  };
  return { providerName: 'mock-weather', getCurrentWeather: jest.fn().mockResolvedValue(result) };
}

function buildRoutingProvider(): RoutingProvider {
  // Deterministic "real route" purely as a function of destination — 42km for the true far point,
  // ~2km for the near point, and something implausible for any OTHER pair (so we can detect a
  // hybrid point was actually queried, distinct from both known points).
  const getRoute = jest.fn(async (request: { destinationLatitude: number; destinationLongitude: number }) => {
    const isFar = Math.abs(request.destinationLatitude - TRUE_FAR_LATITUDE) < 1e-6 && Math.abs(request.destinationLongitude - TRUE_FAR_LONGITUDE) < 1e-6;
    const isNear = Math.abs(request.destinationLatitude - NEAR_LATITUDE) < 1e-6 && Math.abs(request.destinationLongitude - NEAR_LONGITUDE) < 1e-6;
    const result: RouteResult = {
      provider: 'mock-route',
      distanceKm: isFar ? 42 : isNear ? 2 : 2, // a hybrid point built from (near-lat, far-lng) or (far-lat, near-lng) still routes successfully
      durationMinutes: isFar ? 60 : 12,
      routeConfidence: 'HIGH',
      warnings: [],
    };
    return result;
  });
  return { providerName: 'mock-route', getRoute };
}

const auditPrisma = { deliveryPricingAudit: { create: jest.fn(async () => ({ id: 'audit-x' })) } };

describe('A6 RED TEAM: legacy POS partial coordinate update pairs a NEW axis with an OLD axis (fabricated point)', () => {
  jest.setTimeout(30000);
  let prisma: PrismaService;
  let service: OrdersService;
  let routingProvider: RoutingProvider;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    routingProvider = buildRoutingProvider();
    const externalDataService = DeliveryExternalDataService.createForTesting({
      providersEnabled: true,
      origin,
      cache: new InMemoryExternalCache(),
      weatherProvider: buildWeatherProvider(),
      routingProvider,
    });
    const pricingService = new DeliveryPricingService(externalDataService, auditPrisma as never);
    service = new OrdersService(
      prisma,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      {} as never,
      { emit: jest.fn() } as never,
      pricingService,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    await prisma.deliveryCustomer.deleteMany({ where: { phone: '573009998877' } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('FINDING 2 — FIXED: a same-reference-text partial coordinate update no longer fabricates a hybrid point; the atomic pair is preserved from whichever single source is complete', async () => {
    const reference = 'casa esquinera azul barrio alborada';

    // Turn 1: real order with a full, coherent, trusted coordinate pair 42km away — correctly not
    // free, correctly evaluated against the true distance.
    const first = await (service as unknown as {
      resolveDeliverySnapshot: (tx: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }).resolveDeliverySnapshot(prisma, {
      customerName: 'Cliente Redteam',
      customerPhone: '573009998877',
      deliveryReference: reference,
      latitude: TRUE_FAR_LATITUDE,
      longitude: TRUE_FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    expect(Number(first.deliveryLatitude)).toBeCloseTo(TRUE_FAR_LATITUDE, 5);
    expect(Number(first.deliveryLongitude)).toBeCloseTo(TRUE_FAR_LONGITUDE, 5);
    expect(first.deliveryPricingStatus).toBe('OUT_OF_COVERAGE');
    expect(Number(first.deliveryFee)).toBe(0); // blocked -> engine returns finalFee null -> Decimal(0) per resolveDeliverySnapshot's `?? 0`

    // Turn 2: SAME reference text (referenceChanged === false), but the caller supplies ONLY a new
    // latitude that — on its own — is close to the near point, and OMITS longitude entirely (a
    // realistic client bug, or a deliberately crafted partial PATCH/DTO payload; both fields are
    // independently @IsOptional() with no cross-field validator).
    const second = await (service as unknown as {
      resolveDeliverySnapshot: (tx: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }).resolveDeliverySnapshot(prisma, {
      customerName: 'Cliente Redteam',
      customerPhone: '573009998877',
      deliveryReference: reference, // unchanged text
      latitude: NEAR_LATITUDE, // new
      longitude: undefined, // omitted -> falls back to the OLD (far) longitude
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: {
        deliveryLatitude: first.deliveryLatitude as never,
        deliveryLongitude: first.deliveryLongitude as never,
        deliveryAddressNormalized: first.deliveryAddressNormalized as string,
        deliveryDistanceKm: first.deliveryDistanceKm as never,
      },
    });

    // FIXED (round 4 closure): the incomplete new pair (latitude only) is rejected outright, and the
    // system falls back to the last known COHERENT pair (both axes from the same prior resolution)
    // rather than mixing a fresh axis with a stale one.
    expect(Number(second.deliveryLatitude)).toBeCloseTo(TRUE_FAR_LATITUDE, 5);
    expect(Number(second.deliveryLongitude)).toBeCloseTo(TRUE_FAR_LONGITUDE, 5);

    // Prove the fabricated hybrid pair (NEW latitude + OLD longitude) was never queried at all —
    // the engine never trusted a coordinate pair that wasn't atomically sourced.
    const calls = (routingProvider.getRoute as jest.Mock).mock.calls as Array<[{ destinationLatitude: number; destinationLongitude: number }]>;
    const hybridCall = calls.find(
      ([req]) => Math.abs(req.destinationLatitude - NEAR_LATITUDE) < 1e-6 && Math.abs(req.destinationLongitude - TRUE_FAR_LONGITUDE) < 1e-6,
    );
    expect(hybridCall).toBeUndefined();
  });
});
