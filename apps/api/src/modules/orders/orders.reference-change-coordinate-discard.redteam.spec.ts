/**
 * RED TEAM (adapted from an independent, previously-uncommitted PoC found during a worktree-
 * hygiene audit at inventario-remediation-a8) — reference-text-change coordinate discard reopens
 * the LOCAL_FREE textual-zone-alias fraud, adapted to the SHA in this branch (dc22892, which
 * already includes PR #47 RULE 3/5 fixes — `classifyReferenceTextChange` — but NOT any RULE 1/2
 * axis-pairing fix, which does not exist on this branch and is not needed to reproduce this bug:
 * `resolveDeliverySnapshot` nulls BOTH existing axes together under one `referenceChanged` flag,
 * so no mismatched-axis hybrid is even possible here).
 *
 * `resolveDeliverySnapshot` (orders.service.ts) correctly classifies a reference-text change via
 * RULE 3's `classifyReferenceTextChange` and discards stale coordinates on a SPATIAL/AMBIGUOUS
 * change. That part is correct and fail-closed — NOT the bug.
 *
 * The bug lives one layer down: when the SAME turn supplies no explicit new latitude/longitude,
 * `resolveDeliverySnapshot` still calls `DeliveryPricingService.estimate()` with
 * latitude=null/longitude=null and the new reference text. If that text also satisfies the bare
 * zone-alias vocabulary ("condados"/"alborada" — see `local-zone-match.ts`),
 * `DeliveryExternalDataService.resolveDeliveryContext()` returns EARLY
 * (`if (localZoneMatch.matched || localZoneMatch.ambiguous) return ...`) BEFORE ever attempting
 * geocoding, and `DeliveryPricingEngine.quote()` hits the `localZoneMatch.matched` branch at the
 * very top (before any destination-coordinate check) and returns LOCAL_FREE / fee=0 unconditionally.
 *
 * Net effect: an order whose real, previously-verified GPS location proved it was 42km away
 * (correctly OUT_OF_COVERAGE) can be walked to fee=0 / LOCAL_FREE / canCheckout=true by editing
 * ONLY the delivery reference text to zone-alias wording, sending NO coordinates at all. This
 * reopens exactly the "textual zone alias overrides trusted spatial data" fraud the
 * TRUSTED_SPATIAL_DATA > TEXTUAL_ZONE_ALIAS architecture is supposed to prevent — through a path
 * (RULE 3's own correct coordinate discard, combined with the zone-alias shortcut never
 * re-verifying) distinct from any axis-mixing bug.
 *
 * `assertDeliveryCheckoutAllowed` (orders.service.ts) does not re-verify anything against live
 * coordinates at checkout time — it trusts whatever pricing snapshot `resolveDeliverySnapshot`
 * already persisted, so this fraud completes cleanly through to a paid, fee-free delivery order.
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
// True original point: ~42km away, correctly OUT_OF_COVERAGE.
const TRUE_FAR_LATITUDE = 3.62;
const TRUE_FAR_LONGITUDE = -76.15;

function buildWeatherProvider(): WeatherProvider {
  const result: WeatherResult = {
    provider: 'mock-weather', isRaining: false, precipitationMm: 0, rainIntensity: 'NONE',
    confidence: 'HIGH', fetchedAt: new Date('2026-08-20T12:00:00.000Z'), warnings: [],
  };
  return { providerName: 'mock-weather', getCurrentWeather: jest.fn().mockResolvedValue(result) };
}

function buildRoutingProvider(): RoutingProvider {
  const getRoute = jest.fn(async (request: { destinationLatitude: number; destinationLongitude: number }) => {
    const isFar = Math.abs(request.destinationLatitude - TRUE_FAR_LATITUDE) < 1e-6 && Math.abs(request.destinationLongitude - TRUE_FAR_LONGITUDE) < 1e-6;
    const result: RouteResult = {
      provider: 'mock-route',
      distanceKm: isFar ? 42 : 2,
      durationMinutes: isFar ? 60 : 12,
      routeConfidence: 'HIGH',
      warnings: [],
    };
    return result;
  });
  return { providerName: 'mock-route', getRoute };
}

const auditPrisma = { deliveryPricingAudit: { create: jest.fn(async () => ({ id: 'audit-x' })) } };

describe('RED TEAM: reference-text change discards real coordinates, reopening LOCAL_FREE alias fraud', () => {
  jest.setTimeout(30000);
  let prisma: PrismaService;
  let service: OrdersService;
  let routingProvider: RoutingProvider;
  let geocodeCalls = 0;

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
      geocodingProvider: {
        providerName: 'mock-geocode',
        geocodeAddress: jest.fn(async () => {
          geocodeCalls += 1;
          throw new Error('geocoding should never be attempted for a bare zone-alias-only reference');
        }),
      } as never,
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

  function deriveCheckoutAuthorization(snapshot: {
    deliveryPricingStatus: string;
    deliveryRequiresManualQuote: boolean;
    deliveryFee: number;
  }) {
    // Mirrors `OrdersService.assertDeliveryCheckoutAllowed` (orders.service.ts) exactly: the
    // helper imported by the historical PoC (`deriveCheckoutAuthorizationFromOrderSnapshot` from
    // `delivery-checkout-authorization.ts`) does not exist on this branch/SHA, so the gate is
    // replicated here from the real private method's logic for an independent assertion.
    const canCheckout = snapshot.deliveryPricingStatus === 'LOCAL_FREE' || snapshot.deliveryPricingStatus === 'AUTO_PRICED';
    return {
      canCheckout:
        canCheckout &&
        !snapshot.deliveryRequiresManualQuote &&
        snapshot.deliveryFee != null &&
        Number.isFinite(snapshot.deliveryFee),
    };
  }

  it('lets a proven-far order become LOCAL_FREE (fee=0, canCheckout=true) by only editing reference text', async () => {
    const originalReference = 'Calle 45 #12-34, casa blanca, barrio industrial';
    const zoneAliasReference = 'condados casa azul'; // genuine content vocab -> matches strong alias "condados"

    const impl = service as unknown as {
      resolveDeliverySnapshot: (tx: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    // Turn 1: real GPS-verified order, ~42km away, correctly blocked.
    const first = await impl.resolveDeliverySnapshot(prisma, {
      customerName: 'Cliente Redteam RULE1/2',
      customerPhone: '573009998877',
      deliveryReference: originalReference,
      latitude: TRUE_FAR_LATITUDE,
      longitude: TRUE_FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    expect(first.deliveryPricingStatus).toBe('OUT_OF_COVERAGE');
    expect(Number(first.deliveryFee)).toBe(0);
    const firstAuth = deriveCheckoutAuthorization({
      deliveryPricingStatus: first.deliveryPricingStatus as string,
      deliveryRequiresManualQuote: first.deliveryRequiresManualQuote as boolean,
      deliveryFee: Number(first.deliveryFee),
    });
    expect(firstAuth.canCheckout).toBe(false); // correctly blocked so far

    // Turn 2: attacker edits ONLY the reference text to zone-alias wording, sends NO coordinates
    // at all (realistic: a plain PATCH { deliveryReference } from the POS edit form).
    const second = await impl.resolveDeliverySnapshot(prisma, {
      customerName: 'Cliente Redteam RULE1/2',
      customerPhone: '573009998877',
      deliveryReference: zoneAliasReference,
      latitude: undefined,
      longitude: undefined,
      existing: {
        deliveryLatitude: first.deliveryLatitude as never,
        deliveryLongitude: first.deliveryLongitude as never,
        deliveryAddressNormalized: first.deliveryAddressNormalized as string,
        deliveryDistanceKm: first.deliveryDistanceKm as never,
        deliveryPricingStatus: first.deliveryPricingStatus as string,
      },
    });

    // eslint-disable-next-line no-console
    console.log('SECOND RESULT', {
      latitude: second.deliveryLatitude,
      longitude: second.deliveryLongitude,
      status: second.deliveryPricingStatus,
      fee: String(second.deliveryFee),
      requiresManualQuote: second.deliveryRequiresManualQuote,
      geocodeCallsSoFar: geocodeCalls,
    });

    const secondAuth = deriveCheckoutAuthorization({
      deliveryPricingStatus: second.deliveryPricingStatus as string,
      deliveryRequiresManualQuote: second.deliveryRequiresManualQuote as boolean,
      deliveryFee: Number(second.deliveryFee),
    });

    // Coordinates are still correctly nulled (RULE 3's own discard, unrelated to this fix) and
    // geocoding is still never attempted for a bare zone-alias-only reference -- neither of those
    // is the bug. The fix closes what happens next: a bare zone-alias match that never triggered
    // geocoding must never upgrade an order away from its prior proven-non-free pricing status.
    // Before this fix, this exact scenario produced deliveryPricingStatus:'LOCAL_FREE',
    // deliveryFee:0, deliveryRequiresManualQuote:false, canCheckout:true -- a real 42km-away
    // order shipping free. Verified by reverting this file's fix via `git stash` (pathspec-
    // isolated) and re-running: identical fraud reproduced. See the commit message for the
    // full before/after evidence.
    expect(second.deliveryLatitude).toBeNull();
    expect(second.deliveryLongitude).toBeNull();
    expect(geocodeCalls).toBe(0);
    expect(second.deliveryPricingStatus).not.toBe('LOCAL_FREE');
    expect(second.deliveryRequiresManualQuote).toBe(true);
    expect(secondAuth.canCheckout).toBe(false);
  });

  it('REGRESSION GUARD: a genuine address change that successfully re-geocodes to a real near point still prices and checks out normally (fix must not block legitimate moves)', async () => {
    let legitGeocodeCalls = 0;
    const legitRouting = buildRoutingProvider();
    const legitExternalDataService = DeliveryExternalDataService.createForTesting({
      providersEnabled: true,
      origin,
      cache: new InMemoryExternalCache(),
      weatherProvider: buildWeatherProvider(),
      routingProvider: legitRouting,
      geocodingProvider: {
        providerName: 'mock-geocode-legit',
        geocodeAddress: jest.fn(async () => {
          legitGeocodeCalls += 1;
          return {
            provider: 'mock-geocode-legit',
            latitude: 3.27,
            longitude: -76.545,
            formattedAddress: 'Calle 10 #5-20, Barrio San Fernando',
            neighborhood: 'San Fernando',
            matchQuality: 'EXACT',
            confidence: 'HIGH',
            warnings: [],
          };
        }),
      } as never,
    });
    const legitPricingService = new DeliveryPricingService(legitExternalDataService, auditPrisma as never);
    const legitService = new OrdersService(
      prisma,
      { record: jest.fn(async () => ({ auditEventId: 'a2', timestamp: new Date().toISOString() })) } as never,
      {} as never,
      { emit: jest.fn() } as never,
      legitPricingService,
      {} as never,
      {} as never,
      {} as never,
    );
    const impl = legitService as unknown as {
      resolveDeliverySnapshot: (tx: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const first = await impl.resolveDeliverySnapshot(prisma, {
      customerName: 'Cliente Legitimo Mudanza',
      customerPhone: '573001230000',
      deliveryReference: 'Calle 45 #12-34, casa blanca, barrio industrial',
      latitude: TRUE_FAR_LATITUDE,
      longitude: TRUE_FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    expect(first.deliveryPricingStatus).toBe('OUT_OF_COVERAGE');

    // Customer genuinely moved: brand new, non-alias street address, no fresh GPS pin, but it
    // DOES successfully re-geocode to a real near point -- that is positive spatial evidence the
    // fix must accept.
    const second = await impl.resolveDeliverySnapshot(prisma, {
      customerName: 'Cliente Legitimo Mudanza',
      customerPhone: '573001230000',
      deliveryReference: 'Calle 10 #5-20, Barrio San Fernando',
      latitude: undefined,
      longitude: undefined,
      existing: {
        deliveryLatitude: first.deliveryLatitude as never,
        deliveryLongitude: first.deliveryLongitude as never,
        deliveryAddressNormalized: first.deliveryAddressNormalized as string,
        deliveryDistanceKm: first.deliveryDistanceKm as never,
        deliveryPricingStatus: first.deliveryPricingStatus as string,
      },
    });

    expect(legitGeocodeCalls).toBe(1); // real re-verification happened
    expect(second.deliveryPricingStatus).toBe('AUTO_PRICED');
    expect(Number(second.deliveryDistanceKm)).toBe(2);
    const secondAuth = deriveCheckoutAuthorization({
      deliveryPricingStatus: second.deliveryPricingStatus as string,
      deliveryRequiresManualQuote: second.deliveryRequiresManualQuote as boolean,
      deliveryFee: Number(second.deliveryFee),
    });
    expect(secondAuth.canCheckout).toBe(true); // legitimate move, properly re-verified, not blocked

    await prisma.deliveryCustomer.deleteMany({ where: { phone: '573001230000' } }).catch(() => undefined);
  });

  it('REGRESSION GUARD: a brand-new order (no prior snapshot) with zone-alias text still gets LOCAL_FREE directly (fix must not block first-time zone customers)', async () => {
    const impl = service as unknown as {
      resolveDeliverySnapshot: (tx: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const first = await impl.resolveDeliverySnapshot(prisma, {
      customerName: 'Cliente Nuevo Zona Gratis',
      customerPhone: '573001230001',
      deliveryReference: 'condados casa verde',
      latitude: undefined,
      longitude: undefined,
      existing: null,
    });

    expect(first.deliveryPricingStatus).toBe('LOCAL_FREE');
    expect(Number(first.deliveryFee)).toBe(0);
    const firstAuth = deriveCheckoutAuthorization({
      deliveryPricingStatus: first.deliveryPricingStatus as string,
      deliveryRequiresManualQuote: first.deliveryRequiresManualQuote as boolean,
      deliveryFee: Number(first.deliveryFee),
    });
    expect(firstAuth.canCheckout).toBe(true);

    await prisma.deliveryCustomer.deleteMany({ where: { phone: '573001230001' } }).catch(() => undefined);
  });

  it('REGRESSION GUARD: editing reference text on an order that was ALREADY LOCAL_FREE stays LOCAL_FREE (no prior non-free evidence to protect)', async () => {
    const impl = service as unknown as {
      resolveDeliverySnapshot: (tx: unknown, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const first = await impl.resolveDeliverySnapshot(prisma, {
      customerName: 'Cliente Zona Gratis Edita Texto',
      customerPhone: '573001230002',
      deliveryReference: 'condados casa verde',
      latitude: undefined,
      longitude: undefined,
      existing: null,
    });
    expect(first.deliveryPricingStatus).toBe('LOCAL_FREE');

    const second = await impl.resolveDeliverySnapshot(prisma, {
      customerName: 'Cliente Zona Gratis Edita Texto',
      customerPhone: '573001230002',
      deliveryReference: 'alborada casa roja',
      latitude: undefined,
      longitude: undefined,
      existing: {
        deliveryLatitude: first.deliveryLatitude as never,
        deliveryLongitude: first.deliveryLongitude as never,
        deliveryAddressNormalized: first.deliveryAddressNormalized as string,
        deliveryDistanceKm: first.deliveryDistanceKm as never,
        deliveryPricingStatus: first.deliveryPricingStatus as string,
      },
    });

    expect(second.deliveryPricingStatus).toBe('LOCAL_FREE');
    const secondAuth = deriveCheckoutAuthorization({
      deliveryPricingStatus: second.deliveryPricingStatus as string,
      deliveryRequiresManualQuote: second.deliveryRequiresManualQuote as boolean,
      deliveryFee: Number(second.deliveryFee),
    });
    expect(secondAuth.canCheckout).toBe(true);

    await prisma.deliveryCustomer.deleteMany({ where: { phone: '573001230002' } }).catch(() => undefined);
  });
});
