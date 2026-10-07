import type { INestApplication } from '@nestjs/common';
import { DeliveryWorkflowStatus, OrderTicketStatus, OrderTicketType } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { normalizeAddressText } from '../../common/normalization/customer-normalization';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { OrdersService } from './orders.service';

/**
 * fix/delivery-destination-rule1-rule2-reintegration-20261007 — integration coverage for RULE 1
 * (coordinate atomicity) and RULE 2 (coordinate anchor binding) at their real call site:
 * `OrdersService.update()` -> `resolveDeliverySnapshot()`. Same real DB pattern as
 * `orders.rule3-destination-toctou.spec.ts` (RULE 3/5), which this spec does not duplicate or
 * weaken — see that file for the text-classification coverage; this one covers the ORTHOGONAL
 * defect in how the surviving/incoming coordinate pair is assembled once RULE 3/5 has decided a
 * pair may survive.
 *
 * PoC (BEFORE this fix, i.e. against `explicitLatitude ?? existingLatitude` /
 * `explicitLongitude ?? existingLongitude`): the RULE 1 tests below (specifically "a lone new
 * latitude...") FAIL on unfixed `orders.service.ts` — the persisted longitude is the STALE
 * existing value while the latitude is the FRESH submitted one, a synthetic point. Confirmed by
 * temporarily reverting `resolveDeliverySnapshot`'s coordinate resolution to the pre-fix
 * `?? `-chain and re-running this file (see the delivery report's PoC section for the captured
 * before/after `jest` output); not re-run automatically here to avoid shipping a test that
 * depends on checking out old code.
 */
