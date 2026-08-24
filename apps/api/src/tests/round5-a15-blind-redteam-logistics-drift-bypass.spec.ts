/**
 * SOFIA Round 5 / A15 — blind independent red team finding (fresh audit of
 * feat/sofia-remediation-address-round5-14-quote-binding-fix, no prior context).
 *
 * SCOPE OF THIS FILE: the legacy POS WhatsApp "logistics-only" live-location/courier-tracking path
 * — `OrdersService.captureDeliveryLocationFromWhatsapp()` ->
 * `applyDeliveryLocationForLogisticsOnlyInTransaction()` (orders.service.ts). This path is
 * DELIBERATELY excluded from A12's own concurrency/verification matrix (that file's header says it
 * only covers `OrdersService.update()` and SOFIA `CommercialCheckoutService.process()`) and is a
 * COMPLETELY DIFFERENT mechanism from the A13/A14 finding (which was about SOFIA's
 * `isQuoteBoundToCurrentDestination` / RULE 3 coordinate-only edits inside `destination-revision.ts`).
 * This is genuinely new ground.
 *
 * THE BUG (CRITICAL — violates invariants #5, #7, #10, #11 from the mission brief):
 *
 * `applyDeliveryLocationForLogisticsOnlyInTransaction` decides whether new GPS evidence is
 * "materially different" (and therefore must block checkout via `deliveryRequiresManualQuote`) by
 * comparing the INCOMING coordinate pair against ONLY the immediately-preceding *persisted*
 * `order.deliveryLatitude/deliveryLongitude` — i.e. the last live-location ping that was applied —
 * NEVER against the ORIGINAL coordinate pair the currently-active price (`deliveryFee`,
 * `deliveryPricingBreakdown`, `deliveryPricingStatus`) was actually computed for. The sibling guard
 * `OrdersService.deliveryLocationConflicts()` (the pre-transaction "requires manual review" check)
 * has the exact same one-hop-only comparison. Both reuse the same 150m jitter-tolerance threshold
 * `COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM` that `destination-revision.ts` (A14) documents as
 * "MUCH SMALLER than the smallest delivery-pricing zone granularity" specifically so a single hop
 * can never mask a zone/coverage change — but nothing stops a SEQUENCE of hops, each individually
 * under the threshold relative to the PREVIOUS hop, from cumulatively walking the destination an
 * arbitrary distance away from the point the price was actually computed for. This is exactly the
 * "boundary/threshold gaming" attack class called out in the mission brief.
 *
 * Consequence: a courier/customer device that reports its live location every ~100-150m of travel
 * (completely normal WhatsApp live-location update cadence — no adversarial timing required) can walk
 * an order's destination from a NEAR, cheap, in-coverage point (AUTO_PRICED, ~5000 COP) to a point
 * that is genuinely OUT_OF_COVERAGE (>8km away, `deliveryPricingConfig.maxAutoDistanceKm`) WITHOUT
 * `deliveryRequiresManualQuote` ever being set and WITHOUT `deliveryPricingStatus`/`deliveryFee`
 * ever being touched (this path is explicitly "pricing preserved" by design for legitimate courier
 * tracking). `assertDeliveryCheckoutAllowed()` — the canonical, single-authority checkout gate
 * (`deriveCheckoutAuthorizationFromOrderSnapshot`) — reads ONLY those three persisted columns, so it
 * authorizes checkout at the stale NEAR price for a destination that has silently drifted far outside
 * automated coverage. `OrdersService.checkout()` never re-quotes; it charges exactly
 * `current.deliveryFee`. No address text ever changes, no single GPS hop ever looks suspicious, and
 * no concurrency/race is required — this reproduces single-threaded, deterministically, every time.
 *
 * Real Postgres (isolated `a15_round5_test` database), real unmocked `OrdersService` +
 * `DeliveryPricingService` + `DeliveryExternalDataService` + `DeliveryLocationPolicy` +
 * `deriveCheckoutAuthorizationFromOrderSnapshot`. Only the routing/weather HTTP providers are
 * doubled (third-party APIs, not the system under test) — the routing double computes REAL haversine
 * distance from the configured origin so every intermediate hop in the walk is priced/evaluated
 * honestly, exactly like a real routing provider would.
 */

