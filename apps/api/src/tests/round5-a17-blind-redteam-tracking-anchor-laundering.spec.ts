/**
 * SOFIA Round 5 / A17 — blind independent red team finding (fresh audit of
 * feat/sofia-remediation-address-round5-16-drift-fix, no prior context beyond this repo's code).
 *
 * SCOPE: this is a THIRD angle on the same theme A13/A14 and A15/A16 closed (invariant #12 in the
 * mission brief explicitly asks for it) — but it is a genuinely different mechanism from both:
 *   - A13/A14 was about SOFIA's `isQuoteBoundToCurrentDestination` never re-checking coordinate
 *     evidence for a RULE-3 coordinate-only refinement.
 *   - A15/A16 was about the legacy POS logistics-only tracking path comparing new GPS pings against
 *     a WALKING reference (the last-applied ping) instead of the FIXED priced anchor, letting many
 *     sub-threshold hops cumulatively drift the destination undetected.
 *   - THIS finding (A17) is about what happens AFTER A16's fix correctly flips
 *     `deliveryRequiresManualQuote = true` for a drifted destination: an entirely UNRELATED,
 *     non-address `OrdersService.update()` call (e.g. editing `notes`, adding a napkin request —
 *     anything that does not touch `deliveryReference`/`deliveryLatitude`/`deliveryLongitude` in the
 *     DTO at all) SILENTLY:
 *       (a) promotes the courier-tracking-only coordinates (`deliveryLatitude`/`deliveryLongitude`,
 *           written exclusively by the "logistics only, pricing preserved by design" tracking path)
 *           into commercial pricing authority, and
 *       (b) clears `deliveryRequiresManualQuote` back to `false`, undoing the exact protection A16
 *           just installed — WITHOUT the customer or staff ever actually confirming/re-typing the new
 *           address, and WITHOUT any human ever intending to change the destination at all.
 *
 * ROOT CAUSE:
 *
 * `OrdersService.update()` ALWAYS calls `resolveDeliverySnapshot()` for a DELIVERY-type order,
 * regardless of what the caller's DTO actually touches (see `orders.service.ts` around line 1975:
 * `nextType === OrderTicketType.DELIVERY ? await this.resolveDeliverySnapshot(tx, {...}) : null` —
 * unconditional on DTO content). Inside `resolveDeliverySnapshot`, when the DTO does not resupply
 * `deliveryLatitude`/`deliveryLongitude`, the function reconstructs `previousSnapshot` from
 * `input.existing` (== `current`, the row AS IT STANDS RIGHT NOW in the database) via
 * `fromOrderTicketDeliveryColumns()` (`destination-state.persistence.ts`). That reconstruction maps
 * `deliveryLocationSource === 'whatsapp_live_location'` to `coordinateSource: 'GPS_SHARE'`, which is
 * a `HIGH_TRUST_SOURCES` entry — reconstructing `coordinateTrust: 'TRUSTED'`
 * (`destination-state.persistence.ts` line ~132). Crucially, `applyDeliveryLocationForLogisticsOnlyInTransaction`
 * (the courier-tracking path) writes EXACTLY that same `deliveryLocationSource: 'whatsapp_live_location'`
 * marker on every tracking ping (`orders.service.ts` line ~4032) — there is NO way, at the persistence
 * layer, to distinguish "a customer shared GPS to CONFIRM their delivery address" from "a courier's
 * live-location breadcrumb, explicitly documented as logistics-only and never meant to reprice
 * anything" (see the tracking path's own docstring: "this 'logistics only' path... by design must NOT
 * silently change a fee/total the customer already agreed to or paid for"). Both produce a
 * `TRUSTED`/`GPS_SHARE` reconstructed snapshot indistinguishable from a genuine address-confirmation
 * event.
 *
 * When the incoming `update()` DTO does not change the address text either (identical
 * `deliveryReference`, or omitted so `update()` resupplies `current.deliveryReference` unchanged —
 * see `orders.service.ts` line 1980-1981), `classifyRawReferenceChange` returns `NON_SPATIAL`
 * (`TEXT_UNCHANGED`), so `applyDestinationEdit`'s RULE 3 branch fires: "carry forward unchanged,
 * still bound to the SAME revision" — but what it carries forward is the (possibly courier-drifted)
 * `TRUSTED` pair from the CURRENT row, not the pair the order's price was originally computed
 * against. `resolveDeliverySnapshot` then feeds that pair straight into
 * `deliveryPricingService.estimate()`, producing a brand-new price AND a brand-new
 * `DeliveryPricingAudit` row anchored at the tracking-drifted point — which becomes the new "priced
 * anchor" `OrdersService.resolvePricedAnchorCoordinates` (the A16 fix) will recover from then on. The
 * VERY mechanism A16 built to detect drift (comparing against the last REAL repricing pass's anchor)
 * is exactly what an attacker can walk forward one "innocuous edit" at a time.
 *
 * CONSEQUENCE: an attacker (or a compromised/spoofed WhatsApp sender matched to the order — the
 * courier-tracking ingestion path in `captureDeliveryLocationFromWhatsapp` only requires phone-number
 * correlation, see `resolveDeliveryLocationMatch`) can:
 *   1. Drift an order's destination via ordinary live-location tracking pings (A16 correctly flips
 *      `deliveryRequiresManualQuote = true` once cumulative drift exceeds the material threshold —
 *      checkout is genuinely blocked at this point).
 *   2. Wait for (or socially engineer) ANY completely unrelated staff edit to the order — changing
 *      `notes`, adding/removing an item, anything that does not touch the address fields — and the
 *      manual-quote block SILENTLY clears itself, re-pricing the order for the drifted point as if it
 *      were a freshly confirmed address.
 *   3. Repeat indefinitely: each "innocuous edit" both launders the current drift into a new trusted
 *      anchor AND clears the safety flag, letting the destination walk arbitrarily far while never
 *      requiring a human to actually look at, type, or confirm a new delivery address.
 *
 * This violates invariants #4 (editing a NON-address field must never cause trusted-coordinate state
 * to reopen a cheaper/different pricing path), #5 (a quote/price must not survive materially better
 * evidence arriving — here the "materially different" gate is defeated by silent anchor-reset, not
 * bypassed by never firing), #11 (a confirmed price must correspond to destination evidence ACTUALLY
 * validated as address evidence, not courier telemetry), and is exactly the "resetting an anchor by
 * triggering a cheap re-price then drifting again from the new anchor" attack class invariant #12
 * explicitly calls out — except the "cheap re-price" trigger here is not itself a location edit at
 * all, it is ANY unrelated field edit, which is a strictly larger and more dangerous attack surface
 * than a deliberately-crafted repricing call.
 *
 * Real Postgres (isolated test database), real unmocked `OrdersService` + `DeliveryPricingService`
 * (real audit persistence via `PrismaService`, exactly as `delivery.module.ts` wires it in
 * production) + `DeliveryExternalDataService` + `DeliveryLocationPolicy` +
 * `deriveCheckoutAuthorizationFromOrderSnapshot`. Only the routing/weather HTTP providers are
 * doubled (third-party APIs, not the system under test) — the routing double computes REAL haversine
 * distance from the configured origin, exactly like the A15/A16 test harness this file reuses.
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
  throw new Error('A17 requires an isolated _test database.');
}

// Restaurant origin — matches the A15/A16 fixture style (arbitrary real-world-shaped coordinate,
// not tied to any real address).
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

// Honest routing double — computes REAL haversine distance from ORIGIN to whatever destination is
// requested, exactly like the A15/A16 harness. Not a two-magic-constants stub.
function buildHonestRoutingProvider(): RoutingProvider {
  const getRoute = jest.fn(async (request: { destinationLatitude: number; destinationLongitude: number }) => {
    const distanceKm = haversineKm(ORIGIN.latitude, ORIGIN.longitude, request.destinationLatitude, request.destinationLongitude);
    const result: RouteResult = {
      provider: 'mock-route-honest',
      distanceKm,
      durationMinutes: distanceKm * 3,
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

describe('A17 Round 5 (blind) — unrelated non-address order edit launders courier-tracking drift into commercial pricing authority', () => {
  jest.setTimeout(60000);
  let prisma: PrismaService;
  let service: OrdersService;
  let adminUserId: string;
  let cashSessionId: string;
  const admin = { sub: '', email: 'a17-admin@2x1burgerco.local', fullName: 'A17 Admin', sessionVersion: 1, roles: ['admin'], permissions: ['orders.update'] };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const externalDataService = DeliveryExternalDataService.createForTesting({
      providersEnabled: true, origin: ORIGIN, cache: new InMemoryExternalCache(),
      weatherProvider: buildWeatherProvider(), routingProvider: buildHonestRoutingProvider(),
    });
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
      where: { customerPhone: { startsWith: '57301177' } },
      select: { id: true },
    }).catch(() => [] as { id: string }[]);
    await prisma.deliveryPricingAudit.deleteMany({
      where: { orderTicketId: { in: testOrders.map((order) => order.id) } },
    }).catch(() => undefined);
    await prisma.orderTicket.deleteMany({ where: { customerPhone: { startsWith: '57301177' } } }).catch(() => undefined);
    await prisma.deliveryCustomer.deleteMany({ where: { phone: { startsWith: '57301177' } } }).catch(() => undefined);
    await prisma.deliveryLocationInbox.deleteMany({ where: { sourceEventKey: { startsWith: 'a17-launder-' } } }).catch(() => undefined);
    await prisma.cashSession.deleteMany({ where: { id: cashSessionId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: admin.email } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('an unrelated notes-only update() call silently re-anchors and re-prices a courier-drifted destination, clearing deliveryRequiresManualQuote without any address confirmation', async () => {
    const phone = '573011770001';

    // 1. Real order creation ~500m from origin: AUTO_PRICED, cheap, in-coverage, base-fare-only zone.
    const startOffsetDeg = 0.5 / 111.32;
    const startLatitude = ORIGIN.latitude + startOffsetDeg;
    const startLongitude = ORIGIN.longitude;
    expect(haversineKm(ORIGIN.latitude, ORIGIN.longitude, startLatitude, startLongitude)).toBeLessThan(1.5);

    const originalReference = 'Calle 10 #5-20, apto 301';
    const created = await service.create(
      {
        type: 'DELIVERY' as never,
        customerName: 'Cliente A17',
        customerPhone: phone,
        deliveryReference: originalReference,
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
    expect(Number(baseline.deliveryFee)).toBe(5000); // base fare only, within includedKm=1.5
    const originalFee = Number(baseline.deliveryFee);
    const originalCalculationVersionAuditCount = await prisma.deliveryPricingAudit.count({ where: { orderTicketId: created.id } });
    expect(originalCalculationVersionAuditCount).toBe(1); // exactly the creation-time audit row (the true anchor)

    // 2. Walk the destination away via ordinary courier live-location tracking pings — same
    // sub-threshold-hop technique A15 used, now correctly caught by the A16 fixed-anchor gate. Total
    // cumulative drift: ~15 hops * ~139m = ~2.09km, landing the destination ~2.6km from origin —
    // past includedKm (1.5km, so a genuine re-price would cost MORE) but still comfortably inside
    // maxAutoDistanceKm (8km, so a genuine re-price would still be AUTO_PRICED, not blocked outright)
    // — i.e. exactly the "still plausible, not obviously catastrophic" drift an attacker would choose
    // to stay under the radar.
    const stepDeg = 0.00125; // ~139.15m per step
    const steps = 15;
    let currentLatitude = startLatitude;
    const currentLongitude = startLongitude;

    for (let i = 0; i < steps; i += 1) {
      const nextLatitude = currentLatitude + stepDeg;
      const hopKm = haversineKm(currentLatitude, currentLongitude, nextLatitude, currentLongitude);
      expect(hopKm).toBeLessThan(0.15);

      const result = await service.captureDeliveryLocationFromWhatsapp({
        sourceEventKey: `a17-launder-${created.id}-${i}`,
        senderPhoneCandidates: [phone],
        latitude: nextLatitude,
        longitude: currentLongitude,
        actorId: adminUserId,
      });
      expect(result.matchedRule).not.toBe('coordinate_conflict');
      expect(result.order).not.toBeNull();
      currentLatitude = nextLatitude;
    }

    const driftedDistanceFromOriginKm = haversineKm(ORIGIN.latitude, ORIGIN.longitude, currentLatitude, currentLongitude);
    expect(driftedDistanceFromOriginKm).toBeGreaterThan(1.5); // past includedKm
    expect(driftedDistanceFromOriginKm).toBeLessThan(8); // still inside maxAutoDistanceKm if honestly re-priced

    const afterWalk = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(Number(afterWalk.deliveryLatitude)).toBeCloseTo(currentLatitude, 5);
    expect(Number(afterWalk.deliveryLongitude)).toBeCloseTo(currentLongitude, 5);
    expect(
      isCoordinateEvidenceMateriallyDifferent(startLatitude, startLongitude, currentLatitude, currentLongitude),
    ).toBe(true);

    // A16's fixed-anchor protection correctly engaged: checkout is genuinely blocked here, at the
    // stale (pre-drift) fee, exactly as intended.
    expect(afterWalk.deliveryRequiresManualQuote).toBe(true);
    expect(Number(afterWalk.deliveryFee)).toBe(originalFee);
    const authorizationBeforeReset = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: afterWalk.deliveryPricingStatus,
      deliveryRequiresManualQuote: afterWalk.deliveryRequiresManualQuote,
      deliveryFee: Number(afterWalk.deliveryFee),
      hasCalculationSnapshot: Boolean(afterWalk.deliveryCalculationVersion?.trim()) && afterWalk.deliveryPricingBreakdown != null,
    });
    expect(authorizationBeforeReset.canCheckout).toBe(false);

    // THE ADDRESS TEXT NEVER CHANGED — the customer never re-stated or confirmed a new address at
    // any point in this test so far. Only courier-tracking telemetry moved.
    expect(afterWalk.deliveryReference).toBe(originalReference);

    // 3. THE ATTACK: an entirely unrelated staff edit — notes only, no address/coordinate fields
    // anywhere in the DTO. Any ordinary "add extra napkins" / "sin cebolla" kitchen-note edit looks
    // exactly like this from the caller's side.
    await service.update(
      created.id,
      { notes: 'Extra salsa, sin cebolla' } as never,
      admin as never,
    );

    const afterLaunder = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });

    // (a) The address text is STILL byte-for-byte unchanged — no human ever edited or re-confirmed
    // it. Yet:
    expect(afterLaunder.deliveryReference).toBe(originalReference);

    // (b) deliveryRequiresManualQuote — the ONLY thing standing between the drifted destination and
    // checkout — has been SILENTLY cleared, with zero address confirmation.
    expect(afterLaunder.deliveryRequiresManualQuote).toBe(false);

    // (c) The persisted price actually CHANGED to reflect the tracking-only coordinates — proving a
    // real repricing pass ran, fed by courier telemetry the tracking path's own docstring says must
    // "NOT silently change a fee/total the customer already agreed to or paid for".
    expect(afterLaunder.deliveryPricingStatus).toBe('AUTO_PRICED');
    expect(Number(afterLaunder.deliveryFee)).not.toBe(originalFee);
    expect(Number(afterLaunder.deliveryFee)).toBeGreaterThan(originalFee);

    // (d) The coordinates that got silently promoted to "priced anchor" are exactly the
    // courier-tracking-drifted point, not the originally-confirmed one.
    const latestAudit = await prisma.deliveryPricingAudit.findFirst({
      where: { orderTicketId: created.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(latestAudit).not.toBeNull();
    const latestRequest = latestAudit!.requestJson as { latitude?: number; longitude?: number };
    expect(latestRequest.latitude).toBeCloseTo(currentLatitude, 5);
    expect(latestRequest.longitude).toBeCloseTo(currentLongitude, 5);
    // Sanity: this new anchor really is far from the ORIGINAL priced point — this is not a benign
    // same-spot re-price, it is the drifted point becoming authoritative.
    expect(
      isCoordinateEvidenceMateriallyDifferent(startLatitude, startLongitude, latestRequest.latitude ?? null, latestRequest.longitude ?? null),
    ).toBe(true);

    // (e) THE FINANCIAL/OPERATIONAL PROOF: the canonical, single-authority checkout gate now
    // authorizes checkout — at a price computed from courier telemetry that was never presented to
    // anyone as "this is the new delivery address", after a notes-only edit that nobody would expect
    // to touch delivery pricing at all.
    const authorizationAfterLaunder = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: afterLaunder.deliveryPricingStatus,
      deliveryRequiresManualQuote: afterLaunder.deliveryRequiresManualQuote,
      deliveryFee: Number(afterLaunder.deliveryFee),
      hasCalculationSnapshot: Boolean(afterLaunder.deliveryCalculationVersion?.trim()) && afterLaunder.deliveryPricingBreakdown != null,
    });
    expect(authorizationAfterLaunder.canCheckout).toBe(true);
    expect(() => (service as unknown as { assertDeliveryCheckoutAllowed: (o: unknown) => void }).assertDeliveryCheckoutAllowed(afterLaunder)).not.toThrow();

    // 4. THE REPEATABILITY PROOF: the newly-laundered anchor (the drifted point) can now be walked
    // AGAIN via more tracking pings, and reset AGAIN via another unrelated edit — demonstrating this
    // is not a one-off quirk but a repeatable mechanism for walking a destination arbitrarily far
    // using only (tracking ping)* + (unrelated edit) cycles, never a genuine address change.
    const secondStartLatitude = currentLatitude;
    const secondStartLongitude = currentLongitude;
    for (let i = 0; i < steps; i += 1) {
      const nextLatitude = currentLatitude + stepDeg;
      await service.captureDeliveryLocationFromWhatsapp({
        sourceEventKey: `a17-launder-round2-${created.id}-${i}`,
        senderPhoneCandidates: [phone],
        latitude: nextLatitude,
        longitude: currentLongitude,
        actorId: adminUserId,
      });
      currentLatitude = nextLatitude;
    }
    const afterSecondWalk = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterSecondWalk.deliveryRequiresManualQuote).toBe(true); // A16 gate re-engages against the NEW (laundered) anchor
    expect(
      isCoordinateEvidenceMateriallyDifferent(secondStartLatitude, secondStartLongitude, currentLatitude, currentLongitude),
    ).toBe(true);

    await service.update(created.id, { notes: 'Sin tomate esta vez' } as never, admin as never);
    const afterSecondLaunder = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterSecondLaunder.deliveryRequiresManualQuote).toBe(false); // cleared again, still zero address confirmations ever
    expect(afterSecondLaunder.deliveryReference).toBe(originalReference);
    const totalDriftFromOriginalAnchorKm = haversineKm(startLatitude, startLongitude, currentLatitude, currentLongitude);
    expect(totalDriftFromOriginalAnchorKm).toBeGreaterThan(4); // walked >4km from the ONLY ever address-confirmed point, at a computer-honest but never-human-confirmed price
    const authorizationAfterSecondLaunder = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: afterSecondLaunder.deliveryPricingStatus,
      deliveryRequiresManualQuote: afterSecondLaunder.deliveryRequiresManualQuote,
      deliveryFee: Number(afterSecondLaunder.deliveryFee),
      hasCalculationSnapshot: Boolean(afterSecondLaunder.deliveryCalculationVersion?.trim()) && afterSecondLaunder.deliveryPricingBreakdown != null,
    });
    expect(authorizationAfterSecondLaunder.canCheckout).toBe(true);
  });
});
