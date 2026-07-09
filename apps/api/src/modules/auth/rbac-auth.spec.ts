import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import {
  resetDatabase,
  seedTestData,
  WAITER_ACCESS_NAME,
  WAITER_ACCESS_CODE,
  DELIVERY_ACCESS_NAME,
  DELIVERY_ACCESS_CODE,
} from '../../tests/helpers/test-data';
import { PrismaService } from '../../prisma/prisma.service';

type LoginResponse = { accessToken: string; refreshToken: string };

describe('RBAC - Autorizacion por roles (H-01, H-02)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let loginAttempt = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/inventory_fastfood_system?schema=public';
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl.includes('_test')) {
      throw new Error(`RBAC tests require a _test database. Received DATABASE_URL=${databaseUrl}`);
    }
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? 'change-this-access-secret-with-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? 'change-this-refresh-secret-with-at-least-32-characters';

    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
    loginAttempt = 0;
  });

  async function login(email: string, password: string): Promise<LoginResponse> {
    loginAttempt += 1;
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', `10.0.0.${loginAttempt}`)
      .send({ email, password });

    expect(response.status).toBe(201);
    return {
      accessToken: response.body.accessToken as string,
      refreshToken: response.body.refreshToken as string,
    };
  }

  async function waiterLogin(): Promise<LoginResponse> {
    loginAttempt += 1;
    const response = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', `10.0.0.${loginAttempt}`)
      .send({ name: WAITER_ACCESS_NAME, accessCode: WAITER_ACCESS_CODE });

    expect(response.status).toBe(201);
    return {
      accessToken: response.body.accessToken as string,
      refreshToken: response.body.refreshToken as string,
    };
  }

  async function deliveryLogin(): Promise<LoginResponse> {
    loginAttempt += 1;
    const response = await request(app.getHttpServer())
      .post('/auth/delivery-login')
      .set('X-Forwarded-For', `10.0.0.${loginAttempt}`)
      .send({ name: DELIVERY_ACCESS_NAME, accessCode: DELIVERY_ACCESS_CODE });

    expect(response.status).toBe(201);
    return {
      accessToken: response.body.accessToken as string,
      refreshToken: response.body.refreshToken as string,
    };
  }

  // ─── Helper: perform authenticated GET ───────────────────────────────
  async function authedGet(path: string, token: string): Promise<request.Response> {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  }

  // ─── H-01: Reportes financieros ──────────────────────────────────────
  describe('H-01: Reportes financieros', () => {
    it('Admin puede acceder a /reports/daily (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/reports/daily', accessToken);
      expect(res.status).toBe(200);
    });

    it('Admin puede acceder a /reports/operational (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/reports/operational', accessToken);
      expect(res.status).toBe(200);
    });

    it('Admin puede acceder a /reports/best-sellers (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/reports/best-sellers', accessToken);
      expect(res.status).toBe(200);
    });

    it('Admin puede acceder a /reports/sales-by-hour (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/reports/sales-by-hour', accessToken);
      expect(res.status).toBe(200);
    });

    it('Admin puede acceder a /reports/inventory-summary (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/reports/inventory-summary', accessToken);
      expect(res.status).toBe(200);
    });

    it('Admin puede acceder a /reports/daily-closures (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/reports/daily-closures', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter NO puede acceder a /reports/daily (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/reports/daily', accessToken);
      expect(res.status).toBe(403);
    });

    it('Waiter NO puede acceder a /reports/operational (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/reports/operational', accessToken);
      expect(res.status).toBe(403);
    });

    it('Waiter NO puede acceder a /reports/best-sellers (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/reports/best-sellers', accessToken);
      expect(res.status).toBe(403);
    });

    it('Waiter NO puede acceder a /reports/daily-closures (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/reports/daily-closures', accessToken);
      expect(res.status).toBe(403);
    });

    it('Delivery NO puede acceder a /reports/daily (403)', async () => {
      const { accessToken } = await deliveryLogin();
      const res = await authedGet('/reports/daily', accessToken);
      expect(res.status).toBe(403);
    });

    it('Cashier SI puede acceder a /reports/daily (200) por tener reports.read', async () => {
      const { accessToken } = await login('cashier@2x1burgerco.local', 'Cashier12345*');
      const res = await authedGet('/reports/daily', accessToken);
      expect(res.status).toBe(200);
    });
  });

  // ─── H-02: Ventas (sales) ───────────────────────────────────────────
  describe('H-02: Ventas (sales)', () => {
    it('Admin puede acceder a GET /sales (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/sales', accessToken);
      expect(res.status).toBe(200);
    });

    it('Cashier puede acceder a GET /sales (200) por tener sales.read', async () => {
      const { accessToken } = await login('cashier@2x1burgerco.local', 'Cashier12345*');
      const res = await authedGet('/sales', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter NO puede acceder a GET /sales (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/sales', accessToken);
      expect(res.status).toBe(403);
    });

    it('Delivery NO puede acceder a GET /sales (403)', async () => {
      const { accessToken } = await deliveryLogin();
      const res = await authedGet('/sales', accessToken);
      expect(res.status).toBe(403);
    });

    it('Inventory NO puede acceder a GET /sales (403)', async () => {
      const { accessToken } = await login('inventory@2x1burgerco.local', 'Inventory12345*');
      const res = await authedGet('/sales', accessToken);
      // inventory does not have sales.read
      expect(res.status).toBe(403);
    });
  });

  // ─── Purchases ───────────────────────────────────────────────────────
  describe('Purchases (compras)', () => {
    it('Admin puede acceder a GET /purchases (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/purchases', accessToken);
      expect(res.status).toBe(200);
    });

    it('Inventory puede acceder a GET /purchases (200)', async () => {
      const { accessToken } = await login('inventory@2x1burgerco.local', 'Inventory12345*');
      const res = await authedGet('/purchases', accessToken);
      expect(res.status).toBe(200);
    });

    it('Cashier NO puede acceder a GET /purchases (403)', async () => {
      const { accessToken } = await login('cashier@2x1burgerco.local', 'Cashier12345*');
      const res = await authedGet('/purchases', accessToken);
      expect(res.status).toBe(403);
    });

    it('Waiter NO puede acceder a GET /purchases (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/purchases', accessToken);
      expect(res.status).toBe(403);
    });

    it('Delivery NO puede acceder a GET /purchases (403)', async () => {
      const { accessToken } = await deliveryLogin();
      const res = await authedGet('/purchases', accessToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── Expenses ────────────────────────────────────────────────────────
  describe('Expenses (gastos)', () => {
    it('Admin puede acceder a GET /expenses (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/expenses', accessToken);
      expect(res.status).toBe(200);
    });

    it('Cashier puede acceder a GET /expenses (200)', async () => {
      const { accessToken } = await login('cashier@2x1burgerco.local', 'Cashier12345*');
      const res = await authedGet('/expenses', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter NO puede acceder a GET /expenses (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/expenses', accessToken);
      expect(res.status).toBe(403);
    });

    it('Delivery NO puede acceder a GET /expenses (403)', async () => {
      const { accessToken } = await deliveryLogin();
      const res = await authedGet('/expenses', accessToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── Inventory ───────────────────────────────────────────────────────
  describe('Inventory (inventario)', () => {
    it('Admin puede acceder a GET /inventory/stock (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/inventory/stock', accessToken);
      expect(res.status).toBe(200);
    });

    it('Inventory puede acceder a GET /inventory/stock (200)', async () => {
      const { accessToken } = await login('inventory@2x1burgerco.local', 'Inventory12345*');
      const res = await authedGet('/inventory/stock', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter NO puede acceder a GET /inventory/stock (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/inventory/stock', accessToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── Ingredients ─────────────────────────────────────────────────────
  describe('Ingredients (ingredientes)', () => {
    it('Admin puede acceder a GET /ingredients (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/ingredients', accessToken);
      expect(res.status).toBe(200);
    });

    it('Inventory puede acceder a GET /ingredients (200)', async () => {
      const { accessToken } = await login('inventory@2x1burgerco.local', 'Inventory12345*');
      const res = await authedGet('/ingredients', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter NO puede acceder a GET /ingredients (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/ingredients', accessToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── Categories ──────────────────────────────────────────────────────
  describe('Categories (categorias)', () => {
    it('Admin puede acceder a GET /categories (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/categories', accessToken);
      expect(res.status).toBe(200);
    });

    it('Inventory puede acceder a GET /categories (200)', async () => {
      const { accessToken } = await login('inventory@2x1burgerco.local', 'Inventory12345*');
      const res = await authedGet('/categories', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter NO puede acceder a GET /categories (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/categories', accessToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── Products (lectura publica para autenticados) ─────────────────────
  describe('Products (productos)', () => {
    it('Waiter puede ver GET /products (200) - lectura basica auth', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/products', accessToken);
      expect(res.status).toBe(200);
    });

    it('Delivery puede ver GET /products (200) - lectura basica auth', async () => {
      const { accessToken } = await deliveryLogin();
      const res = await authedGet('/products', accessToken);
      expect(res.status).toBe(200);
    });
  });

  // ─── Suppliers ───────────────────────────────────────────────────────
  describe('Suppliers (proveedores)', () => {
    it('Admin puede acceder a GET /suppliers (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/suppliers', accessToken);
      expect(res.status).toBe(200);
    });

    it('Inventory puede acceder a GET /suppliers (200)', async () => {
      const { accessToken } = await login('inventory@2x1burgerco.local', 'Inventory12345*');
      const res = await authedGet('/suppliers', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter NO puede acceder a GET /suppliers (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/suppliers', accessToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── Cash Register ───────────────────────────────────────────────────
  describe('Cash Register (caja)', () => {
    it('Admin puede acceder a GET /cash-register/current (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/cash-register/current', accessToken);
      expect(res.status).toBe(200);
    });

    it('Cashier puede acceder a GET /cash-register/current (200)', async () => {
      const { accessToken } = await login('cashier@2x1burgerco.local', 'Cashier12345*');
      const res = await authedGet('/cash-register/current', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter puede consultar GET /cash-register/current para validar caja abierta (200)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/cash-register/current', accessToken);
      expect(res.status).toBe(200);
    });

    it('Delivery NO puede acceder a GET /cash-register/current (403)', async () => {
      const { accessToken } = await deliveryLogin();
      const res = await authedGet('/cash-register/current', accessToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── Recipes ─────────────────────────────────────────────────────────
  describe('Recipes (recetas)', () => {
    it('Admin puede acceder a GET /recipes/:productId (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/recipes/HAMB-2X1', accessToken);
      expect(res.status).toBe(200);
    });

    it('Inventory puede acceder a GET /recipes/:productId (200)', async () => {
      const { accessToken } = await login('inventory@2x1burgerco.local', 'Inventory12345*');
      const res = await authedGet('/recipes/HAMB-2X1', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter NO puede acceder a GET /recipes/:productId (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/recipes/HAMB-2X1', accessToken);
      expect(res.status).toBe(403);
    });

    it('Cashier NO puede acceder a GET /recipes/:productId (403)', async () => {
      const { accessToken } = await login('cashier@2x1burgerco.local', 'Cashier12345*');
      const res = await authedGet('/recipes/HAMB-2X1', accessToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── Usuarios (ya protegido) ─────────────────────────────────────────
  describe('Users (ya protegido)', () => {
    it('Admin puede acceder a GET /users (200)', async () => {
      const { accessToken } = await login('admin@2x1burgerco.local', 'Admin12345*');
      const res = await authedGet('/users', accessToken);
      expect(res.status).toBe(200);
    });

    it('Waiter NO puede acceder a GET /users (403)', async () => {
      const { accessToken } = await waiterLogin();
      const res = await authedGet('/users', accessToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── Sin autenticacion ───────────────────────────────────────────────
  describe('Sin autenticacion', () => {
    it('GET /reports/daily sin token devuelve 401', async () => {
      const res = await request(app.getHttpServer()).get('/reports/daily');
      expect(res.status).toBe(401);
    });

    it('GET /sales sin token devuelve 401', async () => {
      const res = await request(app.getHttpServer()).get('/sales');
      expect(res.status).toBe(401);
    });

    it('GET /products sin token devuelve 401', async () => {
      const res = await request(app.getHttpServer()).get('/products');
      expect(res.status).toBe(401);
    });

    it('GET /categories sin token devuelve 401', async () => {
      const res = await request(app.getHttpServer()).get('/categories');
      expect(res.status).toBe(401);
    });
  });
});
