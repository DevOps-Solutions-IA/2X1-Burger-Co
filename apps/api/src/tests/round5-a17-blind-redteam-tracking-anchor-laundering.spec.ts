/**
 * SOFIA Round 5 / A17 -> A18 — PERMANENT regression test.
 *
 * ORIGINAL FINDING (A17, blind independent red team, fresh audit of
 * feat/sofia-remediation-address-round5-16-drift-fix, no prior context beyond this repo's code):
 *
 * SCOPE: this is a THIRD angle on the same theme A13/A14 and A15/A16 closed (invariant #12 in the
 * mission brief explicitly asks for it) — but it is a genuinely different mechanism from both:
 *   - A13/A14 was about SOFIA's `isQuoteBoundToCurrentDestination` never re-checking coordinate
 *     evidence for a RULE-3 coordinate-only refinement.
 *   - A15/A16 was about the legacy POS logistics-only tracking path comparing new GPS pings against
 *     a WALKING reference (the last-applied ping) instead of the FIXED priced anchor, letting many
 *     sub-threshold hops cumulatively drift the destination undetected.
 *   - A17 was about what happens AFTER A16's fix correctly flips `deliveryRequiresManualQuote =
 *     true` for a drifted destination: an entirely UNRELATED, non-address `OrdersService.update()`
 *     call (e.g. editing `notes`, adding a napkin request — anything that does not touch
 *     `deliveryReference`/`deliveryLatitude`/`deliveryLongitude` in the DTO at all) SILENTLY:
 *       (a) promoted the courier-tracking-only coordinates (`deliveryLatitude`/`deliveryLongitude`,
 *           written exclusively by the "logistics only, pricing preserved by design" tracking path)
 *           into commercial pricing authority, and
 *       (b) cleared `deliveryRequiresManualQuote` back to `false`, undoing the exact protection A16
 *           just installed — WITHOUT the customer or staff ever actually confirming/re-typing the
 *           new address, and WITHOUT any human ever intending to change the destination at all.
 *
 * ROOT CAUSE (A17):
 *
 * `OrdersService.update()` used to ALWAYS call `resolveDeliverySnapshot()` for a DELIVERY-type
 * order, regardless of what the caller's DTO actually touched. Inside `resolveDeliverySnapshot`,
 * when the DTO did not resupply `deliveryLatitude`/`deliveryLongitude`, the function reconstructed
 * `previousSnapshot` from `input.existing` (== `current`, the row AS IT STOOD RIGHT NOW in the
 * database) via `fromOrderTicketDeliveryColumns()`. That reconstruction maps
 * `deliveryLocationSource === 'whatsapp_live_location'` to `coordinateSource: 'GPS_SHARE'`, a
 * `HIGH_TRUST_SOURCES` entry — reconstructing `coordinateTrust: 'TRUSTED'`. Crucially,
 * `applyDeliveryLocationForLogisticsOnlyInTransaction` (the courier-tracking path) writes EXACTLY
 * that same `deliveryLocationSource: 'whatsapp_live_location'` marker on every tracking ping —
 * there was NO way, at the persistence layer, to distinguish "a customer shared GPS to CONFIRM
 * their delivery address" from "a courier's live-location breadcrumb, explicitly documented as
 * logistics-only and never meant to reprice anything". An unrelated edit (identical/omitted
 * `deliveryReference`) fed that reconstructed pair straight into `deliveryPricingService.estimate()`
 * producing a brand-new price AND a brand-new `DeliveryPricingAudit` row anchored at the
 * tracking-drifted point — becoming the new "priced anchor" for A16's drift check, letting an
 * attacker walk the destination arbitrarily far via (tracking-drift -> unrelated-edit) cycles,
 * never a genuine address change.
 *
 * FIX (A18): `OrdersService.update()` now only invokes `resolveDeliverySnapshot()`'s
 * destination-edit/re-pricing branch when THIS call's DTO carries genuine, explicit
 * address-confirming input (`deliveryReference !== undefined`, or `deliveryLatitude !== undefined`,
 * or `deliveryLongitude !== undefined` — see `hasAddressRelevantInput` in `orders.service.ts`'s
 * `update()`). Any other edit (notes-only, item-only, status-only, etc.) now carries the existing
 * delivery* columns forward VERBATIM via the new `carryForwardDeliverySnapshot()` helper — no
 * re-derivation, no re-pricing, no new `DeliveryPricingAudit` row, no flag reset. Genuine address
 * re-confirmation (explicit new `deliveryReference` text and/or explicit new coordinates supplied
 * directly on the DTO) still goes through the full canonical `resolveDeliverySnapshot`/
 * `applyDestinationEdit` re-pricing path exactly as before — see the positive-control test below.
 *
 * This test file proves BOTH halves: (1) the notes-only "launder" attack from A17 no longer works —
 * `deliveryRequiresManualQuote` survives, no new audit is created, the fee/pricing status are
 * untouched, while the notes field itself DOES update normally; (2) a genuinely new address
 * confirmation still legitimately re-prices and can clear `deliveryRequiresManualQuote` when the
 * newly confirmed evidence is actually in-coverage.
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
  throw new Error('A17/A18 requires an isolated _test database.');
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

describe('A17/A18 Round 5 — unrelated non-address order edits must never launder courier-tracking drift into commercial pricing authority', () => {
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

  it('[FIXED] an unrelated notes-only update() call must NOT re-anchor/re-price a courier-drifted destination and must NOT clear deliveryRequiresManualQuote — the notes field itself must still update normally', async () => {
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
    const originalPricingStatus = baseline.deliveryPricingStatus;
    const originalCalculationVersionAuditCount = await prisma.deliveryPricingAudit.count({ where: { orderTicketId: created.id } });
    expect(originalCalculationVersionAuditCount).toBe(1); // exactly the creation-time audit row (the true anchor)
    const originalAudit = await prisma.deliveryPricingAudit.findFirstOrThrow({ where: { orderTicketId: created.id } });

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

    // 3. THE FORMER ATTACK, NOW A REGRESSION PROBE: an entirely unrelated staff edit — notes only,
    // no address/coordinate fields anywhere in the DTO. Any ordinary "add extra napkins" /
    // "sin cebolla" kitchen-note edit looks exactly like this from the caller's side. Under the A18
    // fix, `OrdersService.update()` must detect that this DTO carries no address-relevant field
    // (`hasAddressRelevantInput === false`) and skip the destination-edit/re-pricing branch entirely,
    // carrying the existing delivery* columns forward VERBATIM via `carryForwardDeliverySnapshot()`.
    const newNotes = 'Extra salsa, sin cebolla';
    await service.update(
      created.id,
      { notes: newNotes } as never,
      admin as never,
    );

    const afterLaunder = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });

    // (a) The notes field itself DOES update normally — this fix must not make ordinary unrelated
    // edits inert, only prevent them from touching delivery pricing/address state.
    expect(afterLaunder.notes).toBe(newNotes);

    // (b) The address text is still byte-for-byte unchanged — no human ever edited or re-confirmed
    // it.
    expect(afterLaunder.deliveryReference).toBe(originalReference);

    // (c) [FIX PROOF] deliveryRequiresManualQuote — the ONLY thing standing between the drifted
    // destination and checkout — MUST SURVIVE this unrelated edit. This is the core regression this
    // test exists to prove: A16's protection is no longer silently undone by an unrelated edit.
    expect(afterLaunder.deliveryRequiresManualQuote).toBe(true);

    // (d) [FIX PROOF] The persisted price/status must be COMPLETELY UNTOUCHED by the unrelated edit
    // — no repricing pass ran at all.
    expect(afterLaunder.deliveryPricingStatus).toBe(originalPricingStatus);
    expect(Number(afterLaunder.deliveryFee)).toBe(originalFee);
    expect(afterLaunder.deliveryLatitude?.toString()).toBe(afterWalk.deliveryLatitude?.toString());
    expect(afterLaunder.deliveryLongitude?.toString()).toBe(afterWalk.deliveryLongitude?.toString());

    // (e) [FIX PROOF] No new `DeliveryPricingAudit` row was created — the courier-drifted point was
    // NEVER promoted to a "priced anchor". The audit trail still shows exactly the one, original,
    // genuinely-address-confirmed anchor.
    const auditCountAfterLaunder = await prisma.deliveryPricingAudit.count({ where: { orderTicketId: created.id } });
    expect(auditCountAfterLaunder).toBe(originalCalculationVersionAuditCount);
    const latestAuditAfterLaunder = await prisma.deliveryPricingAudit.findFirstOrThrow({
      where: { orderTicketId: created.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(latestAuditAfterLaunder.id).toBe(originalAudit.id);

    // (f) [FIX PROOF] The canonical, single-authority checkout gate STILL blocks checkout — the
    // manual-quote requirement A16 installed for this drifted destination was never laundered away.
    const authorizationAfterLaunder = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: afterLaunder.deliveryPricingStatus,
      deliveryRequiresManualQuote: afterLaunder.deliveryRequiresManualQuote,
      deliveryFee: Number(afterLaunder.deliveryFee),
      hasCalculationSnapshot: Boolean(afterLaunder.deliveryCalculationVersion?.trim()) && afterLaunder.deliveryPricingBreakdown != null,
    });
    expect(authorizationAfterLaunder.canCheckout).toBe(false);
    expect(() => (service as unknown as { assertDeliveryCheckoutAllowed: (o: unknown) => void }).assertDeliveryCheckoutAllowed(afterLaunder)).toThrow();

    // 4. REPEATABILITY PROOF: a SECOND round of (tracking pings -> unrelated edit) must behave
    // identically — the fix is structural (gated on DTO content), not a one-shot special case. More
    // tracking drift still correctly re-engages A16's manual-quote gate against the ORIGINAL,
    // never-laundered anchor, and a second unrelated edit still must not clear it.
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
    expect(afterSecondWalk.deliveryRequiresManualQuote).toBe(true); // still gated against the ORIGINAL anchor
    expect(
      isCoordinateEvidenceMateriallyDifferent(secondStartLatitude, secondStartLongitude, currentLatitude, currentLongitude),
    ).toBe(true);

    await service.update(created.id, { notes: 'Sin tomate esta vez' } as never, admin as never);
    const afterSecondLaunder = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterSecondLaunder.deliveryRequiresManualQuote).toBe(true); // STILL not cleared
    expect(afterSecondLaunder.deliveryReference).toBe(originalReference);
    expect(Number(afterSecondLaunder.deliveryFee)).toBe(originalFee);
    const auditCountAfterSecondLaunder = await prisma.deliveryPricingAudit.count({ where: { orderTicketId: created.id } });
    expect(auditCountAfterSecondLaunder).toBe(originalCalculationVersionAuditCount); // still exactly 1
    const authorizationAfterSecondLaunder = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: afterSecondLaunder.deliveryPricingStatus,
      deliveryRequiresManualQuote: afterSecondLaunder.deliveryRequiresManualQuote,
      deliveryFee: Number(afterSecondLaunder.deliveryFee),
      hasCalculationSnapshot: Boolean(afterSecondLaunder.deliveryCalculationVersion?.trim()) && afterSecondLaunder.deliveryPricingBreakdown != null,
    });
    expect(authorizationAfterSecondLaunder.canCheckout).toBe(false);
  });

  it('[POSITIVE CONTROL] a genuine address re-confirmation (explicit new deliveryReference + coordinates on the update() DTO) still correctly re-prices and legitimately clears deliveryRequiresManualQuote when back in-coverage', async () => {
    const phone = '573011770002';

    // 1. Same setup as the fix-proof test: create an order close to origin, then drift it via
    // courier-tracking pings until A16's manual-quote gate engages.
    const startOffsetDeg = 0.5 / 111.32;
    const startLatitude = ORIGIN.latitude + startOffsetDeg;
    const startLongitude = ORIGIN.longitude;
    const originalReference = 'Calle 10 #5-20, apto 301';

    const created = await service.create(
      {
        type: 'DELIVERY' as never,
        customerName: 'Cliente A17 positivo',
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
    expect(baseline.deliveryRequiresManualQuote).toBe(false);
    const originalFee = Number(baseline.deliveryFee);
    const originalAuditCount = await prisma.deliveryPricingAudit.count({ where: { orderTicketId: created.id } });
    expect(originalAuditCount).toBe(1);

    const stepDeg = 0.00125;
    const steps = 15;
    let currentLatitude = startLatitude;
    const currentLongitude = startLongitude;
    for (let i = 0; i < steps; i += 1) {
      const nextLatitude = currentLatitude + stepDeg;
      await service.captureDeliveryLocationFromWhatsapp({
        sourceEventKey: `a17-launder-positive-${created.id}-${i}`,
        senderPhoneCandidates: [phone],
        latitude: nextLatitude,
        longitude: currentLongitude,
        actorId: adminUserId,
      });
      currentLatitude = nextLatitude;
    }

    const afterWalk = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterWalk.deliveryRequiresManualQuote).toBe(true); // A16 gate engaged, exactly as the fix-proof test above

    // 2. THE POSITIVE CONTROL: staff/customer GENUINELY re-confirms the delivery address — a real
    // new reference text AND explicit fresh coordinates supplied directly on THIS update() call
    // (e.g. from the POS address picker, or a SOFIA-forwarded GPS share at order-edit time), placed
    // back within `includedKm` so the honest re-price is legitimately auto-approvable. This is
    // exactly the caller-driven, address-relevant DTO content `hasAddressRelevantInput` in
    // `orders.service.ts` is designed to detect and route through the full
    // `resolveDeliverySnapshot`/`applyDestinationEdit` re-pricing path — the fix must not make this
    // legitimate flow impossible.
    const confirmedReference = 'Carrera 8 #12-45, casa nueva confirmada';
    const confirmedLatitude = startLatitude; // genuinely back at the original, in-coverage point
    const confirmedLongitude = startLongitude;
    expect(haversineKm(ORIGIN.latitude, ORIGIN.longitude, confirmedLatitude, confirmedLongitude)).toBeLessThan(1.5);

    await service.update(
      created.id,
      {
        deliveryReference: confirmedReference,
        deliveryLatitude: confirmedLatitude,
        deliveryLongitude: confirmedLongitude,
        deliveryLocationProvider: 'pos_address_picker',
        deliveryLocationConfidence: 'HIGH',
      } as never,
      admin as never,
    );

    const afterConfirmation = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });

    // (a) The address text DID change — a real, explicit re-confirmation occurred.
    expect(afterConfirmation.deliveryReference).toBe(confirmedReference);

    // (b) The coordinates now reflect the freshly confirmed, in-coverage point — not the
    // tracking-drifted one.
    expect(Number(afterConfirmation.deliveryLatitude)).toBeCloseTo(confirmedLatitude, 5);
    expect(Number(afterConfirmation.deliveryLongitude)).toBeCloseTo(confirmedLongitude, 5);

    // (c) A real repricing pass DID run and produced a NEW audit row anchored at the confirmed
    // point — this is legitimate, caller-driven re-pricing, not laundering.
    const auditCountAfterConfirmation = await prisma.deliveryPricingAudit.count({ where: { orderTicketId: created.id } });
    expect(auditCountAfterConfirmation).toBeGreaterThan(originalAuditCount);
    const latestAudit = await prisma.deliveryPricingAudit.findFirstOrThrow({
      where: { orderTicketId: created.id },
      orderBy: { createdAt: 'desc' },
    });
    const latestRequest = latestAudit.requestJson as { latitude?: number; longitude?: number };
    expect(latestRequest.latitude).toBeCloseTo(confirmedLatitude, 5);
    expect(latestRequest.longitude).toBeCloseTo(confirmedLongitude, 5);

    // (d) [LEGITIMATE UNBLOCK] Because the newly confirmed evidence is genuinely back in-coverage,
    // deliveryRequiresManualQuote is legitimately cleared and the fee reflects the honest re-price —
    // this is the flow the fix must NOT break.
    expect(afterConfirmation.deliveryRequiresManualQuote).toBe(false);
    expect(afterConfirmation.deliveryPricingStatus).toBe('AUTO_PRICED');
    expect(Number(afterConfirmation.deliveryFee)).toBe(originalFee); // same in-coverage base fare as the original anchor

    const authorizationAfterConfirmation = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: afterConfirmation.deliveryPricingStatus,
      deliveryRequiresManualQuote: afterConfirmation.deliveryRequiresManualQuote,
      deliveryFee: Number(afterConfirmation.deliveryFee),
      hasCalculationSnapshot: Boolean(afterConfirmation.deliveryCalculationVersion?.trim()) && afterConfirmation.deliveryPricingBreakdown != null,
    });
    expect(authorizationAfterConfirmation.canCheckout).toBe(true);
    expect(() => (service as unknown as { assertDeliveryCheckoutAllowed: (o: unknown) => void }).assertDeliveryCheckoutAllowed(afterConfirmation)).not.toThrow();
  });
});
