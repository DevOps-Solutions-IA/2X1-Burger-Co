import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { PrismaService } from '../../prisma/prisma.service';

describe('PurchasesService - Concurrencia en compras (C-01)', () => {
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

  it('Test 2 - Dos compras concurrentes mismo ingrediente: stock final es suma correcta', async () => {
    const { accessToken } = await login();
    const supplier = await prisma.supplier.findFirstOrThrow();
    const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { code: 'PAN-HAMB' } });

    // Stock inicial es 20 (según seed data)
    const initialStock = Number(ingredient.currentStock);

    // Dos compras concurrentes de 5 unidades cada una
    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post('/purchases')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          supplierId: supplier.id,
          notes: 'Compra concurrencia 1',
          items: [{ ingredientId: ingredient.id, quantity: 5, unitCost: 1100 }],
        }),
      request(app.getHttpServer())
        .post('/purchases')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          supplierId: supplier.id,
          notes: 'Compra concurrencia 2',
          items: [{ ingredientId: ingredient.id, quantity: 5, unitCost: 1100 }],
        }),
    ]);

    // Ambas deben tener éxito
    const successes = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 201,
    );

    expect(successes.length).toBe(2);

    // Stock final debe ser initialStock + 5 + 5 = 30
    const finalIngredient = await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } });
    expect(Number(finalIngredient.currentStock)).toBe(initialStock + 10);
  });
});
