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
      '/admin/customer-service/cases/missing',
      '/admin/sofia/crm/customers',
    ]) {
      const response = await request(app.getHttpServer()).get(path).set('Authorization', authorization);
      expect(response.status).toBe(403);
    }
  });

  it('rejects role-only CRM, governance, QR and order mutations', async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
    await prisma.rolePermission.deleteMany({
      where: {
        role: { name: 'admin' },
        permission: { code: { in: ['orders.create', 'orders.update', 'settings.update', 'suppliers.update'] } },
      },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.88.0.2')
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(login.status).toBe(201);
    const authorization = `Bearer ${login.body.accessToken as string}`;

    const attempts = [
      () => request(app.getHttpServer()).post('/admin/sofia/crm/segments').send({ name: 'Segmento', customerIds: [] }),
      () => request(app.getHttpServer()).post('/admin/sofia/control/pause-global').send({ reason: 'Prueba de revocación' }),
      () => request(app.getHttpServer()).post('/admin/sofia/governance/resume').send({}),
      () => request(app.getHttpServer()).post('/admin/sofia/order-drafts').send({}),
      () => request(app.getHttpServer()).post('/admin/sofia/conversations/missing/handoff').send({}),
      () => request(app.getHttpServer()).post('/admin/sofia/whatsapp/qr/connect').send({}),
      () => request(app.getHttpServer()).post('/orders/customers/find-or-create').send({ fullName: 'Cliente' }),
      () => request(app.getHttpServer()).post('/reports/supplier-notifications/manual').send({ supplierId: 'missing' }),
    ];
    for (const attempt of attempts) {
      const response = await attempt().set('Authorization', authorization);
      expect(response.status).toBe(403);
    }
  });

  it('allows settings status reads without orders.read while operational reads remain denied', async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
    await prisma.rolePermission.deleteMany({
      where: {
        role: { name: 'admin' },
        permission: { code: 'orders.read' },
      },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.88.0.3')
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(login.status).toBe(201);
    expect(login.body.user.permissions).toContain('settings.read');
    expect(login.body.user.permissions).not.toContain('orders.read');
    const authorization = `Bearer ${login.body.accessToken as string}`;

    for (const path of [
      '/admin/sofia/enterprise-status',
      '/admin/sofia/runtime-safety',
      '/admin/sofia/governance/status',
    ]) {
      const response = await request(app.getHttpServer()).get(path).set('Authorization', authorization);
      expect(response.status).toBe(200);
    }

    const operational = await request(app.getHttpServer())
      .get('/admin/sofia/conversations')
      .set('Authorization', authorization);
    expect(operational.status).toBe(403);
  });
});
