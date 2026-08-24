/**
 * SOFIA Round 5 / A20 -- remediation + permanent regression coverage for the A19 blind red team
 * finding (HIGH), fixed in `OrdersService.createFromCanonicalCheckout()`
 * (`apps/api/src/modules/orders/orders.service.ts`).
 *
 * ORIGINAL FINDING (A19, now fixed): `createFromCanonicalCheckout()` -- the call site that
 * materializes the operational `OrderTicket` once a SOFIA conversation's checkout reaches
 * `KITCHEN_ELIGIBLE` (invoked by `KitchenEligibilityService.createOrderTicket()` /
 * the `SOFIA_CREATE_ORDER` SecureCommand handler) -- copied `deliveryFee` and `deliveryReference`
 * from the checkout's `customerSnapshot` onto the new `OrderTicket`, but never wrote
 * `deliveryLatitude`/`deliveryLongitude`/`deliveryPricingStatus`/`deliveryCalculationVersion`/
 * `deliveryPricingBreakdown`, and never linked the `DeliveryPricingAudit` row that actually priced
 * the destination back to the order. Consequences: (1) `deriveCheckoutAuthorizationFromOrderSnapshot()`
 * always yielded `canCheckout=false` for these orders, permanently blocking `OrdersService.checkout()`;
 * (2) `assertDeliveryOrder()` (gating rider assignment/claim) never checked coordinate/pricing state,
 * so a courier could be dispatched to an order with zero destination coordinate evidence on its row,
 * even though a trusted GPS pin existed (unused) in the linked audit.
 *
 * FIX: `createFromCanonicalCheckout()` now follows `customer.deliveryQuoteAuditId` back to the
 * `DeliveryPricingAudit` row, reconstructs the `DestinationSnapshot` it represents via
 * `fromDeliveryPricingAudit` (destination-state persistence Tier 2/2b,
 * `apps/api/src/delivery/destination-state/destination-state.persistence.ts`), maps it onto the
 * SAME `OrderTicket` columns legacy POS's `resolveDeliverySnapshot` uses
 * (`toOrderTicketDeliveryColumns`), copies the pricing-authority evidence
 * (`deliveryPricingStatus`/`deliveryCalculationVersion`/`deliveryPricingBreakdown`/
 * `deliveryRequiresManualQuote`) straight from the audit row, and links the audit row back to the
 * order (`orderTicketId`) exactly like legacy POS `create()`/`update()` already do.
 *
 * This spec proves, with real Postgres (isolated test database) and the real, unmocked
 * `OrdersService.createFromCanonicalCheckout` + `PrismaService`:
 *
 *   1. [FIXED] A SOFIA-materialized DELIVERY order with a genuine, GPS-trusted, priced audit now
 *      carries the coordinates, pricing-authority evidence, and a linked audit row -- and is
 *      correctly authorized for checkout (`canCheckout=true`) and correctly eligible for dispatch,
 *      this time because REAL evidence backs both gates, not because the gates were blind to its
 *      absence.
 *   2. [NOT REGRESSED] A genuinely coordinate-less LOCAL_FREE SOFIA order (a zone-alias match with
 *      no GPS ever submitted) still ends up correctly authorized for checkout with null coordinates
 *      -- the fix does not turn legitimate coordinate-less orders into permanently unpayable ones.
 *   3. [FAIL CLOSED PRESERVED] A DELIVERY checkout whose audit pointer is missing/dangling still
 *      leaves the order exactly as fail-closed/unauthorized as before the fix -- the fix never
 *      fabricates evidence that was not actually proven.
 *   4. [POSITIVE CONTROL, UNCHANGED] The legacy POS path (`create()`) still correctly fails closed
 *      for a fresh DELIVERY order with no address at all.
 */