describe('OrdersService RULE 1/RULE 2 — delivery destination coordinate atomicity and anchor binding', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrdersService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('RULE 1/RULE 2 destination tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    orders = app.get(OrdersService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  function actor(user: { id: string; email: string; fullName: string }): AuthUser {
    return {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      sessionVersion: 0,
      roles: ['admin'],
      permissions: ['delivery.update'],
    };
  }

  const TRUSTED_LAT = 4.6097;
  const TRUSTED_LNG = -74.0817;
  const TRUSTED_RECEIVED_AT = new Date('2026-01-01T12:00:00.000Z');

  async function createDeliveryOrderWithTrustedCoordinates(reference: string) {
    const seed = await seedTestData(prisma);
    const cashSession = await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0 },
    });
    const order = await prisma.orderTicket.create({
      data: {
        number: `RULE12-${Date.now()}-${Math.random()}`,
        type: OrderTicketType.DELIVERY,
        status: OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        assignedRiderId: seed.deliveryUser.id,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.ASSIGNED,
        deliveryWorkflowVersion: 0,
        customerName: 'Cliente RULE12',
        customerPhone: '3215550112',
        deliveryReference: reference,
        deliveryAddressNormalized: normalizeAddressText(reference),
        deliveryLatitude: TRUSTED_LAT,
        deliveryLongitude: TRUSTED_LNG,
        deliveryLocationSource: 'whatsapp_live_location',
        deliveryLocationReceivedAt: TRUSTED_RECEIVED_AT,
        deliveryFee: 5_000,
        subtotal: 30_000,
      },
    });
    return { seed, order, actor: actor(seed.adminUser) };
  }

  describe('RULE 1 — coordinate atomicity', () => {
    it('a lone new latitude (no new longitude), same address, never combines with the stale existing longitude', async () => {
      const fixture = await createDeliveryOrderWithTrustedCoordinates('Carrera 10 # 20-30, casa azul');
      const freshLatitudeOnly = 4.711; // deliberately far from TRUSTED_LAT

      await orders.update(
        fixture.order.id,
        {
          // Same text -> RULE 3/5 would keep the existing pair trustworthy if nothing new arrived.
          deliveryReference: 'Carrera 10 # 20-30, casa azul',
          deliveryLatitude: freshLatitudeOnly,
          // deliveryLongitude intentionally omitted — this is the exact RULE 1 reproduction.
        },
        fixture.actor,
      );

      const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
      const persistedLat = updated.deliveryLatitude != null ? Number(updated.deliveryLatitude) : null;
      const persistedLng = updated.deliveryLongitude != null ? Number(updated.deliveryLongitude) : null;

      // THE BUG this closes: before the fix, persistedLat === freshLatitudeOnly (4.711) while
      // persistedLng === TRUSTED_LNG (the stale axis) — a synthetic point never proven as a pair.
      expect([persistedLat, persistedLng]).not.toEqual([freshLatitudeOnly, TRUSTED_LNG]);
      // The only two legal outcomes: either the full existing pair survives unchanged (since only
      // one axis was submitted, the partial submission is discarded), or both become null. Given
      // a trusted existing pair and a non-spatial (unchanged) address, it must be the former.
      expect(persistedLat).toBe(TRUSTED_LAT);
      expect(persistedLng).toBe(TRUSTED_LNG);
    });

    it('a lone new longitude (no new latitude) is likewise never combined with the stale existing latitude', async () => {
      const fixture = await createDeliveryOrderWithTrustedCoordinates('Carrera 10 # 20-30, casa azul');
      const freshLongitudeOnly = -70.1234;

      await orders.update(
        fixture.order.id,
        {
          deliveryReference: 'Carrera 10 # 20-30, casa azul',
          deliveryLongitude: freshLongitudeOnly,
        },
        fixture.actor,
      );

      const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
      const persistedLat = updated.deliveryLatitude != null ? Number(updated.deliveryLatitude) : null;
      const persistedLng = updated.deliveryLongitude != null ? Number(updated.deliveryLongitude) : null;

      expect([persistedLat, persistedLng]).not.toEqual([TRUSTED_LAT, freshLongitudeOnly]);
      expect(persistedLat).toBe(TRUSTED_LAT);
      expect(persistedLng).toBe(TRUSTED_LNG);
    });

    it('a full new pair (both axes) always replaces the existing pair atomically', async () => {
      const fixture = await createDeliveryOrderWithTrustedCoordinates('Carrera 10 # 20-30, casa azul');
      const freshLat = 4.65;
      const freshLng = -74.1;

      await orders.update(
        fixture.order.id,
        {
          deliveryReference: 'Carrera 10 # 20-30, casa azul',
          deliveryLatitude: freshLat,
          deliveryLongitude: freshLng,
        },
        fixture.actor,
      );

      const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
      expect(Number(updated.deliveryLatitude)).toBe(freshLat);
      expect(Number(updated.deliveryLongitude)).toBe(freshLng);
    });
  });

  describe('RULE 2 — coordinate anchor binding (deliveryLocationReceivedAt)', () => {
    it('a SPATIAL edit that discards the coordinate pair also discards the anchor timestamp — never left dangling', async () => {
      const fixture = await createDeliveryOrderWithTrustedCoordinates('Carrera 10 # 20-30, casa azul');

      await orders.update(
        fixture.order.id,
        { deliveryReference: 'Carrera 55 # 80-12, casa azul' }, // real street/number change -> SPATIAL
        fixture.actor,
      );

      const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
      expect(updated.deliveryLatitude).toBeNull();
      expect(updated.deliveryLongitude).toBeNull();
      // THE BUG this closes: before the fix, deliveryLocationReceivedAt fell back to the OLD
      // `TRUSTED_RECEIVED_AT` here even though both coordinates are null — a dangling anchor.
      expect(updated.deliveryLocationReceivedAt).toBeNull();
    });

    it('a NON_SPATIAL edit that carries the coordinate pair forward also preserves the ORIGINAL anchor timestamp, never re-stamping it to now', async () => {
      const fixture = await createDeliveryOrderWithTrustedCoordinates('Carrera 10 # 20-30, casa azul');

      await orders.update(
        fixture.order.id,
        { deliveryReference: 'Carrera 10 # 20-30, porton negro' }, // instruction-only -> NON_SPATIAL
        fixture.actor,
      );

      const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
      expect(Number(updated.deliveryLatitude)).toBe(TRUSTED_LAT);
      expect(Number(updated.deliveryLongitude)).toBe(TRUSTED_LNG);
      // THE BUG this closes: before the fix, this was unconditionally re-stamped to `new Date()`
      // on every turn a pair happened to be present, misrepresenting when it was actually
      // captured.
      expect(updated.deliveryLocationReceivedAt?.toISOString()).toBe(TRUSTED_RECEIVED_AT.toISOString());
    });

    it('a freshly submitted explicit pair gets a FRESH anchor timestamp (not the old one)', async () => {
      const fixture = await createDeliveryOrderWithTrustedCoordinates('Carrera 10 # 20-30, casa azul');
      const freshLat = 4.65;
      const freshLng = -74.1;
      const before = new Date();

      await orders.update(
        fixture.order.id,
        {
          deliveryReference: 'Carrera 10 # 20-30, casa azul',
          deliveryLatitude: freshLat,
          deliveryLongitude: freshLng,
        },
        fixture.actor,
      );

      const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
      expect(updated.deliveryLocationReceivedAt).not.toBeNull();
      expect(updated.deliveryLocationReceivedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updated.deliveryLocationReceivedAt!.toISOString()).not.toBe(TRUSTED_RECEIVED_AT.toISOString());
    });

    it('a partial (RULE 1 discarded) submission on a non-spatial edit preserves BOTH the existing pair and its original anchor together', async () => {
      const fixture = await createDeliveryOrderWithTrustedCoordinates('Carrera 10 # 20-30, casa azul');

      await orders.update(
        fixture.order.id,
        {
          deliveryReference: 'Carrera 10 # 20-30, casa azul',
          deliveryLatitude: 9.999, // partial — no longitude — must be discarded, never combined
        },
        fixture.actor,
      );

      const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
      expect(Number(updated.deliveryLatitude)).toBe(TRUSTED_LAT);
      expect(Number(updated.deliveryLongitude)).toBe(TRUSTED_LNG);
      expect(updated.deliveryLocationReceivedAt?.toISOString()).toBe(TRUSTED_RECEIVED_AT.toISOString());
    });
  });
});
