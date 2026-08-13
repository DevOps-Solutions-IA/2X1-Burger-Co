import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

describe('Phase 8 API role and permission intersection', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
  });

  afterAll(async () => closeTestApp(app));

  it('returns 403 when an allowed role has its required capabilities revoked', async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
    await prisma.rolePermission.deleteMany({
      where: {
        role: { name: 'admin' },
        permission: { code: { in: ['orders.read', 'reports.read'] } },
      },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.88.0.1')
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(login.status).toBe(201);
    const authorization = `Bearer ${login.body.accessToken as string}`;

    for (const path of [
      '/admin/payments/intents',
      '/orders/operations/list',
      '/admin/customer-service/cases',
      '/admin/sofia/crm/customers',
    ]) {
      const response = await request(app.getHttpServer()).get(path).set('Authorization', authorization);
      expect(response.status).toBe(403);
    }
  });
});