import { randomUUID } from 'node:crypto';
import {
  OrderCheckoutSource,
  OrderCheckoutStatus,
  OrderTicketStatus,
  OrderTicketType,
  Prisma,
  ProductKind,
  SofiaOrderDraftStatus,
  SofiaPaymentPreference,
} from '@prisma/client';
import { OrdersService } from '../modules/orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { deriveCheckoutAuthorizationFromOrderSnapshot } from '../delivery/delivery-pricing/delivery-checkout-authorization';
import { DeliveryPricingService } from '../delivery/delivery-pricing/delivery-pricing.service';
import { DeliveryExternalDataService } from '../delivery/providers/delivery-external-data.service';
import { InMemoryExternalCache } from '../delivery/providers/in-memory-external-cache';
import type { RouteResult, WeatherResult } from '../delivery/providers/provider-types';
import type { RoutingProvider } from '../delivery/providers/routing-provider.interface';
import type { WeatherProvider } from '../delivery/providers/weather-provider.interface';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error('A20 requires an isolated _test database.');
}

const ORIGIN = { latitude: 3.2601, longitude: -76.5405, label: '2X1 Burger Co', address: 'Local principal' };

function buildWeatherProvider(): WeatherProvider {
  const result: WeatherResult = {
    provider: 'mock-weather', isRaining: false, precipitationMm: 0, rainIntensity: 'NONE',
    confidence: 'HIGH', fetchedAt: new Date('2026-08-23T12:00:00.000Z'), warnings: [],
  };
  return { providerName: 'mock-weather', getCurrentWeather: jest.fn().mockResolvedValue(result) };
}

