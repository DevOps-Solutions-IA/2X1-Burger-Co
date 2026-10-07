import type { INestApplication } from '@nestjs/common';
import { DeliveryWorkflowStatus, OrderTicketStatus, OrderTicketType } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { normalizeAddressText } from '../../common/normalization/customer-normalization';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { OrdersService } from './orders.service';

/**
 * MEDIO-6 (independent review, 2026-10-07): integration coverage for RULE 3 at its real call
 * site — `OrdersService.update()` -> `resolveDeliverySnapshot()`. The unit spec
 * (`spatial-change-classifier.spec.ts`) proves the pure classification function; this spec proves
 * the classification actually drives whether `OrdersService.update()` keeps or discards a
 * previously-persisted `deliveryLatitude`/`deliveryLongitude` pair on a real order.
 */
describe('OrdersService RULE 3 — delivery destination coordinate preservation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrdersService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('RULE 3 destination tests require an isolated _test database.');
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

  async function createDeliveryOrderWithTrustedCoordinates(reference: string) {
    const seed = await seedTestData(prisma);
    const cashSession = await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0 },
    });
    const order = await prisma.orderTicket.create({
      data: {
        number: `RULE3-${Date.now()}-${Math.random()}`,
        type: OrderTicketType.DELIVERY,
        status: OrderTicketStatus.SERVED,
        cashSessionId: cashSession.id,
        createdById: seed.adminUser.id,
        assignedRiderId: seed.deliveryUser.id,
        deliveryWorkflowStatus: DeliveryWorkflowStatus.ASSIGNED,
        deliveryWorkflowVersion: 0,
        customerName: 'Cliente RULE3',
        customerPhone: '3215550111',
        deliveryReference: reference,
        // The real call site persists `deliveryAddressNormalized` as `normalizedAddress ?? rawReference`
        // (see `resolveDeliverySnapshot`); mirror that exactly so `existing.deliveryAddressNormalized`
        // is realistic.
        deliveryAddressNormalized: normalizeAddressText(reference),
        deliveryLatitude: TRUSTED_LAT,
        deliveryLongitude: TRUSTED_LNG,
        deliveryLocationSource: 'commercial_quote',
        deliveryFee: 5_000,
        subtotal: 30_000,
      },
    });
    return { seed, order, actor: actor(seed.adminUser) };
  }

  it('NON_SPATIAL edit (same address, different access note) preserves the trusted coordinates', async () => {
    const fixture = await createDeliveryOrderWithTrustedCoordinates('Carrera 10 # 20-30, casa azul');

    await orders.update(
      fixture.order.id,
      { deliveryReference: 'Carrera 10 # 20-30, porton negro' },
      fixture.actor,
    );

    const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
    expect(Number(updated.deliveryLatitude)).toBe(TRUSTED_LAT);
    expect(Number(updated.deliveryLongitude)).toBe(TRUSTED_LNG);
  });

  it('SPATIAL edit (real street/number change) discards the now-unproven coordinates', async () => {
    const fixture = await createDeliveryOrderWithTrustedCoordinates('Carrera 10 # 20-30, casa azul');

    await orders.update(
      fixture.order.id,
      { deliveryReference: 'Carrera 55 # 80-12, casa azul' },
      fixture.actor,
    );

    const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
    expect(updated.deliveryLatitude).toBeNull();
    expect(updated.deliveryLongitude).toBeNull();
  });

  it('AMBIGUOUS edit (unrecognized segment changes, fail-closed) also discards the coordinates', async () => {
    const fixture = await createDeliveryOrderWithTrustedCoordinates(
      'Carrera 10 # 20-30, patio con flores moradas',
    );

    await orders.update(
      fixture.order.id,
      { deliveryReference: 'Carrera 10 # 20-30, jardin con limonero' },
      fixture.actor,
    );

    const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
    expect(updated.deliveryLatitude).toBeNull();
    expect(updated.deliveryLongitude).toBeNull();
  });

  it('ALTO-1 regression: a real neighborhood change disguised as "frente a" still discards the coordinates', async () => {
    const fixture = await createDeliveryOrderWithTrustedCoordinates(
      'calle 50, frente al parque de belen',
    );

    await orders.update(
      fixture.order.id,
      { deliveryReference: 'calle 50, frente al parque de laureles' },
      fixture.actor,
    );

    const updated = await prisma.orderTicket.findUniqueOrThrow({ where: { id: fixture.order.id } });
    expect(updated.deliveryLatitude).toBeNull();
    expect(updated.deliveryLongitude).toBeNull();
  });
});
