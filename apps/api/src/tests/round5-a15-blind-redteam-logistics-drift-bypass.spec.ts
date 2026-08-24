/**
 * SOFIA Round 5 / A15 — blind independent red team finding (fresh audit of
 * feat/sofia-remediation-address-round5-14-quote-binding-fix, no prior context).
 *
 * SOFIA Round 5 / A16 CLOSURE: this file was originally a red-team REPRODUCTION of the CRITICAL A15
 * finding (see git history for the pre-fix version). It is now converted into a PERMANENT regression
 * test of the FIXED behavior — same 70-hop sub-threshold drift walk, but now asserting it correctly
 * blocks checkout instead of silently succeeding. See `OrdersService.resolvePricedAnchorCoordinates`
 * (orders.service.ts) for the fix.
 *
 * SCOPE OF THIS FILE: the legacy POS WhatsApp "logistics-only" live-location/courier-tracking path
 * — `OrdersService.captureDeliveryLocationFromWhatsapp()` ->
 * `applyDeliveryLocationForLogisticsOnlyInTransaction()` (orders.service.ts). This path is
 * DELIBERATELY excluded from A12's own concurrency/verification matrix (that file's header says it
 * only covers `OrdersService.update()` and SOFIA `CommercialCheckoutService.process()`) and is a
 * COMPLETELY DIFFERENT mechanism from the A13/A14 finding (which was about SOFIA's
 * `isQuoteBoundToCurrentDestination` / RULE 3 coordinate-only edits inside `destination-revision.ts`).
 *
 * THE BUG (CRITICAL — violates invariants #5, #7, #10, #11 from the mission brief), NOW FIXED:
 *
 * `applyDeliveryLocationForLogisticsOnlyInTransaction` used to decide whether new GPS evidence is
 * "materially different" (and therefore must block checkout via `deliveryRequiresManualQuote`) by
 * comparing the INCOMING coordinate pair against ONLY the immediately-preceding *persisted*
 * `order.deliveryLatitude/deliveryLongitude` — i.e. the last live-location ping that was applied —
 * NEVER against the ORIGINAL coordinate pair the currently-active price (`deliveryFee`,
 * `deliveryPricingBreakdown`, `deliveryPricingStatus`) was actually computed for. The sibling guard
 * `OrdersService.deliveryLocationConflicts()` (the pre-transaction "requires manual review" check)
 * had the exact same one-hop-only comparison. Both reused the same 150m jitter-tolerance threshold
 * `COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM` that `destination-revision.ts` (A14) documents as
 * "MUCH SMALLER than the smallest delivery-pricing zone granularity" specifically so a single hop
 * can never mask a zone/coverage change — but nothing stopped a SEQUENCE of hops, each individually
 * under the threshold relative to the PREVIOUS hop, from cumulatively walking the destination an
 * arbitrary distance away from the point the price was actually computed for. This was exactly the
 * "boundary/threshold gaming" attack class called out in the mission brief.
 *
 * Consequence (PRE-FIX): a courier/customer device that reports its live location every ~100-150m of
 * travel (completely normal WhatsApp live-location update cadence — no adversarial timing required)
 * could walk an order's destination from a NEAR, cheap, in-coverage point (AUTO_PRICED, ~5000 COP) to
 * a point that is genuinely OUT_OF_COVERAGE (>8km away, `deliveryPricingConfig.maxAutoDistanceKm`)
 * WITHOUT `deliveryRequiresManualQuote` ever being set and WITHOUT `deliveryPricingStatus`/
 * `deliveryFee` ever being touched. `assertDeliveryCheckoutAllowed()` — the canonical, single-
 * authority checkout gate (`deriveCheckoutAuthorizationFromOrderSnapshot`) — reads ONLY those three
 * persisted columns, so it authorized checkout at the stale NEAR price for a destination that had
 * silently drifted far outside automated coverage.
 *
 * THE FIX (A16): both guards now anchor their materiality comparison to the coordinate pair recovered
 * from the last REAL repricing pass's linked `DeliveryPricingAudit` row (`resolvePricedAnchorCoordinates`)
 * — a FIXED reference logistics-only tracking pings can never move — instead of the WALKING
 * `deliveryLatitude`/`deliveryLongitude` columns those same pings overwrite on every call. Cumulative
 * drift of any size relative to that fixed anchor is now caught, even when every individual hop is
 * small relative to its immediate predecessor.
 *
 * Real Postgres (isolated test database), real unmocked `OrdersService` + `DeliveryPricingService`
 * (including its REAL audit persistence via `PrismaService` — required for the A16 fix's anchor
 * lookup to find anything, and faithful to how `delivery.module.ts` wires it in production) +
 * `DeliveryExternalDataService` + `DeliveryLocationPolicy` + `deriveCheckoutAuthorizationFromOrderSnapshot`.
 * Only the routing/weather HTTP providers are doubled (third-party APIs, not the system under test) —
 * the routing double computes REAL haversine distance from the configured origin so every
 * intermediate hop in the walk is priced/evaluated honestly, exactly like a real routing provider
 * would.
 */

