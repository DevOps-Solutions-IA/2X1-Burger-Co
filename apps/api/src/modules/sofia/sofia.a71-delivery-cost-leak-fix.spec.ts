import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A71 (blind red-team, round 5 pass 71) — FINDING (MEDIUM): `SofiaService.listDeliveryOrders()`
 * and `findDeliveryOrder()` (served by `GET /admin/sofia/delivery-orders` and
 * `GET /admin/sofia/delivery-orders/:id`, controller-gated only by
 * `@Roles('admin', 'cashier', 'supervisor')` + `@Permissions('delivery.read')`) used an unshaped
 * `include: { orderTicket: { include: { items: { include: { product: true } } } } }`, leaking the
 * raw `product.costPrice` (supplier cost) to any authenticated `cashier` (who holds `delivery.read`
 * but not `products.update`, the established `COST_VISIBILITY_PERMISSION` gate already used by
 * `products.service.ts`/`reports.service.ts`/`ingredients.service.ts`/`sales.service.ts`/
 * `orders.service.ts` from prior rounds). The `SofiaAdminResponseSanitizerInterceptor` applied to
 * this controller only masks phone-number-shaped keys and has no notion of cost visibility, so it
 * did not help here.
 *
 * === THE FIX ===
 * Mirrors `orders.service.ts`'s `canViewOrderCost()`/`stripOrderItemsCost()` pattern (A69/A70,
 * already in this branch): `@CurrentUser('permissions')` is now threaded through
 * `listDeliveryOrders()`/`findDeliveryOrder()` in `SofiaController`, and `costPrice` is stripped
 * from every nested `orderTicket.items[].product` unless the caller holds `products.update`. The
 * fix is scoped to these two controller-facing GET read methods only — `findDeliveryOrder()`'s
 * internal reuse by `updateDeliveryOrderStatus()` (an admin/supervisor-only mutation endpoint, not
 * part of this finding) now goes through a separate raw-fetch helper
 * (`getDeliveryOrderRecord()`) and is therefore completely unaffected by this fix.
 *
 * These tests exercise the REAL, unmocked `SofiaController` -> `SofiaService` chain through the
 * full Nest DI graph (`createTestApp()`) against real Postgres.
 */
describe('A71 — SOFIA delivery-orders read endpoints no longer leak product.costPrice to cashier', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A71 sofia delivery-cost-leak tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => resetDatabase(prisma));

  async function login(email: string, password: string, xff: string) {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', xff)
      .send({ email, password });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  /** Creates a real POS order (2x Coca-Cola, salePrice 4500 / costPrice 2500) via the canonical
   * checkout authority, then attaches a WhatsApp/Sofía delivery-order record on top of it — the
   * same shape SOFIA's real order-materialization flow produces — so the nested
   * `orderTicket.items[].product.costPrice` reflects a REAL Prisma read, not a mocked payload. */
  // The shared `seedTestData()` fixture's `cashier` role omits `delivery.read` (unlike the real
  // production seed at `prisma/seed.ts`, where `cashier` DOES hold `delivery.read` — the exact
  // premise of this finding). Grant it here, scoped to this test file only, so the cashier login
  // below reflects the real production RBAC shape this finding is about, without touching the
  // shared fixture used by every other spec file.
  async function grantCashierDeliveryRead() {
    const [cashierRole, deliveryReadPermission] = await Promise.all([
      prisma.role.findFirstOrThrow({ where: { name: 'cashier' } }),
      prisma.permission.findFirstOrThrow({ where: { code: 'delivery.read' } }),
    ]);
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: cashierRole.id, permissionId: deliveryReadPermission.id } },
      update: {},
      create: { roleId: cashierRole.id, permissionId: deliveryReadPermission.id },
    });
  }

  async function seedDeliveryOrderWithCost(xffPrefix: string) {
    const seed = await seedTestData(prisma);
    await grantCashierDeliveryRead();
    const adminToken = await login('admin@2x1burgerco.local', 'Admin12345*', `${xffPrefix}.1`);
    const cashierToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', `${xffPrefix}.2`);

    const openRes = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 100000 });
    expect(openRes.status).toBe(201);

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'COUNTER',
        items: [{ productId: seed.soda.id, quantity: 2, unitPrice: 4500 }],
      });
    expect(createRes.status).toBe(201);
    const orderTicketId = createRes.body.id as string;

    const deliveryOrder = await prisma.whatsappDeliveryOrder.create({
      data: {
        orderTicketId,
        itemsSnapshot: [{ productId: seed.soda.id, quantity: 2 }],
        subtotal: 9000,
        total: 9000,
        customerNameSnapshot: 'Cliente A71',
        customerPhoneSnapshot: '+57 316 555 0199',
        deliveryAddressSnapshot: 'Calle A71 # 1-71',
      },
    });

    return { seed, adminToken, cashierToken, deliveryOrderId: deliveryOrder.id };
  }

  describe('GET /admin/sofia/delivery-orders', () => {
    it('FIXED: cashier response contains no costPrice anywhere, product name/items still present', async () => {
      const { cashierToken } = await seedDeliveryOrderWithCost('10.71.20');

      const res = await request(app.getHttpServer())
        .get('/admin/sofia/delivery-orders')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('costPrice');

      const order = res.body[0];
      expect(order.orderTicket).toBeDefined();
      expect(Number(order.subtotal)).toBe(9000);
      for (const item of order.orderTicket.items) {
        expect(item.product).not.toHaveProperty('costPrice');
        expect(item.product.name).toBeDefined();
      }
    });

    it('CONTRAST: admin (holds products.update) still receives real costPrice', async () => {
      const { adminToken } = await seedDeliveryOrderWithCost('10.71.21');

      const res = await request(app.getHttpServer())
        .get('/admin/sofia/delivery-orders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const order = res.body[0];
      expect(Number(order.orderTicket.items[0].product.costPrice)).toBe(2500);
    });
  });

  describe('GET /admin/sofia/delivery-orders/:id', () => {
    it('FIXED: cashier response contains no costPrice anywhere for the detail route', async () => {
      const { cashierToken, deliveryOrderId } = await seedDeliveryOrderWithCost('10.71.22');

      const res = await request(app.getHttpServer())
        .get(`/admin/sofia/delivery-orders/${deliveryOrderId}`)
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('costPrice');
      for (const item of res.body.orderTicket.items) {
        expect(item.product).not.toHaveProperty('costPrice');
        expect(item.product.name).toBeDefined();
      }
    });

    it('CONTRAST: admin still receives real costPrice on the detail route', async () => {
      const { adminToken, deliveryOrderId } = await seedDeliveryOrderWithCost('10.71.23');

      const res = await request(app.getHttpServer())
        .get(`/admin/sofia/delivery-orders/${deliveryOrderId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Number(res.body.orderTicket.items[0].product.costPrice)).toBe(2500);
    });
  });
});