import { OrderTicketStatus, OrderTicketType } from '@prisma/client';
import { OrdersService } from '../modules/orders/orders.service';
import { DeliveryPricingService } from '../delivery/delivery-pricing/delivery-pricing.service';
import { DeliveryExternalDataService } from '../delivery/providers/delivery-external-data.service';
import { InMemoryExternalCache } from '../delivery/providers/in-memory-external-cache';
import { PrismaService } from '../prisma/prisma.service';
import { deriveCheckoutAuthorizationFromOrderSnapshot } from '../delivery/delivery-pricing/delivery-checkout-authorization';
import { isCoordinateEvidenceMateriallyDifferent } from '../delivery/destination-state/destination-revision';
import type { RouteResult, WeatherResult } from '../delivery/providers/provider-types';
import type { RoutingProvider } from '../delivery/providers/routing-provider.interface';
import type { WeatherProvider } from '../delivery/providers/weather-provider.interface';
import { Prisma } from '@prisma/client';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error('A15 requires an isolated _test database.');
}

// Restaurant origin (arbitrary real-world-shaped coordinate, matches the style of prior rounds'
// fixtures — not tied to any real address).
const ORIGIN = { latitude: 3.2601, longitude: -76.5405, label: '2X1 Burger Co', address: 'Local principal' };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildWeatherProvider(): WeatherProvider {
  const result: WeatherResult = {
    provider: 'mock-weather', isRaining: false, precipitationMm: 0, rainIntensity: 'NONE',
    confidence: 'HIGH', fetchedAt: new Date('2026-08-23T12:00:00.000Z'), warnings: [],
  };
  return { providerName: 'mock-weather', getCurrentWeather: jest.fn().mockResolvedValue(result) };
}

// Routing double computes a REAL haversine distance from ORIGIN to whatever destination is asked
// for — this is not a two-magic-constants stub, it honestly evaluates ANY point along the walk,
// exactly like a real routing provider would (just without an HTTP call).
function buildHonestRoutingProvider(): RoutingProvider {
  const getRoute = jest.fn(async (request: { destinationLatitude: number; destinationLongitude: number }) => {
    const distanceKm = haversineKm(ORIGIN.latitude, ORIGIN.longitude, request.destinationLatitude, request.destinationLongitude);
    const result: RouteResult = {
      provider: 'mock-route-honest',
      distanceKm,
      durationMinutes: distanceKm * 3, // well under maxAutoDurationMinutes=45 even at 10km — isolates the distance boundary
      routeConfidence: 'HIGH',
      warnings: [],
    };
    return result;
  });
  return { providerName: 'mock-route-honest', getRoute };
}

const auditPrisma = { deliveryPricingAudit: { create: jest.fn(async () => ({ id: `audit-${Math.random().toString(36).slice(2, 8)}` })) } };

function buildRealtimeStub() {
  return {
    publishOrderUpdated: jest.fn(),
    publishOperationalRefresh: jest.fn(),
    publishOperationalAlertUpdated: jest.fn(),
    publishDeliveryLocationPending: jest.fn(),
    publishDeliveryLocationReceived: jest.fn(),
    publishDeliveryWorkflowUpdated: jest.fn(),
    emit: jest.fn(),
  };
}

