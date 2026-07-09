import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { PrismaService } from '../../prisma/prisma.service';

describe('SalesService - Concurrencia en stock (C-01)', () => {
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
      throw new Error(`Concurrency tests require a _test database. Received DATABASE_URL=${databaseUrl}`);
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

  async function login(email = 'admin@2x1burgerco.local', password = 'Admin12345*') {
    loginAttempt += 1;
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', `10.0.0.${loginAttempt}`)
      .send({ email, password });

    expect(response.status).toBe(201);
    return {
      accessToken: response.body.accessToken as string,
    };
  }

  it('Test 1 - Dos ventas concurrentes con stock limitado: una falla con stock insuficiente', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'cash' } });
    const soda = await prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } });

    // Stock inicial del producto es 10 (según seed data)
    // Lo ajustamos a 3 para la prueba
    await prisma.product.update({
      where: { id: soda.id },
      data: { currentStock: 3 },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    // Dos ventas simultáneas de 2 unidades cada una (total 4, pero solo hay 3)
    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post('/sales')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          items: [{ productId: soda.id, quantity: 2 }],
          payments: [{ paymentMethodId: paymentCash.id, amount: 9000 }],
        }),
      request(app.getHttpServer())
        .post('/sales')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          items: [{ productId: soda.id, quantity: 2 }],
          payments: [{ paymentMethodId: paymentCash.id, amount: 9000 }],
        }),
    ]);

    // Una debe tener éxito y la otra debe fallar
    const successes = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 201,
    );
    const failures = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 400,
    );

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // El stock final debe ser 1 (3 - 2 = 1), no negativo
    const finalProduct = await prisma.product.findUniqueOrThrow({ where: { id: soda.id } });
    expect(Number(finalProduct.currentStock)).toBe(1);
  });

  it('Test 4 - Stock insuficiente: producto con stock=0 falla al vender', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'cash' } });
    const soda = await prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } });

    // Stock a 0
    await prisma.product.update({
      where: { id: soda.id },
      data: { currentStock: 0 },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 1 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 4500 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Stock insuficiente');
  });
});
