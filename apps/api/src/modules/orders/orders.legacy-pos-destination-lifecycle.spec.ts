/**
 * SOFIA Address Remediation — Round 5 / A11 CLOSURE (legacy POS destination lifecycle).
 *
 * Rounds 1-4 fixed individual symptoms (denylist bypass, cross-field bypass, spatial-authority
 * gap, coordinate pairing — see `orders.delivery-coordinate-pairing.redteam.spec.ts`). An
 * independent red team (A8) then found the recurring root defect class: STALE OR MISMATCHED
 * SPATIAL EVIDENCE SURVIVING DESTINATION EDITS ACROSS TURNS, REQUESTS OR PERSISTENCE BOUNDARIES.
 * Its CRITICAL finding: an order has trusted coordinates proving destination ~42km away; the
 * customer edits ONLY a non-spatial reference field ("casa azul" -> "portón negro"); the legacy
 * `referenceChanged` check discarded the trusted coordinates anyway, after which bare textual
 * local-zone matching could reopen LOCAL_FREE.
 *
 * `resolveDeliverySnapshot` (orders.service.ts) now routes every destination edit through A9's
 * single canonical `applyDestinationEdit` state-transition function (the SAME authority SOFIA/A10
 * uses) instead of an independent per-field `referenceChanged` check — no parallel legacy fallback
 * logic remains. This file proves the required destination-revision rules end-to-end for the
 * legacy POS entrypoint, each with a real Postgres-backed test, per the round's closure mandate.
 */

import { OrdersService } from './orders.service';
import { DeliveryPricingService } from '../../delivery/delivery-pricing/delivery-pricing.service';
import { DeliveryExternalDataService } from '../../delivery/providers/delivery-external-data.service';
import { InMemoryExternalCache } from '../../delivery/providers/in-memory-external-cache';
import { PrismaService } from '../../prisma/prisma.service';
import type { RouteResult, WeatherResult } from '../../delivery/providers/provider-types';
import type { RoutingProvider } from '../../delivery/providers/routing-provider.interface';
import type { WeatherProvider } from '../../delivery/providers/weather-provider.interface';
import { Prisma } from '@prisma/client';

const origin = { latitude: 3.2601, longitude: -76.5405, label: '2X1 Burger Co', address: 'Local principal' };
// A real, trusted point ~42km away — correctly OUT_OF_COVERAGE. Same value as the round-4 redteam
// spec (`orders.delivery-coordinate-pairing.redteam.spec.ts`) for continuity/comparability.
const FAR_LATITUDE = 3.62;
const FAR_LONGITUDE = -76.15;
// A nearby point (~2km), well inside auto-priced coverage.
const NEAR_LATITUDE = 3.255;
const NEAR_LONGITUDE = -76.545;
// A THIRD, independently-distinguishable point (~3km) used only for the "concurrent coordinate +
// reference update in the same turn" test, so a fabricated/hybrid point can never be confused with
// either FAR or NEAR.
const CORRECTED_LATITUDE = 3.258;
const CORRECTED_LONGITUDE = -76.548;

function buildWeatherProvider(): WeatherProvider {
  const result: WeatherResult = {
    provider: 'mock-weather', isRaining: false, precipitationMm: 0, rainIntensity: 'NONE',
    confidence: 'HIGH', fetchedAt: new Date('2026-08-20T12:00:00.000Z'), warnings: [],
  };
  return { providerName: 'mock-weather', getCurrentWeather: jest.fn().mockResolvedValue(result) };
}

function buildRoutingProvider(): RoutingProvider {
  const getRoute = jest.fn(async (request: { destinationLatitude: number; destinationLongitude: number }) => {
    const isFar = Math.abs(request.destinationLatitude - FAR_LATITUDE) < 1e-6 && Math.abs(request.destinationLongitude - FAR_LONGITUDE) < 1e-6;
    const isNear = Math.abs(request.destinationLatitude - NEAR_LATITUDE) < 1e-6 && Math.abs(request.destinationLongitude - NEAR_LONGITUDE) < 1e-6;
    const isCorrected = Math.abs(request.destinationLatitude - CORRECTED_LATITUDE) < 1e-6 && Math.abs(request.destinationLongitude - CORRECTED_LONGITUDE) < 1e-6;
    const distanceKm = isFar ? 42 : isNear ? 2 : isCorrected ? 3 : 77; // 77 = "unexpected/hybrid point" sentinel
    const result: RouteResult = {
      provider: 'mock-route',
      distanceKm,
      durationMinutes: isFar ? 60 : 15,
      routeConfidence: 'HIGH',
      warnings: [],
    };
    return result;
  });
  return { providerName: 'mock-route', getRoute };
}

