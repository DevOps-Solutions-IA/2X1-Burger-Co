/**
 * SOFIA Round 5 / A19 -- blind independent red team, fresh audit of
 * feat/sofia-remediation-address-round5-18-anchor-laundering-fix. No prior context beyond this
 * repo's code was consulted -- this is a NEW call site, not a replay of A9-A18.
 *
 * SCOPE: every prior round (A9-A18) audited how destination EDITS flow through
 * `applyDestinationEdit`/`resolveDeliverySnapshot` -- i.e. mutations to an EXISTING order/draft's
 * address. This round instead audits the ONE call site where a brand-new, operational `OrderTicket`
 * row is MATERIALIZED from a SOFIA conversation's already-confirmed commercial checkout:
 * `OrdersService.createFromCanonicalCheckout()` (invoked by
 * `KitchenEligibilityService.createOrderTicket()` / `sofia-create-order-command.handler.ts`, i.e.
 * the SOFIA_CREATE_ORDER SecureCommand handler, once a `SofiaOrderDraft` has been CONFIRMED and its
 * `OrderCheckout` has reached `KITCHEN_ELIGIBLE`).
 *
 * FINDING (HIGH): `createFromCanonicalCheckout()` writes `deliveryFee` and `deliveryReference` (text)
 * from the checkout's `customerSnapshot` onto the new `OrderTicket`, but NEVER writes
 * `deliveryLatitude` / `deliveryLongitude` / `deliveryPricingStatus` / `deliveryCalculationVersion` /
 * `deliveryPricingBreakdown`, and NEVER links the `DeliveryPricingAudit` row that actually priced the
 * destination back to the new order (contrast with legacy POS `create()` and `update()`'s
 * `resolveDeliverySnapshot`, which ALWAYS does
 * `deliveryPricingAudit.updateMany({ where: { id, orderTicketId: null }, data: { orderTicketId } })`).
 *
 * ROOT CAUSE: across the entire SOFIA order-intake pipeline -- `SofiaOrderDraft` (see
 * `prisma/schema.prisma`: no lat/lng column, only `deliveryAddress` text +
 * `deliveryQuoteAuditId`/`deliveryQuoteVersion`) -> `OrderCheckout.customerSnapshot` (see
 * `CheckoutCustomerSnapshot` in `order-checkout.types.ts`: same shape, still no lat/lng field at
 * all, only the audit pointer) -> `OrderTicket` -- the ONLY place the actual GPS/geocoded coordinate
 * pair that SOFIA's canonical destination-state authority (A9-A14) validated during the conversation
 * still exists is buried inside `DeliveryPricingAudit.requestJson` (a free-form JSON blob), reachable
 * only via `deliveryQuoteAuditId`. `createFromCanonicalCheckout()` reads `customer.name` and
 * `customer.deliveryAddress` off that snapshot but never reads `deliveryQuoteAuditId`/
 * `deliveryQuoteVersion` at all -- the pointer is silently dropped on the floor. This is also true of
 * the (separately dead-code) Tier-2 full-fidelity `DestinationSnapshot` envelope
 * (`toDeliveryQuoteAuditEnvelope`/`fromDeliveryQuoteAuditEnvelope` in `destination-state.persistence.ts`):
 * grep confirms NEITHER function has a single real caller anywhere in the codebase outside their own
 * module and its unit spec -- the "full fidelity" persistence tier the architecture's own module
 * header describes as "the tier the QUOTE BINDING invariant actually needs" was designed but never
 * wired into the one call site (SOFIA order materialization) that actually needs it.
 *
 * TWO CONCRETE, PROVABLE CONSEQUENCES (both asserted below with real Postgres, real unmocked
 * `OrdersService` code, zero mocks for the system under test):
 *
 *   (1) FUNCTIONAL/FAIL-CLOSED BREAK: `deriveCheckoutAuthorizationFromOrderSnapshot()` requires
 *       `deliveryPricingStatus` to be `LOCAL_FREE`/`AUTO_PRICED` for `addressValid`, and a real
 *       `deliveryCalculationVersion` + `deliveryPricingBreakdown` for `deliveryFeeResolved`. Since
 *       neither is ever set by `createFromCanonicalCheckout()`, `canCheckout` is `false` and
 *       `OrdersService.checkout()` (the ONLY code path that ever sets `OrderTicketStatus.PAID`)
 *       throws `BadRequestException` for EVERY SOFIA-materialized DELIVERY order, permanently --
 *       even though the customer's fee was genuinely, correctly resolved by SOFIA's canonical
 *       pricing engine at confirmation time. At minimum this is a correctness/consistency defect in
 *       how the canonical destination-state authority is wired at this call site (CLAUDE.md section
 *       2: SOFIA must not create a parallel, divergent notion of "this order is priced" that the
 *       legacy authority then refuses to honor).
 *
 *   (2) OPERATIONAL/DISPATCH-SAFETY GAP: `assignDeliveryRider()`/`claimDelivery()` gate on
 *       `assertDeliveryOrder()`, which checks ONLY `order.type === DELIVERY` and
 *       `order.status not in {PAID, CANCELLED}` -- it never consults `deliveryLatitude`/
 *       `deliveryLongitude`/`deliveryPricingStatus`/`deliveryRequiresManualQuote` at all. Because
 *       `createFromCanonicalCheckout()` leaves this order with ZERO coordinate evidence anywhere
 *       (not even a stale/discarded pair -- genuinely absent), a courier can be assigned/dispatched
 *       to an order whose ONLY location evidence is a bare text string, with the actual GPS pin the
 *       customer's conversation produced never propagated past the `DeliveryPricingAudit` row that
 *       computed the price. This is the same defect CLASS the whole remediation program exists to
 *       close (TRUSTED_COORDINATE_LOSS) -- just triggered by order MATERIALIZATION instead of an
 *       EDIT, a call site none of A9-A18 touched.
 *
 * Real Postgres (isolated test database), real unmocked `OrdersService.createFromCanonicalCheckout`
 * + `PrismaService`, exercising the exact `OrderCheckout`/`SofiaOrderDraft`/`DeliveryPricingAudit`
 * shapes production code actually writes (see `order-checkout.types.ts::CheckoutCustomerSnapshot` and
 * `prisma-order-checkout.repository.ts::customerSnapshot()` for the real shape this test's
 * `customerSnapshot` payload matches field-for-field). No provider HTTP calls are needed -- this call
 * site never invokes the pricing engine at all, which is precisely the bug.
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
  throw new Error('A19 requires an isolated _test database.');
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

describe('A19 Round 5 (blind) — SOFIA canonical checkout order-materialization silently drops trusted destination evidence', () => {
  jest.setTimeout(60000);
  let prisma: PrismaService;
  let service: OrdersService;
  let adminUserId: string;
  let cashSessionId: string;
  let productId: string;
  const admin = {
    sub: '',
    email: 'a19-admin@2x1burgerco.local',
    fullName: 'A19 Admin',
    sessionVersion: 1,
    roles: ['admin'],
    permissions: ['orders.update'],
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    // System under test: real `OrdersService` with a real Prisma connection. None of the stubbed
    // collaborators below (audit/sales/realtime/pricing/tables/deliveryWorkflow/notificationOutbox)
    // are touched by `createFromCanonicalCheckout()` -- confirmed by reading the function body: it
    // only ever calls `this.prisma`, `this.auditService.log`, `this.realtimeService.publish*`, and
    // its own private helpers. The finding is entirely about what THIS function does and does not
    // write to `this.prisma`, so stubbing the untouched collaborators does not weaken the proof.
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

    const category = await prisma.category.findFirst() ?? (await prisma.category.create({ data: { name: 'A19', slug: `a19-${Date.now()}` } }));
    const unit = await prisma.unit.findFirst() ?? (await prisma.unit.create({ data: { name: 'Unidad', code: `a19u${Date.now()}`, abbreviation: 'u' } }));
    const product = await prisma.product.create({
      data: {
        code: `A19-${Date.now()}`,
        name: 'Combo A19',
        salePrice: new Prisma.Decimal(24000),
        categoryId: category.id,
        unitId: unit.id,
        kind: ProductKind.DIRECT_STOCK,
        currentStock: new Prisma.Decimal(25),
        trackStock: true,
        isActive: true,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    const testOrders = await prisma.orderTicket
      .findMany({ where: { customerPhone: { startsWith: '57301999' } }, select: { id: true } })
      .catch(() => [] as { id: string }[]);
    await prisma.orderCheckout.deleteMany({ where: { sourceReference: { startsWith: 'a19-' } } }).catch(() => undefined);
    await prisma.deliveryPricingAudit.deleteMany({ where: { orderTicketId: { in: testOrders.map((o) => o.id) } } }).catch(() => undefined);
    await prisma.deliveryPricingAudit.deleteMany({ where: { calculationVersion: 'delivery-pricing-v-a19-test' } }).catch(() => undefined);
    await prisma.orderTicket.deleteMany({ where: { customerPhone: { startsWith: '57301999' } } }).catch(() => undefined);
    await prisma.sofiaOrderDraft.deleteMany({ where: { customerPhone: { startsWith: '57301999' } } }).catch(() => undefined);
    await prisma.product.deleteMany({ where: { id: productId } }).catch(() => undefined);
    await prisma.cashSession.deleteMany({ where: { id: cashSessionId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: admin.email } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('[FINDING] createFromCanonicalCheckout() never persists trusted GPS coordinates or pricing-authority evidence onto the OrderTicket, and never links the DeliveryPricingAudit anchor -- leaving the order coordinate-blind for dispatch and permanently unable to formally checkout, even though the evidence genuinely existed and was referenced via deliveryQuoteAuditId', async () => {
    const phone = '573019990001';

    // 1. A REAL `DeliveryPricingAudit` row, shaped exactly like what
    //    `DeliveryPricingService::auditEstimate()` persists (`requestJson: sanitizeJson(request)`,
    //    where `DeliveryPricingRequest` carries `latitude`/`longitude` directly -- see
    //    `delivery-pricing.types.ts`) when SOFIA's canonical destination-state authority (A9-A14)
    //    resolved a genuine, in-coverage, GPS-trusted quote during the conversation.
    const trustedLatitude = 3.265;
    const trustedLongitude = -76.543;
    const audit = await prisma.deliveryPricingAudit.create({
      data: {
        requestJson: {
          addressText: 'Calle 5 #10-20',
          reference: 'Calle 5 #10-20',
          latitude: trustedLatitude,
          longitude: trustedLongitude,
          location: { latitude: trustedLatitude, longitude: trustedLongitude, provider: 'whatsapp_live_location', confidence: 'HIGH' },
        } as unknown as Prisma.InputJsonValue,
        resultJson: {
          pricingStatus: 'AUTO_PRICED',
          finalFee: 6500,
          zoneLabel: 'NEAR',
          distanceKm: 2.1,
        } as unknown as Prisma.InputJsonValue,
        finalFee: new Prisma.Decimal(6500),
        suggestedFee: new Prisma.Decimal(6500),
        calculationVersion: 'delivery-pricing-v-a19-test',
      },
    });
    expect(audit.orderTicketId).toBeNull();

    // 2. The matching CONFIRMED `SofiaOrderDraft` -- exactly as `commercial-checkout.service.ts`
    //    leaves it once the customer confirms: `deliveryQuoteAuditId`/`deliveryQuoteVersion` point at
    //    the audit above (see `SofiaOrderDraft` in `prisma/schema.prisma`: there is no lat/lng column
    //    on this model at all -- the audit pointer is the ONLY way back to the coordinates).
    const hash = `a19-draft-hash-${randomUUID()}`;
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
        customerName: 'Cliente A19',
        customerPhone: phone,
        deliveryAddress: 'Calle 5 #10-20',
        deliveryQuoteAuditId: audit.id,
        deliveryQuoteVersion: 1,
        itemsSnapshot: [{ productId, code: 'A19', name: 'Combo A19', quantity: 1, unitPrice: 24000, totalPrice: 24000 }] as unknown as Prisma.InputJsonValue,
        subtotal: new Prisma.Decimal(24000),
        deliveryFee: new Prisma.Decimal(6500),
        total: new Prisma.Decimal(30500),
      },
    });

    // 3. The `OrderCheckout` bound to that draft (version/hash match, `KITCHEN_ELIGIBLE`), carrying
    //    the SAME `customerSnapshot` shape production actually writes -- see
    //    `CheckoutCustomerSnapshot` in `order-checkout.types.ts` and
    //    `prisma-order-checkout.repository.ts::customerSnapshot()`: `deliveryAddress` text +
    //    `deliveryQuoteAuditId`/`deliveryQuoteVersion`, NO lat/lng field exists on that type at all.
    const checkout = await prisma.orderCheckout.create({
      data: {
        source: OrderCheckoutSource.SOFIA,
        sourceReference: `a19-${draft.id}`,
        idempotencyKey: `a19-checkout-${draft.id}`,
        sofiaDraftId: draft.id,
        sofiaDraftVersion: draft.version,
        sofiaDraftHash: draft.draftHash,
        confirmationHash: draft.confirmationHash,
        customerSnapshot: {
          name: 'Cliente A19',
          phoneMasked: '***0001',
          deliveryAddress: 'Calle 5 #10-20',
          deliveryNeighborhood: null,
          deliveryNotes: null,
          deliveryQuoteAuditId: audit.id,
          deliveryQuoteVersion: 1,
        } as unknown as Prisma.InputJsonValue,
        itemsSnapshot: [{ productId, code: 'A19', name: 'Combo A19', quantity: 1, unitPrice: 24000, totalPrice: 24000 }] as unknown as Prisma.InputJsonValue,
        subtotal: new Prisma.Decimal(24000),
        deliveryFee: new Prisma.Decimal(6500),
        total: new Prisma.Decimal(30500),
        fulfillment: OrderTicketType.DELIVERY,
        paymentPreference: SofiaPaymentPreference.CASH_ON_DELIVERY,
        status: OrderCheckoutStatus.KITCHEN_ELIGIBLE,
        version: 1,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    // 4. REAL call into the system under test: the exact function
    //    `KitchenEligibilityService.createOrderTicket()` / the `SOFIA_CREATE_ORDER` SecureCommand
    //    handler invoke to materialize the operational `OrderTicket` once kitchen-eligibility is
    //    settled.
    const result = await service.createFromCanonicalCheckout(checkout.id, admin as never);
    expect(result.replayed).toBe(false);

    const order = await prisma.orderTicket.findUniqueOrThrow({ where: { id: result.order.id } });
    expect(order.type).toBe(OrderTicketType.DELIVERY);
    expect(order.status).toBe(OrderTicketStatus.OPEN);

    // Money and text ARE carried over correctly -- this is not a pricing-amount bug.
    expect(Number(order.deliveryFee)).toBe(6500);
    expect(order.deliveryReference).toBe('Calle 5 #10-20');

    // [FINDING] the GPS coordinates that were genuinely trusted/verified during the SOFIA
    // conversation (and are still sitting, unused, in `audit.requestJson`) NEVER reach the
    // OrderTicket:
    expect(order.deliveryLatitude).toBeNull();
    expect(order.deliveryLongitude).toBeNull();

    // [FINDING] none of the pricing-authority evidence survives either -- the order carries a fee
    // with NO accompanying proof of how/why it was resolved:
    expect(order.deliveryPricingStatus).toBeNull();
    expect(order.deliveryCalculationVersion).toBeNull();
    expect(order.deliveryPricingBreakdown).toBeNull();
    expect(order.deliveryRequiresManualQuote).toBe(false); // not even flagged for human review

    // [FINDING] the audit trail linkage is dropped -- contrast with legacy POS `create()` /
    // `update()`'s `resolveDeliverySnapshot`, which ALWAYS does
    // `deliveryPricingAudit.updateMany({ where: { id, orderTicketId: null }, data: { orderTicketId } })`.
    // An auditor/reconciliation process cannot walk from this OrderTicket back to the
    // `DeliveryPricingAudit` row that actually priced it via any foreign key.
    const auditAfter = await prisma.deliveryPricingAudit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(auditAfter.orderTicketId).toBeNull();

    // [CONSEQUENCE 1 -- fail-closed functional break] the canonical, single-authority checkout gate
    // now PERMANENTLY blocks this order from ever being marked PAID via `OrdersService.checkout()`
    // (the ONLY code path in the entire service that sets `OrderTicketStatus.PAID`), even though the
    // fee was genuinely, correctly resolved by SOFIA's canonical pricing engine at confirmation time:
    const authorization = deriveCheckoutAuthorizationFromOrderSnapshot({
      deliveryPricingStatus: order.deliveryPricingStatus,
      deliveryRequiresManualQuote: order.deliveryRequiresManualQuote,
      deliveryFee: Number(order.deliveryFee),
      hasCalculationSnapshot: Boolean(order.deliveryCalculationVersion?.trim()) && order.deliveryPricingBreakdown != null,
    });
    expect(authorization.canCheckout).toBe(false);
    expect(() =>
      (service as unknown as { assertDeliveryCheckoutAllowed: (o: unknown) => void }).assertDeliveryCheckoutAllowed(order),
    ).toThrow();

    // [CONSEQUENCE 2 -- operational dispatch-safety gap] the courier-dispatch gate
    // (`assertDeliveryOrder`, gating `assignDeliveryRider()`/`claimDelivery()`) checks ONLY
    // `type === DELIVERY` and `status not in {PAID, CANCELLED}` -- it never consults
    // `deliveryLatitude`/`deliveryLongitude`/`deliveryPricingStatus`/`deliveryRequiresManualQuote` at
    // all. So this order, despite having ZERO coordinate evidence anywhere on its row (not even a
    // stale/discarded pair -- genuinely absent, unlike every RULE-2 STALE case A9-A18 cover), is
    // IMMEDIATELY eligible for rider assignment/dispatch -- the two safety gates on the SAME order
    // structurally disagree about whether it is "ready", and the WEAKER one (dispatch) wins:
    expect(() =>
      (service as unknown as { assertDeliveryOrder: (o: unknown) => void }).assertDeliveryOrder(order),
    ).not.toThrow();

    // Sanity/contrast: the legacy POS path (`create()`) correctly fails closed for the identical
    // "no coordinates ever reached the row" scenario -- proving this is specifically a
    // `createFromCanonicalCheckout` wiring gap, not a universal property of the system. A fresh
    // legacy DELIVERY order created with NO address at all is correctly flagged for manual review
    // and correctly blocked from dispatch-readiness signaling:
    const legacyOrder = await service.create(
      {
        type: 'DELIVERY' as never,
        customerName: 'Cliente A19 Legacy',
        customerPhone: '573019990002',
        items: [],
      } as never,
      admin as never,
    );
    const legacyRow = await prisma.orderTicket.findUniqueOrThrow({ where: { id: legacyOrder.id } });
    expect(legacyRow.deliveryPricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(legacyRow.deliveryRequiresManualQuote).toBe(true); // correctly fail-closed via resolveDeliverySnapshot
    await prisma.orderTicket.deleteMany({ where: { id: legacyOrder.id } });
    await prisma.deliveryPricingAudit.deleteMany({ where: { orderTicketId: legacyOrder.id } });
  });
});
