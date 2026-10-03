import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { CashSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A73/A74 (blind red-team, round 5 pass 73/74) — FINDING (CRITICAL, live PoC-confirmed by the
 * auditor): A69/A70 fixed `items[].product.costPrice` leaking through `orderInclude` on the
 * READ surface only (`findAll()`/`findOne()`, via `canViewOrderCost()`/`stripOrderItemsCost()`).
 * Every MUTATION/workflow endpoint in `orders.service.ts` that also returns an `orderInclude`-
 * shaped order straight to its HTTP response was left unguarded — reachable by `waiter`/`cashier`/
 * `supervisor`/`delivery`, none of whom (besides `admin`/`inventory`) hold `products.update`. The
 * auditor's live PoC: a seeded `waiter` called `POST /orders` to add an item to a dine-in order
 * and got the real `costPrice` back in the response JSON. A `cashier` calling `POST /sales` got
 * the same shape.
 *
 * === THE FIX ===
 * Every call site below now applies the SAME `canViewOrderCost()`/`stripOrderItemsCost()` gate
 * `findAll()`/`findOne()` already used, sourced from `actor.permissions` (already carried on the
 * `AuthUser` passed into these methods) or from a new `viewerPermissions`/`permissions` parameter
 * threaded from the controller (`checkout()`/`reopen()`, which previously only received
 * `actorId: string`).
 *
 * This suite is an EXHAUSTIVE sweep, not just the 3 named endpoints (`POST /orders`,
 * `PATCH /orders/:id`, `POST /sales`) — see `sales.a73-mutation-cost-leak-fix.spec.ts` for the
 * `/sales` side.
 *
 * These tests exercise the REAL, unmocked `OrdersController` -> `OrdersService` chain through the
 * full Nest DI graph (`createTestApp()`) against real Postgres.
 */
describe('A73/A74 — Orders module no longer leaks costPrice through mutation/workflow endpoints', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let loginAttempt = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A73/A74 orders mutation-cost-leak tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    await resetDatabase(prisma);
    loginAttempt = 0;
  });

  async function login(email: string, password: string) {
    loginAttempt += 1;
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', `10.73.${loginAttempt}.1`)
      .send({ email, password });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  async function waiterLogin() {
    loginAttempt += 1;
    const res = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', `10.73.${loginAttempt}.2`)
      .send({ name: 'Mesero Principal', accessCode: 'M124578' });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  async function deliveryLogin() {
    loginAttempt += 1;
    const res = await request(app.getHttpServer())
      .post('/auth/delivery-login')
      .set('X-Forwarded-For', `10.73.${loginAttempt}.3`)
      .send({ name: 'Domiciliario Principal', accessCode: 'D124578' });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  /** Seeds catalog/roles + an OPEN cash session (opened directly against Postgres, mirroring
   * `orders.a54-waiter-price-manipulation.spec.ts`), and logs in admin/cashier/waiter tokens.
   * `soda` (DIRECT_STOCK, salePrice 4500, costPrice 2500) is used everywhere below — a NONZERO,
   * directly-set `costPrice`, matching the auditor's own note that `burger`-style prepared items
   * only report a nonzero cost after a purchase has been recorded. */
  async function seedContext() {
    const seed = await seedTestData(prisma);
    await prisma.cashSession.create({
      data: { openedById: seed.adminUser.id, openingAmount: 0, status: CashSessionStatus.OPEN },
    });
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*');
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*');
    return { seed, adminToken, cashierToken };
  }

  function assertNoCostPrice(body: unknown) {
    expect(JSON.stringify(body)).not.toContain('costPrice');
  }

  /** `apps/api/src/tests/helpers/test-data.ts` (the test-only seed) is intentionally more minimal
   * than the real `prisma/seed.ts` production seed: its `cashier` role holds no `delivery.*`
   * permission at all, whereas production's `cashier` DOES hold `delivery.read`/`delivery.assign`/
   * `delivery.update` (see `prisma/seed.ts`'s `roles.cashier`). Rather than widen the shared
   * `test-data.ts` fixture (used by ~30 other spec files) just for this suite, grant the missing
   * permission directly to the test cashier role here, matching production reality, scoped to the
   * single test that needs it. */
  async function grantPermissionToRole(roleId: string, code: string) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      update: {},
      create: { roleId, permissionId: permission.id },
    });
  }

  function findItemsProducts(order: { items: Array<{ product: Record<string, unknown> }> }) {
    return order.items.map((item) => item.product);
  }

  describe('POST /orders (create) — named finding', () => {
    it('FIXED: waiter response strips costPrice from items[].product', async () => {
      const { seed } = await seedContext();
      const waiterToken = await waiterLogin();

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({
          type: 'DINE_IN',
          tableId: seed.tableOne.id,
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });

      expect(res.status).toBe(201);
      assertNoCostPrice(res.body);
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
        expect(product.name).toBeDefined();
      }
      expect(Number(res.body.subtotal)).toBe(4500);
    });

    it('CONTRAST: admin (holds products.update) still receives real costPrice', async () => {
      const { seed, adminToken } = await seedContext();

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });

      expect(res.status).toBe(201);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('PATCH /orders/:id (update) — named finding', () => {
    async function seedCashierEditableOrder() {
      const ctx = await seedContext();
      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: ctx.seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      return { ...ctx, orderId: createRes.body.id as string };
    }

    it('FIXED: cashier response strips costPrice from items[].product', async () => {
      const { cashierToken, orderId } = await seedCashierEditableOrder();

      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ notes: 'Sin cebolla' });

      expect(res.status).toBe(200);
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice', async () => {
      const { adminToken, orderId } = await seedCashierEditableOrder();

      const res = await request(app.getHttpServer())
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Sin cebolla' });

      expect(res.status).toBe(200);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('PUT /orders/:id/items (replaceItems) — sweep finding', () => {
    async function seedEditableOrder() {
      const ctx = await seedContext();
      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: ctx.seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      return { ...ctx, orderId: createRes.body.id as string };
    }

    it('FIXED: cashier response strips costPrice from items[].product', async () => {
      const { cashierToken, orderId, seed } = await seedEditableOrder();

      const res = await request(app.getHttpServer())
        .put(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ items: [{ productId: seed.soda.id, quantity: 2 }] });

      expect(res.status).toBe(200);
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice', async () => {
      const { adminToken, orderId, seed } = await seedEditableOrder();

      const res = await request(app.getHttpServer())
        .put(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: seed.soda.id, quantity: 2 }] });

      expect(res.status).toBe(200);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('POST /orders/waiter-sync (syncWaiterOrder) — sweep finding', () => {
    it('FIXED: waiter response strips costPrice from items[].product (fresh create branch)', async () => {
      const { seed } = await seedContext();
      const waiterToken = await waiterLogin();

      const res = await request(app.getHttpServer())
        .post('/orders/waiter-sync')
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({
          tableId: seed.tableOne.id,
          items: [{ productId: seed.soda.id, quantity: 1 }],
          clientMutationId: 'a73-sync-1',
        });

      expect(res.status).toBe(201);
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice via waiter-sync', async () => {
      const { seed, adminToken } = await seedContext();

      const res = await request(app.getHttpServer())
        .post('/orders/waiter-sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tableId: seed.tableOne.id,
          items: [{ productId: seed.soda.id, quantity: 1 }],
          clientMutationId: 'a73-sync-2',
        });

      expect(res.status).toBe(201);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('POST /orders/:id/claim — sweep finding', () => {
    it('FIXED: waiter response strips costPrice from items[].product when claiming an unassigned dine-in order', async () => {
      const { seed, adminToken } = await seedContext();
      const waiterToken = await waiterLogin();

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DINE_IN',
          tableId: seed.tableOne.id,
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/claim`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ reason: 'Tomo la mesa' });

      expect(res.status).toBe(201);
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });
  });

  describe('POST /orders/:id/kitchen-transition (transitionKitchen) — sweep finding', () => {
    it('FIXED: cashier response strips costPrice from items[].product', async () => {
      const { seed, adminToken, cashierToken } = await seedContext();

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.revision).toBe(0);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/kitchen-transition`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ action: 'START_PREPARATION', expectedRevision: 0 });

      expect(res.status).toBe(201);
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice', async () => {
      const { seed, adminToken } = await seedContext();

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/kitchen-transition`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'START_PREPARATION', expectedRevision: 0 });

      expect(res.status).toBe(201);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('POST /orders/:id/checkout — named judgment-call finding (order AND embedded sale)', () => {
    it('FIXED: cashier response strips costPrice from both order.items and sale.items', async () => {
      const { seed, adminToken, cashierToken } = await seedContext();

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: seed.soda.id, quantity: 1, unitPrice: 4500 }],
        });
      expect(createRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/checkout`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ payments: [{ paymentMethodId: seed.paymentCash.id, amount: 4500 }] });

      expect(res.status).toBe(201);
      assertNoCostPrice(res.body);
      for (const product of findItemsProducts(res.body.order)) {
        expect(product).not.toHaveProperty('costPrice');
      }
      for (const product of findItemsProducts(res.body.sale)) {
        expect(product).not.toHaveProperty('costPrice');
      }
      expect(Number(res.body.sale.total)).toBe(4500);
    });

    it('CONTRAST: admin still receives real costPrice on both order and sale', async () => {
      const { seed, adminToken } = await seedContext();

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: seed.soda.id, quantity: 1, unitPrice: 4500 }],
        });
      expect(createRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/checkout`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ payments: [{ paymentMethodId: seed.paymentCash.id, amount: 4500 }] });

      expect(res.status).toBe(201);
      expect(Number(res.body.order.items[0].product.costPrice)).toBe(2500);
      expect(Number(res.body.sale.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('POST /orders/:id/reopen — sweep finding', () => {
    it('FIXED: cashier response strips costPrice from items[].product', async () => {
      const { seed, adminToken, cashierToken } = await seedContext();

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: seed.soda.id, quantity: 1, unitPrice: 4500 }],
        });
      expect(createRes.status).toBe(201);

      const checkoutRes = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/checkout`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ payments: [{ paymentMethodId: seed.paymentCash.id, amount: 4500 }] });
      expect(checkoutRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/reopen`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ reason: 'El cliente pidio corregir la cuenta' });

      expect(res.status).toBe(201);
      for (const product of findItemsProducts(res.body.orderTicket)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice', async () => {
      const { seed, adminToken } = await seedContext();

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: seed.soda.id, quantity: 1, unitPrice: 4500 }],
        });
      expect(createRes.status).toBe(201);

      const checkoutRes = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/checkout`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ payments: [{ paymentMethodId: seed.paymentCash.id, amount: 4500 }] });
      expect(checkoutRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/reopen`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'El cliente pidio corregir la cuenta' });

      expect(res.status).toBe(201);
      expect(Number(res.body.orderTicket.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('Delivery workflow endpoints — sweep finding', () => {
    it('FIXED: POST /orders/:id/assign-rider (cashier) strips costPrice', async () => {
      const { seed, adminToken } = await seedContext();
      // Production's cashier role holds `delivery.assign` (see prisma/seed.ts); the minimal test
      // fixture (test-data.ts) does not — grant it here so this test exercises the SAME
      // permission tier the finding actually targets (see grantPermissionToRole()'s doc comment).
      await grantPermissionToRole(seed.cashierRole.id, 'delivery.assign');
      const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*');
      const deliveryUser = await prisma.user.findUniqueOrThrow({
        where: { email: 'delivery@2x1burgerco.local' },
      });

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DELIVERY',
          customerName: 'Cliente Domicilio',
          customerPhone: '3001234567',
          deliveryReference: 'Cra 10 # 10-10',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/assign-rider`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ riderId: deliveryUser.id, notes: 'Ruta centro' });

      expect(res.status).toBe(201);
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice on assign-rider', async () => {
      const { seed, adminToken } = await seedContext();
      const deliveryUser = await prisma.user.findUniqueOrThrow({
        where: { email: 'delivery@2x1burgerco.local' },
      });

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DELIVERY',
          customerName: 'Cliente Domicilio',
          customerPhone: '3001234567',
          deliveryReference: 'Cra 10 # 10-10',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/assign-rider`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ riderId: deliveryUser.id, notes: 'Ruta centro' });

      expect(res.status).toBe(201);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });

    it('FIXED: POST /orders/:id/claim-delivery (delivery role) strips costPrice', async () => {
      const { seed, adminToken } = await seedContext();
      const riderToken = await deliveryLogin();

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DELIVERY',
          customerName: 'Cliente Domicilio',
          customerPhone: '3001234567',
          deliveryReference: 'Cra 10 # 10-10',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/claim-delivery`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ reason: 'Tomo la ruta' });

      expect(res.status).toBe(201);
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('FIXED: POST /orders/:id/delivery-workflow (delivery role) strips costPrice', async () => {
      const { seed, adminToken } = await seedContext();
      const riderToken = await deliveryLogin();
      const deliveryUser = await prisma.user.findUniqueOrThrow({
        where: { email: 'delivery@2x1burgerco.local' },
      });

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DELIVERY',
          customerName: 'Cliente Domicilio',
          customerPhone: '3001234567',
          deliveryReference: 'Cra 10 # 10-10',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);

      const assignRes = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/assign-rider`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ riderId: deliveryUser.id, notes: 'Ruta centro' });
      expect(assignRes.status).toBe(201);

      // The workflow policy (`DeliveryWorkflowPolicy.evaluate()`) only allows ASSIGNED ->
      // IN_TRANSIT once the underlying order is SERVED (`mapFulfillmentReadiness()`) — mirrors
      // `app.critical.spec.ts`'s "delivery rider login, assignment and workflow transitions"
      // fixture, which sets this same column directly for the same reason.
      await prisma.orderTicket.update({
        where: { id: createRes.body.id },
        data: { status: 'SERVED', servedAt: new Date() },
      });

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/delivery-workflow`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ workflowStatus: 'IN_TRANSIT', notes: 'Saliendo a domicilio' });

      expect(res.status).toBe(201);
      for (const product of findItemsProducts(res.body)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice on delivery-workflow', async () => {
      const { seed, adminToken } = await seedContext();
      const deliveryUser = await prisma.user.findUniqueOrThrow({
        where: { email: 'delivery@2x1burgerco.local' },
      });

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DELIVERY',
          customerName: 'Cliente Domicilio',
          customerPhone: '3001234567',
          deliveryReference: 'Cra 10 # 10-10',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);

      const assignRes = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/assign-rider`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ riderId: deliveryUser.id, notes: 'Ruta centro' });
      expect(assignRes.status).toBe(201);

      await prisma.orderTicket.update({
        where: { id: createRes.body.id },
        data: { status: 'SERVED', servedAt: new Date() },
      });

      const res = await request(app.getHttpServer())
        .post(`/orders/${createRes.body.id}/delivery-workflow`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ workflowStatus: 'IN_TRANSIT', notes: 'Saliendo a domicilio' });

      expect(res.status).toBe(201);
      expect(Number(res.body.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('POST /orders/delivery-location-inbox/:id/resolve (resolveDeliveryLocationInbox) — sweep finding', () => {
    it('FIXED: cashier response strips costPrice from the APPLIED-replay branch', async () => {
      const { seed, adminToken } = await seedContext();
      // Same test-fixture/production-seed gap as assign-rider above: this route requires
      // `delivery.update`, which production's `cashier` role holds but the minimal test fixture
      // does not.
      await grantPermissionToRole(seed.cashierRole.id, 'delivery.update');
      const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*');

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DELIVERY',
          customerName: 'Cliente Domicilio',
          customerPhone: '3001234567',
          deliveryReference: 'Cra 10 # 10-10',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.id as string;

      const inbox = await prisma.deliveryLocationInbox.create({
        data: {
          latitude: 3.4516,
          longitude: -76.532,
          matchStatus: 'APPLIED',
          matchedOrderId: orderId,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/orders/delivery-location-inbox/${inbox.id}/resolve`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ orderId });

      expect(res.status).toBe(201);
      expect(res.body.order).toBeDefined();
      for (const product of findItemsProducts(res.body.order)) {
        expect(product).not.toHaveProperty('costPrice');
      }
    });

    it('CONTRAST: admin still receives real costPrice', async () => {
      const { seed, adminToken } = await seedContext();

      const createRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'DELIVERY',
          customerName: 'Cliente Domicilio',
          customerPhone: '3001234567',
          deliveryReference: 'Cra 10 # 10-10',
          items: [{ productId: seed.soda.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.id as string;

      const inbox = await prisma.deliveryLocationInbox.create({
        data: {
          latitude: 3.4516,
          longitude: -76.532,
          matchStatus: 'APPLIED',
          matchedOrderId: orderId,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/orders/delivery-location-inbox/${inbox.id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderId });

      expect(res.status).toBe(201);
      expect(Number(res.body.order.items[0].product.costPrice)).toBe(2500);
    });
  });
});