import { BadRequestException } from '@nestjs/common';
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
    // SOFIA Round 5 / A16 CLOSURE: pass the REAL `PrismaService` for audit persistence, exactly as
    // `delivery.module.ts` wires it in production (not a mock double) — the A16 fix
    // (`resolvePricedAnchorCoordinates` in `orders.service.ts`) recovers the coordinate pair the
    // CURRENTLY active price was computed against from the real, linked `DeliveryPricingAudit` row
    // every genuine repricing pass writes, so this test must exercise that same real persistence path
    // to be a faithful regression test of the fixed production behavior.
    const pricingService = new DeliveryPricingService(externalDataService, prisma);
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
    const testOrders = await prisma.orderTicket.findMany({
      where: { customerPhone: { startsWith: '57301199' } },
      select: { id: true },
    }).catch(() => [] as { id: string }[]);
    await prisma.deliveryPricingAudit.deleteMany({
      where: { orderTicketId: { in: testOrders.map((order) => order.id) } },
    }).catch(() => undefined);
    await prisma.orderTicket.deleteMany({ where: { customerPhone: { startsWith: '57301199' } } }).catch(() => undefined);
    await prisma.deliveryCustomer.deleteMany({ where: { phone: { startsWith: '57301199' } } }).catch(() => undefined);
    await prisma.deliveryLocationInbox.deleteMany({ where: { sourceEventKey: { startsWith: 'a15-drift-' } } }).catch(() => undefined);
    await prisma.cashSession.deleteMany({ where: { id: cashSessionId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: admin.email } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[A16 FIXED] walks an order from a cheap in-coverage address toward a genuinely out-of-coverage point via sub-threshold GPS hops, and deliveryRequiresManualQuote now DOES flip true (checkout blocked at the stale fee) once cumulative drift from the priced anchor exceeds the material threshold', async () => {
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
    // COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM threshold relative to the PREVIOUS ping — the
    // pre-transaction `deliveryLocationConflicts` guard is DELIBERATELY still a walking-reference,
    // trajectory-anomaly check post-A16 (see its updated docstring in orders.service.ts for why), so
    // it never fires for this honest gradual sequence. What changed (A16) is
    // `applyDeliveryLocationForLogisticsOnlyInTransaction`'s pricing-safety comparison: it now
    // compares every hop against the FIXED priced anchor (`resolvePricedAnchorCoordinates`), not the
    // walking `deliveryLatitude`/`deliveryLongitude` columns — so cumulative drift is caught even
    // though no individual hop ever looks suspicious to the (intentionally unchanged) conflict guard.
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

    // [A16 FIXED] The materiality of that drift IS now detected, because
    // `applyDeliveryLocationForLogisticsOnlyInTransaction` compares every incoming ping against the
    // FIXED coordinate pair recovered from this order's linked `DeliveryPricingAudit` row (the exact
    // point `service.create()` priced against) via `resolvePricedAnchorCoordinates` — never against
    // the walking `deliveryLatitude`/`deliveryLongitude` columns those same pings overwrite. Once
    // cumulative drift from that anchor first exceeds `COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM`
    // (well before hop 70), `deliveryRequiresManualQuote` flips true and stays true for the rest of
    // the walk (the anchor never moves, and the destination only gets farther away from it).
    expect(afterWalk.deliveryRequiresManualQuote).toBe(true);
    expect(afterWalk.deliveryPricingStatus).toBe(originalStatus); // still 'AUTO_PRICED' — this path never silently reprices
    expect(Number(afterWalk.deliveryFee)).toBe(originalFee); // fee itself is untouched; the MANUAL QUOTE gate is what blocks checkout now

    // THE FINANCIAL/OPERATIONAL PROOF (FIXED): the SAME canonical, single-authority checkout gate
    // that `OrdersService.checkout()` calls (`assertDeliveryCheckoutAllowed` -> exactly this pure
    // function, reading exactly these persisted columns, per `delivery-checkout-authorization.ts`'s
    // own file header: "the ONE pure, deterministic function ... every checkout entrypoint must end
    // up calling it") now correctly REFUSES to authorize checkout at the stale cheap fee for a
    // destination that is >9.7km beyond the ~500m point the price was actually computed for.
    const authorization = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: afterWalk.deliveryPricingStatus,
      deliveryRequiresManualQuote: afterWalk.deliveryRequiresManualQuote,
      deliveryFee: Number(afterWalk.deliveryFee),
      hasCalculationSnapshot: Boolean(afterWalk.deliveryCalculationVersion?.trim()) && afterWalk.deliveryPricingBreakdown != null,
    });
    expect(authorization.canCheckout).toBe(false);

    // Confirm the REAL private gate `OrdersService.checkout()` actually calls (`assertDeliveryCheckoutAllowed`,
    // called from `checkout()` immediately after the item/session checks — see orders.service.ts)
    // now throws too, exercising the exact method rather than a reimplementation of its logic.
    // Checkout is genuinely blocked, not just the pure-function projection of the snapshot.
    expect(() => (service as unknown as { assertDeliveryCheckoutAllowed: (o: unknown) => void }).assertDeliveryCheckoutAllowed(afterWalk)).toThrow(BadRequestException);

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

  // SOFIA Round 5 / A16 — anti-regression for the fix above: ordinary short-range courier/customer
  // GPS tracking that stays WITHIN the material-difference radius of the priced anchor (e.g. a rider
  // circling the block, or GPS noise while parked near the destination) must NOT spuriously trip
  // `deliveryRequiresManualQuote`. The A16 fix is specifically about DRIFT AWAY FROM the anchor
  // accumulating past threshold — not about rejecting all movement. Eight pings walk a small circle
  // of radius ~80m (well under the 150m `COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM`) around the SAME
  // priced anchor, in alternating directions (never monotonically drifting away) — an over-tightened
  // fix (e.g. one that flagged ANY movement, or accumulated radial distance instead of true distance
  // from the fixed anchor) would fail this.
  it('[A16 anti-regression] ordinary small-radius live-location tracking near the priced point never triggers deliveryRequiresManualQuote', async () => {
    const phone = '573011990003';
    const startOffsetDeg = 0.5 / 111.32;
    const anchorLatitude = ORIGIN.latitude + startOffsetDeg;
    const anchorLongitude = ORIGIN.longitude;

    const created = await service.create(
      {
        type: 'DELIVERY' as never,
        customerName: 'Cliente A16 Jitter',
        customerPhone: phone,
        deliveryReference: 'Calle 10 #5-20, apto 303',
        deliveryLatitude: anchorLatitude,
        deliveryLongitude: anchorLongitude,
        deliveryLocationProvider: 'whatsapp_live_location',
        deliveryLocationConfidence: 'HIGH',
        items: [],
      } as never,
      admin as never,
    );

    const baseline = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(baseline.deliveryPricingStatus).toBe('AUTO_PRICED');
    expect(baseline.deliveryRequiresManualQuote).toBe(false);
    const originalFee = Number(baseline.deliveryFee);

    const radiusKm = 0.08; // 80m — comfortably under the 150m material-difference threshold
    const anchorLatRad = (anchorLatitude * Math.PI) / 180;
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];

    for (const [i, angleDeg] of angles.entries()) {
      const angleRad = (angleDeg * Math.PI) / 180;
      const dLatKm = radiusKm * Math.cos(angleRad);
      const dLngKm = radiusKm * Math.sin(angleRad);
      const pointLatitude = anchorLatitude + dLatKm / 111.32;
      const pointLongitude = anchorLongitude + dLngKm / (111.32 * Math.cos(anchorLatRad));

      // Sanity: this ping is genuinely within the jitter-tolerance radius of the FIXED anchor, not
      // just under threshold relative to whatever the previous ping happened to be.
      expect(haversineKm(anchorLatitude, anchorLongitude, pointLatitude, pointLongitude)).toBeLessThan(0.15);

      const result = await service.captureDeliveryLocationFromWhatsapp({
        sourceEventKey: `a16-jitter-${created.id}-${i}`,
        senderPhoneCandidates: [phone],
        latitude: pointLatitude,
        longitude: pointLongitude,
        actorId: adminUserId,
      });
      expect(result.matchedRule).not.toBe('coordinate_conflict');
      expect(result.order).not.toBeNull();
    }

    const afterJitter = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterJitter.deliveryRequiresManualQuote).toBe(false);
    expect(afterJitter.deliveryPricingStatus).toBe('AUTO_PRICED');
    expect(Number(afterJitter.deliveryFee)).toBe(originalFee);

    const authorization = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: afterJitter.deliveryPricingStatus,
      deliveryRequiresManualQuote: afterJitter.deliveryRequiresManualQuote,
      deliveryFee: Number(afterJitter.deliveryFee),
      hasCalculationSnapshot: Boolean(afterJitter.deliveryCalculationVersion?.trim()) && afterJitter.deliveryPricingBreakdown != null,
    });
    expect(authorization.canCheckout).toBe(true);
    expect(() => (service as unknown as { assertDeliveryCheckoutAllowed: (o: unknown) => void }).assertDeliveryCheckoutAllowed(afterJitter)).not.toThrow();
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