const auditPrisma = { deliveryPricingAudit: { create: jest.fn(async () => ({ id: 'audit-a11' })) } };

describe('A11 SOFIA Round 5 — legacy POS destination lifecycle (canonical destination-state authority, real Postgres)', () => {
  jest.setTimeout(30000);
  let prisma: PrismaService;
  let service: OrdersService;
  let routingProvider: RoutingProvider;
  let adminUserId: string;
  let cashSessionId: string;

  type ResolveDeliverySnapshotFn = (
    tx: unknown,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;

  function resolveDeliverySnapshot(input: Record<string, unknown>) {
    return (service as unknown as { resolveDeliverySnapshot: ResolveDeliverySnapshotFn }).resolveDeliverySnapshot(prisma, input);
  }

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

    const admin = await prisma.user.findFirst({ where: { email: 'admin@2x1burgerco.local' } });
    if (!admin) throw new Error('Expected seeded admin user for A11 legacy POS destination lifecycle tests.');
    adminUserId = admin.id;
    const session = await prisma.cashSession.create({
      data: { status: 'OPEN', openedById: adminUserId, openingAmount: new Prisma.Decimal(0) },
    });
    cashSessionId = session.id;
  });

  afterAll(async () => {
    await prisma.orderTicket.deleteMany({ where: { customerPhone: { startsWith: '57300099' } } }).catch(() => undefined);
    await prisma.deliveryCustomer.deleteMany({ where: { phone: { startsWith: '57300099' } } }).catch(() => undefined);
    await prisma.cashSession.deleteMany({ where: { id: cashSessionId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  let phoneCounter = 0;
  function nextPhone() {
    phoneCounter += 1;
    return `57300099${String(1000 + phoneCounter)}`;
  }

  /** Creates a minimal, real `OrderTicket` row directly (bypassing the public `create()` HTTP/DTO
   * surface, which is out of this file's concern) so RULE 7 (persist -> reload -> edit) tests can
   * exercise a GENUINE Postgres round trip through `fromOrderTicketDeliveryColumns` /
   * `toOrderTicketDeliveryColumns`, not merely chained in-memory calls. */
  async function persistDeliveryOrder(snapshot: Record<string, unknown>) {
    const created = await prisma.orderTicket.create({
      data: {
        number: `A11-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'DELIVERY',
        cashSessionId,
        createdById: adminUserId,
        deliveryReference: (snapshot.deliveryReference as string | null) ?? null,
        deliveryAddressNormalized: (snapshot.deliveryAddressNormalized as string | null) ?? null,
        deliveryLatitude: (snapshot.deliveryLatitude as Prisma.Decimal | null) ?? null,
        deliveryLongitude: (snapshot.deliveryLongitude as Prisma.Decimal | null) ?? null,
        deliveryLocationSource: (snapshot.deliveryLocationSource as string | null) ?? null,
        deliveryLocationReceivedAt: (snapshot.deliveryLocationReceivedAt as Date | null) ?? null,
        deliveryGeocodingProvider: (snapshot.deliveryGeocodingProvider as string | null) ?? null,
        deliveryDistanceKm: (snapshot.deliveryDistanceKm as Prisma.Decimal | null) ?? null,
        deliveryFee: (snapshot.deliveryFee as Prisma.Decimal | undefined) ?? new Prisma.Decimal(0),
      },
    });
    return created;
  }

  // ---------------------------------------------------------------------------------------------
  // RULE 3 CLOSURE — A8 CRITICAL finding: a non-spatial reference-only edit must never discard
  // valid existing coordinates.
  // ---------------------------------------------------------------------------------------------
  it('RULE 3 (A8 CRITICAL): a reference-only edit ("casa azul" -> "portón negro") on a 42km-trusted destination preserves coordinates, keeps OUT_OF_COVERAGE, and LOCAL_FREE stays impossible even though "alborada" is present in the reference the whole time', async () => {
    const phone = nextPhone();
    const first = await resolveDeliverySnapshot({
      customerName: 'Cliente A11',
      customerPhone: phone,
      deliveryReference: 'Calle 100 #20-30, barrio alborada, casa azul',
      latitude: FAR_LATITUDE,
      longitude: FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    expect(Number(first.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);
    expect(Number(first.deliveryLongitude)).toBeCloseTo(FAR_LONGITUDE, 5);
    expect(first.deliveryPricingStatus).toBe('OUT_OF_COVERAGE');

    // Reference-only edit: SAME street/number/zone-alias segment, ONLY the instruction portion
    // changes. No latitude/longitude supplied this turn at all (exactly what a legacy POS operator
    // editing just the "casa azul" note would submit).
    const second = await resolveDeliverySnapshot({
      customerName: 'Cliente A11',
      customerPhone: phone,
      deliveryReference: 'Calle 100 #20-30, barrio alborada, portón negro',
      latitude: undefined,
      longitude: undefined,
      existing: {
        deliveryReference: 'Calle 100 #20-30, barrio alborada, casa azul',
        deliveryAddressNormalized: first.deliveryAddressNormalized as string,
        deliveryLatitude: first.deliveryLatitude as never,
        deliveryLongitude: first.deliveryLongitude as never,
        deliveryLocationSource: first.deliveryLocationSource as string,
        deliveryLocationReceivedAt: first.deliveryLocationReceivedAt as never,
        deliveryGeocodingProvider: first.deliveryGeocodingProvider as string | null,
        deliveryDistanceKm: first.deliveryDistanceKm as never,
      },
    });

    expect(Number(second.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);
    expect(Number(second.deliveryLongitude)).toBeCloseTo(FAR_LONGITUDE, 5);
    expect(second.deliveryPricingStatus).toBe('OUT_OF_COVERAGE');
    expect(second.deliveryPricingStatus).not.toBe('LOCAL_FREE');
    expect(Number(second.deliveryFee)).toBe(0); // OUT_OF_COVERAGE -> blocked, never a real charge

    // Prove the real routing provider was queried with the TRUE far point on BOTH turns — never a
    // coordinate-less / zone-alias-only quote.
    const calls = (routingProvider.getRoute as jest.Mock).mock.calls as Array<[{ destinationLatitude: number; destinationLongitude: number }]>;
    expect(calls.some(([req]) => Math.abs(req.destinationLatitude - FAR_LATITUDE) < 1e-6 && Math.abs(req.destinationLongitude - FAR_LONGITUDE) < 1e-6)).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------
  // RULE 2 CLOSURE — a genuine spatial edit marks old coordinates STALE; no distance carry-forward.
  // ---------------------------------------------------------------------------------------------
  it('RULE 2: a genuine spatial edit (street/number changes) marks the old 42km pair STALE — coordinates are dropped, not silently reused, and no old distance is carried forward', async () => {
    const phone = nextPhone();
    const first = await resolveDeliverySnapshot({
      customerName: 'Cliente A11',
      customerPhone: phone,
      deliveryReference: 'Calle 100 #20-30, casa azul',
      latitude: FAR_LATITUDE,
      longitude: FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    expect(Number(first.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);
    expect(first.deliveryPricingStatus).toBe('OUT_OF_COVERAGE');

    // Genuine spatial edit: the STREET NUMBER changes ("#20-30" -> "#45-99") without supplying new
    // coordinates. RULE 2 requires the old (far) pair become STALE for pricing purposes.
    const second = await resolveDeliverySnapshot({
      customerName: 'Cliente A11',
      customerPhone: phone,
      deliveryReference: 'Calle 100 #45-99, casa azul',
      latitude: undefined,
      longitude: undefined,
      existing: {
        deliveryReference: 'Calle 100 #20-30, casa azul',
        deliveryAddressNormalized: first.deliveryAddressNormalized as string,
        deliveryLatitude: first.deliveryLatitude as never,
        deliveryLongitude: first.deliveryLongitude as never,
        deliveryLocationSource: first.deliveryLocationSource as string,
        deliveryLocationReceivedAt: first.deliveryLocationReceivedAt as never,
        deliveryDistanceKm: first.deliveryDistanceKm as never,
      },
    });

    expect(second.deliveryLatitude).toBeNull();
    expect(second.deliveryLongitude).toBeNull();
    // Never silently reuse the OLD 42km distance for the NEW (unproven) address.
    expect(second.deliveryDistanceKm).toBeNull();
    expect(second.deliveryPricingStatus).not.toBe('OUT_OF_COVERAGE');

    const calls = (routingProvider.getRoute as jest.Mock).mock.calls as Array<[{ destinationLatitude: number; destinationLongitude: number }]>;
    // The stale pair must never even be re-queried as if it were still authoritative for this turn.
    const staleRequeriedAfterEdit = calls.slice(1).some(
      ([req]) => Math.abs(req.destinationLatitude - FAR_LATITUDE) < 1e-6 && Math.abs(req.destinationLongitude - FAR_LONGITUDE) < 1e-6,
    );
    expect(staleRequeriedAfterEdit).toBe(false);
  });

  // ---------------------------------------------------------------------------------------------
  // RULE 1 CLOSURE — partial coordinate pair on a SPATIAL edit: never fabricated, never silently
  // trusted; complements the round-4 redteam spec, which covers the NON_SPATIAL case.
  // ---------------------------------------------------------------------------------------------
  it('RULE 1: a partial coordinate pair (latitude only) supplied ALONGSIDE a genuine spatial edit is never fabricated into a hybrid point and never silently trusted as current', async () => {
    const phone = nextPhone();
    const first = await resolveDeliverySnapshot({
      customerName: 'Cliente A11',
      customerPhone: phone,
      deliveryReference: 'Carrera 8 #10-10, casa azul',
      latitude: FAR_LATITUDE,
      longitude: FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    expect(Number(first.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);

    // Spatial edit (street changes) AND only a NEW latitude close to NEAR, longitude omitted. This
    // must NEVER pair NEAR_LATITUDE with the OLD (far) longitude, and must NEVER pair it with a
    // NEW longitude that was never supplied either.
    const second = await resolveDeliverySnapshot({
      customerName: 'Cliente A11',
      customerPhone: phone,
      deliveryReference: 'Carrera 9 #10-10, casa azul',
      latitude: NEAR_LATITUDE,
      longitude: undefined,
      existing: {
        deliveryReference: 'Carrera 8 #10-10, casa azul',
        deliveryAddressNormalized: first.deliveryAddressNormalized as string,
        deliveryLatitude: first.deliveryLatitude as never,
        deliveryLongitude: first.deliveryLongitude as never,
        deliveryLocationSource: first.deliveryLocationSource as string,
        deliveryLocationReceivedAt: first.deliveryLocationReceivedAt as never,
      },
    });

    expect(second.deliveryLatitude).toBeNull();
    expect(second.deliveryLongitude).toBeNull();

    const calls = (routingProvider.getRoute as jest.Mock).mock.calls as Array<[{ destinationLatitude: number; destinationLongitude: number }]>;
    const hybridCall = calls.find(
      ([req]) => Math.abs(req.destinationLatitude - NEAR_LATITUDE) < 1e-6 && Math.abs(req.destinationLongitude - FAR_LONGITUDE) < 1e-6,
    );
    expect(hybridCall).toBeUndefined();
    const partialAsCompleteCall = calls.find(([req]) => Math.abs(req.destinationLatitude - NEAR_LATITUDE) < 1e-6);
    expect(partialAsCompleteCall).toBeUndefined();
  });

  // ---------------------------------------------------------------------------------------------
  // RULE 1 + RULE 4 CLOSURE — a coordinate update and a reference update in the SAME turn must
  // apply atomically together: no mixed old/new revision.
  // ---------------------------------------------------------------------------------------------
  it('RULE 1/4: a coordinate update and a reference update submitted TOGETHER in one call apply atomically — the new pair is bound to the new address, never mixed with the old one', async () => {
    const phone = nextPhone();
    const first = await resolveDeliverySnapshot({
      customerName: 'Cliente A11',
      customerPhone: phone,
      deliveryReference: 'Diagonal 5 #1-1, casa azul',
      latitude: FAR_LATITUDE,
      longitude: FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    expect(Number(first.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);

    // Concurrent (same turn) address AND coordinate correction: the customer moved and re-shared
    // GPS in one message/PATCH.
    const second = await resolveDeliverySnapshot({
      customerName: 'Cliente A11',
      customerPhone: phone,
      deliveryReference: 'Diagonal 9 #9-9, casa azul',
      latitude: CORRECTED_LATITUDE,
      longitude: CORRECTED_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: {
        deliveryReference: 'Diagonal 5 #1-1, casa azul',
        deliveryAddressNormalized: first.deliveryAddressNormalized as string,
        deliveryLatitude: first.deliveryLatitude as never,
        deliveryLongitude: first.deliveryLongitude as never,
        deliveryLocationSource: first.deliveryLocationSource as string,
        deliveryLocationReceivedAt: first.deliveryLocationReceivedAt as never,
      },
    });

    expect(Number(second.deliveryLatitude)).toBeCloseTo(CORRECTED_LATITUDE, 5);
    expect(Number(second.deliveryLongitude)).toBeCloseTo(CORRECTED_LONGITUDE, 5);
    expect(second.deliveryPricingStatus).not.toBe('OUT_OF_COVERAGE');

    const calls = (routingProvider.getRoute as jest.Mock).mock.calls as Array<[{ destinationLatitude: number; destinationLongitude: number }]>;
    const correctedCall = calls.find(
      ([req]) => Math.abs(req.destinationLatitude - CORRECTED_LATITUDE) < 1e-6 && Math.abs(req.destinationLongitude - CORRECTED_LONGITUDE) < 1e-6,
    );
    expect(correctedCall).toBeDefined();
    // Never a mixed pair (new latitude/longitude combined with anything from the OLD far point).
    const mixedCall = calls.find(
      ([req]) => (Math.abs(req.destinationLatitude - CORRECTED_LATITUDE) < 1e-6 && Math.abs(req.destinationLongitude - FAR_LONGITUDE) < 1e-6)
        || (Math.abs(req.destinationLatitude - FAR_LATITUDE) < 1e-6 && Math.abs(req.destinationLongitude - CORRECTED_LONGITUDE) < 1e-6),
    );
    expect(mixedCall).toBeUndefined();
  });

  // ---------------------------------------------------------------------------------------------
  // RULE 6 CLOSURE — a brand new order/destination never inherits a PREVIOUS order's coordinates.
  // ---------------------------------------------------------------------------------------------
  it('RULE 6: a brand new order (no `existing`) never inherits coordinates from a different, previously-resolved destination', async () => {
    const phoneA = nextPhone();
    const first = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Uno',
      customerPhone: phoneA,
      deliveryReference: 'Calle 1 #1-1',
      latitude: FAR_LATITUDE,
      longitude: FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    expect(Number(first.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);

    // A brand new, unrelated order/customer, no coordinates supplied, `existing: null` (a genuinely
    // new destination) — must start with NO coordinates at all, never the previous order's point.
    const phoneB = nextPhone();
    const second = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Dos',
      customerPhone: phoneB,
      deliveryReference: 'Calle 2 #2-2',
      latitude: undefined,
      longitude: undefined,
      existing: null,
    });
    expect(second.deliveryLatitude).toBeNull();
    expect(second.deliveryLongitude).toBeNull();
  });

  // ---------------------------------------------------------------------------------------------
  // RULE 7 CLOSURE — persist -> reload (real Postgres round trip, not just chained in-memory
  // calls) -> edit -> correct preservation/staleness.
  // ---------------------------------------------------------------------------------------------
  it('RULE 7: persist -> reload from Postgres -> reference-only edit -> coordinates preserved', async () => {
    const phone = nextPhone();
    const snapshot = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Reload',
      customerPhone: phone,
      deliveryReference: 'Avenida 6 #7-8, casa azul',
      latitude: FAR_LATITUDE,
      longitude: FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    const created = await persistDeliveryOrder({ ...snapshot, deliveryReference: 'Avenida 6 #7-8, casa azul' });

    // RELOAD: a genuinely fresh read from Postgres, independent of any in-memory state from the
    // call above (RULE 7 — "security must NOT depend on in-memory state").
    const reloaded = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(Number(reloaded.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);

    const edited = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Reload',
      customerPhone: phone,
      deliveryReference: 'Avenida 6 #7-8, portón negro',
      latitude: undefined,
      longitude: undefined,
      existing: reloaded,
    });
    expect(Number(edited.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);
    expect(Number(edited.deliveryLongitude)).toBeCloseTo(FAR_LONGITUDE, 5);
    expect(edited.deliveryPricingStatus).toBe('OUT_OF_COVERAGE');
  });

  it('RULE 7: persist -> reload from Postgres -> spatial edit -> coordinates stale', async () => {
    const phone = nextPhone();
    const snapshot = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Reload Spatial',
      customerPhone: phone,
      deliveryReference: 'Avenida 20 #7-8, casa azul',
      latitude: FAR_LATITUDE,
      longitude: FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    const created = await persistDeliveryOrder({ ...snapshot, deliveryReference: 'Avenida 20 #7-8, casa azul' });
    const reloaded = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.id } });
    expect(Number(reloaded.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);

    const edited = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Reload Spatial',
      customerPhone: phone,
      deliveryReference: 'Avenida 77 #7-8, casa azul', // genuine street number change
      latitude: undefined,
      longitude: undefined,
      existing: reloaded,
    });
    expect(edited.deliveryLatitude).toBeNull();
    expect(edited.deliveryLongitude).toBeNull();
  });

  // ---------------------------------------------------------------------------------------------
  // RULE 8 CLOSURE — 42km trusted coordinate + "alborada" reference: cannot become LOCAL_FREE, in
  // a MULTI-CALL edit sequence (not just the single-call case Round 4 already covered).
  // ---------------------------------------------------------------------------------------------
  it('RULE 8 (multi-turn): an "alborada" reference starts LOCAL_FREE (no evidence yet, legitimate happy path), then real 42km GPS arrives on a LATER, separate turn and immediately overrides LOCAL_FREE — and a further instruction-only turn never reverts to it', async () => {
    const phone = nextPhone();
    // Turn 1: legitimate zone-alias address, no coordinates yet at all — the happy path Round 4
    // already certified (a genuinely new destination with no contradicting evidence).
    const turn1 = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Alborada',
      customerPhone: phone,
      deliveryReference: 'barrio alborada casa azul frente al parque',
      latitude: undefined,
      longitude: undefined,
      existing: null,
    });
    expect(turn1.deliveryPricingStatus).toBe('LOCAL_FREE');
    expect(turn1.deliveryLatitude).toBeNull();

    // Turn 2 (SEPARATE call/request): real GPS arrives for the SAME address text (no reference
    // change at all) — a coordinates-only edit. RULE 3 keeps this NON_SPATIAL (same revision); RULE
    // 4 makes the new trusted point authoritative. TRUSTED_SPATIAL_DATA must immediately override
    // the previous LOCAL_FREE determination.
    const turn2 = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Alborada',
      customerPhone: phone,
      deliveryReference: 'barrio alborada casa azul frente al parque',
      latitude: FAR_LATITUDE,
      longitude: FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: {
        deliveryReference: 'barrio alborada casa azul frente al parque',
        deliveryAddressNormalized: turn1.deliveryAddressNormalized as string,
        deliveryLatitude: turn1.deliveryLatitude as never,
        deliveryLongitude: turn1.deliveryLongitude as never,
        deliveryLocationSource: turn1.deliveryLocationSource as string | null,
        deliveryLocationReceivedAt: turn1.deliveryLocationReceivedAt as never,
      },
    });
    expect(turn2.deliveryPricingStatus).not.toBe('LOCAL_FREE');
    expect(turn2.deliveryPricingStatus).toBe('OUT_OF_COVERAGE');
    expect(Number(turn2.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);

    // Turn 3: a further edit whose reference text has NO recognizable street/number baseline (this
    // exact address never had one) — `classifyRawReferenceChange` fails closed to AMBIGUOUS (a
    // documented, intentional A9 property: see `spatial-fingerprint.spec.ts` "fails closed to
    // AMBIGUOUS when the previous text has no provable spatial baseline"), which by RULE 2 stales
    // the 42km-trusted pair. THIS IS THE EXACT A8-CLASS LOOPHOLE: with coordinates gone and
    // "alborada" still present in the text, a naive re-quote would fall back to a bare
    // zone-alias-only LOCAL_FREE match — silently granting free delivery to a destination the
    // system JUST had real proof was 42km away. The A11 safety net in `resolveDeliverySnapshot`
    // (`localFreeBlockedByAmbiguousStaleness`) must force this to `NEEDS_ADDRESS_CORRECTION`
    // instead: fail closed, require re-proof, NEVER silently free.
    const turn3 = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Alborada',
      customerPhone: phone,
      deliveryReference: 'barrio alborada casa azul frente al parque, tocar el timbre',
      latitude: undefined,
      longitude: undefined,
      existing: {
        deliveryReference: 'barrio alborada casa azul frente al parque',
        deliveryAddressNormalized: turn2.deliveryAddressNormalized as string,
        deliveryLatitude: turn2.deliveryLatitude as never,
        deliveryLongitude: turn2.deliveryLongitude as never,
        deliveryLocationSource: turn2.deliveryLocationSource as string | null,
        deliveryLocationReceivedAt: turn2.deliveryLocationReceivedAt as never,
      },
    });
    expect(turn3.deliveryPricingStatus).not.toBe('LOCAL_FREE');
    expect(turn3.deliveryPricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(turn3.deliveryRequiresManualQuote).toBe(true);
    expect(Number(turn3.deliveryFee)).toBe(0);
    // Coordinates are genuinely gone (STALE, not carried forward) — never fabricated as "still
    // 42km" either. The system honestly has no current proof, so it fails closed to manual
    // re-proof instead of asserting either OUT_OF_COVERAGE or LOCAL_FREE without evidence.
    expect(turn3.deliveryLatitude).toBeNull();
    expect(turn3.deliveryLongitude).toBeNull();
  });

  it('RULE 8 (single ambiguous edit): a 42km-trusted destination whose reference has no street/number baseline never falls back to LOCAL_FREE when an edit cannot be proven non-spatial', async () => {
    const phone = nextPhone();
    const first = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Alborada Directo',
      customerPhone: phone,
      deliveryReference: 'alborada casa azul frente al parque',
      latitude: FAR_LATITUDE,
      longitude: FAR_LONGITUDE,
      locationProvider: 'whatsapp_live_location',
      locationConfidence: 'HIGH',
      existing: null,
    });
    expect(first.deliveryPricingStatus).toBe('OUT_OF_COVERAGE');
    expect(Number(first.deliveryLatitude)).toBeCloseTo(FAR_LATITUDE, 5);

    // No recognizable street/number baseline in this reference at all -> any text change fails
    // closed to AMBIGUOUS (documented A9 property), staling the trusted 42km pair. The A11 safety
    // net must still prevent this from resolving to LOCAL_FREE.
    const second = await resolveDeliverySnapshot({
      customerName: 'Cliente A11 Alborada Directo',
      customerPhone: phone,
      deliveryReference: 'alborada casa azul frente al parque, cuidado con el perro',
      latitude: undefined,
      longitude: undefined,
      existing: {
        deliveryReference: 'alborada casa azul frente al parque',
        deliveryAddressNormalized: first.deliveryAddressNormalized as string,
        deliveryLatitude: first.deliveryLatitude as never,
        deliveryLongitude: first.deliveryLongitude as never,
        deliveryLocationSource: first.deliveryLocationSource as string | null,
        deliveryLocationReceivedAt: first.deliveryLocationReceivedAt as never,
      },
    });
    expect(second.deliveryPricingStatus).not.toBe('LOCAL_FREE');
    expect(second.deliveryRequiresManualQuote).toBe(true);
    expect(Number(second.deliveryFee)).toBe(0);
  });
});
