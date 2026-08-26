import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';

/**
 * A65 (blind red team, round 5 pass 65) — FINDING: `GET /products` and `GET /products/:id` leak
 * `costPrice` (and, for `findOne()`, the full recipe cost breakdown — every ingredient's
 * `costPrice` under `recipes[].items[].ingredient`) to ANY authenticated role.
 *
 * ROOT CAUSE
 * ----------
 * `ProductsController` applies `@UseGuards(JwtAuthGuard, RolesGuard)` at class level, but
 * `findAll()`/`findOne()` had no `@Roles`/`@Permissions` decorator — `RolesGuard` short-circuits
 * to `true` when no roles/permissions are required, so ANY authenticated user (including
 * `cashier`, `waiter`, `delivery` — none of whom should see cost/margin data) could read it.
 * `ProductsService.findAll()`/`findOne()` used Prisma `include` (not a curated `select`), so the
 * response carried every scalar column including `costPrice`, and `findOne()` additionally
 * included `recipes.items.ingredient`, exposing every ingredient's `costPrice` — i.e. the full
 * cost/margin structure of every product.
 *
 * Contrast: the sibling `GET /products/sellable` (`findSellable()`) deliberately uses a curated
 * `select` that excludes `costPrice` — proving the intended design is that operational roles
 * should never see cost data.
 *
 * WHY THE ROUTE ITSELF WAS NOT LOCKED DOWN (judgment call)
 * ----------------------------------------------------------
 * Unlike `/ingredients` (gated by `@Roles('ingredients.read')`, a permission only `inventory`/
 * `admin` hold — because ingredients has no legitimate low-privilege consumer), `GET /products`
 * has real legitimate callers beyond admin/inventory: `apps/web/src/app/(app)/pos/page.tsx` (the
 * POS product browser, used by `cashier` and `supervisor`, both of whom lack the `products.read`
 * permission in the real seed — `prisma/seed.ts`) calls `apiFetch('/products')` directly for
 * `salePrice`/`currentStock`/`category` data it needs to sell — NOT for `costPrice`. Fully
 * restricting the route (mirroring `/ingredients`) would have broken that legitimate flow.
 * Instead, the route stays reachable to any authenticated role (preserving current legitimate
 * frontend behavior), and `ProductsService` now shapes the response: it strips `costPrice`
 * (and, in `findOne()`, `recipes[].items[].ingredient.costPrice`) unless the caller holds the
 * `products.update` permission — the SAME privilege tier already gated on
 * `POST /products` / `PATCH /products` (`@Roles('admin', 'inventory')`), i.e. the tier that
 * actually manages product cost data.
 *
 * These tests exercise the REAL, unmocked `ProductsController` -> `ProductsService` chain
 * through the full Nest DI graph (`createTestApp()`) against real Postgres, using the seeded
 * `Hamburguesa 2x1` product (which has a full recipe with costed ingredients) and
 * `Coca-Cola Original 400 ml` (which has a flat `costPrice`) from
 * `apps/api/src/tests/helpers/test-data.ts`.
 */
describe('A65 — GET /products and GET /products/:id no longer leak costPrice / recipe cost to non-privileged roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A65 products cost-leak tests require an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
  });

  async function login(email: string, password: string, xff: string) {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', xff)
      .send({ email, password });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  async function waiterLogin(xff: string) {
    // Operational-role users (waiter/delivery) cannot use POST /auth/login (email+password) —
    // they authenticate via name+accessCode against /auth/waiter-login. Fixtures come from
    // WAITER_ACCESS_NAME/WAITER_ACCESS_CODE in test-data.ts.
    const login = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', xff)
      .send({ name: 'Mesero Principal', accessCode: 'M124578' });
    expect(login.status).toBe(201);
    return login.body.accessToken as string;
  }

  it('FIXED: cashier (no products.update) gets GET /products with the route still reachable (200) but no costPrice on any item', async () => {
    const cashierAccessToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.65.2.1');

    const res = await request(app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${cashierAccessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const product of res.body) {
      expect(product).not.toHaveProperty('costPrice');
    }
    // Fields the real POS product browser (apps/web/.../pos/page.tsx) legitimately needs are
    // still present — proving this is response shaping, not a broken/empty route.
    const soda = res.body.find((product: { code: string }) => product.code === 'CC-ORG-400');
    expect(soda).toBeDefined();
    expect(soda.salePrice).toBeDefined();
    expect(soda.currentStock).toBeDefined();
    expect(soda.category?.name).toBeDefined();
  });

  it('FIXED: cashier GET /products/:id — no costPrice on the product AND no costPrice on any recipe ingredient', async () => {
    const cashierAccessToken = await login('cashier@2x1burgerco.local', 'Cashier12345*', '10.65.2.2');
    const burger = await prisma.product.findUniqueOrThrow({ where: { code: 'HAMB-2X1' } });

    const res = await request(app.getHttpServer())
      .get(`/products/${burger.id}`)
      .set('Authorization', `Bearer ${cashierAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('costPrice');
    expect(res.body.recipes.length).toBeGreaterThan(0);
    for (const recipe of res.body.recipes) {
      expect(recipe.items.length).toBeGreaterThan(0);
      for (const item of recipe.items) {
        expect(item.ingredient).not.toHaveProperty('costPrice');
        // Non-cost ingredient fields must still be present (this is field-level shaping, not a
        // wholesale recipe removal).
        expect(item.ingredient.name).toBeDefined();
        expect(item.quantity).toBeDefined();
      }
    }
  });

  it('FIXED: waiter (holds products.read but NOT products.update — cannot manage cost data) also gets costPrice stripped', async () => {
    const waiterAccessToken = await waiterLogin('10.65.2.3');

    const res = await request(app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${waiterAccessToken}`);

    expect(res.status).toBe(200);
    for (const product of res.body) {
      expect(product).not.toHaveProperty('costPrice');
    }
  });

  it('CONTRAST: admin (holds products.update) still receives full costPrice on GET /products and GET /products/:id — the fix does not break the privileged flow', async () => {
    const adminAccessToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.65.2.4');

    const listRes = await request(app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(listRes.status).toBe(200);
    const soda = listRes.body.find((product: { code: string }) => product.code === 'CC-ORG-400');
    expect(soda).toBeDefined();
    expect(soda).toHaveProperty('costPrice');
    expect(Number(soda.costPrice)).toBe(2500);

    const burger = await prisma.product.findUniqueOrThrow({ where: { code: 'HAMB-2X1' } });
    const oneRes = await request(app.getHttpServer())
      .get(`/products/${burger.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(oneRes.status).toBe(200);
    expect(oneRes.body).toHaveProperty('costPrice');
    expect(oneRes.body.recipes[0].items[0].ingredient).toHaveProperty('costPrice');
  });

  it('CONTRAST: GET /products/sellable (findSellable) is untouched — still excludes costPrice by its own pre-existing curated select', async () => {
    const adminAccessToken = await login('admin@2x1burgerco.local', 'Admin12345*', '10.65.2.5');

    const res = await request(app.getHttpServer())
      .get('/products/sellable')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const product of res.body) {
      expect(product).not.toHaveProperty('costPrice');
    }
  });
});