function buildRoutingProvider(): RoutingProvider {
  const getRoute = jest.fn(async () => {
    const result: RouteResult = {
      provider: 'mock-route', distanceKm: 1, durationMinutes: 3, routeConfidence: 'HIGH', warnings: [],
    };
    return result;
  });
  return { providerName: 'mock-route', getRoute };
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

describe('A20 Round 5 -- SOFIA canonical checkout order-materialization persists destination evidence (A19 CLOSURE)', () => {
  jest.setTimeout(60000);
  let prisma: PrismaService;
  let service: OrdersService;
  let adminUserId: string;
  let cashSessionId: string;
  let productId: string;
  const admin = {
    sub: '',
    email: 'a20-admin@2x1burgerco.local',
    fullName: 'A20 Admin',
    sessionVersion: 1,
    roles: ['admin'],
    permissions: ['orders.update'],
  };

  const createdOrderIds: string[] = [];
  const createdDraftIds: string[] = [];
  const createdCheckoutIds: string[] = [];
  const createdAuditIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    // System under test: real `OrdersService` with a real Prisma connection. None of the stubbed
    // collaborators below (audit/sales/realtime/pricing/tables/deliveryWorkflow/notificationOutbox)
    // are touched by `createFromCanonicalCheckout()` -- confirmed by reading the function body: it
    // only ever calls `this.prisma`, `this.auditService.log`, `this.realtimeService.publish*`, and
    // its own private helpers.
    const externalDataService = DeliveryExternalDataService.createForTesting({
      providersEnabled: true, origin: ORIGIN, cache: new InMemoryExternalCache(),
      weatherProvider: buildWeatherProvider(), routingProvider: buildRoutingProvider(),
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

    const session = await prisma.cashSession.create({
      data: { status: 'OPEN', openedById: adminUserId, openingAmount: new Prisma.Decimal(0) },
    });
    cashSessionId = session.id;

    const category = await prisma.category.findFirst() ?? (await prisma.category.create({ data: { name: 'A20', slug: `a20-${Date.now()}` } }));
    const unit = await prisma.unit.findFirst() ?? (await prisma.unit.create({ data: { name: 'Unidad', code: `a20u${Date.now()}`, abbreviation: 'u' } }));
    const product = await prisma.product.create({
      data: {
        code: `A20-${Date.now()}`,
        name: 'Combo A20',
        salePrice: new Prisma.Decimal(24000),
        categoryId: category.id,
        unitId: unit.id,
        kind: ProductKind.DIRECT_STOCK,
        currentStock: new Prisma.Decimal(100),
        trackStock: true,
        isActive: true,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.orderCheckout.deleteMany({ where: { id: { in: createdCheckoutIds } } }).catch(() => undefined);
    await prisma.orderTicket.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => undefined);
    await prisma.deliveryPricingAudit.deleteMany({ where: { id: { in: createdAuditIds } } }).catch(() => undefined);
    await prisma.sofiaOrderDraft.deleteMany({ where: { id: { in: createdDraftIds } } }).catch(() => undefined);
    await prisma.product.deleteMany({ where: { id: productId } }).catch(() => undefined);
    await prisma.cashSession.deleteMany({ where: { id: cashSessionId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: admin.email } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  /** Builds a real `DeliveryPricingAudit` + confirmed `SofiaOrderDraft` + `OrderCheckout`
   * (`KITCHEN_ELIGIBLE`) triple, shaped exactly like production writes them (see
   * `DeliveryPricingService.auditEstimate()`, `prisma-order-checkout.repository.ts::customerSnapshot()`),
   * and returns the checkout id ready for `service.createFromCanonicalCheckout()`. */
  async function buildSofiaDeliveryCheckout(input: {
    phone: string;
    address: string;
    requestJson: Prisma.InputJsonValue;
    resultJson: Prisma.InputJsonValue;
    finalFee: number;
    calculationVersion: string;
  }) {
    const audit = await prisma.deliveryPricingAudit.create({
      data: {
        requestJson: input.requestJson,
        resultJson: input.resultJson,
        finalFee: new Prisma.Decimal(input.finalFee),
        suggestedFee: new Prisma.Decimal(input.finalFee),
        calculationVersion: input.calculationVersion,
      },
    });
    createdAuditIds.push(audit.id);
    expect(audit.orderTicketId).toBeNull();

    const hash = `a20-draft-hash-${randomUUID()}`;
    const draft = await prisma.sofiaOrderDraft.create({
      data: {
        status: SofiaOrderDraftStatus.CONFIRMED,
        fulfillment: OrderTicketType.DELIVERY,
        paymentPreference: SofiaPaymentPreference.CASH_ON_DELIVERY,
        version: 1,
        draftHash: hash,
        confirmationHash: `confirm-${hash}`,
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        customerName: 'Cliente A20',
        customerPhone: input.phone,
        deliveryAddress: input.address,
        deliveryQuoteAuditId: audit.id,
        deliveryQuoteVersion: 1,
        itemsSnapshot: [{ productId, code: 'A20', name: 'Combo A20', quantity: 1, unitPrice: 24000, totalPrice: 24000 }] as unknown as Prisma.InputJsonValue,
        subtotal: new Prisma.Decimal(24000),
        deliveryFee: new Prisma.Decimal(input.finalFee),
        total: new Prisma.Decimal(24000 + input.finalFee),
      },
    });
    createdDraftIds.push(draft.id);

    const checkout = await prisma.orderCheckout.create({
      data: {
        source: OrderCheckoutSource.SOFIA,
        sourceReference: `a20-${draft.id}`,
        idempotencyKey: `a20-checkout-${draft.id}`,
        sofiaDraftId: draft.id,
        sofiaDraftVersion: draft.version,
        sofiaDraftHash: draft.draftHash,
        confirmationHash: draft.confirmationHash,
        customerSnapshot: {
          name: 'Cliente A20',
          phoneMasked: `***${input.phone.slice(-4)}`,
          deliveryAddress: input.address,
          deliveryNeighborhood: null,
          deliveryNotes: null,
          deliveryQuoteAuditId: audit.id,
          deliveryQuoteVersion: 1,
        } as unknown as Prisma.InputJsonValue,
        itemsSnapshot: [{ productId, code: 'A20', name: 'Combo A20', quantity: 1, unitPrice: 24000, totalPrice: 24000 }] as unknown as Prisma.InputJsonValue,
        subtotal: new Prisma.Decimal(24000),
        deliveryFee: new Prisma.Decimal(input.finalFee),
        total: new Prisma.Decimal(24000 + input.finalFee),
        fulfillment: OrderTicketType.DELIVERY,
        paymentPreference: SofiaPaymentPreference.CASH_ON_DELIVERY,
        status: OrderCheckoutStatus.KITCHEN_ELIGIBLE,
        version: 1,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    createdCheckoutIds.push(checkout.id);
    return { audit, draft, checkout };
  }

  it('[FIXED] persists trusted GPS coordinates and pricing-authority evidence onto the OrderTicket, links the DeliveryPricingAudit anchor, and correctly authorizes checkout + dispatch', async () => {
    const trustedLatitude = 3.265;
    const trustedLongitude = -76.543;
    const { audit, checkout } = await buildSofiaDeliveryCheckout({
      phone: '573019990001',
      address: 'Calle 5 #10-20',
      requestJson: {
        addressText: 'Calle 5 #10-20',
        reference: 'Calle 5 #10-20',
        latitude: trustedLatitude,
        longitude: trustedLongitude,
        location: { latitude: trustedLatitude, longitude: trustedLongitude, provider: 'whatsapp_live_location', confidence: 'HIGH' },
      },
      resultJson: {
        pricingStatus: 'AUTO_PRICED',
        requiresManualQuote: false,
        finalFee: 6500,
        zoneLabel: 'NEAR',
        distanceKm: 2.1,
        confidence: 'HIGH',
      },
      finalFee: 6500,
      calculationVersion: 'delivery-pricing-v-a20-test',
    });

    const result = await service.createFromCanonicalCheckout(checkout.id, admin as never);
    expect(result.replayed).toBe(false);
    createdOrderIds.push(result.order.id);

    const order = await prisma.orderTicket.findUniqueOrThrow({ where: { id: result.order.id } });
    expect(order.type).toBe(OrderTicketType.DELIVERY);
    expect(order.status).toBe(OrderTicketStatus.OPEN);

    // Money and text still carry over correctly.
    expect(Number(order.deliveryFee)).toBe(6500);
    expect(order.deliveryReference).toBe('Calle 5 #10-20');

    // [FIXED] the GPS coordinates genuinely trusted/verified during the SOFIA conversation now
    // reach the OrderTicket.
    expect(order.deliveryLatitude).not.toBeNull();
    expect(order.deliveryLongitude).not.toBeNull();
    expect(Number(order.deliveryLatitude)).toBeCloseTo(trustedLatitude, 6);
    expect(Number(order.deliveryLongitude)).toBeCloseTo(trustedLongitude, 6);
    expect(order.deliveryLocationSource).toBe('whatsapp_live_location');

    // [FIXED] pricing-authority evidence now survives -- the order carries proof of how/why the
    // fee was resolved, not just the bare number.
    expect(order.deliveryPricingStatus).toBe('AUTO_PRICED');
    expect(order.deliveryCalculationVersion).toBe('delivery-pricing-v-a20-test');
    expect(order.deliveryPricingBreakdown).not.toBeNull();
    expect(order.deliveryRequiresManualQuote).toBe(false);

    // [FIXED] the audit trail linkage is no longer dropped -- matches legacy POS `create()`/
    // `update()`'s `resolveDeliverySnapshot`, which always links `orderTicketId` back.
    const auditAfter = await prisma.deliveryPricingAudit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(auditAfter.orderTicketId).toBe(order.id);

    // [FIXED, CONSEQUENCE 1] the canonical checkout-authorization gate now correctly authorizes
    // this order, because the persisted evidence genuinely supports it.
    const authorization = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: order.deliveryPricingStatus,
      deliveryRequiresManualQuote: order.deliveryRequiresManualQuote,
      deliveryFee: Number(order.deliveryFee),
      hasCalculationSnapshot: Boolean(order.deliveryCalculationVersion?.trim()) && order.deliveryPricingBreakdown != null,
    });
    expect(authorization.canCheckout).toBe(true);
    expect(() =>
      (service as unknown as { assertDeliveryCheckoutAllowed: (o: unknown) => void }).assertDeliveryCheckoutAllowed(order),
    ).not.toThrow();

    // [CONSEQUENCE 2] dispatch-readiness (`assertDeliveryOrder`) still does not throw -- but this
    // time real coordinate evidence backs the order, so the two safety gates on this order no
    // longer structurally disagree about whether it is "ready".
    expect(() =>
      (service as unknown as { assertDeliveryOrder: (o: unknown) => void }).assertDeliveryOrder(order),
    ).not.toThrow();
  });

  it('[NOT REGRESSED] a genuinely coordinate-less LOCAL_FREE SOFIA order still ends up correctly authorized for checkout, with null coordinates', async () => {
    const { audit, checkout } = await buildSofiaDeliveryCheckout({
      phone: '573019990003',
      address: 'Barrio Condados, sin GPS',
      requestJson: {
        addressText: 'Barrio Condados, sin GPS',
        reference: 'Barrio Condados, sin GPS',
        // Deliberately NO latitude/longitude/location -- a genuine zone-alias-only match, the
        // already-approved happy path for a brand-new order with no GPS ever submitted.
      },
      resultJson: {
        pricingStatus: 'LOCAL_FREE',
        requiresManualQuote: false,
        finalFee: 0,
        zoneLabel: 'LOCAL_FREE',
        distanceKm: null,
        confidence: 'MEDIUM',
      },
      finalFee: 0,
      calculationVersion: 'delivery-pricing-v-a20-local-free-test',
    });

    const result = await service.createFromCanonicalCheckout(checkout.id, admin as never);
    expect(result.replayed).toBe(false);
    createdOrderIds.push(result.order.id);

    const order = await prisma.orderTicket.findUniqueOrThrow({ where: { id: result.order.id } });
    expect(Number(order.deliveryFee)).toBe(0);

    // Legitimately absent -- no GPS was ever submitted for this destination.
    expect(order.deliveryLatitude).toBeNull();
    expect(order.deliveryLongitude).toBeNull();

    // Pricing-authority evidence is still fully persisted even without coordinates.
    expect(order.deliveryPricingStatus).toBe('LOCAL_FREE');
    expect(order.deliveryCalculationVersion).toBe('delivery-pricing-v-a20-local-free-test');
    expect(order.deliveryPricingBreakdown).not.toBeNull();
    expect(order.deliveryRequiresManualQuote).toBe(false);

    const auditAfter = await prisma.deliveryPricingAudit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(auditAfter.orderTicketId).toBe(order.id);

    // The fix must NOT make legitimate coordinate-less orders permanently unpayable.
    const authorization = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: order.deliveryPricingStatus,
      deliveryRequiresManualQuote: order.deliveryRequiresManualQuote,
      deliveryFee: Number(order.deliveryFee),
      hasCalculationSnapshot: Boolean(order.deliveryCalculationVersion?.trim()) && order.deliveryPricingBreakdown != null,
    });
    expect(authorization.canCheckout).toBe(true);
    expect(() =>
      (service as unknown as { assertDeliveryCheckoutAllowed: (o: unknown) => void }).assertDeliveryCheckoutAllowed(order),
    ).not.toThrow();
  });

  it('[FAIL CLOSED PRESERVED] a DELIVERY checkout whose audit pointer is missing/dangling leaves the order exactly as unauthorized as before the fix -- never fabricates evidence', async () => {
    const phone = '573019990004';
    const draftHash = `a20-draft-hash-${randomUUID()}`;
    const draft = await prisma.sofiaOrderDraft.create({
      data: {
        status: SofiaOrderDraftStatus.CONFIRMED,
        fulfillment: OrderTicketType.DELIVERY,
        paymentPreference: SofiaPaymentPreference.CASH_ON_DELIVERY,
        version: 1,
        draftHash,
        confirmationHash: `confirm-${draftHash}`,
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        customerName: 'Cliente A20 Sin Auditoria',
        customerPhone: phone,
        deliveryAddress: 'Calle Sin Auditoria #1-1',
        // Deliberately no deliveryQuoteAuditId -- simulates a dangling/missing pointer.
        deliveryQuoteAuditId: null,
        deliveryQuoteVersion: null,
        itemsSnapshot: [{ productId, code: 'A20', name: 'Combo A20', quantity: 1, unitPrice: 24000, totalPrice: 24000 }] as unknown as Prisma.InputJsonValue,
        subtotal: new Prisma.Decimal(24000),
        deliveryFee: new Prisma.Decimal(4000),
        total: new Prisma.Decimal(28000),
      },
    });
    createdDraftIds.push(draft.id);

    const checkout = await prisma.orderCheckout.create({
      data: {
        source: OrderCheckoutSource.SOFIA,
        sourceReference: `a20-${draft.id}`,
        idempotencyKey: `a20-checkout-${draft.id}`,
        sofiaDraftId: draft.id,
        sofiaDraftVersion: draft.version,
        sofiaDraftHash: draft.draftHash,
        confirmationHash: draft.confirmationHash,
        customerSnapshot: {
          name: 'Cliente A20 Sin Auditoria',
          phoneMasked: `***${phone.slice(-4)}`,
          deliveryAddress: 'Calle Sin Auditoria #1-1',
          deliveryNeighborhood: null,
          deliveryNotes: null,
          deliveryQuoteAuditId: null,
          deliveryQuoteVersion: null,
        } as unknown as Prisma.InputJsonValue,
        itemsSnapshot: [{ productId, code: 'A20', name: 'Combo A20', quantity: 1, unitPrice: 24000, totalPrice: 24000 }] as unknown as Prisma.InputJsonValue,
        subtotal: new Prisma.Decimal(24000),
        deliveryFee: new Prisma.Decimal(4000),
        total: new Prisma.Decimal(28000),
        fulfillment: OrderTicketType.DELIVERY,
        paymentPreference: SofiaPaymentPreference.CASH_ON_DELIVERY,
        status: OrderCheckoutStatus.KITCHEN_ELIGIBLE,
        version: 1,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    createdCheckoutIds.push(checkout.id);

    const result = await service.createFromCanonicalCheckout(checkout.id, admin as never);
    createdOrderIds.push(result.order.id);
    const order = await prisma.orderTicket.findUniqueOrThrow({ where: { id: result.order.id } });

    expect(order.deliveryLatitude).toBeNull();
    expect(order.deliveryLongitude).toBeNull();
    expect(order.deliveryPricingStatus).toBeNull();
    expect(order.deliveryCalculationVersion).toBeNull();
    expect(order.deliveryPricingBreakdown).toBeNull();

    const authorization = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: order.deliveryPricingStatus,
      deliveryRequiresManualQuote: order.deliveryRequiresManualQuote,
      deliveryFee: Number(order.deliveryFee),
      hasCalculationSnapshot: Boolean(order.deliveryCalculationVersion?.trim()) && order.deliveryPricingBreakdown != null,
    });
    expect(authorization.canCheckout).toBe(false);
  });

  it('[POSITIVE CONTROL, UNCHANGED] legacy POS create() still correctly fails closed for a fresh DELIVERY order with no address at all', async () => {
    const legacyOrder = await service.create(
      {
        type: 'DELIVERY' as never,
        customerName: 'Cliente A20 Legacy',
        customerPhone: '573019990002',
        items: [],
      } as never,
      admin as never,
    );
    createdOrderIds.push(legacyOrder.id);
    const legacyRow = await prisma.orderTicket.findUniqueOrThrow({ where: { id: legacyOrder.id } });
    expect(legacyRow.deliveryPricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(legacyRow.deliveryRequiresManualQuote).toBe(true); // correctly fail-closed via resolveDeliverySnapshot
  });
});
