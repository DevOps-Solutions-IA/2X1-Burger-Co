import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { PrismaService } from '../../prisma/prisma.service';

describe('CashRegisterService - Concurrencia en cierre de caja (H-03)', () => {
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

  it('Test 3 - Dos cierres de caja concurrentes: solo uno tiene éxito', async () => {
    const { accessToken } = await login();

    // Abrir caja
    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    // Dos cierres simultáneos
    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post('/cash-register/close')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ actualAmount: 50000 }),
      request(app.getHttpServer())
        .post('/cash-register/close')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ actualAmount: 50000 }),
    ]);

    // Uno debe ser exitoso (201), el otro debe fallar con ConflictException (409) o BadRequest (400)
    const closeSuccess = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 201,
    );
    const closeFailed = results.filter(
      (r) => r.status === 'fulfilled' && (r.value.status === 409 || r.value.status === 400),
    );

    expect(closeSuccess.length).toBe(1);
    expect(closeFailed.length).toBe(1);

    // Verificar que la caja está cerrada
    const sessions = await prisma.cashSession.findMany({
      orderBy: { openedAt: 'desc' },
    });
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.status).toBe('CLOSED');
  });
});