describe('A15 Round 5 (blind) — legacy POS logistics-only live-location drift bypasses coverage/price re-validation', () => {
  jest.setTimeout(60000);
  let prisma: PrismaService;
  let service: OrdersService;
  let adminUserId: string;
  let cashSessionId: string;
  const admin = { sub: '', email: 'a15-admin@2x1burgerco.local', fullName: 'A15 Admin', sessionVersion: 1, roles: ['admin'], permissions: ['orders.update'] };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const externalDataService = DeliveryExternalDataService.createForTesting({
      providersEnabled: true, origin: ORIGIN, cache: new InMemoryExternalCache(),
      weatherProvider: buildWeatherProvider(), routingProvider: buildHonestRoutingProvider(),
    });
    const pricingService = new DeliveryPricingService(externalDataService, auditPrisma as never);
    service = new OrdersService(
      prisma,
      { log: jest.fn(async () => undefined), record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      {} as never,
      buildRealtimeStub() as never,
      pricingService,
      {} as never,
      {} as never,
      {} as never,
    );

    let adminRow = await prisma.user.findFirst({ where: { email: admin.email } });
    if (!adminRow) {
      adminRow = await prisma.user.create({
        data: { email: admin.email, passwordHash: 'x', fullName: admin.fullName, isActive: true },
      });
    }
    adminUserId = adminRow.id;
    admin.sub = adminUserId;
    const session = await prisma.cashSession.create({ data: { status: 'OPEN', openedById: adminUserId, openingAmount: new Prisma.Decimal(0) } });
    cashSessionId = session.id;
  });

  afterAll(async () => {
    await prisma.orderTicket.deleteMany({ where: { customerPhone: { startsWith: '57301199' } } }).catch(() => undefined);
    await prisma.deliveryCustomer.deleteMany({ where: { phone: { startsWith: '57301199' } } }).catch(() => undefined);
    await prisma.deliveryLocationInbox.deleteMany({ where: { sourceEventKey: { startsWith: 'a15-drift-' } } }).catch(() => undefined);
    await prisma.cashSession.deleteMany({ where: { id: cashSessionId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: admin.email } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('walks an order from a cheap in-coverage address to a genuinely out-of-coverage point via sub-threshold GPS hops, with deliveryRequiresManualQuote NEVER set and the stale fee still checkout-authorized', async () => {
    const phone = '573011990001';

    // 1. Real order creation at a NEAR point (~500m from origin): AUTO_PRICED, cheap, in-coverage.
    const startOffsetDeg = 0.5 / 111.32; // ~500m north of origin
    const startLatitude = ORIGIN.latitude + startOffsetDeg;
    const startLongitude = ORIGIN.longitude;
    const startDistanceKm = haversineKm(ORIGIN.latitude, ORIGIN.longitude, startLatitude, startLongitude);
    expect(startDistanceKm).toBeLessThan(1.5); // inside includedKm -> base fare only, no distance charge

    const created = await service.create(
      {
        type: 'DELIVERY' as never,
        customerName: 'Cliente A15',
        customerPhone: phone,
        deliveryReference: 'Calle 10 #5-20, apto 301',
        deliveryLatitude: startLatitude,
        deliveryLongitude: startLongitude,
        deliveryLocationProvider: 'whatsapp_live_location',
        deliveryLocationConfidence: 'HIGH',
        items: [],
      } as never,
      admin as never,
    );

    const baseline = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(baseline.status).toBe(OrderTicketStatus.OPEN);
    expect(baseline.type).toBe(OrderTicketType.DELIVERY);
    expect(baseline.deliveryPricingStatus).toBe('AUTO_PRICED');
    expect(baseline.deliveryRequiresManualQuote).toBe(false);
    expect(Number(baseline.deliveryFee)).toBe(5000); // baseFare / minFare, no distance/time surcharge this close
    expect(baseline.deliveryCalculationVersion).toBeTruthy();
    expect(baseline.deliveryPricingBreakdown).not.toBeNull();
    const originalFee = Number(baseline.deliveryFee);
    const originalStatus = baseline.deliveryPricingStatus;

    // 2. Walk the destination away from the origin in ~139m hops (safely under the 150m
    // COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM jitter-tolerance threshold that BOTH
    // `deliveryLocationConflicts` (pre-transaction guard) and `applyDeliveryLocationForLogisticsOnlyInTransaction`
    // (`isCoordinateEvidenceMateriallyDifferent`) use) — each hop compared only to the PREVIOUS
    // persisted point, never to the point the current price was actually computed for.
    const stepDeg = 0.00125; // ~139.15m per step (0.00125 * 111.32 km/deg)
    const steps = 70; // cumulative ~9.74km of drift on top of the ~0.5km start offset
    let currentLatitude = startLatitude;
    const currentLongitude = startLongitude;

    for (let i = 0; i < steps; i += 1) {
      const nextLatitude = currentLatitude + stepDeg;
      const hopKm = haversineKm(currentLatitude, currentLongitude, nextLatitude, currentLongitude);
      expect(hopKm).toBeLessThan(0.15); // each individual hop is "not material" in isolation

      const result = await service.captureDeliveryLocationFromWhatsapp({
        sourceEventKey: `a15-drift-${created.id}-${i}`,
        senderPhoneCandidates: [phone],
        latitude: nextLatitude,
        longitude: currentLongitude,
        actorId: adminUserId,
      });

      // The pre-transaction `deliveryLocationConflicts` guard must never fire for an honest,
      // sub-threshold hop sequence — if it did, this whole attack would be defeated by design.
      expect(result.matchedRule).not.toBe('coordinate_conflict');
      expect(result.order).not.toBeNull();

      currentLatitude = nextLatitude;
    }

    const finalDistanceFromOriginKm = haversineKm(ORIGIN.latitude, ORIGIN.longitude, currentLatitude, currentLongitude);
    // Sanity: the cumulative walk genuinely moved the destination past the automated-coverage
    // boundary (maxAutoDistanceKm = 8km) — this is not a near-miss, it is unambiguously
    // OUT_OF_COVERAGE if honestly re-quoted for the CURRENT point.
    expect(finalDistanceFromOriginKm).toBeGreaterThan(8);

    const afterWalk = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(Number(afterWalk.deliveryLatitude)).toBeCloseTo(currentLatitude, 5);
    expect(Number(afterWalk.deliveryLongitude)).toBeCloseTo(currentLongitude, 5);

    // THE ACTUAL COORDINATE EVIDENCE MOVED FAR AWAY FROM WHAT THE PERSISTED PRICE WAS COMPUTED
    // FOR — proven using the canonical, real `isCoordinateEvidenceMateriallyDifferent` helper
    // (the SAME one `destination-revision.ts` / A14 uses for SOFIA's quote-binding check) comparing
    // the ORIGINAL priced-for point against the FINAL point, not hop-by-hop.
    expect(
      isCoordinateEvidenceMateriallyDifferent(startLatitude, startLongitude, currentLatitude, currentLongitude),
    ).toBe(true);

    // THE BUG: none of that materiality was ever detected, because every individual write only
    // ever compared against the immediately-preceding persisted point.
    expect(afterWalk.deliveryRequiresManualQuote).toBe(false);
    expect(afterWalk.deliveryPricingStatus).toBe(originalStatus); // still 'AUTO_PRICED', never re-evaluated
    expect(Number(afterWalk.deliveryFee)).toBe(originalFee); // still the cheap ~500m fee

    // THE FINANCIAL/OPERATIONAL PROOF: the SAME canonical, single-authority checkout gate that
    // `OrdersService.checkout()` calls (`assertDeliveryCheckoutAllowed` -> exactly this pure
    // function, reading exactly these persisted columns, per `delivery-checkout-authorization.ts`'s
    // own file header: "the ONE pure, deterministic function ... every checkout entrypoint must end
    // up calling it") says checkout IS authorized, at the stale cheap fee, for a destination that
    // is now >9.7km beyond the ~500m point the price was computed for.
    const authorization = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: afterWalk.deliveryPricingStatus,
      deliveryRequiresManualQuote: afterWalk.deliveryRequiresManualQuote,
      deliveryFee: Number(afterWalk.deliveryFee),
      hasCalculationSnapshot: Boolean(afterWalk.deliveryCalculationVersion?.trim()) && afterWalk.deliveryPricingBreakdown != null,
    });
    expect(authorization.canCheckout).toBe(true); // <-- should be false/blocked; this is the finding

    // Confirm the REAL private gate `OrdersService.checkout()` actually calls does not throw either
    // (exercising the exact method, not a reimplementation of its logic).
    expect(() => (service as unknown as { assertDeliveryCheckoutAllowed: (o: unknown) => void }).assertDeliveryCheckoutAllowed(afterWalk)).not.toThrow();

    // Contrast: if the FULL drift (start -> final) had arrived as a SINGLE GPS hop instead of 70
    // small ones, the existing A14 guard correctly catches it and blocks checkout — proving the
    // vulnerability is specifically the sub-threshold-hop decomposition, not a general absence of
    // any guard at all.
    const { order: singleHopOrder } = await createControlOrder(service, prisma, adminUserId, '573011990002');
    const singleHopResult = await service.captureDeliveryLocationFromWhatsapp({
      sourceEventKey: `a15-drift-control-${singleHopOrder.id}`,
      senderPhoneCandidates: ['573011990002'],
      latitude: currentLatitude,
      longitude: currentLongitude,
      actorId: adminUserId,
    });
    // A single large hop is correctly caught by `deliveryLocationConflicts` (REQUIRES_REVIEW) —
    // never silently applied. This is the exact protection the 70-step walk above defeats.
    expect(singleHopResult.matchedRule).toBe('coordinate_conflict');
    const controlAfter = await prisma.orderTicket.findUniqueOrThrow({ where: { id: singleHopOrder.id } });
    // Coordinates were NOT silently overwritten for the single-large-hop control case.
    expect(Number(controlAfter.deliveryLatitude)).toBeCloseTo(startLatitude, 5);
  });
});

async function createControlOrder(service: OrdersService, prisma: PrismaService, adminUserId: string, phone: string) {
  const admin = { sub: adminUserId, email: 'a15-admin@2x1burgerco.local', fullName: 'A15 Admin', sessionVersion: 1, roles: ['admin'], permissions: ['orders.update'] };
  const startOffsetDeg = 0.5 / 111.32;
  const order = await service.create(
    {
      type: 'DELIVERY' as never,
      customerName: 'Cliente A15 Control',
      customerPhone: phone,
      deliveryReference: 'Calle 10 #5-20, apto 302',
      deliveryLatitude: ORIGIN.latitude + startOffsetDeg,
      deliveryLongitude: ORIGIN.longitude,
      deliveryLocationProvider: 'whatsapp_live_location',
      deliveryLocationConfidence: 'HIGH',
      items: [],
    } as never,
    admin as never,
  );
  return { order };
}
