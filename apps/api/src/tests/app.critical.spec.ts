import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../modules/orders/orders.service';
import { DeliveryPricingService } from '../delivery/delivery-pricing/delivery-pricing.service';
import { WhatsappService } from '../modules/whatsapp/whatsapp.service';
import { SofiaWhatsappService } from '../modules/sofia/sofia-whatsapp.service';
import { Prisma, SaleChannel, SaleStatus } from '@prisma/client';

type CatalogAuditValues = {
  _audit: {
    source: string;
    reason: string;
  };
};

type PurchaseListItem = {
  supplier: {
    id: string;
  };
};

type OperationalLogItem = {
  type: string;
};

type StockCountPreviewItem = {
  id: string;
};

describe('Critical business flows', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let deliveryPricingService: DeliveryPricingService;
  let whatsappService: WhatsappService;
  let sofiaWhatsappService: SofiaWhatsappService;
  let loginAttempt = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/inventory_fastfood_system?schema=public';
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl.includes('_test')) {
      throw new Error(`Critical tests require a _test database. Received DATABASE_URL=${databaseUrl}`);
    }
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? 'change-this-access-secret-with-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? 'change-this-refresh-secret-with-at-least-32-characters';

    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    ordersService = app.get(OrdersService);
    deliveryPricingService = app.get(DeliveryPricingService);
    whatsappService = app.get(WhatsappService);
    sofiaWhatsappService = app.get(SofiaWhatsappService);
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
      .send({
        email,
        password,
      });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeDefined();

    return {
      accessToken: response.body.accessToken as string,
      cookies: (response.headers['set-cookie'] ?? []) as string[],
    };
  }

  async function loginWaiter(name = 'Mesero Principal', accessCode = 'M124578') {
    loginAttempt += 1;
    const response = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', `10.0.1.${loginAttempt}`)
      .send({
        name,
        accessCode,
      });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeDefined();

    return {
      accessToken: response.body.accessToken as string,
      cookies: (response.headers['set-cookie'] ?? []) as string[],
    };
  }

  async function loginDeliveryRider(name = 'Domiciliario Principal', accessCode = 'D124578') {
    loginAttempt += 1;
    const response = await request(app.getHttpServer())
      .post('/auth/delivery-login')
      .set('X-Forwarded-For', `10.0.2.${loginAttempt}`)
      .send({
        name,
        accessCode,
      });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeDefined();

    return {
      accessToken: response.body.accessToken as string,
      cookies: (response.headers['set-cookie'] ?? []) as string[],
    };
  }

  it('auth login success', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login').send({
      email: 'admin@2x1burgerco.local',
      password: 'Admin12345*',
    });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.user.email).toBe('admin@2x1burgerco.local');
  });

  it('auth protected route', async () => {
    const { accessToken } = await login();

    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe('admin@2x1burgerco.local');
    expect(response.body.roles).toContain('admin');
  });

  it('waiter login success with access name and code', async () => {
    const response = await request(app.getHttpServer()).post('/auth/waiter-login').send({
      name: 'Mesero Principal',
      accessCode: 'M124578',
    });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.user.roles).toContain('waiter');
  });

  it('delivery rider login success with access name and code', async () => {
    const response = await request(app.getHttpServer()).post('/auth/delivery-login').send({
      name: 'Domiciliario Principal',
      accessCode: 'D124578',
    });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBeDefined();
    expect(response.body.user.roles).toContain('delivery');
  });

  it('admin can create a waiter user with nombre y código de acceso', async () => {
    const { accessToken } = await login();
    const waiterRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'waiter' },
    });

    const createResponse = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        fullName: 'Mesero Turno',
        roleIds: [waiterRole.id],
        accessCode: 'M888888',
      });

    expect(createResponse.status).toBe(201);

    const loginResponse = await request(app.getHttpServer()).post('/auth/waiter-login').send({
      name: 'Mesero Turno',
      accessCode: 'M888888',
    });

    expect(loginResponse.status).toBe(201);
    expect(loginResponse.body.user.roles).toContain('waiter');
  });

  it('catalog sync changes leave explicit audit trail on products', async () => {
    const { accessToken } = await login();
    const category = await prisma.category.findFirstOrThrow({ where: { slug: 'bebidas' } });
    const unit = await prisma.unit.findFirstOrThrow({ where: { code: 'unit' } });

    const response = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Audit-Source', 'catalog_sync')
      .set('X-Audit-Reason', 'Prueba de trazabilidad de catalogo')
      .send({
        code: 'TEST-CAT-001',
        name: 'Producto catálogo prueba',
        categoryId: category.id,
        unitId: unit.id,
        kind: 'DIRECT_STOCK',
        brand: 'OTHER',
        salePrice: 5000,
        currentStock: 3,
        stockMin: 1,
        trackStock: true,
        isActive: true,
      });

    expect(response.status).toBe(201);

    const auditEntry = await prisma.auditLog.findFirstOrThrow({
      where: {
        entity: 'product',
        entityId: response.body.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(auditEntry.module).toBe('catalog_sync');
    expect((auditEntry.newValues as CatalogAuditValues)._audit.source).toBe('catalog_sync');
    expect((auditEntry.newValues as CatalogAuditValues)._audit.reason).toBe('Prueba de trazabilidad de catalogo');
  });

  it('admin can update the sale price of an existing product', async () => {
    const { accessToken } = await login();
    const product = await prisma.product.findFirstOrThrow({
      where: { name: 'Hamburguesa 2x1' },
    });

    const response = await request(app.getHttpServer())
      .patch(`/products/${product.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        salePrice: 21500,
      });

    expect(response.status).toBe(200);
    expect(Number(response.body.salePrice)).toBe(21500);

    const updated = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    });

    expect(Number(updated.salePrice)).toBe(21500);
  });

  it('whatsapp interno expone estado deshabilitado en tests', async () => {
    const { accessToken } = await login();

    const response = await request(app.getHttpServer())
      .get('/whatsapp/session')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(false);
    expect(response.body.connectionState).toBe('DISABLED');
  });

  it('closing cash logs out every active waiter and delivery session', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: waiterToken, cookies: waiterCookies } = await loginWaiter();
    const { accessToken: deliveryToken, cookies: deliveryCookies } = await loginDeliveryRider();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/cash-register/close')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ actualAmount: 50000 })
      .expect(201);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${waiterToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', waiterCookies)
      .send({})
      .expect(401);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${deliveryToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', deliveryCookies)
      .send({})
      .expect(401);
  });

  it('delivery rider login, assignment and workflow transitions are operational', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: riderToken } = await loginDeliveryRider();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const deliveryUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'delivery@2x1burgerco.local' },
    });

    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente Domicilio',
        customerPhone: '3001234567',
        deliveryReference: 'Cra 10 # 10-10',
        items: [{ productId: burger.id, quantity: 1 }],
      });

    expect(createResponse.status).toBe(201);

    const createdOrder = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: createResponse.body.id },
      select: {
        deliveryWorkflowStatus: true,
      },
    });

    expect(createdOrder.deliveryWorkflowStatus).toBe('PENDING_ASSIGNMENT');

    const activeBeforeAssignment = await request(app.getHttpServer())
      .get('/orders/delivery-active')
      .set('Authorization', `Bearer ${riderToken}`);

    expect(activeBeforeAssignment.status).toBe(200);
    expect(activeBeforeAssignment.body.map((order: { id: string }) => order.id)).toContain(createResponse.body.id);

    const assignResponse = await request(app.getHttpServer())
      .post(`/orders/${createResponse.body.id}/assign-rider`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        riderId: deliveryUser.id,
        notes: 'Ruta centro',
      });

    expect(assignResponse.status).toBe(201);

    const deliveryAfterAssign = await request(app.getHttpServer())
      .get('/orders/delivery-active')
      .set('Authorization', `Bearer ${riderToken}`);

    expect(deliveryAfterAssign.status).toBe(200);
    const assignedEntry = deliveryAfterAssign.body.find(
      (order: { id: string; deliveryWorkflowStatus?: string; assignedRiderId?: string | null }) =>
        order.id === createResponse.body.id,
    );
    expect(assignedEntry).toBeDefined();
    expect(assignedEntry.deliveryWorkflowStatus).toBe('ASSIGNED');
    expect(assignedEntry.assignedRiderId).toBe(deliveryUser.id);

    await prisma.orderTicket.update({
      where: { id: createResponse.body.id },
      data: { status: 'SERVED', servedAt: new Date() },
    });

    const transitResponse = await request(app.getHttpServer())
      .post(`/orders/${createResponse.body.id}/delivery-workflow`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        workflowStatus: 'IN_TRANSIT',
        notes: 'Saliendo a domicilio',
      });

    expect(transitResponse.status).toBe(201);

    const afterTransit = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: createResponse.body.id },
      select: {
        deliveryWorkflowStatus: true,
        deliveryDispatchedAt: true,
      },
    });

    expect(afterTransit.deliveryWorkflowStatus).toBe('IN_TRANSIT');
    expect(afterTransit.deliveryDispatchedAt).not.toBeNull();

    const deliveredResponse = await request(app.getHttpServer())
      .post(`/orders/${createResponse.body.id}/delivery-workflow`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        workflowStatus: 'DELIVERED',
        notes: 'Entregado al cliente',
      });

    expect(deliveredResponse.status).toBe(201);

    const afterDelivered = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: createResponse.body.id },
      select: {
        status: true,
        deliveryWorkflowStatus: true,
      },
    });

    expect(afterDelivered.status).toBe('PAYMENT_PENDING');
    expect(afterDelivered.deliveryWorkflowStatus).toBe('DELIVERED');

    const activeAfterDelivery = await request(app.getHttpServer())
      .get('/orders/delivery-active')
      .set('Authorization', `Bearer ${riderToken}`);

    expect(activeAfterDelivery.status).toBe(200);
    expect(activeAfterDelivery.body.find((order: { id: string }) => order.id === createResponse.body.id)).toBeUndefined();

    const adminActiveAfterDelivery = await request(app.getHttpServer())
      .get('/orders/delivery-active')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminActiveAfterDelivery.status).toBe(200);
    expect(adminActiveAfterDelivery.body.find((order: { id: string }) => order.id === createResponse.body.id)).toBeUndefined();

    const stored = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: createResponse.body.id },
    });

    expect(stored.assignedRiderId).toBe(deliveryUser.id);
    expect(stored.status).toBe('PAYMENT_PENDING');
    expect(stored.deliveryWorkflowStatus).toBe('DELIVERED');
  });

  it('cash current returns JSON null when there is no open cash session', async () => {
    const { accessToken } = await login();

    const response = await request(app.getHttpServer())
      .get('/cash-register/current')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it('cash close readiness returns a clean checklist when there are no blockers', async () => {
    const { accessToken } = await login();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    const response = await request(app.getHttpServer())
      .get('/cash-register/close-checklist')
      .query({ actualAmount: 50000 })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.canClose).toBe(true);
    expect(response.body.activeOrdersCount).toBe(0);
    expect(response.body.paymentMismatchCount).toBe(0);
    expect(response.body.uncategorizedExpensesCount).toBe(0);
  });

  it('admin can delete another user without historial operativo', async () => {
    const { accessToken } = await login();
    const cashierRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'cashier' },
    });

    const created = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: 'temporal@2x1burgerco.local',
        fullName: 'Usuario Temporal',
        password: 'Temporal12345*',
        roleIds: [cashierRole.id],
      });

    expect(created.status).toBe(201);

    const removeResponse = await request(app.getHttpServer())
      .delete(`/users/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(removeResponse.status).toBe(200);
    expect(removeResponse.body.success).toBe(true);

    const deleted = await prisma.user.findUnique({
      where: { id: created.body.id },
    });

    expect(deleted).toBeNull();
  });

  it('admin can delete a user even if it already has operational history', async () => {
    const { accessToken: adminToken } = await login();
    const cashierRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'cashier' },
    });
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });

    const created = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'operativo.eliminar@2x1burgerco.local',
        fullName: 'Operativo Eliminar',
        password: 'Operativo12345*',
        roleIds: [cashierRole.id],
      });

    expect(created.status).toBe(201);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const operationalLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'operativo.eliminar@2x1burgerco.local',
        password: 'Operativo12345*',
      });

    expect(operationalLogin.status).toBe(201);

    const saleResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${operationalLogin.body.accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 1 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 4500 }],
      });

    expect(saleResponse.status).toBe(201);

    const removeResponse = await request(app.getHttpServer())
      .delete(`/users/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(removeResponse.status).toBe(200);
    expect(removeResponse.body.success).toBe(true);

    const deleted = await prisma.user.findUnique({
      where: { id: created.body.id },
    });

    expect(deleted).toBeNull();

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleResponse.body.id },
      select: { createdById: true },
    });
    const archiveUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'archivo.usuarios@2x1burgerco.local' },
      select: { id: true, isActive: true },
    });

    expect(archiveUser.isActive).toBe(false);
    expect(sale.createdById).toBe(archiveUser.id);
  });

  it('waiter cannot use admin login endpoint', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login').send({
      email: 'waiter@2x1burgerco.local',
      password: 'Waiter12345*',
    });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('meseros');
  });

  it('waiter can create an order ticket from waiter endpoints but cannot acceder a listados amplios ni hacer checkout', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: waiterToken } = await loginWaiter();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 });

    const table = await prisma.diningTable.findFirstOrThrow();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });

    const tablesResponse = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(tablesResponse.status).toBe(200);
    expect(tablesResponse.body.length).toBeGreaterThan(0);

    const forbiddenTablesResponse = await request(app.getHttpServer())
      .get('/tables')
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(forbiddenTablesResponse.status).toBe(403);

    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table.id,
        items: [{ productId: burger.id, quantity: 1 }],
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.tableId).toBe(table.id);

    const forbiddenOrdersResponse = await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(forbiddenOrdersResponse.status).toBe(403);

    const checkoutResponse = await request(app.getHttpServer())
      .post(`/orders/${createResponse.body.id}/checkout`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        payments: [{ paymentMethodId: paymentCash.id, amount: 20000 }],
      });

    expect(checkoutResponse.status).toBe(403);
  });

  it('waiter summary endpoints return lightweight operational data', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: waiterToken } = await loginWaiter();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 });

    const table = await prisma.diningTable.findFirstOrThrow();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table.id,
        notes: 'Para llevar',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const tablesSummary = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(tablesSummary.status).toBe(200);
    expect(tablesSummary.body[0]).toHaveProperty('orderTickets');
    expect(tablesSummary.body[0]).not.toHaveProperty('notes');

    const ordersSummary = await request(app.getHttpServer())
      .get('/orders/waiter-active')
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(ordersSummary.status).toBe(200);
    expect(ordersSummary.body[0]).toHaveProperty('table');
    expect(ordersSummary.body[0]).toHaveProperty('createdBy');
    expect(ordersSummary.body[0]).toHaveProperty('createdById');
  });

  it('waiter item replacement rejects stale revisions to avoid lost updates', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: waiterToken } = await loginWaiter();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 });

    const table = await prisma.diningTable.findFirstOrThrow();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });

    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table.id,
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const patchResponse = await request(app.getHttpServer())
      .post(`/orders/${createResponse.body.id}/kitchen-transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'START_PREPARATION',
        expectedRevision: createResponse.body.revision,
      })
      .expect(201);

    expect(patchResponse.body.revision).toBe(createResponse.body.revision + 1);

    const staleReplaceResponse = await request(app.getHttpServer())
      .put(`/orders/${createResponse.body.id}/items`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        expectedRevision: createResponse.body.revision,
        items: [{ productId: soda.id, quantity: 1 }],
      });

    expect(staleReplaceResponse.status).toBe(409);
    expect(staleReplaceResponse.body.message).toContain('comanda cambió');
  });

  it('waiter sync enforces ownership and allows claiming unassigned orders', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: waiterToken } = await loginWaiter();
    const waiterRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'waiter' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 });

    const createdWaiter = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Mesero Secundario',
        accessName: 'Mesero Secundario',
        accessCode: 'M998877',
        roleIds: [waiterRole.id],
      })
      .expect(201);

    expect(createdWaiter.body.accessName).toBe('mesero secundario');

    const secondaryWaiter = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .send({
        name: 'Mesero Secundario',
        accessCode: 'M998877',
      })
      .expect(201);

    const tableOne = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 1' },
    });
    const tableTwo = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 2' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    const firstSync = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        tableId: tableOne.id,
        status: 'OPEN',
        clientMutationId: 'waiter-sync-owner-1',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(firstSync.body.assignedWaiterId).toBeTruthy();

    const forbiddenSync = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${secondaryWaiter.body.accessToken}`)
      .send({
        orderId: firstSync.body.id,
        tableId: tableOne.id,
        status: 'IN_PREPARATION',
        expectedRevision: firstSync.body.revision,
        clientMutationId: 'waiter-sync-owner-2',
        items: [{ productId: burger.id, quantity: 1 }],
      });

    expect(forbiddenSync.status).toBe(409);
    expect(forbiddenSync.body.message).toContain('atiende');

    const adminOrder = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DINE_IN',
        tableId: tableTwo.id,
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(adminOrder.body.assignedWaiterId).toBeNull();

    const claim = await request(app.getHttpServer())
      .post(`/orders/${adminOrder.body.id}/claim`)
      .set('Authorization', `Bearer ${secondaryWaiter.body.accessToken}`)
      .send({
        reason: 'Tomo la mesa desde meseros.',
      })
      .expect(201);

    expect(claim.body.assignedWaiterId).toBe(secondaryWaiter.body.user.sub);

    const kitchenStarted = await request(app.getHttpServer())
      .post(`/orders/${claim.body.id}/kitchen-transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'START_PREPARATION',
        expectedRevision: claim.body.revision,
      })
      .expect(201);

    const claimedSync = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${secondaryWaiter.body.accessToken}`)
      .send({
        orderId: claim.body.id,
        tableId: tableTwo.id,
        status: 'IN_PREPARATION',
        expectedRevision: kitchenStarted.body.revision,
        clientMutationId: 'waiter-sync-owner-3',
        items: [{ productId: burger.id, quantity: 2 }],
      })
      .expect(201);

    expect(claimedSync.body.assignedWaiterId).toBe(secondaryWaiter.body.user.sub);
    expect(claimedSync.body.status).toBe('IN_PREPARATION');
    expect(claimedSync.body.items).toHaveLength(1);
    expect(Number(claimedSync.body.items[0].quantity)).toBe(2);
  });

  it('waiter table groups restrict visible and writable tables with waiter snapshots', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: waiterToken } = await loginWaiter();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 });

    const waiter = await prisma.user.findFirstOrThrow({
      where: { accessName: 'mesero principal' },
    });
    const tableOne = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 1' },
    });
    const tableTwo = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 2' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    const group = await request(app.getHttpServer())
      .post('/table-groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Salón', area: 'Salón principal' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/table-groups/${group.body.id}/tables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tableId: tableOne.id })
      .expect(201);

    await request(app.getHttpServer())
      .post('/waiter-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ waiterId: waiter.id, scope: 'GROUP', tableGroupId: group.body.id })
      .expect(201);

    const waiterTables = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${waiterToken}`)
      .expect(200);

    expect(waiterTables.body.map((table: { id: string }) => table.id)).toContain(tableOne.id);
    expect(waiterTables.body.map((table: { id: string }) => table.id)).not.toContain(tableTwo.id);
    expect(waiterTables.body[0].group.name).toBe('Salón');

    await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        tableId: tableTwo.id,
        status: 'OPEN',
        clientMutationId: 'waiter-assignment-forbidden',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(409);

    const created = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        tableId: tableOne.id,
        status: 'OPEN',
        clientMutationId: 'waiter-assignment-allowed',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(created.body.assignedWaiterId).toBe(waiter.id);
    expect(created.body.waiterNameSnapshot).toBe(waiter.fullName);
    expect(created.body.tableId).toBe(tableOne.id);
  });

  it('waiter assignments are exclusive, editable, direct-priority and preserve historical waiter snapshots', async () => {
    const { accessToken: adminToken } = await login();
    const waiterRole = await prisma.role.findUniqueOrThrow({
      where: { name: 'waiter' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 });

    const andresUser = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Andrés Mesero',
        accessName: 'Andrés',
        accessCode: 'M111222',
        roleIds: [waiterRole.id],
      })
      .expect(201);

    const virginiaUser = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Virginia Mesera',
        accessName: 'Virginia',
        accessCode: 'M333444',
        roleIds: [waiterRole.id],
      })
      .expect(201);

    const andresLogin = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', `10.0.3.${loginAttempt++}`)
      .send({ name: 'Andrés Mesero', accessCode: 'M111222' })
      .expect(201);

    const virginiaLogin = await request(app.getHttpServer())
      .post('/auth/waiter-login')
      .set('X-Forwarded-For', `10.0.3.${loginAttempt++}`)
      .send({ name: 'Virginia Mesera', accessCode: 'M333444' })
      .expect(201);

    const [tableOne, tableTwo, tableThree] = await Promise.all([
      prisma.diningTable.findFirstOrThrow({ where: { label: 'Mesa 1' } }),
      prisma.diningTable.findFirstOrThrow({ where: { label: 'Mesa 2' } }),
      prisma.diningTable.findFirstOrThrow({ where: { label: 'Mesa 3' } }),
    ]);
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    const group = await request(app.getHttpServer())
      .post('/table-groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Exterior', area: 'Patio' })
      .expect(201);

    for (const table of [tableOne, tableTwo, tableThree]) {
      await request(app.getHttpServer())
        .post(`/table-groups/${group.body.id}/tables`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tableId: table.id })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post('/waiter-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ waiterId: virginiaUser.body.id, scope: 'GROUP', tableGroupId: group.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .post('/waiter-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ waiterId: virginiaUser.body.id, scope: 'TABLE', tableId: tableThree.id })
      .expect(201);

    const directBeforeGroupReassignment = await prisma.waiterTableAssignment.findMany({
      where: { tableId: tableThree.id, isActive: true },
    });
    expect(directBeforeGroupReassignment).toHaveLength(1);
    expect(directBeforeGroupReassignment.at(0)?.waiterId).toBe(virginiaUser.body.id);

    const virginiaBefore = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${virginiaLogin.body.accessToken}`)
      .expect(200);

    expect(virginiaBefore.body.map((table: { id: string }) => table.id)).toEqual(
      expect.arrayContaining([tableOne.id, tableTwo.id, tableThree.id]),
    );

    const historicalOrder = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${virginiaLogin.body.accessToken}`)
      .send({
        tableId: tableOne.id,
        status: 'OPEN',
        clientMutationId: 'waiter-enterprise-historical-virginia',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(historicalOrder.body.assignedWaiterId).toBe(virginiaUser.body.id);
    expect(historicalOrder.body.waiterNameSnapshot).toBe('Virginia Mesera');

    await request(app.getHttpServer())
      .post('/waiter-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ waiterId: andresUser.body.id, scope: 'GROUP', tableGroupId: group.body.id })
      .expect(201);

    const activeGroupAssignments = await prisma.waiterTableGroupAssignment.findMany({
      where: { tableGroupId: group.body.id, isActive: true },
    });
    expect(activeGroupAssignments).toHaveLength(1);
    expect(activeGroupAssignments.at(0)?.waiterId).toBe(andresUser.body.id);

    const staleDirectAfterGroupReassignment = await prisma.waiterTableAssignment.findMany({
      where: { tableId: tableThree.id, isActive: true },
    });
    expect(staleDirectAfterGroupReassignment).toHaveLength(0);

    const virginiaAfter = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${virginiaLogin.body.accessToken}`)
      .expect(200);
    const andresAfter = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${andresLogin.body.accessToken}`)
      .expect(200);

    expect(virginiaAfter.body.map((table: { id: string }) => table.id)).not.toContain(tableTwo.id);
    expect(andresAfter.body.map((table: { id: string }) => table.id)).toEqual(
      expect.arrayContaining([tableOne.id, tableTwo.id, tableThree.id]),
    );

    await request(app.getHttpServer())
      .patch(`/table-groups/${group.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Terraza Exterior', area: 'Exterior premium' })
      .expect(200);

    const andresAfterRename = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${andresLogin.body.accessToken}`)
      .expect(200);
    const renamedTable = andresAfterRename.body.find((table: { id: string }) => table.id === tableTwo.id);
    expect(renamedTable.group.name).toBe('Terraza Exterior');

    const andresNewOrder = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${andresLogin.body.accessToken}`)
      .send({
        tableId: tableTwo.id,
        status: 'OPEN',
        clientMutationId: 'waiter-enterprise-new-andres',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(andresNewOrder.body.assignedWaiterId).toBe(andresUser.body.id);
    expect(andresNewOrder.body.waiterNameSnapshot).toBe('Andrés Mesero');

    const historicalReload = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: historicalOrder.body.id },
      select: { waiterNameSnapshot: true, assignedWaiterId: true },
    });
    expect(historicalReload.assignedWaiterId).toBe(virginiaUser.body.id);
    expect(historicalReload.waiterNameSnapshot).toBe('Virginia Mesera');

    await request(app.getHttpServer())
      .post('/waiter-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ waiterId: virginiaUser.body.id, scope: 'TABLE', tableId: tableThree.id })
      .expect(201);

    const activeDirectAssignments = await prisma.waiterTableAssignment.findMany({
      where: { tableId: tableThree.id, isActive: true },
    });
    expect(activeDirectAssignments).toHaveLength(1);
    expect(activeDirectAssignments.at(0)?.waiterId).toBe(virginiaUser.body.id);

    const andresAfterDirectOverride = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${andresLogin.body.accessToken}`)
      .expect(200);
    const virginiaAfterDirectOverride = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${virginiaLogin.body.accessToken}`)
      .expect(200);

    expect(andresAfterDirectOverride.body.map((table: { id: string }) => table.id)).not.toContain(tableThree.id);
    expect(virginiaAfterDirectOverride.body.map((table: { id: string }) => table.id)).toContain(tableThree.id);

    await request(app.getHttpServer())
      .delete(`/table-groups/${group.body.id}/tables/${tableThree.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const virginiaAfterGroupRemoval = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${virginiaLogin.body.accessToken}`)
      .expect(200);
    expect(virginiaAfterGroupRemoval.body.map((table: { id: string }) => table.id)).toContain(tableThree.id);

    await request(app.getHttpServer())
      .delete(`/table-groups/${group.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const andresAfterInactiveGroup = await request(app.getHttpServer())
      .get('/tables/waiter')
      .set('Authorization', `Bearer ${andresLogin.body.accessToken}`)
      .expect(200);
    expect(andresAfterInactiveGroup.body.map((table: { id: string }) => table.id)).not.toContain(tableTwo.id);
  });

  it('tables and table groups support safe administrative deletion without losing operational history', async () => {
    const { accessToken: adminToken } = await login();

    const disposableTable = await request(app.getHttpServer())
      .post('/tables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'Mesa descartable test',
        area: 'QA',
        capacity: 2,
        status: 'FREE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/tables/${disposableTable.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await expect(
      prisma.diningTable.findUnique({ where: { id: disposableTable.body.id } }),
    ).resolves.toBeNull();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 });

    const tableWithHistory = await request(app.getHttpServer())
      .post('/tables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'Mesa con historial test',
        area: 'QA',
        capacity: 2,
        status: 'FREE',
      })
      .expect(201);
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DINE_IN',
        tableId: tableWithHistory.body.id,
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const activeDelete = await request(app.getHttpServer())
      .delete(`/tables/${tableWithHistory.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(activeDelete.status).toBe(400);

    const historicalOrder = await prisma.orderTicket.findFirstOrThrow({
      where: { tableId: tableWithHistory.body.id },
      select: { id: true },
    });

    await prisma.orderTicket.update({
      where: { id: historicalOrder.id },
      data: { status: 'CANCELLED' },
    });

    await request(app.getHttpServer())
      .delete(`/tables/${tableWithHistory.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await expect(
      prisma.diningTable.findUnique({ where: { id: tableWithHistory.body.id } }),
    ).resolves.toBeNull();

    await expect(
      prisma.orderTicket.findUnique({
        where: { id: historicalOrder.id },
        select: { tableId: true },
      }),
    ).resolves.toEqual({ tableId: null });

    const tableForGroupArchive = await request(app.getHttpServer())
      .post('/tables')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        label: 'Mesa grupo archive test',
        area: 'QA',
        capacity: 2,
        status: 'FREE',
      })
      .expect(201);

    const group = await request(app.getHttpServer())
      .post('/table-groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Grupo descartable test', area: 'QA' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/table-groups/${group.body.id}/tables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tableId: tableForGroupArchive.body.id })
      .expect(201);

    const deleteGroup = await request(app.getHttpServer())
      .delete(`/table-groups/${group.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(deleteGroup.body.success).toBe(true);
    expect(deleteGroup.body.mode).toBe('deleted');

    const deletedGroup = await prisma.tableGroup.findUnique({
      where: { id: group.body.id },
    });
    const detachedTable = await prisma.diningTable.findUniqueOrThrow({
      where: { id: tableForGroupArchive.body.id },
    });
    expect(deletedGroup).toBeNull();
    expect(detachedTable.groupId).toBeNull();
  });

  it('waiter sync is idempotent for the same client mutation id', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: waiterToken } = await loginWaiter();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 });

    const table = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 3' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    const first = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        tableId: table.id,
        status: 'OPEN',
        clientMutationId: 'waiter-sync-idempotent-1',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        tableId: table.id,
        status: 'OPEN',
        clientMutationId: 'waiter-sync-idempotent-1',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(replay.body.id).toBe(first.body.id);

    const activeCount = await prisma.orderTicket.count({
      where: {
        tableId: table.id,
        status: {
          in: ['OPEN', 'IN_PREPARATION', 'SERVED', 'PAYMENT_PENDING'],
        },
      },
    });

    expect(activeCount).toBe(1);
  });

  it('refresh token is rejected after logout', async () => {
    const { cookies, accessToken } = await login();

    const logoutResponse = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', cookies)
      .send({});

    expect(logoutResponse.status).toBe(201);

    const refreshResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .send({});

    expect(refreshResponse.status).toBe(401);
  });

  it('rejected anonymous refresh cannot clear a concurrently issued login cookie', async () => {
    const refreshResponse = await request(app.getHttpServer()).post('/auth/refresh').send({});

    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.headers['set-cookie']).toBeUndefined();
  });

  it('create purchase updates stock', async () => {
    const { accessToken } = await login();
    const supplier = await prisma.supplier.findFirstOrThrow();
    const ingredient = await prisma.ingredient.findFirstOrThrow({
      where: { code: 'PAN-HAMB' },
    });

    const response = await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        supplierId: supplier.id,
        items: [
          {
            ingredientId: ingredient.id,
            quantity: 5,
            unitCost: 1100,
          },
        ],
      });

    expect(response.status).toBe(201);

    const updatedIngredient = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });

    expect(Number(updatedIngredient.currentStock)).toBe(25);
  });

  it('create purchase fails on incomplete line item', async () => {
    const { accessToken } = await login();
    const supplier = await prisma.supplier.findFirstOrThrow();

    const response = await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        supplierId: supplier.id,
        items: [
          {
            quantity: 5,
            unitCost: 1100,
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(
      'Cada línea de compra debe apuntar exactamente a un insumo o a un producto',
    );
  });

  it('create sale reduces direct stock product', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    const response = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 2 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 9000 }],
      });

    expect(response.status).toBe(201);

    const updatedProduct = await prisma.product.findUniqueOrThrow({
      where: { id: soda.id },
    });

    expect(Number(updatedProduct.currentStock)).toBe(8);

    const pdfResponse = await request(app.getHttpServer())
      .get(`/sales/${response.body.id}/receipt-pdf`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers['content-type']).toContain('application/pdf');
    expect(pdfResponse.headers['content-disposition']).toContain('comprobante-');
    expect(Buffer.from(pdfResponse.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('create sale stores efectivo recibido y cambio for cash payments', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const sodaLarge = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-1500' },
    });
    const appliedAmount = Number(burger.salePrice) + Number(sodaLarge.salePrice);
    const receivedAmount = appliedAmount + 15000;

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [
          { productId: burger.id, quantity: 1 },
          { productId: sodaLarge.id, quantity: 1 },
        ],
        payments: [
          {
            paymentMethodId: paymentCash.id,
            amount: appliedAmount,
            receivedAmount,
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(Number(response.body.payments[0].amount)).toBe(appliedAmount);
    expect(Number(response.body.payments[0].receivedAmount)).toBe(receivedAmount);
    expect(Number(response.body.payments[0].changeAmount)).toBe(15000);

    const storedPayment = await prisma.salePayment.findFirstOrThrow({
      where: { saleId: response.body.id },
    });

    expect(Number(storedPayment.amount)).toBe(appliedAmount);
    expect(Number(storedPayment.receivedAmount)).toBe(receivedAmount);
    expect(Number(storedPayment.changeAmount)).toBe(15000);
  });

  it('converts a direct paid sale into an open order with stock and cash reversal', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });
    const table = await prisma.diningTable.findFirstOrThrow();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const saleResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 2 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 9000 }],
      })
      .expect(201);

    const productAfterSale = await prisma.product.findUniqueOrThrow({
      where: { id: soda.id },
    });
    expect(Number(productAfterSale.currentStock)).toBe(8);

    const conversionResponse = await request(app.getHttpServer())
      .post(`/sales/${saleResponse.body.id}/convert-to-order`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table.id,
        reason: 'La venta directa realmente era una comanda de mesa.',
      });

    expect(conversionResponse.status).toBe(201);
    expect(conversionResponse.body.success).toBe(true);
    expect(conversionResponse.body.orderTicket.status).toBe('OPEN');
    expect(conversionResponse.body.orderTicket.tableId).toBe(table.id);
    expect(conversionResponse.body.orderTicket.items).toHaveLength(1);

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleResponse.body.id },
      include: { conversion: true },
    });
    expect(sale.status).toBe('CANCELLED');
    expect(sale.conversion?.orderTicketId).toBe(conversionResponse.body.orderTicket.id);

    const productAfterConversion = await prisma.product.findUniqueOrThrow({
      where: { id: soda.id },
    });
    expect(Number(productAfterConversion.currentStock)).toBe(10);

    const reversalMovement = await prisma.cashMovement.findFirst({
      where: {
        referenceType: 'sale_conversion',
        referenceId: sale.id,
        type: 'ADJUSTMENT',
      },
    });
    expect(Number(reversalMovement?.amount)).toBe(-9000);

    const reportResponse = await request(app.getHttpServer())
      .get('/reports/daily')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(reportResponse.status).toBe(200);
    expect(reportResponse.body.sales.count).toBe(0);

    const activeOrders = await prisma.orderTicket.count({
      where: { status: 'OPEN' },
    });
    expect(activeOrders).toBe(1);
  });

  it('reopens a converted paid order restoring the original sale composition', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const coke = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-1500' },
    });
    const poker = await prisma.product.findFirstOrThrow({
      where: { name: 'Cerveza Poker 330 ml' },
    });
    const table = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 4' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const originalTotal =
      Number(burger.salePrice) +
      Number(coke.salePrice) +
      Number(poker.salePrice);

    const saleResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [
          { productId: burger.id, quantity: 1 },
          { productId: coke.id, quantity: 1 },
          { productId: poker.id, quantity: 1 },
        ],
        payments: [{ paymentMethodId: paymentCash.id, amount: originalTotal }],
      })
      .expect(201);

    const conversionResponse = await request(app.getHttpServer())
      .post(`/sales/${saleResponse.body.id}/convert-to-order`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table.id,
        reason: 'La venta directa realmente era una comanda de mesa.',
      })
      .expect(201);

    const orderId = conversionResponse.body.orderTicket.id as string;

    await request(app.getHttpServer())
      .put(`/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: burger.id, quantity: 2 }],
      })
      .expect(200);

    const finalCheckout = await request(app.getHttpServer())
      .post(`/orders/${orderId}/checkout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        payments: [{ paymentMethodId: paymentCash.id, amount: Number(burger.salePrice) * 2 }],
      })
      .expect(201);

    const reopen = await request(app.getHttpServer())
      .post(`/sales/${saleResponse.body.id}/reopen-converted-order`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        reason: 'Debe volver a la composición original de la venta convertida.',
      });

    expect(reopen.status).toBe(201);
    expect(reopen.body.orderTicket.status).toBe('OPEN');
    expect(reopen.body.orderTicket.items).toHaveLength(3);

    const reopenedOrder = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        sale: true,
      },
    });

    expect(reopenedOrder.status).toBe('OPEN');
    expect(reopenedOrder.sale).toBeNull();
    expect(reopenedOrder.items.map((item) => item.product.name)).toEqual([
      'Hamburguesa 2x1',
      'Coca-Cola Original 1.5 L',
      'Cerveza Poker 330 ml',
    ]);
    expect(reopenedOrder.items.map((item) => Number(item.quantity))).toEqual([1, 1, 1]);

    const finalCheckoutSale = await prisma.sale.findUniqueOrThrow({
      where: { id: finalCheckout.body.sale.id },
    });
    expect(finalCheckoutSale.status).toBe('CANCELLED');
  });

  it('create sale reduces recipe ingredients', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const bun = await prisma.ingredient.findUniqueOrThrow({
      where: { code: 'PAN-HAMB' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    const response = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: burger.id, quantity: 1 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 20000 }],
      });

    expect(response.status).toBe(201);

    const updatedBun = await prisma.ingredient.findUniqueOrThrow({
      where: { id: bun.id },
    });

    expect(Number(updatedBun.currentStock)).toBe(18);
  });

  it('create sale persists manual adjustment and exposes it in daily report', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    const saleResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        baseSubtotal: 80000,
        items: [{ productId: burger.id, quantity: 1, unitPrice: 55000 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 55000 }],
      });

    expect(saleResponse.status).toBe(201);
    expect(Number(saleResponse.body.subtotal)).toBe(80000);
    expect(Number(saleResponse.body.discount)).toBe(25000);
    expect(Number(saleResponse.body.total)).toBe(55000);

    const dailyResponse = await request(app.getHttpServer())
      .get('/reports/daily')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(dailyResponse.status).toBe(200);
    expect(dailyResponse.body.sales.adjustments.count).toBe(1);
    expect(dailyResponse.body.sales.adjustments.total).toBe(25000);
    expect(dailyResponse.body.sales.adjustments.details[0].discount).toBe(25000);
  });

  it('create sale fails on insufficient stock', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    const response = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 99 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 445500 }],
      });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('Stock insuficiente');
  });

  it('open cash session', async () => {
    const { accessToken } = await login();

    const response = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 80000, notes: 'Inicio de turno' });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('OPEN');
    expect(Number(response.body.openingAmount)).toBe(80000);
  });

  it('close cash session with daily summary', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 2 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 9000 }],
      });

    const closeResponse = await request(app.getHttpServer())
      .post('/cash-register/close')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ actualAmount: 59000 });

    expect(closeResponse.status).toBe(201);
    expect(closeResponse.body.status).toBe('CLOSED');
    expect(Number(closeResponse.body.expectedAmount)).toBe(59000);
    expect(closeResponse.body.notifications.whatsapp.skipped).toBe(true);
    expect(closeResponse.body.notifications.email).toBeUndefined();

    const dailyResponse = await request(app.getHttpServer())
      .get('/reports/daily')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(dailyResponse.status).toBe(200);
    expect(dailyResponse.body.sales.total).toBe(9000);
  });

  it('close cash session stores a historical daily closure snapshot', async () => {
    const { accessToken } = await login();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000, notes: 'Cierre de prueba' });

    const closeResponse = await request(app.getHttpServer())
      .post('/cash-register/close')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ actualAmount: 50000, notes: 'Jornada cerrada correctamente' });

    expect(closeResponse.status).toBe(201);

    const historyResponse = await request(app.getHttpServer())
      .get('/reports/daily-closures')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body).toHaveLength(1);
    expect(historyResponse.body[0].journey.status).toBe('CERRADA');
  });

  it('create expense affects daily close', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    const expenseResponse = await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        concept: 'Gas',
        amount: 15000,
        paymentMethodId: paymentCash.id,
      });

    expect(expenseResponse.status).toBe(201);

    const dailyResponse = await request(app.getHttpServer())
      .get('/reports/daily')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(dailyResponse.status).toBe(200);
    expect(dailyResponse.body.expenses.total).toBe(15000);
    expect(dailyResponse.body.metrics.netProfit).toBe(-15000);
  });

  it('cash daily summary separates physical cash from digital revenue and operating result', async () => {
    const { accessToken } = await login();
    const [paymentCash, paymentNequi, soda] = await Promise.all([
      prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'cash' } }),
      prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'nequi' } }),
      prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } }),
    ]);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 100000 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 1, unitPrice: 25000 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 25000 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 1, unitPrice: 30000 }],
        payments: [{ paymentMethodId: paymentNequi.id, amount: 30000 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ concept: 'Gas', classification: 'Servicios', amount: 5000, paymentMethodId: paymentCash.id })
      .expect(201);

    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ concept: 'Publicidad', classification: 'Mercadeo', amount: 7000, paymentMethodId: paymentNequi.id })
      .expect(201);

    const summary = await request(app.getHttpServer())
      .get('/cash-register/daily-summary?actualAmount=120000')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(summary.body.expectedPhysicalCash).toBe(120000);
    expect(summary.body.digitalRevenue).toBe(30000);
    expect(summary.body.totalSales).toBe(55000);
    expect(summary.body.totalRevenue).toBe(55000);
    expect(summary.body.totalExpenses).toBe(12000);
    expect(summary.body.operationalResult).toBe(43000);
    expect(summary.body.cashDifference).toBe(0);
    expect(summary.body.salesByMethod.cash).toBe(25000);
    expect(summary.body.salesByMethod.nequi).toBe(30000);
    expect(summary.body.expensesByMethod.cash).toBe(5000);
    expect(summary.body.expensesByMethod.nequi).toBe(7000);
  });

  it('card revenue does not create a physical cash shortage', async () => {
    const { accessToken } = await login();
    const [paymentCard, soda] = await Promise.all([
      prisma.paymentMethod.upsert({
        where: { code: 'card' },
        update: { name: 'Tarjeta', isActive: true },
        create: { code: 'card', name: 'Tarjeta', isActive: true },
      }),
      prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } }),
    ]);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 1, unitPrice: 80000 }],
        payments: [{ paymentMethodId: paymentCard.id, amount: 80000 }],
      })
      .expect(201);

    const summary = await request(app.getHttpServer())
      .get('/cash-register/daily-summary?actualAmount=0')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(summary.body.expectedPhysicalCash).toBe(0);
    expect(summary.body.salesByMethod.card).toBe(80000);
    expect(summary.body.digitalRevenue).toBe(80000);
    expect(summary.body.totalRevenue).toBe(80000);
    expect(summary.body.cashDifference).toBe(0);
  });

  it('purchases use payment method for cash drawer and operating expenses', async () => {
    const { accessToken } = await login();
    const [paymentCash, paymentNequi, supplier, ingredient] = await Promise.all([
      prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'cash' } }),
      prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'nequi' } }),
      prisma.supplier.findFirstOrThrow(),
      prisma.ingredient.findUniqueOrThrow({ where: { code: 'PAN-HAMB' } }),
    ]);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        supplierId: supplier.id,
        paymentMethodId: paymentCash.id,
        items: [{ ingredientId: ingredient.id, quantity: 2, unitCost: 10000 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        supplierId: supplier.id,
        paymentMethodId: paymentNequi.id,
        items: [{ ingredientId: ingredient.id, quantity: 3, unitCost: 10000 }],
      })
      .expect(201);

    const summary = await request(app.getHttpServer())
      .get('/cash-register/daily-summary?actualAmount=30000')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(summary.body.purchasesByMethod.cash).toBe(20000);
    expect(summary.body.purchasesByMethod.nequi).toBe(30000);
    expect(summary.body.expectedPhysicalCash).toBe(30000);
    expect(summary.body.totalExpenses).toBe(50000);
    expect(summary.body.cashDifference).toBe(0);
  });

  it('deletes suppliers without history and blocks deletion when purchase history exists', async () => {
    const { accessToken } = await login();
    const supplierWithoutHistory = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Proveedor sin historial ${Date.now()}`,
        taxId: `NO-HISTORY-${Date.now()}`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/suppliers/${supplierWithoutHistory.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/suppliers/${supplierWithoutHistory.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    const [supplier, ingredient] = await Promise.all([
      prisma.supplier.findFirstOrThrow(),
      prisma.ingredient.findUniqueOrThrow({ where: { code: 'PAN-HAMB' } }),
    ]);

    await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        supplierId: supplier.id,
        items: [{ ingredientId: ingredient.id, quantity: 1, unitCost: 1000 }],
      })
      .expect(201);

    const blocked = await request(app.getHttpServer())
      .delete(`/suppliers/${supplier.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);

    expect(blocked.body.message).toContain('historial');
    await expect(prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } })).resolves.toMatchObject({
      id: supplier.id,
    });
  });

  it('blocks new purchases with inactive suppliers while keeping purchase history readable', async () => {
    const { accessToken } = await login();
    const [supplier, ingredient] = await Promise.all([
      prisma.supplier.findFirstOrThrow(),
      prisma.ingredient.findUniqueOrThrow({ where: { code: 'PAN-HAMB' } }),
    ]);

    await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        supplierId: supplier.id,
        items: [{ ingredientId: ingredient.id, quantity: 1, unitCost: 1000 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/suppliers/${supplier.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isActive: false })
      .expect(200);

    await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        supplierId: supplier.id,
        items: [{ ingredientId: ingredient.id, quantity: 1, unitCost: 1000 }],
      })
      .expect(400);

    const purchases = await request(app.getHttpServer())
      .get('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(
      (purchases.body as PurchaseListItem[]).some((purchase) => purchase.supplier.id === supplier.id),
    ).toBe(true);
  });

  it('delivery sale is counted once with its stored delivery fee', async () => {
    const { accessToken } = await login();
    const [paymentCash, soda, admin] = await Promise.all([
      prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'cash' } }),
      prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } }),
    ]);

    const sessionResponse = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    await prisma.sale.create({
      data: {
        number: `SALE-DELIVERY-${Date.now()}`,
        status: SaleStatus.PAID,
        channel: SaleChannel.DOMICILIO,
        subtotal: new Prisma.Decimal(35000),
        deliveryFee: new Prisma.Decimal(5000),
        deliveryZoneLabel: 'Zona prueba',
        deliveryReference: 'Dirección de prueba',
        total: new Prisma.Decimal(40000),
        createdById: admin.id,
        cashSessionId: sessionResponse.body.id,
        items: {
          create: {
            productId: soda.id,
            quantity: new Prisma.Decimal(1),
            unitPrice: new Prisma.Decimal(35000),
            totalPrice: new Prisma.Decimal(35000),
            estimatedCost: new Prisma.Decimal(0),
          },
        },
        payments: {
          create: {
            paymentMethodId: paymentCash.id,
            amount: new Prisma.Decimal(40000),
          },
        },
      },
    });

    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ concept: 'Empaque', classification: 'Operativo', amount: 10000, paymentMethodId: paymentCash.id })
      .expect(201);

    const summary = await request(app.getHttpServer())
      .get('/cash-register/daily-summary?actualAmount=80000')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(summary.body.expectedPhysicalCash).toBe(80000);
    expect(summary.body.salesByMethod.cash).toBe(40000);
    expect(summary.body.delivery.count).toBe(1);
    expect(summary.body.delivery.totalFee).toBe(5000);
    expect(summary.body.delivery.feeByMethod.cash).toBe(5000);
  });

  it('cancelled sales are excluded from physical cash and total revenue', async () => {
    const { accessToken } = await login();
    const [admin, session, paymentCash] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } }),
      request(app.getHttpServer())
        .post('/cash-register/open')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ openingAmount: 30000 })
        .expect(201),
      prisma.paymentMethod.findUniqueOrThrow({ where: { code: 'cash' } }),
    ]);

    await prisma.sale.create({
      data: {
        number: `SALE-CANCEL-${Date.now()}`,
        status: SaleStatus.CANCELLED,
        channel: SaleChannel.MOSTRADOR,
        subtotal: new Prisma.Decimal(25000),
        total: new Prisma.Decimal(25000),
        createdById: admin.id,
        cashSessionId: session.body.id,
        payments: {
          create: {
            paymentMethodId: paymentCash.id,
            amount: new Prisma.Decimal(25000),
          },
        },
      },
    });

    const summary = await request(app.getHttpServer())
      .get('/cash-register/daily-summary?actualAmount=30000')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(summary.body.expectedPhysicalCash).toBe(30000);
    expect(summary.body.totalSales).toBe(0);
    expect(summary.body.totalRevenue).toBe(0);
    expect(summary.body.cashDifference).toBe(0);
  });

  it('close checklist blocks closing when there are unclassified expenses', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });

    const openResponse = await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    await prisma.expense.create({
      data: {
        concept: 'Gas',
        classification: null,
        amount: 12000,
        paymentMethodId: paymentCash.id,
        cashSessionId: openResponse.body.id,
        createdById: (await prisma.user.findFirstOrThrow({ where: { email: 'admin@2x1burgerco.local' } })).id,
      },
    });

    const checklistResponse = await request(app.getHttpServer())
      .get('/cash-register/close-checklist')
      .query({ actualAmount: 38000 })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(checklistResponse.status).toBe(200);
    expect(checklistResponse.body.canClose).toBe(false);
    expect(checklistResponse.body.uncategorizedExpensesCount).toBe(1);

    await request(app.getHttpServer())
      .post('/cash-register/close')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ actualAmount: 38000 })
      .expect(400);
  });

  it('close checklist blocks closing when there are paid sales with payment mismatches', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const saleResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 2 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 9000 }],
      })
      .expect(201);

    await prisma.salePayment.updateMany({
      where: { saleId: saleResponse.body.id },
      data: { amount: 8000 },
    });

    const checklistResponse = await request(app.getHttpServer())
      .get('/cash-register/close-checklist')
      .query({ actualAmount: 59000 })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(checklistResponse.status).toBe(200);
    expect(checklistResponse.body.canClose).toBe(false);
    expect(checklistResponse.body.paymentMismatchCount).toBe(1);
    expect(checklistResponse.body.blockers.join(' ')).toContain('pagos descuadrados');

    await request(app.getHttpServer())
      .post('/cash-register/close')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ actualAmount: 59000 })
      .expect(400);
  });

  it('close checklist executive summary includes total classified expenses in the session window', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        concept: 'Cambio menor',
        classification: 'Pago menor',
        amount: 12000,
        paymentMethodId: paymentCash.id,
      })
      .expect(201);

    const checklistResponse = await request(app.getHttpServer())
      .get('/cash-register/close-checklist')
      .query({ actualAmount: 38000 })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(checklistResponse.status).toBe(200);
    expect(checklistResponse.body.canClose).toBe(true);
    expect(checklistResponse.body.uncategorizedExpensesCount).toBe(0);
    expect(checklistResponse.body.summary.expensesTotal).toBe(12000);
  });

  it('create expense fails with invalid amount', async () => {
    const { accessToken } = await login();

    const response = await request(app.getHttpServer())
      .post('/expenses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        concept: 'Gas',
        amount: 0,
      });

    expect(response.status).toBe(400);
  });

  it('recipe rejects incomplete payload', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    const response = await request(app.getHttpServer())
      .put(`/recipes/${burger.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [],
      });

    expect(response.status).toBe(400);
  });

  it('cashier cannot create purchases without permission', async () => {
    const { accessToken } = await login('cashier@2x1burgerco.local', 'Cashier12345*');
    const supplier = await prisma.supplier.findFirstOrThrow();
    const ingredient = await prisma.ingredient.findFirstOrThrow({
      where: { code: 'PAN-HAMB' },
    });

    const response = await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        supplierId: supplier.id,
        items: [
          {
            ingredientId: ingredient.id,
            quantity: 2,
            unitCost: 1000,
          },
        ],
      });

    expect(response.status).toBe(403);
  });

  it('daily report generation basic validation', async () => {
    const { accessToken } = await login();

    const response = await request(app.getHttpServer())
      .get('/reports/daily')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('sales');
    expect(response.body).toHaveProperty('purchases');
    expect(response.body).toHaveProperty('expenses');
    expect(response.body).toHaveProperty('metrics');
  });

  it('supplier notification can be generated from reorder suggestions', async () => {
    const { accessToken } = await login();
    const supplier = await prisma.supplier.findFirstOrThrow();
    const ingredient = await prisma.ingredient.findUniqueOrThrow({
      where: { code: 'PAN-HAMB' },
    });

    await prisma.purchase.create({
      data: {
        number: `PUR-${Date.now()}`,
        supplierId: supplier.id,
        createdById: (await prisma.user.findFirstOrThrow({ where: { email: 'admin@2x1burgerco.local' } })).id,
        subtotal: 2000,
        total: 2000,
        items: {
          create: {
            ingredientId: ingredient.id,
            quantity: 2,
            unitCost: 1000,
            totalCost: 2000,
          },
        },
      },
    });

    await prisma.ingredient.update({
      where: { id: ingredient.id },
      data: {
        currentStock: 1,
        stockMin: 2,
      },
    });

    const alertsResponse = await request(app.getHttpServer())
      .get('/reports/supply-alerts')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(alertsResponse.status).toBe(200);
    expect(alertsResponse.body.groupedBySupplier[0].supplierId).toBe(supplier.id);

    const notificationResponse = await request(app.getHttpServer())
      .post('/reports/supplier-notifications/manual')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ supplierId: supplier.id });

    expect(notificationResponse.status).toBe(201);
    expect(notificationResponse.body.channel).toBe('WHATSAPP');
    expect(notificationResponse.body.whatsappLink).toContain('wa.me');
  });

  it('create dining table', async () => {
    const { accessToken } = await login();

    const response = await request(app.getHttpServer())
      .post('/tables')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'Mesa 10',
        area: 'Terraza',
        capacity: 4,
      });

    expect(response.status).toBe(201);
    expect(response.body.label).toBe('Mesa 10');
    expect(response.body.status).toBe('FREE');
  });

  it('allows clearing the area of a dining table', async () => {
    const { accessToken } = await login();
    const table = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 1' },
    });

    const response = await request(app.getHttpServer())
      .patch(`/tables/${table.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        area: '',
      });

    expect(response.status).toBe(200);
    expect(response.body.area).toBeNull();

    const updated = await prisma.diningTable.findUniqueOrThrow({
      where: { id: table.id },
    });

    expect(updated.area).toBeNull();
  });

  it('forces reports timezone to America/Bogota', async () => {
    const { accessToken } = await login();

    const response = await request(app.getHttpServer())
      .patch('/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [
          {
            key: 'reports.daily-close',
            category: 'reports',
            description: 'Configuración visual del cierre diario',
            value: {
              printSignature: true,
              timezone: 'UTC',
            },
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body[0].value.timezone).toBe('America/Bogota');

    const stored = await prisma.setting.findUniqueOrThrow({
      where: { key: 'reports.daily-close' },
    });

    expect((stored.value as { timezone?: string }).timezone).toBe('America/Bogota');
  });

  it('open order ticket and checkout frees table', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const table = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    const createOrder = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table.id,
        customerName: 'Mesa familiar',
        items: [{ productId: burger.id, quantity: 1 }],
      });

    expect(createOrder.status).toBe(201);
    expect(createOrder.body.status).toBe('OPEN');

    const occupiedTable = await prisma.diningTable.findUniqueOrThrow({
      where: { id: table.id },
    });

    expect(occupiedTable.status).toBe('OCCUPIED');

    const checkout = await request(app.getHttpServer())
      .post(`/orders/${createOrder.body.id}/checkout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        payments: [{ paymentMethodId: paymentCash.id, amount: 20000, receivedAmount: 50000 }],
      });

    expect(checkout.status).toBe(201);
    expect(checkout.body.order.status).toBe('PAID');
    expect(checkout.body.sale.channel).toBe('MESA');
    expect(Number(checkout.body.sale.payments[0].receivedAmount)).toBe(50000);
    expect(Number(checkout.body.sale.payments[0].changeAmount)).toBe(30000);

    const freedTable = await prisma.diningTable.findUniqueOrThrow({
      where: { id: table.id },
    });

    expect(freedTable.status).toBe('FREE');
  });

  it('can reopen a paid order by reversing its linked sale safely', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const table = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 2' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    const createOrder = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DINE_IN',
        tableId: table.id,
        customerName: 'Mesa reabrir',
        items: [{ productId: burger.id, quantity: 1 }],
      });

    expect(createOrder.status).toBe(201);

    const checkout = await request(app.getHttpServer())
      .post(`/orders/${createOrder.body.id}/checkout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        payments: [{ paymentMethodId: paymentCash.id, amount: Number(burger.salePrice) }],
      });

    expect(checkout.status).toBe(201);
    expect(checkout.body.order.status).toBe('PAID');

    const reopen = await request(app.getHttpServer())
      .post(`/orders/${createOrder.body.id}/reopen`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        reason: 'Se cerró por error y la mesa debe seguir abierta.',
      });

    expect(reopen.status).toBe(201);
    expect(reopen.body.orderTicket.status).toBe('OPEN');

    const reopenedOrder = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: createOrder.body.id },
      include: { sale: true, table: true },
    });
    expect(reopenedOrder.status).toBe('OPEN');
    expect(reopenedOrder.sale).toBeNull();

    const cancelledSale = await prisma.sale.findUniqueOrThrow({
      where: { id: checkout.body.sale.id },
    });
    expect(cancelledSale.status).toBe('CANCELLED');
    expect(cancelledSale.orderTicketId).toBeNull();

    const occupiedTable = await prisma.diningTable.findUniqueOrThrow({
      where: { id: table.id },
    });
    expect(occupiedTable.status).toBe('OCCUPIED');
  });

  it('uses a shared consecutive sequence for mostrador, mesa y domicilio', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const table = await prisma.diningTable.findFirstOrThrow({
      where: { label: 'Mesa 1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const [counterOrder, dineInOrder, deliveryOrder] = await Promise.all([
      request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'COUNTER',
          items: [{ productId: burger.id, quantity: 1 }],
        }),
      request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'DINE_IN',
          tableId: table.id,
          items: [{ productId: burger.id, quantity: 1 }],
        }),
      request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'DELIVERY',
          customerName: 'Cliente Ruta',
          customerPhone: '3001234567',
          deliveryReference: 'Cra 10 # 10-10',
          items: [{ productId: burger.id, quantity: 1 }],
        }),
    ]);

    expect(counterOrder.status).toBe(201);
    expect(dineInOrder.status).toBe(201);
    expect(deliveryOrder.status).toBe(201);

    const numbers = [counterOrder.body.number, dineInOrder.body.number, deliveryOrder.body.number];
    const sequences = numbers.map((number: string) => Number(number.split('-').pop()));

    expect(numbers[0]).toMatch(/^MOSTRADOR-\d{3}$/);
    expect(numbers[1]).toMatch(/^MESA-\d{3}$/);
    expect(numbers[2]).toMatch(/^DOMICILIO-\d{3}$/);
    expect(new Set(sequences).size).toBe(3);
    expect(sequences.sort((left, right) => left - right)).toEqual([1, 2, 3]);
  });

  it('supports multiple open order tickets simultaneously', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const [tableOne, tableTwo] = await Promise.all([
      prisma.diningTable.findFirstOrThrow({ where: { label: 'Mesa 1' } }),
      prisma.diningTable.findFirstOrThrow({ where: { label: 'Mesa 2' } }),
    ]);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    const [firstOrder, secondOrder] = await Promise.all([
      request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'DINE_IN',
          tableId: tableOne.id,
          items: [{ productId: burger.id, quantity: 1 }],
        }),
      request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'DINE_IN',
          tableId: tableTwo.id,
          items: [{ productId: burger.id, quantity: 1 }],
        }),
    ]);

    expect(firstOrder.status).toBe(201);
    expect(secondOrder.status).toBe(201);

    const response = await request(app.getHttpServer())
      .get('/orders?activeOnly=true')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
  });

  it('does not accept frontend deliveryFee as operational pricing source', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente Domicilio',
        customerPhone: '3001234567',
        deliveryReference: 'Centro Jamundí',
        deliveryFee: 123456,
        deliveryFeeEditReason: 'Intento legacy que debe quedar audit-only',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(Number(createResponse.body.deliveryFee)).not.toBe(123456);
    expect(createResponse.body.deliveryFeeEdited).toBe(false);
    expect(createResponse.body.deliveryFeeEditReason).toBeNull();
    expect(['AUTO_PRICED', 'NEEDS_ADDRESS_CORRECTION', 'PROVIDER_UNAVAILABLE']).toContain(
      createResponse.body.deliveryPricingStatus,
    );
    expect(Number(createResponse.body.subtotal)).toBe(20000 + Number(createResponse.body.deliveryFee));

    const updatedOrder = await ordersService.applyDeliveryLocationFromWhatsapp('3001234567', 3.2556, -76.5417);

    expect(updatedOrder).not.toBeNull();
    expect(updatedOrder?.deliveryFeeEdited).toBe(false);
    expect(Number(updatedOrder?.deliveryFee)).not.toBe(123456);
    expect(Number(updatedOrder?.subtotal)).toBe(20000 + Number(updatedOrder?.deliveryFee));

    const savedCustomer = await prisma.deliveryCustomer.findUniqueOrThrow({
      where: { phone: '573001234567' },
    });
    expect(savedCustomer.fullName).toBe('Cliente Domicilio');
    expect(Number(savedCustomer.lastLatitude)).toBeCloseTo(3.2556, 4);
    expect(Number(savedCustomer.lastLongitude)).toBeCloseTo(-76.5417, 4);
    expect(savedCustomer.lastDistanceKm?.toString() ?? null).toBe(
      createResponse.body.deliveryDistanceKm == null
        ? null
        : String(createResponse.body.deliveryDistanceKm),
    );
  });

  it('delivery pricing endpoint handles local free and ambiguous local text safely', async () => {
    const { accessToken } = await login();

    // SOFIA Address Remediation (MANDATORY RULE 1/2/6): a bare zone alias with no other address
    // detail still prices the free zone at 0 (zoneMatched), but must NOT be checkout-eligible by
    // itself — a courier cannot be dispatched to "Condados de la Alborada" with nothing else.
    const localFree = await request(app.getHttpServer())
      .post('/delivery-pricing/estimate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        orderSubtotal: 25000,
        addressText: 'Condados de la Alborada',
      })
      .expect(200);

    expect(localFree.body.pricingStatus).toBe('LOCAL_FREE');
    expect(localFree.body.finalFee).toBe(0);
    expect(localFree.body.requiresManualQuote).toBe(true);
    expect(localFree.body.canCheckout).toBe(false);
    expect(localFree.body.checkoutAuthorization).toMatchObject({
      zoneMatched: true,
      addressComplete: false,
      canCheckout: false,
    });

    // The same zone alias, but with a real geocoded point already attached (e.g. a WhatsApp live
    // location pin), IS checkout-eligible: the address is complete because we know exactly where
    // it is, even though it still prices as the free zone.
    const localFreeWithPoint = await request(app.getHttpServer())
      .post('/delivery-pricing/estimate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        orderSubtotal: 25000,
        addressText: 'Condados de la Alborada',
        latitude: 3.2556,
        longitude: -76.5417,
      })
      .expect(200);

    expect(localFreeWithPoint.body.pricingStatus).toBe('LOCAL_FREE');
    expect(localFreeWithPoint.body.finalFee).toBe(0);
    expect(localFreeWithPoint.body.requiresManualQuote).toBe(false);
    expect(localFreeWithPoint.body.canCheckout).toBe(true);
    expect(localFreeWithPoint.body.checkoutAuthorization).toMatchObject({
      zoneMatched: true,
      addressComplete: true,
      canCheckout: true,
    });

    const ambiguous = await request(app.getHttpServer())
      .post('/delivery-pricing/estimate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        orderSubtotal: 25000,
        addressText: 'cerca de alborada',
      })
      .expect(200);

    expect(ambiguous.body.pricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(ambiguous.body.finalFee).toBeNull();
    expect(ambiguous.body.canCheckout).toBe(false);
    expect(ambiguous.body.requiresAddressCorrection).toBe(true);
    expect(ambiguous.body.warnings).toContain('LOCAL_ZONE_AMBIGUOUS');
  });

  it('checkout uses backend delivery pricing and blocks arbitrary frontend deliveryFee injection', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    // SOFIA Address Remediation (MANDATORY RULE 1/2/6): a LOCAL_FREE zone match with NO other
    // address detail (bare "Condados de la Alborada", no real point) must NOT be checkout-eligible
    // — this is the exact false positive both prior remediation rounds failed to close for real,
    // because the fix never survived persistence onto the order row. orders.service.ts must block
    // checkout here via the same canonical authority the live quote used
    // (deriveCheckoutAuthorizationFromOrderSnapshot / deriveCheckoutAuthorization).
    const incompleteLocalFreeOrder = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente Local Incompleto',
        customerPhone: '3100000003',
        deliveryReference: 'Condados de la Alborada',
        deliveryFee: 7000,
        deliveryFeeEditReason: 'Intento de inyección legacy',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(incompleteLocalFreeOrder.body.deliveryPricingStatus).toBe('LOCAL_FREE');
    expect(Number(incompleteLocalFreeOrder.body.deliveryFee)).toBe(0);
    expect(incompleteLocalFreeOrder.body.deliveryRequiresManualQuote).toBe(true);

    await request(app.getHttpServer())
      .post(`/orders/${incompleteLocalFreeOrder.body.id}/checkout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        payments: [{ paymentMethodId: paymentCash.id, amount: 20000 }],
      })
      .expect(400);

    // The same free zone, but WITH a real geocoded point already attached (e.g. a live location
    // pin captured at order-creation time), IS checkout-eligible: the address is complete because
    // the exact destination is known, even though it still prices as the free zone.
    const localFreeOrder = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente Local',
        customerPhone: '3100000001',
        deliveryReference: 'Condados de la Alborada',
        deliveryLatitude: 3.2556,
        deliveryLongitude: -76.5417,
        deliveryFee: 7000,
        deliveryFeeEditReason: 'Intento de inyección legacy',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(localFreeOrder.body.deliveryPricingStatus).toBe('LOCAL_FREE');
    expect(Number(localFreeOrder.body.deliveryFee)).toBe(0);
    expect(localFreeOrder.body.deliveryRequiresManualQuote).toBe(false);

    const localCheckout = await request(app.getHttpServer())
      .post(`/orders/${localFreeOrder.body.id}/checkout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        payments: [{ paymentMethodId: paymentCash.id, amount: 20000 }],
      })
      .expect(201);

    expect(Number(localCheckout.body.sale.deliveryFee)).toBe(0);

    const blockedOrder = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente Sin Estimación',
        customerPhone: '3100000002',
        deliveryReference: '',
        deliveryFee: 123456,
        deliveryFeeEditReason: 'Intento de inyección legacy',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    expect(blockedOrder.body.deliveryPricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(Number(blockedOrder.body.deliveryFee)).toBe(0);

    await request(app.getHttpServer())
      .post(`/orders/${blockedOrder.body.id}/checkout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        payments: [{ paymentMethodId: paymentCash.id, amount: 27000 }],
      })
      .expect(400);
  });

  it('rejects direct delivery sale injection without backend-priced order ticket', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        channel: 'DOMICILIO',
        deliveryReference: 'Centro Jamundí',
        deliveryFee: 7000,
        deliveryFeeEditReason: 'Intento directo de fee falso',
        items: [{ productId: burger.id, quantity: 1 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 27000 }],
      })
      .expect(400);

    const injectedSale = await prisma.sale.findFirst({
      where: {
        channel: 'DOMICILIO',
        deliveryReference: 'Centro Jamundí',
        deliveryFee: new Prisma.Decimal(7000),
      },
    });

    expect(injectedSale).toBeNull();
  });

  it('rejects single-active-order fallback when WhatsApp sender has no usable phone', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const createResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente fallback ubicación',
        customerPhone: '3237963047',
        deliveryReference: 'Jamundí centro',
        deliveryFee: 123456,
        deliveryFeeEditReason: 'Intento legacy que debe quedar audit-only',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const originalOrder = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: createResponse.body.id },
    });
    const estimateSpy = jest.spyOn(deliveryPricingService, 'estimate');

    const updatedOrder = await ordersService.applyDeliveryLocationFromWhatsapp('', 3.2556, -76.5417);

    expect(updatedOrder).toBeNull();
    expect(estimateSpy).not.toHaveBeenCalled();
    estimateSpy.mockRestore();

    const unchangedOrder = await prisma.orderTicket.findUniqueOrThrow({
      where: { id: createResponse.body.id },
    });
    expect(unchangedOrder.deliveryLocationReceivedAt).toEqual(originalOrder.deliveryLocationReceivedAt);
    expect(unchangedOrder.deliveryLocationSource).toBe(originalOrder.deliveryLocationSource);
    expect(unchangedOrder.deliveryLatitude).toEqual(originalOrder.deliveryLatitude);
    expect(unchangedOrder.deliveryLongitude).toEqual(originalOrder.deliveryLongitude);
    expect(Number(unchangedOrder.deliveryFee)).toBe(Number(originalOrder.deliveryFee));
    expect(Number(unchangedOrder.subtotal)).toBe(Number(originalOrder.subtotal));
    expect(unchangedOrder.deliveryPricingBreakdown).toEqual(originalOrder.deliveryPricingBreakdown);

    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        entity: 'order_ticket',
        entityId: createResponse.body.id,
        action: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(auditEntry).toBeNull();

    const pending = await prisma.deliveryLocationInbox.findFirst({
      where: { matchStatus: 'REQUIRES_REVIEW' },
      orderBy: { receivedAt: 'desc' },
    });
    expect(pending).toBeTruthy();
  });

  it('does not guess between active delivery orders when sender identity is absent', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const olderOrder = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente repetido 1',
        customerPhone: '3237963047',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const newerOrder = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente repetido 2',
        customerPhone: '3237963047',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const updatedOrder = await ordersService.applyDeliveryLocationFromWhatsapp('', 3.2556, -76.5417);

    expect(updatedOrder).toBeNull();
    const [olderUnchanged, newerUnchanged] = await Promise.all([
      prisma.orderTicket.findUniqueOrThrow({ where: { id: olderOrder.body.id } }),
      prisma.orderTicket.findUniqueOrThrow({ where: { id: newerOrder.body.id } }),
    ]);
    expect(olderUnchanged.deliveryLocationReceivedAt).toBeNull();
    expect(newerUnchanged.deliveryLocationReceivedAt).toBeNull();
  });

  it('stores delivery location inbox entries and persistent alerts when live location is correlated', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Inbox delivery',
        customerPhone: '3215550001',
        deliveryReference: 'Alfaguara Jamundí',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const capture = await ordersService.captureDeliveryLocationFromWhatsapp({
      rawSenderJid: '137271701463201@lid',
      remoteJid: '137271701463201@lid',
      participantJid: null,
      senderPhoneCandidates: ['3215550001'],
      latitude: 3.2686,
      longitude: -76.5516,
    });

    expect(capture.order?.id).toBe(created.body.id);
    expect(capture.inbox.matchStatus).toBe('APPLIED');
    expect(capture.inbox.matchedOrderId).toBe(created.body.id);

    const inbox = await prisma.deliveryLocationInbox.findUniqueOrThrow({
      where: { id: capture.inbox.id },
    });
    expect(inbox.matchStatus).toBe('APPLIED');

    const alert = await prisma.operationalAlert.findFirst({
      where: {
        module: 'deliveries',
        type: 'DELIVERY_LOCATION_RECEIVED',
        entityId: created.body.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(alert).toBeTruthy();
    expect(alert?.deliveryLocationInboxId).toBe(capture.inbox.id);
  });

  it('stores unresolved live locations in inbox instead of discarding them', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Ambiguo 1',
        customerPhone: '3215550101',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Ambiguo 2',
        customerPhone: '3215550202',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const capture = await ordersService.captureDeliveryLocationFromWhatsapp({
      rawSenderJid: '137271701463201@lid',
      remoteJid: '137271701463201@lid',
      participantJid: null,
      senderPhoneCandidates: [],
      latitude: 3.2686,
      longitude: -76.5516,
    });

    expect(capture.order).toBeNull();
    expect(capture.inbox.matchStatus).toBe('REQUIRES_REVIEW');

    const pendingAlert = await prisma.operationalAlert.findFirst({
      where: {
        module: 'deliveries',
        type: 'DELIVERY_LOCATION_PENDING_REVIEW',
        entityType: 'delivery_location_inbox',
        entityId: capture.inbox.id,
      },
    });

    expect(pendingAlert).toBeTruthy();
  });

  it('never applies an uncorrelated WhatsApp location to a single active delivery', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Sin correlación',
        customerPhone: '3215550303',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const capture = await ordersService.captureDeliveryLocationFromWhatsapp({
      rawSenderJid: 'synthetic-unresolved@lid',
      remoteJid: 'synthetic-unresolved@lid',
      senderPhoneCandidates: [],
      latitude: 3.2686,
      longitude: -76.5516,
    });

    expect(capture.order).toBeNull();
    expect(capture.inbox.matchStatus).toBe('REQUIRES_REVIEW');
    const unchanged = await prisma.orderTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(unchanged.deliveryLatitude).toBeNull();
    expect(unchanged.deliveryLongitude).toBeNull();
  });

  it('preserves live delivery location after updating the order later', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Persistencia delivery',
        customerPhone: '3215550303',
        deliveryReference: 'Calle 11 2AS 167 La Cibita',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    await ordersService.applyDeliveryLocationFromWhatsapp('3215550303', 3.2686, -76.5516);

    const patched = await request(app.getHttpServer())
      .patch(`/orders/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        notes: 'Cliente confirmó por chat',
      })
      .expect(200);

    expect(patched.body.deliveryLocationSource).toBe('whatsapp_live_location');
    expect(patched.body.deliveryLocationReceivedAt).toBeTruthy();
    expect(patched.body.deliveryLatitude).toBeTruthy();
    expect(patched.body.deliveryLongitude).toBeTruthy();
  });

  it('refreshes delivery account after commercial item changes while preserving persisted delivery fee', async () => {
    const { accessToken } = await login();
    const [burger, soda] = await Promise.all([
      prisma.product.findUniqueOrThrow({
        where: { code: 'HAMB-2X1' },
      }),
      prisma.product.findUniqueOrThrow({
        where: { code: 'CC-ORG-400' },
      }),
    ]);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cuenta actualizada',
        customerPhone: '3215550505',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const originalFee = Number(created.body.deliveryFee);
    const sendSpy = jest.spyOn(whatsappService, 'sendDeliveryOrderSummary').mockResolvedValue({
      success: true,
      phone: '3215550505',
      orderNumber: created.body.number,
      updated: true,
      sentAt: new Date().toISOString(),
    });

    const updated = await request(app.getHttpServer())
      .put(`/orders/${created.body.id}/items`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        expectedRevision: created.body.revision,
        items: [
          { productId: burger.id, quantity: 1 },
          { productId: soda.id, quantity: 2 },
        ],
      })
      .expect(200);

    expect(Number(updated.body.deliveryFee)).toBe(originalFee);
    expect(Number(updated.body.subtotal)).toBe(
      Number(burger.salePrice) + Number(soda.salePrice) * 2 + originalFee,
    );
    expect(sendSpy).not.toHaveBeenCalled();

    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        entity: 'order_ticket',
        entityId: created.body.id,
        action: 'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(auditEntry).toBeTruthy();
    expect(auditEntry?.newValues).toMatchObject({
      receiptRegenerated: true,
      message: 'Pedido actualizado. Nueva cuenta generada con total vigente.',
    });

    const suppressedIntent = await prisma.notificationIntent.findUnique({
      where: {
        aggregateType_sourceEventId_channel_purpose: {
          aggregateType: 'ORDER_TICKET',
          sourceEventId: `DELIVERY_RECEIPT_UPDATED_SENT:${created.body.id}:${updated.body.revision}`,
          channel: 'WHATSAPP',
          purpose: 'SERVICE',
        },
      },
    });
    expect(suppressedIntent).toMatchObject({
      status: 'SUPPRESSED',
      policyReason: 'AUTO_WHATSAPP_DISABLED',
    });

    const sentAudit = await prisma.auditLog.findFirst({
      where: {
        entity: 'order_ticket',
        entityId: created.body.id,
        action: 'DELIVERY_UPDATED_RECEIPT_SEND_SUPPRESSED',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(sentAudit).toBeTruthy();
    expect(sentAudit?.newValues).toMatchObject({
      revision: updated.body.revision,
      receiptUpdated: true,
      sendAttempted: false,
      sendSucceeded: false,
      phoneMasked: expect.stringMatching(/^\*+0505$/),
    });
    sendSpy.mockRestore();
  });

  it('does not send a duplicate updated delivery account when items did not change', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Sin duplicado',
        customerPhone: '3215550606',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const sendSpy = jest.spyOn(whatsappService, 'sendDeliveryOrderSummary').mockResolvedValue({
      success: true,
      phone: '3215550606',
      orderNumber: created.body.number,
      updated: true,
      sentAt: new Date().toISOString(),
    });

    const updated = await request(app.getHttpServer())
      .put(`/orders/${created.body.id}/items`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        expectedRevision: created.body.revision,
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(200);

    expect(updated.body.revision).toBe(created.body.revision);
    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });

  it('does not generate or send updated delivery account when WhatsApp location arrives', async () => {
    const { accessToken } = await login();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Ubicacion no cuenta',
        customerPhone: '3215550707',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const sendSpy = jest.spyOn(whatsappService, 'sendDeliveryOrderSummary').mockResolvedValue({
      success: true,
      phone: '3215550707',
      orderNumber: created.body.number,
      updated: true,
      sentAt: new Date().toISOString(),
    });

    await ordersService.applyDeliveryLocationFromWhatsapp('3215550707', 3.2556, -76.5417);

    expect(sendSpy).not.toHaveBeenCalled();
    const receiptRefresh = await prisma.auditLog.findFirst({
      where: {
        entity: 'order_ticket',
        entityId: created.body.id,
        action: 'DELIVERY_ORDER_UPDATED_RECEIPT_REFRESHED',
      },
    });
    expect(receiptRefresh).toBeNull();
    sendSpy.mockRestore();
  });

  it('keeps commercial delivery update while automatic WhatsApp remains suppressed', async () => {
    const { accessToken } = await login();
    const [burger, soda] = await Promise.all([
      prisma.product.findUniqueOrThrow({
        where: { code: 'HAMB-2X1' },
      }),
      prisma.product.findUniqueOrThrow({
        where: { code: 'CC-ORG-400' },
      }),
    ]);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Fallo WhatsApp',
        customerPhone: '3215550808',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const sendSpy = jest
      .spyOn(whatsappService, 'sendDeliveryOrderSummary')
      .mockRejectedValue(new Error('WhatsApp desconectado para test'));

    const updated = await request(app.getHttpServer())
      .put(`/orders/${created.body.id}/items`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        expectedRevision: created.body.revision,
        items: [
          { productId: burger.id, quantity: 1 },
          { productId: soda.id, quantity: 1 },
        ],
      })
      .expect(200);

    expect(Number(updated.body.subtotal)).toBe(Number(created.body.subtotal) + Number(soda.salePrice));
    expect(sendSpy).not.toHaveBeenCalled();

    const failedAudit = await prisma.auditLog.findFirst({
      where: {
        entity: 'order_ticket',
        entityId: created.body.id,
        action: 'DELIVERY_UPDATED_RECEIPT_SEND_SUPPRESSED',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(failedAudit).toBeTruthy();
    expect(failedAudit?.newValues).toMatchObject({
      revision: updated.body.revision,
      receiptUpdated: true,
      sendAttempted: false,
      sendSucceeded: false,
      phoneMasked: expect.stringMatching(/^\*+0808$/),
    });
    sendSpy.mockRestore();
  });

  it('keeps commercial delivery update and records failure when customer phone is missing', async () => {
    const { accessToken } = await login();
    const [burger, soda] = await Promise.all([
      prisma.product.findUniqueOrThrow({
        where: { code: 'HAMB-2X1' },
      }),
      prisma.product.findUniqueOrThrow({
        where: { code: 'CC-ORG-400' },
      }),
    ]);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Sin telefono',
        customerPhone: '3215550909',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const withoutPhone = await prisma.orderTicket.update({
      where: { id: created.body.id },
      data: { customerPhone: null },
    });

    const sendSpy = jest.spyOn(whatsappService, 'sendDeliveryOrderSummary');

    const updated = await request(app.getHttpServer())
      .put(`/orders/${created.body.id}/items`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        expectedRevision: withoutPhone.revision,
        items: [
          { productId: burger.id, quantity: 1 },
          { productId: soda.id, quantity: 1 },
        ],
      })
      .expect(200);

    expect(Number(updated.body.subtotal)).toBe(Number(created.body.subtotal) + Number(soda.salePrice));
    expect(sendSpy).not.toHaveBeenCalled();

    const failedAudit = await prisma.auditLog.findFirst({
      where: {
        entity: 'order_ticket',
        entityId: created.body.id,
        action: 'DELIVERY_UPDATED_RECEIPT_SEND_FAILED',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(failedAudit).toBeTruthy();
    expect(failedAudit?.newValues).toMatchObject({
      revision: updated.body.revision,
      receiptUpdated: true,
      sendAttempted: false,
      sendSucceeded: false,
      failureReason: 'CUSTOMER_PHONE_MISSING',
      phoneMasked: null,
    });
    sendSpy.mockRestore();
  });

  it('delivery issues create persistent issue records and alerts visible to admin', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: riderToken } = await loginDeliveryRider();
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const deliveryUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'delivery@2x1burgerco.local' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente novedad',
        customerPhone: '3215550404',
        deliveryReference: 'Cra 10 # 10-10',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/orders/${created.body.id}/assign-rider`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        riderId: deliveryUser.id,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/orders/${created.body.id}/delivery-workflow`)
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        workflowStatus: 'ISSUE',
        issueType: 'ROUTE_INCIDENT',
        notes: 'El acceso principal está bloqueado.',
      })
      .expect(201);

    const issue = await prisma.deliveryIssue.findFirst({
      where: { orderTicketId: created.body.id },
      orderBy: { createdAt: 'desc' },
    });

    expect(issue).toBeTruthy();
    expect(issue?.issueType).toBe('ROUTE_INCIDENT');
    expect(issue?.status).toBe('OPEN');

    const alertsResponse = await request(app.getHttpServer())
      .get('/orders/operational-alerts?module=deliveries')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(
      alertsResponse.body.some(
        (alert: { type: string; entityId: string }) =>
          alert.type === 'DELIVERY_ISSUE' && alert.entityId === created.body.id,
      ),
    ).toBe(true);
  });

  it('waiter sync creates persistent operational alerts for the shift', async () => {
    const { accessToken: adminToken } = await login();
    const { accessToken: waiterToken } = await loginWaiter();
    const table = await prisma.diningTable.findFirstOrThrow({
      orderBy: { label: 'asc' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ openingAmount: 0 })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/orders/waiter-sync')
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({
        tableId: table.id,
        status: 'PAYMENT_PENDING',
        clientMutationId: 'waiter-alert-1',
        items: [{ productId: burger.id, quantity: 1 }],
      })
      .expect(201);

    const alertsResponse = await request(app.getHttpServer())
      .get('/orders/operational-alerts?module=waiters')
      .set('Authorization', `Bearer ${waiterToken}`)
      .expect(200);

    expect(
      alertsResponse.body.some(
        (alert: { type: string; entityId: string }) =>
          alert.type === 'WAITER_ORDER_READY_FOR_PAYMENT' && alert.entityId === created.body.id,
      ),
    ).toBe(true);
  });

  it('supports controlled cash reopen and classified manual movements', async () => {
    const { accessToken } = await login();

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        openingAmount: 50000,
        openingBreakdown: { '50000': 1 },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/cash-register/close')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        actualAmount: 54000,
        closingBreakdown: { '50000': 1, '2000': 2 },
      })
      .expect(201);

    const reopen = await request(app.getHttpServer())
      .post('/cash-register/reopen')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        reason: 'Corrección de arqueo',
      });

    expect(reopen.status).toBe(201);
    expect(reopen.body.reopenedFromSessionId).toBeTruthy();
    expect(reopen.body.openingBreakdown).toEqual({ '2000': 2, '50000': 1 });

    const movement = await request(app.getHttpServer())
      .post('/cash-register/movements/manual')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'OTHER_EXPENSE',
        amount: 3000,
        classification: 'Pago menor',
        description: 'Compra de insumo urgente',
      });

    expect(movement.status).toBe(201);
    expect(movement.body.classification).toBe('Pago menor');

    const operationalLog = await request(app.getHttpServer())
      .get('/cash-register/operational-log')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(operationalLog.status).toBe(200);
    expect(
      (operationalLog.body.items as OperationalLogItem[]).some(
        (item) => item.type === 'CAJA_REAPERTURA' || item.type === 'CAJA_APERTURA',
      ),
    ).toBe(true);
  });

  it('guided stock counts adjust stock and persist the count session', async () => {
    const { accessToken } = await login();
    const ingredient = await prisma.ingredient.findUniqueOrThrow({
      where: { code: 'PAN-HAMB' },
    });

    const preview = await request(app.getHttpServer())
      .get('/inventory/stock-counts/preview?scope=INGREDIENTS')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(preview.status).toBe(200);
    expect((preview.body.items as StockCountPreviewItem[]).some((item) => item.id === ingredient.id)).toBe(true);

    const createCount = await request(app.getHttpServer())
      .post('/inventory/stock-counts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        scope: 'INGREDIENTS',
        notes: 'Conteo semanal',
        items: [
          {
            itemType: 'INGREDIENT',
            itemId: ingredient.id,
            countedStock: 12,
            reason: 'Conteo físico',
          },
        ],
      });

    expect(createCount.status).toBe(201);
    expect(createCount.body.items).toHaveLength(1);

    const updatedIngredient = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });
    expect(Number(updatedIngredient.currentStock)).toBe(12);

    const sessions = await request(app.getHttpServer())
      .get('/inventory/stock-counts')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(sessions.status).toBe(200);
    expect(sessions.body[0].status).toBe('COMPLETED');
  });

  it('builds reorder suggestions and executive report datasets', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });
    const supplier = await prisma.supplier.findFirstOrThrow();
    const ingredient = await prisma.ingredient.findUniqueOrThrow({
      where: { code: 'PAN-HAMB' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/purchases')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        supplierId: supplier.id,
        items: [{ ingredientId: ingredient.id, quantity: 3, unitCost: 1200 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        channel: 'MOSTRADOR',
        items: [{ productId: burger.id, quantity: 2 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 40000 }],
      })
      .expect(201);

    await prisma.product.update({
      where: { code: 'CC-ORG-400' },
      data: { currentStock: 1, stockMin: 6 },
    });
    await prisma.ingredient.update({
      where: { code: 'PAN-HAMB' },
      data: { currentStock: 1, stockMin: 6 },
    });

    const [suggestions, byHour, margins, rotation, comparisons, dailyReport, operationalReport] = await Promise.all([
      request(app.getHttpServer()).get('/inventory/reorder-suggestions').set('Authorization', `Bearer ${accessToken}`),
      request(app.getHttpServer()).get('/reports/sales-by-hour').set('Authorization', `Bearer ${accessToken}`),
      request(app.getHttpServer()).get('/reports/product-margins').set('Authorization', `Bearer ${accessToken}`),
      request(app.getHttpServer()).get('/reports/ingredient-rotation').set('Authorization', `Bearer ${accessToken}`),
      request(app.getHttpServer()).get('/reports/comparisons').set('Authorization', `Bearer ${accessToken}`),
      request(app.getHttpServer()).get('/reports/daily').set('Authorization', `Bearer ${accessToken}`),
      request(app.getHttpServer()).get('/reports/operational').set('Authorization', `Bearer ${accessToken}`),
    ]);

    expect(suggestions.status).toBe(200);
    expect(Array.isArray(suggestions.body.alerts)).toBe(true);
    expect(byHour.status).toBe(200);
    expect(byHour.body).toHaveLength(24);
    expect(margins.status).toBe(200);
    expect(margins.body[0]).toHaveProperty('margin');
    expect(rotation.status).toBe(200);
    expect(rotation.body[0]).toHaveProperty('daysOfCoverage');
    expect(comparisons.status).toBe(200);
    expect(comparisons.body.day.current.salesTotal).toBeGreaterThan(0);
    expect(dailyReport.status).toBe(200);
    expect(dailyReport.body.sales.count).toBe(1);
    expect(dailyReport.body.sales.itemsSold).toBe(2);
    expect(dailyReport.body.sales.canceledCount).toBe(0);
    expect(dailyReport.body.sales.pendingCount).toBe(0);
    expect(dailyReport.body.sales.bestSellers[0].productName).toBe('Hamburguesa 2x1');
    expect(Array.isArray(dailyReport.body.sales.leastSellers)).toBe(true);
    expect(Array.isArray(dailyReport.body.sales.nonMovingProducts)).toBe(true);
    expect(dailyReport.body.replenishment).toHaveProperty('productLowStock');
    expect(dailyReport.body.replenishment).toHaveProperty('productCriticalStock');
    expect(dailyReport.body.replenishment).toHaveProperty('productOutOfStock');
    expect(dailyReport.body.replenishment.productCriticalStock).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productCode: 'CC-ORG-400',
          productName: 'Coca-Cola Original 400 ml',
          currentStock: 1,
          stockMin: 6,
          missingQty: 5,
        }),
      ]),
    );
    expect(dailyReport.body.replenishment.criticalStock).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientCode: 'PAN-HAMB',
          ingredientName: 'Pan de hamburguesa',
          currentStock: 1,
          stockMin: 6,
        }),
      ]),
    );
    expect(operationalReport.status).toBe(200);
    expect(operationalReport.body.sales.count).toBe(dailyReport.body.sales.count);
    expect(operationalReport.body.sales.itemsSold).toBe(dailyReport.body.sales.itemsSold);
    expect(operationalReport.body.replenishment.productCriticalStock.length).toBeGreaterThan(0);
    expect(operationalReport.body.replenishment.criticalStock.length).toBeGreaterThan(0);
  });

  it('daily PDF endpoint returns a printable enriched document', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const burger = await prisma.product.findUniqueOrThrow({
      where: { code: 'HAMB-2X1' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        channel: 'MOSTRADOR',
        items: [{ productId: burger.id, quantity: 1 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 20000 }],
      })
      .expect(201);

    const pdfResponse = await request(app.getHttpServer())
      .get(`/reports/daily/${new Date().toISOString().slice(0, 10)}/pdf`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers['content-type']).toContain('application/pdf');
    expect(Buffer.isBuffer(pdfResponse.body)).toBe(true);
    expect((pdfResponse.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('operational dashboard resets after daily close', async () => {
    const { accessToken } = await login();
    const paymentCash = await prisma.paymentMethod.findUniqueOrThrow({
      where: { code: 'cash' },
    });
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });

    await request(app.getHttpServer())
      .post('/sales')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: soda.id, quantity: 1 }],
        payments: [{ paymentMethodId: paymentCash.id, amount: 4500 }],
      });

    await request(app.getHttpServer())
      .post('/cash-register/close')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ actualAmount: 54500 });

    const operational = await request(app.getHttpServer())
      .get('/reports/operational')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(operational.status).toBe(200);
    expect(operational.body.journey.status).toBe('PENDIENTE_APERTURA');
    expect(operational.body.sales.total).toBe(0);
    expect(operational.body.cash.expectedAmount).toBe(0);
  });

  it('keeps Sofia drafts as supervised projections without operational, payment, stock or cash side effects', async () => {
    const protectedResponse = await request(app.getHttpServer()).get('/admin/sofia/conversations');
    expect(protectedResponse.status).toBe(401);

    const { accessToken } = await login();
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });
    const stockBefore = Number(soda.currentStock);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();
    const orderTicketsBefore = await prisma.orderTicket.count();

    const inbound = await request(app.getHttpServer())
      .post('/admin/sofia/conversations/mock-inbound')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0101',
        customerName: 'Cliente Sofía',
        body: 'Hola Sofía, quiero una Coca-Cola a domicilio',
        rawPayload: { provider: 'mock-admin' },
      })
      .expect(201);

    expect(inbound.body.phone).toMatch(/^\*+0101$/);
    expect(inbound.body.messages).toHaveLength(1);
    expect(inbound.body.messages[0].direction).toBe('INBOUND');

    const reusedConversation = await request(app.getHttpServer())
      .post('/admin/sofia/conversations/mock-inbound')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0101',
        customerName: 'Cliente Sofía',
        body: 'Agregar una unidad',
      })
      .expect(201);

    expect(reusedConversation.body.id).toBe(inbound.body.id);
    expect(reusedConversation.body.messages).toHaveLength(2);

    await request(app.getHttpServer())
      .post(`/admin/sofia/conversations/${inbound.body.id}/mock-outbound`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ body: 'Pedido recibido en modo mock. Te confirmo el resumen.' })
      .expect(201);

    const draft = await request(app.getHttpServer())
      .post('/admin/sofia/order-drafts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        conversationId: inbound.body.id,
        customerName: 'Cliente Sofía',
        customerPhone: '+57 316 555 0101',
        deliveryAddress: 'Cra 10 # 20-30',
        deliveryNeighborhood: 'Jamundí',
        deliveryNotes: 'Casa blanca',
        aiSummary: 'Pedido mock creado desde admin para validar núcleo interno.',
        items: [{ productId: soda.id, quantity: 2 }],
      })
      .expect(201);

    expect(draft.body.status).toBe('READY_TO_CONFIRM');
    expect(draft.body.source).toBe('MOCK_ADMIN');
    expect(Number(draft.body.subtotal)).toBe(9000);
    expect(Number(draft.body.deliveryFee)).toBe(0);
    expect(Number(draft.body.total)).toBe(9000);

    const updatedDraft = await request(app.getHttpServer())
      .patch(`/admin/sofia/order-drafts/${draft.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ deliveryNotes: 'Casa blanca, portón negro' })
      .expect(200);

    expect(updatedDraft.body.deliveryNotes).toContain('portón negro');

    const legacyConfirmation = await request(app.getHttpServer())
      .post(`/admin/sofia/order-drafts/${draft.body.id}/confirm`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);

    expect(legacyConfirmation.body.code).toBe('SOFIA_DRAFT_NOT_CONFIRMABLE');
    expect(legacyConfirmation.body.reasonCode).toBe('PHASE_4_BINDING_REQUIRED');

    const deliveryOrdersBefore = await prisma.whatsappDeliveryOrder.count({
      where: { orderDraftId: draft.body.id },
    });
    const blockedConversion = await request(app.getHttpServer())
      .post(`/admin/sofia/delivery-orders/from-draft/${draft.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(403);

    expect(blockedConversion.body.code).toBe('SOFIA_ORDER_CREATION_BLOCKED');
    expect(await prisma.whatsappDeliveryOrder.count({ where: { orderDraftId: draft.body.id } })).toBe(deliveryOrdersBefore);

    const deliveryActive = await request(app.getHttpServer())
      .get('/orders/delivery-active')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(deliveryActive.body).toHaveLength(0);

    const posActive = await request(app.getHttpServer())
      .get('/orders?activeOnly=true')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(posActive.body).toHaveLength(0);

    const cancelDraft = await request(app.getHttpServer())
      .post('/admin/sofia/order-drafts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        customerName: 'Cliente Cancelado',
        customerPhone: '+57 316 555 0102',
        deliveryAddress: 'Calle 11 # 22-33',
        items: [{ productId: soda.id, quantity: 1 }],
      })
      .expect(201);

    const cancelled = await request(app.getHttpServer())
      .post(`/admin/sofia/order-drafts/${cancelDraft.body.id}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    expect(cancelled.body.status).toBe('CANCELLED');

    const sodaAfter = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });
    expect(Number(sodaAfter.currentStock)).toBe(stockBefore);
    expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
    expect(await prisma.sale.count()).toBe(salesBefore);
    expect(await prisma.orderTicket.count()).toBe(orderTicketsBefore);
  });

  it('hard-disables the legacy Sofia payment webhook without mutating financial state', async () => {
    const { accessToken } = await login();
    const soda = await prisma.product.findUniqueOrThrow({
      where: { code: 'CC-ORG-400' },
    });

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 });
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();

    const inbound = await request(app.getHttpServer())
      .post('/admin/sofia/conversations/mock-inbound')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0202',
        customerName: 'Cliente Online Sofia',
        body: 'Quiero pagar online',
      })
      .expect(201);

    const draft = await request(app.getHttpServer())
      .post('/admin/sofia/order-drafts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        conversationId: inbound.body.id,
        customerName: 'Cliente Online Sofia',
        customerPhone: '+57 316 555 0202',
        deliveryAddress: 'Cra 40 # 10-20',
        deliveryNeighborhood: 'Jamundí',
        items: [{ productId: soda.id, quantity: 1 }],
      })
      .expect(201);

    const legacyConfirmation = await request(app.getHttpServer())
      .post(`/admin/sofia/order-drafts/${draft.body.id}/confirm`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);
    expect(legacyConfirmation.body.code).toBe('SOFIA_DRAFT_NOT_CONFIRMABLE');
    expect(legacyConfirmation.body.reasonCode).toBe('PHASE_4_BINDING_REQUIRED');

    const blockedConversion = await request(app.getHttpServer())
      .post(`/admin/sofia/delivery-orders/from-draft/${draft.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(403);
    expect(blockedConversion.body.code).toBe('SOFIA_ORDER_CREATION_BLOCKED');

    // Provider reconciliation needs a persisted test fixture, not the disabled SOFIA conversion path.
    const onlineRecord = await prisma.whatsappDeliveryOrder.create({
      data: {
        conversationId: inbound.body.id,
        orderDraftId: draft.body.id,
        orderTicketId: null,
        status: 'CONFIRMED',
        customerNameSnapshot: draft.body.customerName,
        customerPhoneSnapshot: draft.body.customerPhone,
        deliveryAddressSnapshot: draft.body.deliveryAddress,
        deliveryNeighborhoodSnapshot: draft.body.deliveryNeighborhood,
        itemsSnapshot: draft.body.itemsSnapshot as Prisma.InputJsonValue,
        subtotal: draft.body.subtotal,
        deliveryFee: draft.body.deliveryFee,
        total: draft.body.total,
        source: draft.body.source,
        createdByAgentNameSnapshot: 'Sofía',
        onlinePaymentProvider: 'MOCK',
        providerPaymentId: 'mock-payment-critical-1',
        providerReference: 'mock-provider-critical-1',
        orderReference: 'ORD-TEST-CRITICAL-1',
        paymentMethod: 'ONLINE',
        paymentStatus: 'PENDING_ONLINE_PAYMENT',
      },
    });
    expect(onlineRecord.providerPaymentId).toBeTruthy();
    expect(onlineRecord.providerReference).toBeTruthy();

    const webhookEventsBefore = await prisma.paymentWebhookEvent.count();
    const sofiaPaymentEventsBefore = await prisma.sofiaPaymentEvent.count({
      where: { whatsappDeliveryOrderId: onlineRecord.id },
    });

    await request(app.getHttpServer())
      .post('/integrations/payments/webhook/mock')
      .set('x-mock-payment-signature', 'mock-dev-signature')
      .send({
        eventId: 'mock-paid-critical-1',
        eventType: 'mock.payment.paid',
        providerPaymentId: onlineRecord.providerPaymentId,
        providerReference: onlineRecord.providerReference,
        orderReference: onlineRecord.orderReference,
        status: 'PAID',
        amount: Number(onlineRecord.total),
        currency: 'COP',
      })
      .expect(404);

    expect(await prisma.paymentWebhookEvent.count()).toBe(webhookEventsBefore);
    expect(
      await prisma.sofiaPaymentEvent.count({
        where: { whatsappDeliveryOrderId: onlineRecord.id },
      }),
    ).toBe(sofiaPaymentEventsBefore);

    const reflectedOrder = await prisma.whatsappDeliveryOrder.findUniqueOrThrow({
      where: { id: onlineRecord.id },
    });
    expect(reflectedOrder.orderTicketId).toBeNull();
    expect(reflectedOrder.paymentMethod).toBe('ONLINE');
    expect(reflectedOrder.paymentStatus).toBe('PENDING_ONLINE_PAYMENT');
    expect(reflectedOrder.webhookEventCount).toBe(0);
    expect(reflectedOrder.onlinePaymentPaidAt).toBeNull();

    await request(app.getHttpServer())
      .post('/dev/sofia/payments/mock-webhook')
      .send({ orderReference: onlineRecord.orderReference, status: 'PAID', amount: Number(onlineRecord.total) })
      .expect(401);

    expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
    expect(await prisma.sale.count()).toBe(salesBefore);
  });

  it('exposes Sofia canonical commercial brain with prompt, catalog, memory and anti-invention rules', async () => {
    const { accessToken } = await login();
    const stockBefore = await prisma.product.aggregate({ _sum: { currentStock: true } });
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();

    const prompt = await request(app.getHttpServer())
      .get('/admin/sofia/prompt/active')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(prompt.body.version).toBe('SOFIA_MASTER_PROMPT_V2');
    expect(prompt.body.status).toBe('ACTIVE');
    expect(prompt.body.promptText).toContain('No inventes productos');

    const activePromptCount = await prisma.sofiaPromptVersion.count({ where: { status: 'ACTIVE' } });
    expect(activePromptCount).toBe(1);

    const catalog = await request(app.getHttpServer())
      .get('/admin/sofia/catalog')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const offers = catalog.body.filter((item: { type: string }) => item.type === 'OFFER');
    expect(offers.map((item: { slug: string }) => item.slug)).toEqual([
      'maxi-family',
      '2x1-hamburguesas',
      'doble-todo',
      'hamburguesa-sencilla',
    ]);
    const maxi = catalog.body.find((item: { slug: string }) => item.slug === 'maxi-family');
    expect(maxi.composition.requiredCopy).toBe('6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L');
    expect(maxi.prohibitedClaims).toContain('papitas para todos');
    expect(maxi.availability).toBe('CONFIGURATION_ONLY');
    expect(maxi.purchasable).toBe(false);
    expect(maxi.price).toBeNull();

    const maxiQuestion = await request(app.getHttpServer())
      .post('/admin/sofia/sandbox/commercial-message')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 317 111 0001',
        customerName: 'Cliente Cerebro',
        message: 'qué trae el Maxi Family',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(maxiQuestion.body.promptVersion).toBe('SOFIA_MASTER_PROMPT_V2');
    expect(maxiQuestion.body.commercialCatalog.filter((item: { type: string }) => item.type === 'OFFER')).toHaveLength(4);
    expect(maxiQuestion.body.responseText).toContain('6 burgers');
    expect(maxiQuestion.body.responseText).toContain('porción personal de papitas');
    expect(maxiQuestion.body.responseText).toContain('Pepsi 1.5 L');
    expect(maxiQuestion.body.responseText).toContain('todavía no está disponible para comprar');
    expect(maxiQuestion.body.responseText).not.toMatch(/papas familiares|papas grandes|papas para todos|papitas para todos|porción familiar/i);

    const dobleTodo = await request(app.getHttpServer())
      .post('/admin/sofia/sandbox/commercial-message')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 317 111 0002',
        customerName: 'Cliente Doble',
        message: 'y la doble todo qué trae',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(dobleTodo.body.responseText).toContain('doble carne');
    expect(dobleTodo.body.responseText).toContain('doble tocineta');
    expect(dobleTodo.body.responseText).toContain('doble queso cheddar en lonjas');

    const repeatWithoutMemory = await request(app.getHttpServer())
      .post('/admin/sofia/sandbox/commercial-message')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 317 111 0003',
        customerName: 'Cliente Sin Memoria',
        message: 'quiero lo mismo de ayer',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(repeatWithoutMemory.body.responseText).toContain('Todavía no tengo un pedido anterior confirmado');

    await prisma.sofiaCustomerMemory.upsert({
      where: { phoneNormalized: '573171110004' },
      create: {
        phoneNormalized: '573171110004',
        displayName: 'Cliente Con Memoria',
        lastOrderSummaryJson: { items: [{ name: 'Maxi Family', quantity: 1 }], total: 0, currency: 'COP' },
        consentState: 'IMPLIED_BY_CONVERSATION',
      },
      update: {
        lastOrderSummaryJson: { items: [{ name: 'Maxi Family', quantity: 1 }], total: 0, currency: 'COP' },
      },
    });
    const repeatWithMemory = await request(app.getHttpServer())
      .post('/admin/sofia/sandbox/commercial-message')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 317 111 0004',
        customerName: 'Cliente Con Memoria',
        message: 'quiero lo mismo de ayer',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(repeatWithMemory.body.responseText).toContain('tu último pedido fue Maxi Family');
    expect(repeatWithMemory.body.responseText).toContain('papitas adicionales');

    const correction = await request(app.getHttpServer())
      .post('/admin/sofia/sandbox/commercial-message')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        conversationId: maxiQuestion.body.conversationId,
        message: 'ese combo familiar trae papitas para todos',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(correction.body.responseText).toContain('porción personal de papitas');
    const ruleEvents = await prisma.sofiaCommercialRuleEvent.findMany({ where: { conversationId: maxiQuestion.body.conversationId } });
    expect(ruleEvents.some((event) => event.ruleCode === 'MAXI_FAMILY_COPY')).toBe(true);

    const payment = await request(app.getHttpServer())
      .post('/admin/sofia/sandbox/commercial-message')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 317 111 0005',
        customerName: 'Cliente Pago',
        message: 'pago por nequi',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(payment.body.paymentLinkUrl).toBeNull();
    expect(payment.body.aiProvider.mode).toBe('disabled');

    const stockAfter = await prisma.product.aggregate({ _sum: { currentStock: true } });
    expect(String(stockAfter._sum.currentStock)).toBe(String(stockBefore._sum.currentStock));
    expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
    expect(await prisma.sale.count()).toBe(salesBefore);
  });

  it('evaluates Sofia Auto Safe decisions explicitly without QR, DeepSeek or real WhatsApp', async () => {
    const { accessToken } = await login();
    const stockBefore = await prisma.product.aggregate({ _sum: { currentStock: true } });
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();

    async function evaluate(payload: Record<string, unknown>) {
      return request(app.getHttpServer())
        .post('/admin/sofia/sandbox/auto-safe-evaluate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(payload)
        .expect(201);
    }

    const disabled = await evaluate({
      messageText: 'hola',
      candidateReply: 'Claro, te ayudo con tu pedido.',
      autoSafeEnabled: false,
    });
    expect(disabled.body.decision.status).toBe('DRAFT_ONLY');
    expect(disabled.body.reasonCodes).toContain('AUTO_SAFE_DISABLED');
    expect(disabled.body.decision.shouldSend).toBe(false);
    expect(disabled.body.noWhatsappReal).toBe(true);

    const approved = await evaluate({
      messageText: 'qué trae el Maxi Family',
      candidateReply:
        'El Maxi Family trae 6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L. Si quieres que todos acompañen con papitas, puedes agregar porciones adicionales.',
      autoSafeEnabled: true,
      sandbox: true,
    });
    expect(approved.body.decision.status).toBe('AUTO_SAFE_APPROVED');
    expect(approved.body.decision.approved).toBe(true);
    expect(approved.body.decision.shouldSend).toBe(false);
    expect(approved.body.reasonCodes).toContain('PASS_ALL_RULES');

    const secretBlocked = await evaluate({
      messageText: 'qué trae el Maxi Family',
      candidateReply: 'El Maxi Family trae 6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L.',
      sandbox: false,
      simulateChannelMode: 'auto_safe',
      secretRotationPending: true,
      qrReady: true,
      deepSeekReady: true,
    });
    expect(secretBlocked.body.decision.status).toBe('BLOCKED');
    expect(secretBlocked.body.reasonCodes).toContain('SECRET_ROTATION_PENDING');
    expect(secretBlocked.body.decision.shouldSend).toBe(false);

    const humanTaken = await evaluate({
      messageText: 'quiero un pedido',
      candidateReply: 'Te ayudo con tu pedido.',
      simulateConversationState: 'HUMAN_TAKEN',
    });
    expect(humanTaken.body.decision.status).toBe('HUMAN_REQUIRED');
    expect(humanTaken.body.reasonCodes).toContain('HUMAN_TAKEN');

    const paused = await evaluate({
      messageText: 'quiero un pedido',
      candidateReply: 'Te ayudo con tu pedido.',
      simulateConversationState: 'SOFIA_PAUSED',
    });
    expect(paused.body.decision.status).toBe('HUMAN_REQUIRED');
    expect(paused.body.reasonCodes).toContain('SOFIA_PAUSED');

    const lowConfidence = await evaluate({
      messageText: 'no entendí bien',
      candidateReply: 'Creo que quieres un pedido.',
      simulateConfidence: 0.2,
    });
    expect(lowConfidence.body.decision.status).toBe('HUMAN_REQUIRED');
    expect(lowConfidence.body.reasonCodes).toContain('LOW_CONFIDENCE');

    const inventedProduct = await evaluate({
      phone: '+57 317 222 0001',
      messageText: 'quiero sushi',
    });
    expect(inventedProduct.body.decision.status).toBe('HUMAN_REQUIRED');
    expect(inventedProduct.body.reasonCodes).toContain('UNKNOWN_PRODUCT');
    expect(inventedProduct.body.finalReply).toContain('Déjame confirmarlo con el equipo');

    const unknownPrice = await evaluate({
      messageText: 'cuánto vale la burger especial',
      candidateReply: 'Vale 25000 COP.',
    });
    expect(unknownPrice.body.decision.status).toBe('HUMAN_REQUIRED');
    expect(unknownPrice.body.reasonCodes).toContain('UNKNOWN_PRICE');

    const inventedPromotion = await evaluate({
      messageText: 'qué promociones tienen',
      candidateReply: 'Tenemos una promo gratis especial solo por hoy.',
    });
    expect(inventedPromotion.body.decision.status).toBe('BLOCKED');
    expect(inventedPromotion.body.reasonCodes).toContain('INVENTED_PROMOTION');

    const maxiIncorrect = await evaluate({
      messageText: 'viene con papas grandes',
      candidateReply: 'El Maxi Family trae 6 burgers, papas grandes y Pepsi 1.5 L.',
    });
    expect(maxiIncorrect.body.decision.status).toBe('BLOCKED');
    expect(maxiIncorrect.body.reasonCodes).toContain('MAXI_FAMILY_COPY_RISK');

    const paidClaim = await evaluate({
      messageText: 'ya pagué por Nequi',
      candidateReply: 'Pago confirmado, ya quedó pagado.',
    });
    expect(paidClaim.body.decision.status).toBe('BLOCKED');
    expect(paidClaim.body.reasonCodes).toContain('PAID_CLAIM_BLOCKED');

    const safeNequiExplanation = await evaluate({
      messageText: 'cómo pago por nequi',
      candidateReply: 'Puedes elegir Nequi manual en el link de pago. El equipo revisa la evidencia antes de actualizar el estado.',
    });
    expect(safeNequiExplanation.body.decision.status).toBe('AUTO_SAFE_APPROVED');
    expect(safeNequiExplanation.body.decision.shouldSend).toBe(false);

    const draftOnlyOrder = await evaluate({
      phone: '+57 317 222 0002',
      messageText: 'quiero un maxi family',
    });
    expect(['DRAFT_ONLY', 'HUMAN_REQUIRED']).toContain(draftOnlyOrder.body.decision.status);
    expect(draftOnlyOrder.body.decision.shouldSend).toBe(false);

    const complaint = await evaluate({
      phone: '+57 317 222 0003',
      messageText: 'me llegó mal el pedido',
    });
    expect(complaint.body.decision.status).toBe('HUMAN_REQUIRED');
    expect(complaint.body.reasonCodes).toContain('CUSTOMER_COMPLAINT');

    const autoSafeEvents = await prisma.sofiaAutoSafeDecisionEvent.count();
    expect(autoSafeEvents).toBeGreaterThanOrEqual(13);

    const stockAfter = await prisma.product.aggregate({ _sum: { currentStock: true } });
    expect(String(stockAfter._sum.currentStock)).toBe(String(stockBefore._sum.currentStock));
    expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
    expect(await prisma.sale.count()).toBe(salesBefore);
  });

  it('exposes Sofia enterprise governance panel status, readiness and kill-switch without activating real channels', async () => {
    const { accessToken } = await login();
    const stockBefore = await prisma.product.aggregate({ _sum: { currentStock: true } });
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();

    const enterprise = await request(app.getHttpServer())
      .get('/admin/sofia/enterprise-status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(enterprise.body.generatedAt).toBeDefined();
    expect(enterprise.body.overallStatus).toBe('BLOCKED_FOR_PRODUCTION');
    expect(enterprise.body.productionReadiness.status).toBe('BLOCKED');
    expect(enterprise.body.productionReadiness.blockers).toEqual(expect.arrayContaining(['secret_rotation', 'qr_gateway_real_send', 'qr_gateway_real', 'deepseek_real']));
    expect(enterprise.body.security.secretRotationStatus).toBe('PENDING');
    expect(enterprise.body.security.canActivateQrReal).toBe(false);
    expect(enterprise.body.security.canActivateDeepSeekReal).toBe(false);
    expect(enterprise.body.security.canActivateAutoSafeProduction).toBe(false);
    expect(enterprise.body.security.blockers).toEqual(expect.arrayContaining(['SECRET_ROTATION_PENDING', 'REAL_SEND_DISABLED', 'DEEPSEEK_REAL_DISABLED', 'AUTO_SAFE_PRODUCTION_DISABLED']));
    expect(enterprise.body.sofia.activePromptVersion).toBe('SOFIA_MASTER_PROMPT_V2');
    expect(enterprise.body.catalog.offersCount).toBeGreaterThanOrEqual(4);
    expect(enterprise.body.catalog.maxiFamilyStatus).toBe('PASS');
    expect(enterprise.body.memory.customersWithMemory).toBeGreaterThanOrEqual(0);
    expect(enterprise.body.autoSafe.sandboxOnly).toBe(true);
    expect(enterprise.body.whatsapp.qrGatewayReady).toBe(false);
    expect(enterprise.body.whatsapp.qrReceiveOnlyReady).toBe(true);
    expect(enterprise.body.whatsapp.realSendingEnabled).toBe(false);
    expect(enterprise.body.ai.deepSeekReady).toBe(false);
    expect(enterprise.body.payments.whatsappCanMarkPaid).toBe(false);
    expect(enterprise.body.operations.posStatus).toBe('BLOCKED');
    expect(enterprise.body.operations.deliveriesStatus).toBe('BLOCKED');
    expect(enterprise.body.operations.checkoutStatus).toBe('BLOCKED');
    expect(JSON.stringify(enterprise.body)).not.toContain('sk-');
    expect(JSON.stringify(enterprise.body)).not.toContain('HERMES_API_TOKEN');
    expect(JSON.stringify(enterprise.body)).not.toContain('DEEPSEEK_API_KEY');

    const readiness = await request(app.getHttpServer())
      .get('/admin/sofia/readiness')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(readiness.body.status).toBe('BLOCKED');
    expect(readiness.body.checklist.some((item: { key: string; status: string }) => item.key === 'auto_safe_sandbox' && item.status === 'PASS')).toBe(true);

    const metrics = await request(app.getHttpServer())
      .get('/admin/sofia/metrics')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(metrics.body.autoSafe).toBeDefined();
    expect(metrics.body.catalog.offersCount).toBeGreaterThanOrEqual(4);

    const security = await request(app.getHttpServer())
      .get('/admin/sofia/security-status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(security.body.sanitized).toBe(true);
    expect(security.body.secretsVisible).toBe(false);

    const pause = await request(app.getHttpServer())
      .post('/admin/sofia/governance/pause')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'Prueba F3 governance' })
      .expect(201);
    expect(pause.body.paused).toBe(true);

    const governancePaused = await request(app.getHttpServer())
      .get('/admin/sofia/governance/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(governancePaused.body.globalPaused).toBe(true);

    const resume = await request(app.getHttpServer())
      .post('/admin/sofia/governance/resume')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(resume.body.paused).toBe(false);

    const blockedQr = await request(app.getHttpServer())
      .post('/admin/sofia/governance/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ qrRealAllowed: true })
      .expect(400);
    expect(JSON.stringify(blockedQr.body)).toContain('PHASE_NOT_READY');

    const blockedDeepSeek = await request(app.getHttpServer())
      .post('/admin/sofia/governance/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ deepSeekRealAllowed: true })
      .expect(400);
    expect(JSON.stringify(blockedDeepSeek.body)).toContain('PHASE_NOT_READY');

    const blockedAutoSafe = await request(app.getHttpServer())
      .post('/admin/sofia/governance/settings')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ autoSafeProductionAllowed: true })
      .expect(400);
    expect(JSON.stringify(blockedAutoSafe.body)).toContain('PHASE_NOT_READY');

    const events = await request(app.getHttpServer())
      .get('/admin/sofia/governance/events')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(events.body)).toBe(true);
    expect(events.body.some((event: { type: string }) => event.type === 'GOVERNANCE')).toBe(true);

    const stockAfter = await prisma.product.aggregate({ _sum: { currentStock: true } });
    expect(String(stockAfter._sum.currentStock)).toBe(String(stockBefore._sum.currentStock));
    expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
    expect(await prisma.sale.count()).toBe(salesBefore);
  });

  it('keeps Sofia WhatsApp QR Gateway disabled in tests while validating deduplication and real send blocking', async () => {
    const { accessToken } = await login();
    const stockBefore = await prisma.product.aggregate({ _sum: { currentStock: true } });
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();
    const phone = '573001119999';
    const externalMessageId = `qr-critical-${Date.now()}`;

    const initialStatus = await request(app.getHttpServer())
      .get('/admin/sofia/whatsapp/qr/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(initialStatus.body.provider).toBe('qr_gateway');
    expect(initialStatus.body.mode).toBe('receive_only');
    expect(initialStatus.body.realSendingEnabled).toBe(false);
    expect(initialStatus.body.autoReplyEnabled).toBe(false);
    expect(initialStatus.body.deepSeekEnabled).toBe(false);
    expect(initialStatus.body.sessionPathSanitized).toContain('storage/whatsapp-sessions');
    expect(JSON.stringify(initialStatus.body)).not.toContain('/home/');
    expect(JSON.stringify(initialStatus.body)).not.toContain('sk-');

    const connected = await request(app.getHttpServer())
      .post('/admin/sofia/whatsapp/qr/connect')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
    expect(connected.body.status).toBe('BLOCKED');
    expect(connected.body.reason).toBe('QR_GATEWAY_DISABLED');

    const code = await request(app.getHttpServer())
      .get('/admin/sofia/whatsapp/qr/code')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(code.body.status).toBe('DISABLED');
    expect(code.body.qrAvailable).toBe(false);
    expect(code.body.noSecrets).toBe(true);

    const inbound = await request(app.getHttpServer())
      .post('/admin/sofia/whatsapp/qr/test-inbound')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone,
        text: 'quiero un maxi family',
        externalMessageId,
        messageType: 'TEXT',
      })
      .expect(201);
    expect(inbound.body.provider).toBe('qr_gateway');
    expect(inbound.body.mode).toBe('receive_only');
    expect(inbound.body.conversationId).toBeDefined();
    expect(inbound.body.inboundMessageId).toBeDefined();
    expect(inbound.body.outbound.status).toBe('SUGGESTED');
    expect(inbound.body.realSendingEnabled).toBe(false);

    const duplicate = await request(app.getHttpServer())
      .post('/admin/sofia/whatsapp/qr/test-inbound')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone,
        text: 'quiero un maxi family',
        externalMessageId,
        messageType: 'TEXT',
      })
      .expect(201);
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.processingStatus).toBe('DUPLICATE_IGNORED');

    const conversation = await prisma.whatsappConversation.findUnique({
      where: { id: inbound.body.conversationId },
      include: { messages: true, outboundMessages: true },
    });
    expect(conversation?.provider).toBe('qr_gateway');
    expect(conversation?.mode).toBe('receive_only');
    expect(conversation?.messages.filter((message) => message.provider === 'qr_gateway' && message.direction === 'INBOUND')).toHaveLength(1);
    expect(conversation?.outboundMessages.filter((message) => message.provider === 'qr_gateway')).toHaveLength(1);
    expect(conversation?.outboundMessages[0]?.status).toBe('SUGGESTED');

    const fromMe = await request(app.getHttpServer())
      .post('/admin/sofia/whatsapp/qr/test-inbound')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone,
        text: 'mensaje propio',
        externalMessageId: `${externalMessageId}-from-me`,
        messageType: 'TEXT',
        fromMe: true,
      })
      .expect(201);
    expect(fromMe.body.processingStatus).toBe('FROM_ME_IGNORED');
    expect(fromMe.body.outbound).toBeNull();

    const media = await request(app.getHttpServer())
      .post('/admin/sofia/whatsapp/qr/test-inbound')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone,
        externalMessageId: `${externalMessageId}-audio`,
        messageType: 'AUDIO',
        mediaUrl: 'qr-audio-redacted',
        mediaMimeType: 'audio/ogg',
      })
      .expect(201);
    expect(JSON.stringify(media.body)).toContain('confirmes el pedido por texto');

    const blockedSend = await request(app.getHttpServer())
      .post('/admin/sofia/whatsapp/qr/test-send')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ to: phone, body: 'mensaje bloqueado' })
      .expect(201);
    expect(blockedSend.body.status).toBe('BLOCKED_REAL_SEND_DISABLED');
    expect(blockedSend.body.sent).toBe(false);

    const enterprise = await request(app.getHttpServer())
      .get('/admin/sofia/enterprise-status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(enterprise.body.whatsapp.provider).toBe('qr_gateway');
    expect(enterprise.body.whatsapp.qrGatewayReady).toBe(false);
    expect(enterprise.body.whatsapp.realSendingEnabled).toBe(false);
    expect(enterprise.body.productionReadiness.status).toBe('BLOCKED');
    expect(enterprise.body.payments.whatsappCanMarkPaid).toBe(false);

    const stockAfter = await prisma.product.aggregate({ _sum: { currentStock: true } });
    expect(String(stockAfter._sum.currentStock)).toBe(String(stockBefore._sum.currentStock));
    expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
    expect(await prisma.sale.count()).toBe(salesBefore);
  });

  it('keeps Sofia QR physical pilot receive_only with allowlist, no real send and no WhatsApp PAID', async () => {
    const { accessToken } = await login();
    const originalAllowlistEnabled = process.env.SOFIA_QR_PILOT_ALLOWLIST_ENABLED;
    const originalAllowlistPhones = process.env.SOFIA_QR_PILOT_ALLOWED_PHONES;
    const originalQrRealSend = process.env.SOFIA_QR_PILOT_REAL_SEND;
    const stockBefore = await prisma.product.aggregate({ _sum: { currentStock: true } });
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();
    const ordersBefore = await prisma.orderTicket.count();
    const blockedPhone = '573001115555';
    const phone = '573001115556';

    try {
      process.env.SOFIA_QR_PILOT_ALLOWLIST_ENABLED = 'true';
      process.env.SOFIA_QR_PILOT_ALLOWED_PHONES = '';
      process.env.SOFIA_QR_PILOT_REAL_SEND = 'false';

      const blocked = await sofiaWhatsappService.processInboundWebhook(
        'qr_gateway',
        {
          provider: 'qr_gateway',
          externalMessageId: `qr-f5-blocked-${Date.now()}`,
          providerEventId: `qr-f5-blocked-event-${Date.now()}`,
          phone: blockedPhone,
          text: 'Hola',
          messageType: 'TEXT',
          timestamp: new Date().toISOString(),
        },
        { 'x-sofia-whatsapp-mode': 'receive_only', 'x-sofia-whatsapp-provider': 'qr_gateway' },
        { trustedBaileysTransport: true },
      );
      expect(blocked.processingStatus).toBe('ALLOWLIST_REQUIRED');
      expect(blocked.outbound).toBeNull();
      expect(blocked.noWhatsappReal).toBe(true);

      const blockedConversation = await prisma.whatsappConversation.findUniqueOrThrow({
        where: { id: blocked.conversationId },
      });
      expect(blockedConversation.provider).toBe('qr_gateway');
      expect(blockedConversation.humanStatus).toBe('PILOT_NOT_ALLOWED');
      expect(blockedConversation.sofiaEnabled).toBe(false);

      process.env.SOFIA_QR_PILOT_ALLOWED_PHONES = phone;
      const allowedMessageId = `qr-f5-allowed-${Date.now()}`;
      const allowedTimestamp = new Date().toISOString();
      const allowed = await sofiaWhatsappService.processInboundWebhook(
        'qr_gateway',
        {
          provider: 'qr_gateway',
          externalMessageId: allowedMessageId,
          providerEventId: `${allowedMessageId}-event`,
          phone,
          text: 'Qué trae el Maxi Family',
          messageType: 'TEXT',
          timestamp: allowedTimestamp,
        },
        { 'x-sofia-whatsapp-mode': 'receive_only', 'x-sofia-whatsapp-provider': 'qr_gateway' },
        { trustedBaileysTransport: true },
      );
      expect(allowed.provider).toBe('qr_gateway');
      expect(allowed.mode).toBe('receive_only');
      expect(allowed.outbound?.status).toBe('SUGGESTED');
      expect(allowed.outbound?.body).toContain('porción personal de papitas');
      expect(allowed.outbound?.status).not.toBe('SENT');

      const duplicate = await sofiaWhatsappService.processInboundWebhook(
        'qr_gateway',
        {
          provider: 'qr_gateway',
          externalMessageId: allowedMessageId,
          providerEventId: `${allowedMessageId}-event`,
          phone,
          text: 'Qué trae el Maxi Family',
          messageType: 'TEXT',
          timestamp: allowedTimestamp,
        },
        { 'x-sofia-whatsapp-mode': 'receive_only', 'x-sofia-whatsapp-provider': 'qr_gateway' },
        { trustedBaileysTransport: true },
      );
      expect(duplicate.processingStatus).toBe('DUPLICATE_IGNORED');

      const nequi = await request(app.getHttpServer())
        .post('/admin/sofia/whatsapp/qr/test-inbound')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          phone,
          text: 'Ya pagué por Nequi',
          externalMessageId: `qr-f5-nequi-${Date.now()}`,
          messageType: 'TEXT',
        })
        .expect(201);
      expect(JSON.stringify(nequi.body)).toContain('PAYMENT_SENSITIVE');
      expect(JSON.stringify(nequi.body)).not.toContain('"status":"SENT"');

      const complaintPhone = '573001115557';
      process.env.SOFIA_QR_PILOT_ALLOWED_PHONES = `${phone},${complaintPhone}`;
      const complaint = await request(app.getHttpServer())
        .post('/admin/sofia/whatsapp/qr/test-inbound')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          phone: complaintPhone,
          text: 'Me llegó mal el pedido',
          externalMessageId: `qr-f5-complaint-${Date.now()}`,
          messageType: 'TEXT',
        })
        .expect(201);
      expect(JSON.stringify(complaint.body)).toContain('CUSTOMER_COMPLAINT');

      const unknownPhone = '573001115558';
      process.env.SOFIA_QR_PILOT_ALLOWED_PHONES = `${phone},${complaintPhone},${unknownPhone}`;
      const unknown = await request(app.getHttpServer())
        .post('/admin/sofia/whatsapp/qr/test-inbound')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          phone: unknownPhone,
          text: 'Quiero sushi',
          externalMessageId: `qr-f5-sushi-${Date.now()}`,
          messageType: 'TEXT',
        })
        .expect(201);
      expect(JSON.stringify(unknown.body)).toContain('UNKNOWN_PRODUCT');

      const events = await request(app.getHttpServer())
        .get('/admin/sofia/whatsapp/qr/inbound-events')
        .query({ limit: 20 })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(events.body.provider).toBe('qr_gateway');
      expect(events.body.realSendingEnabled).toBe(false);
      expect(events.body.events.some((event: { processingStatus: string }) => event.processingStatus === 'ALLOWLIST_REQUIRED')).toBe(true);
      expect(JSON.stringify(events.body)).not.toContain(phone);
      expect(JSON.stringify(events.body)).not.toContain('/home/');
      expect(JSON.stringify(events.body)).not.toContain('sk-');

      const blockedSend = await request(app.getHttpServer())
        .post('/admin/sofia/whatsapp/qr/test-send')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ phone, text: 'prueba bloqueo envio real' })
        .expect(201);
      expect(blockedSend.body.status).toBe('BLOCKED_REAL_SEND_DISABLED');
      expect(blockedSend.body.sent).toBe(false);
      expect(blockedSend.body.realSendingEnabled).toBe(false);

      const enterprise = await request(app.getHttpServer())
        .get('/admin/sofia/enterprise-status')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(enterprise.body.productionReadiness.status).toBe('BLOCKED');
      expect(enterprise.body.whatsapp.realSendingEnabled).toBe(false);
      expect(enterprise.body.ai.deepSeekReady).toBe(false);
      expect(enterprise.body.payments.whatsappCanMarkPaid).toBe(false);

      const sentByQr = await prisma.whatsappOutboundMessage.count({
        where: { provider: 'qr_gateway', status: 'SENT' },
      });
      expect(sentByQr).toBe(0);
      expect(await prisma.orderTicket.count()).toBe(ordersBefore);
      const stockAfter = await prisma.product.aggregate({ _sum: { currentStock: true } });
      expect(String(stockAfter._sum.currentStock)).toBe(String(stockBefore._sum.currentStock));
      expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
      expect(await prisma.sale.count()).toBe(salesBefore);
    } finally {
      if (originalAllowlistEnabled === undefined) delete process.env.SOFIA_QR_PILOT_ALLOWLIST_ENABLED;
      else process.env.SOFIA_QR_PILOT_ALLOWLIST_ENABLED = originalAllowlistEnabled;
      if (originalAllowlistPhones === undefined) delete process.env.SOFIA_QR_PILOT_ALLOWED_PHONES;
      else process.env.SOFIA_QR_PILOT_ALLOWED_PHONES = originalAllowlistPhones;
      if (originalQrRealSend === undefined) delete process.env.SOFIA_QR_PILOT_REAL_SEND;
      else process.env.SOFIA_QR_PILOT_REAL_SEND = originalQrRealSend;
    }
  });

  it('wires a real receive-only suggestion end to end: persisted, correlated, audited, RBAC-protected and never sent', async () => {
    const { accessToken } = await login();
    const originalAllowlistEnabled = process.env.SOFIA_QR_PILOT_ALLOWLIST_ENABLED;
    const originalAllowlistPhones = process.env.SOFIA_QR_PILOT_ALLOWED_PHONES;
    const stockBefore = await prisma.product.aggregate({ _sum: { currentStock: true } });
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();
    const ordersBefore = await prisma.orderTicket.count();
    const deliveryOrdersBefore = await prisma.whatsappDeliveryOrder.count();
    const salePaymentsBefore = await prisma.salePayment.count();
    const paymentIntentsBefore = await prisma.paymentIntent.count();
    const paymentLinksBefore = await prisma.paymentLink.count();
    const phone = '573001116001';

    try {
      process.env.SOFIA_QR_PILOT_ALLOWLIST_ENABLED = 'true';
      process.env.SOFIA_QR_PILOT_ALLOWED_PHONES = phone;
      const externalMessageId = `qr-ai-wiring-${Date.now()}`;
      const inboundTimestamp = new Date().toISOString();

      const first = await sofiaWhatsappService.processInboundWebhook(
        'qr_gateway',
        {
          provider: 'qr_gateway',
          externalMessageId,
          providerEventId: `${externalMessageId}-event`,
          phone,
          text: 'Quiero una burger clásica',
          messageType: 'TEXT',
          timestamp: inboundTimestamp,
        },
        { 'x-sofia-whatsapp-mode': 'receive_only', 'x-sofia-whatsapp-provider': 'qr_gateway' },
        { trustedBaileysTransport: true },
      );
      expect(first.outbound?.status).toBe('SUGGESTED');
      expect(first.outbound?.status).not.toBe('SENT');
      const conversationId = first.conversationId as string;
      const outboundId = (first.outbound as { id: string }).id;

      // Retrying the exact same provider event must never create a second suggestion.
      const duplicate = await sofiaWhatsappService.processInboundWebhook(
        'qr_gateway',
        {
          provider: 'qr_gateway',
          externalMessageId,
          providerEventId: `${externalMessageId}-event`,
          phone,
          text: 'Quiero una burger clásica',
          messageType: 'TEXT',
          timestamp: inboundTimestamp,
        },
        { 'x-sofia-whatsapp-mode': 'receive_only', 'x-sofia-whatsapp-provider': 'qr_gateway' },
        { trustedBaileysTransport: true },
      );
      expect(duplicate.processingStatus).toBe('DUPLICATE_IGNORED');
      expect(await prisma.whatsappOutboundMessage.count({ where: { conversationId } })).toBe(1);

      const persistedOutbound = await prisma.whatsappOutboundMessage.findUniqueOrThrow({ where: { id: outboundId } });
      expect(persistedOutbound.autoSafeDecisionEventId).toEqual(expect.any(String));
      const decisionEvent = await prisma.sofiaAutoSafeDecisionEvent.findUniqueOrThrow({
        where: { id: persistedOutbound.autoSafeDecisionEventId! },
      });
      expect(decisionEvent.channelMode).toBe('whatsapp_adapter');
      expect(decisionEvent.isSandbox).toBe(false);
      expect(await prisma.auditLog.findFirstOrThrow({
        where: { module: 'sofia', action: { in: ['AI_SUGGESTION_READY', 'AI_SUGGESTION_BLOCKED'] }, entityId: conversationId },
      })).toBeTruthy();

      const detail = await request(app.getHttpServer())
        .get(`/admin/sofia/conversations/inbox/${conversationId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const suggestedOutbound = (detail.body.outboundMessages as Array<{ id: string; aiSuggestion: unknown }>).find(
        (o) => o.id === outboundId,
      );
      expect(suggestedOutbound?.aiSuggestion).toMatchObject({
        decisionEventId: persistedOutbound.autoSafeDecisionEventId,
      });
      expect(JSON.stringify(detail.body)).not.toContain(phone);

      const { accessToken: waiterToken } = await loginWaiter();
      const forbidden = await request(app.getHttpServer())
        .get(`/admin/sofia/conversations/inbox/${conversationId}`)
        .set('Authorization', `Bearer ${waiterToken}`);
      expect(forbidden.status).not.toBe(200);

      expect(await prisma.orderTicket.count()).toBe(ordersBefore);
      expect(await prisma.whatsappDeliveryOrder.count()).toBe(deliveryOrdersBefore);
      const stockAfter = await prisma.product.aggregate({ _sum: { currentStock: true } });
      expect(String(stockAfter._sum.currentStock)).toBe(String(stockBefore._sum.currentStock));
      expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
      expect(await prisma.sale.count()).toBe(salesBefore);
      expect(await prisma.salePayment.count()).toBe(salePaymentsBefore);
      expect(await prisma.paymentIntent.count()).toBe(paymentIntentsBefore);
      expect(await prisma.paymentLink.count()).toBe(paymentLinksBefore);
      expect(await prisma.whatsappOutboundMessage.count({ where: { conversationId, status: 'SENT' } })).toBe(0);
      expect(await prisma.whatsappOutboundMessage.count({ where: { status: 'SENT' } })).toBe(0);
    } finally {
      if (originalAllowlistEnabled === undefined) delete process.env.SOFIA_QR_PILOT_ALLOWLIST_ENABLED;
      else process.env.SOFIA_QR_PILOT_ALLOWLIST_ENABLED = originalAllowlistEnabled;
      if (originalAllowlistPhones === undefined) delete process.env.SOFIA_QR_PILOT_ALLOWED_PHONES;
      else process.env.SOFIA_QR_PILOT_ALLOWED_PHONES = originalAllowlistPhones;
    }
  });

  it('exposes Sofia learning, metrics, privacy, retention, alerts and backup hardening without production activation', async () => {
    const { accessToken } = await login();
    const stockBefore = await prisma.product.aggregate({ _sum: { currentStock: true } });
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();
    const ordersBefore = await prisma.orderTicket.count();

    const metrics = await request(app.getHttpServer())
      .get('/admin/sofia/metrics/summary')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(metrics.body.payments.whatsappCanMarkPaid).toBe(false);
    expect(metrics.body.system.health).toBe('AGGREGATE_METRICS_ONLY');
    expect(metrics.body.system.logSanitizationStatus).toBe('VERIFIED_EXECUTABLE');
    expect(JSON.stringify(metrics.body)).not.toContain('DEEPSEEK_API_KEY');
    expect(JSON.stringify(metrics.body)).not.toContain('HERMES_API_TOKEN');

    const exportSanitized = await request(app.getHttpServer())
      .get('/admin/sofia/metrics/export-sanitized')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(exportSanitized.body.noSecrets).toBe(true);
    expect(exportSanitized.body.noRawMessages).toBe(true);
    expect(exportSanitized.body.noFullPhones).toBe(true);
    expect(JSON.stringify(exportSanitized.body)).not.toContain('573001115556');

    const feedback = await request(app.getHttpServer())
      .post('/admin/sofia/learning/feedback')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        feedbackType: 'CATALOG_GAP',
        rating: 2,
        notes: 'Cliente 573001112222 pidió producto no ofrecido y dirección Carrera 10 # 20-30',
        correctedReply: 'Confirmo con el equipo antes de ofrecerlo.',
        tags: ['f6', 'catalog'],
      })
      .expect(201);
    expect(feedback.body.module).toBe('SofiaLearningFeedback');
    expect(JSON.stringify(feedback.body.newValues)).not.toContain('573001112222');
    expect(JSON.stringify(feedback.body.newValues)).not.toContain('Carrera 10');

    const feedbackList = await request(app.getHttpServer())
      .get('/admin/sofia/learning/feedback')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(feedbackList.body)).toBe(true);

    const insights = await request(app.getHttpServer())
      .get('/admin/sofia/learning/insights')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(insights.body.noExternalTraining).toBe(true);
    expect(insights.body.noAutomaticPromptChanges).toBe(true);

    const privacy = await request(app.getHttpServer())
      .post('/admin/sofia/privacy/redact-preview')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phoneNumber: '573001112222',
        address: 'Carrera 10 # 20-30',
        accessToken: 'eyJsecretotest',
        rawPayload: { body: 'mensaje completo' },
      })
      .expect(201);
    expect(JSON.stringify(privacy.body)).not.toContain('573001112222');
    expect(JSON.stringify(privacy.body)).not.toContain('Carrera 10');
    expect(JSON.stringify(privacy.body)).not.toContain('eyJsecretotest');
    expect(privacy.body).not.toHaveProperty('rawPayload');

    const retention = await request(app.getHttpServer())
      .post('/admin/sofia/retention/dry-run')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(retention.body.dryRun).toBe(true);
    expect(retention.body.willDeleteOperationalOrders).toBe(false);
    expect(retention.body.willDeletePayments).toBe(false);
    await request(app.getHttpServer())
      .post('/admin/sofia/retention/run')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(400);

    const alertCheck = await request(app.getHttpServer())
      .post('/admin/sofia/alerts/check')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(alertCheck.body.externalNotificationsSent).toBe(false);
    expect(Array.isArray(alertCheck.body.alerts)).toBe(true);
    const openAlert = alertCheck.body.alerts.find((alert: { status: string }) => alert.status === 'OPEN');
    if (openAlert) {
      await request(app.getHttpServer())
        .post(`/admin/sofia/alerts/${openAlert.id}/ack`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
    }

    const backup = await request(app.getHttpServer())
      .post('/admin/sofia/backups/dry-run')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(backup.body.dryRun).toBe(true);
    expect(backup.body.noSecrets).toBe(true);
    expect(JSON.stringify(backup.body)).not.toContain('.env=');
    expect(JSON.stringify(backup.body.excluded)).toContain('storage/whatsapp-sessions');

    const hardening = await request(app.getHttpServer())
      .get('/admin/sofia/hardening/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(hardening.body.logSanitizationStatus).toBe('VERIFIED_EXECUTABLE');
    expect(Object.values(hardening.body.checks)).toEqual([true, true, true, true]);
    expect(JSON.stringify(hardening.body.sample)).not.toContain('/home/');
    expect(JSON.stringify(hardening.body.sample)).not.toContain('qr-secret');

    const enterprise = await request(app.getHttpServer())
      .get('/admin/sofia/enterprise-status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(enterprise.body.productionReadiness.status).toBe('BLOCKED');
    expect(enterprise.body.ai.deepSeekReady).toBe(false);
    expect(enterprise.body.whatsapp.realSendingEnabled).toBe(false);
    expect(enterprise.body.payments.whatsappCanMarkPaid).toBe(false);

    const stockAfter = await prisma.product.aggregate({ _sum: { currentStock: true } });
    expect(String(stockAfter._sum.currentStock)).toBe(String(stockBefore._sum.currentStock));
    expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
    expect(await prisma.sale.count()).toBe(salesBefore);
    expect(await prisma.orderTicket.count()).toBe(ordersBefore);
  });

  it('processes Sofia conversational sandbox messages without inventing data or creating operational orders', async () => {
    const { accessToken } = await login();
    const soda = await prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } });
    const stockBefore = Number(soda.currentStock);

    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();

    const typoOrder = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0303',
        customerName: '',
        message: 'kiero una hamburgesa 2x1 con domisilio',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);

    expect(typoOrder.body.detectedIntent).toBe('ORDER_ITEM');
    expect(typoOrder.body.currentItems.some((item: { name: string }) => item.name.includes('Hamburguesa'))).toBe(true);
    expect(typoOrder.body.missingFields).toContain('deliveryAddress');
    expect(typoOrder.body.suggestedUpsell).toBeTruthy();
    expect(typoOrder.body.mediaSuggestion.altText).toBeTruthy();
    expect(typoOrder.body.mediaSuggestion.imageUrl).toBe('/uploads/sofia-offers/2x1-hamburguesas.webp');
    expect(typoOrder.body.featuredOffers.map((offer: { slug: string }) => offer.slug)).toEqual(['2x1-hamburguesas']);

    const menuCatalog = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0313',
        customerName: 'Cliente Catálogo',
        message: 'qué combos tienen',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(menuCatalog.body.responseText).toContain('2x1 Hamburguesas');
    expect(menuCatalog.body.responseText).not.toContain('Doble Todo');
    expect(menuCatalog.body.responseText).not.toContain('Hamburguesa Sencilla');
    expect(menuCatalog.body.featuredOffers.map((offer: { imageUrl: string }) => offer.imageUrl)).toEqual([
      '/uploads/sofia-offers/2x1-hamburguesas.webp',
    ]);

    const maxiFamily = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0323',
        customerName: 'Cliente Maxi',
        message: 'quiero maxi family',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(maxiFamily.body.responseText).toContain('6 burgers');
    expect(maxiFamily.body.responseText).toContain('porción personal de papitas');
    expect(maxiFamily.body.responseText).toContain('Pepsi 1.5 L');
    expect(maxiFamily.body.responseText).toContain('todavía no está disponible para comprar');
    expect(maxiFamily.body.currentItems).toHaveLength(0);
    expect(maxiFamily.body.suggestedUpsell).toBeNull();
    expect(maxiFamily.body.mediaSuggestion).toBeNull();
    expect(maxiFamily.body.responseText).not.toMatch(/papas familiares|papas grandes|papas para todos|porción familiar de papas/i);

    const maxiCopyCorrection = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        conversationId: maxiFamily.body.conversationId,
        message: 'viene con papas grandes',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(maxiCopyCorrection.body.responseText).toContain('porción personal de papitas');
    expect(maxiCopyCorrection.body.responseText).toContain('todavía no está disponible para comprar');
    expect(maxiCopyCorrection.body.responseText).not.toMatch(/papas familiares|papas grandes|papas para todos|porción familiar de papas/i);

    const maxiPhoto = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0333',
        customerName: 'Cliente Foto Maxi',
        message: 'mándame foto del maxi',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(maxiPhoto.body.mediaSuggestion).toBeNull();
    expect(maxiPhoto.body.responseText).toContain('todavía no está disponible para comprar');

    const sodaOnly = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0343',
        customerName: 'Cliente Bebida',
        message: 'quiero una gaseosa',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(sodaOnly.body.mediaSuggestion).toBeNull();

    const unknownProduct = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0404',
        customerName: 'Cliente No Inventar',
        message: 'quiero sushi galactico',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(unknownProduct.body.currentItems).toHaveLength(0);
    expect(unknownProduct.body.responseText).toContain('Déjame confirmarlo');

    const audioTranscript = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0505',
        customerName: 'Cliente Audio',
        message: 'dos hamburguesas 2x1 y una gaseosa',
        messageType: 'AUDIO_TRANSCRIPT',
        transcriptConfidence: 0.6,
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(audioTranscript.body.responseText).toContain('¿Es correcto?');

    const handoff = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        phone: '+57 316 555 0606',
        customerName: 'Cliente Handoff',
        message: 'quiero hablar con alguien',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(handoff.body.shouldHandoff).toBe(true);

    const nameStep = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        conversationId: typoOrder.body.conversationId,
        message: 'soy Cliente Sandbox',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(nameStep.body.missingFields).toContain('deliveryAddress');

    const addressStep = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        conversationId: typoOrder.body.conversationId,
        message: 'mi direccion es Calle 9 # 12-34 barrio Centro',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(addressStep.body.missingFields).toHaveLength(0);

    const recovery = await request(app.getHttpServer())
      .post('/admin/sofia/agent/recover-abandoned')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ conversationId: typoOrder.body.conversationId })
      .expect(201);
    expect(recovery.body.responseText).toContain('pendiente');

    const confirmOutsideHours = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        conversationId: typoOrder.body.conversationId,
        message: 'si confirmo',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T10:00:00.000Z',
      })
      .expect(201);
    expect(confirmOutsideHours.body.deliveryOrder).toBeNull();
    expect(confirmOutsideHours.body.responseText).toContain('fuera de horario');

    const confirmed = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        conversationId: typoOrder.body.conversationId,
        message: 'si confirmo',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);

    expect(confirmed.body.detectedIntent).toBe('CONFIRM_ORDER');
    expect(confirmed.body.deliveryOrder).toBeNull();
    expect(confirmed.body.paymentLinkUrl).toBeNull();
    expect(confirmed.body.safeguards.sandboxOperationalIsolation).toBe(true);
    expect(confirmed.body.safeguards.productiveActionBlocked).toBe('SOFIA_ORDER_CREATION_BLOCKED');

    const activeDeliveries = await request(app.getHttpServer())
      .get('/orders/delivery-active')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(activeDeliveries.body.some((order: { whatsappDeliveryOrder?: unknown }) => Boolean(order.whatsappDeliveryOrder))).toBe(false);

    const sodaAfter = await prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } });
    expect(Number(sodaAfter.currentStock)).toBe(stockBefore);
    expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
    expect(await prisma.sale.count()).toBe(salesBefore);
  });

  it('processes Sofia WhatsApp/Hermes mock inbound without bypassing secure outbound commands', async () => {
    const { accessToken } = await login();
    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ openingAmount: 50000 })
      .expect(201);

    const soda = await prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } });
    const stockBefore = Number(soda.currentStock);
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();
    const originalEnv = {
      WHATSAPP_MODE: process.env.WHATSAPP_MODE,
      WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER,
      SOFIA_AUTO_REPLY_ENABLED: process.env.SOFIA_AUTO_REPLY_ENABLED,
      SOFIA_REPLY_OUTSIDE_HOURS: process.env.SOFIA_REPLY_OUTSIDE_HOURS,
    };

    try {
      const whatsappWebhook = (
        mode: 'disabled' | 'mock' | 'receive_only' | 'supervised' | 'auto',
        payload: Record<string, unknown>,
        autoReplyEnabled = false,
      ) =>
        request(app.getHttpServer())
          .post('/integrations/whatsapp/mock/webhook')
          .set('x-sofia-whatsapp-mode', mode)
          .set('x-sofia-whatsapp-provider', 'mock')
          .set('x-sofia-auto-reply-enabled', autoReplyEnabled ? 'true' : 'false')
          .send(payload);

      const disabled = await whatsappWebhook('disabled', {
          providerEventId: 'phase8-disabled-event',
          providerMessageId: 'phase8-disabled-message',
          phone: '+57 316 888 0001',
          body: 'hola',
        })
        .expect(201);
      expect(disabled.body.processingStatus).toBe('DISABLED_STORED');
      expect(await prisma.whatsappOutboundMessage.count()).toBe(0);

      const maxiPayload = {
        providerEventId: 'phase8-maxi-event',
        providerMessageId: 'phase8-maxi-message',
        phone: '+57 316 888 0002',
        customerName: 'Cliente WhatsApp',
        body: 'quiero un maxi family',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      };
      const maxi = await whatsappWebhook('mock', maxiPayload).expect(201);
      expect(maxi.body.sofiaResult.responseText).toContain('porción personal de papitas');
      expect(maxi.body.sofiaResult.responseText).not.toContain('papas familiares');
      expect(maxi.body.sofiaResult.responseText).not.toContain('papas grandes');
      expect(maxi.body.outbound.status).toBe('QUEUED');
      expect(maxi.body.outbound.providerMessageId).toBeNull();
      expect(maxi.body.outbound.mediaUrl).toBeNull();

      const messagesBeforeDuplicate = await prisma.whatsappMessage.count();
      const outboundsBeforeDuplicate = await prisma.whatsappOutboundMessage.count();
      const duplicate = await whatsappWebhook('mock', maxiPayload).expect(201);
      expect(duplicate.body.duplicate).toBe(true);
      expect(duplicate.body.processingStatus).toBe('DUPLICATE_IGNORED');
      expect(await prisma.whatsappMessage.count()).toBe(messagesBeforeDuplicate);
      expect(await prisma.whatsappOutboundMessage.count()).toBe(outboundsBeforeDuplicate);

      const supervised = await whatsappWebhook('supervised', {
          providerEventId: 'phase8-supervised-event',
          providerMessageId: 'phase8-supervised-message',
          phone: '+57 316 888 0003',
          customerName: 'Cliente Supervisado',
          body: 'que combos tienen',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        })
        .expect(201);
      expect(supervised.body.outbound.status).toBe('APPROVAL_PENDING');

      const approved = await request(app.getHttpServer())
        .post(`/admin/sofia/outbound/${supervised.body.outbound.id}/approve-send`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
      expect(approved.body.code).toBe('SOFIA_SECURE_COMMAND_REQUIRED');
      expect(approved.body.sent).toBe(false);

      const receiveOnly = await whatsappWebhook('receive_only', {
          providerEventId: 'phase8-receive-only-event',
          providerMessageId: 'phase8-receive-only-message',
          phone: '+57 316 888 0004',
          body: 'hola',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        })
        .expect(201);
      expect(receiveOnly.body.outbound.status).toBe('SUGGESTED');

      const autoBlocked = await whatsappWebhook('auto', {
          providerEventId: 'phase8-auto-blocked-event',
          providerMessageId: 'phase8-auto-blocked-message',
          phone: '+57 316 888 0005',
          body: 'hola',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        });
      if (autoBlocked.status !== 201) {
        throw new Error(`autoBlocked failed: ${JSON.stringify(autoBlocked.body)}`);
      }
      expect(autoBlocked.body.outbound.status).toBe('APPROVAL_PENDING');

      const autoSent = await whatsappWebhook('auto', {
          providerEventId: 'phase8-auto-sent-event',
          providerMessageId: 'phase8-auto-sent-message',
          phone: '+57 316 888 0006',
          body: 'quiero un maxi family',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        }, true)
        .expect(201);
      expect(autoSent.body.outbound.status).toBe('QUEUED');
      expect(autoSent.body.outbound.providerMessageId).toBeNull();

      const handoff = await whatsappWebhook('mock', {
          providerEventId: 'phase8-human-event',
          providerMessageId: 'phase8-human-message',
          phone: '+57 316 888 0007',
          body: 'quiero hablar con alguien',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        })
        .expect(201);
      expect(handoff.body.sofiaResult.shouldHandoff).toBe(true);
      const humanConversation = await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: handoff.body.conversationId } });
      expect(humanConversation.status).toBe('HUMAN_REQUIRED');
      expect(humanConversation.sofiaEnabled).toBe(false);

      const pausedFollowUp = await whatsappWebhook('mock', {
          providerEventId: 'phase8-human-follow-event',
          providerMessageId: 'phase8-human-follow-message',
          phone: '+57 316 888 0007',
          body: 'hola otra vez',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        })
        .expect(201);
      expect(pausedFollowUp.body.processingStatus).toBe('HUMAN_HANDOFF_ACTIVE');
      expect(pausedFollowUp.body.outbound).toBeNull();

      await request(app.getHttpServer())
        .post(`/admin/sofia/conversations/${handoff.body.conversationId}/resume`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
      const resumedConversation = await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: handoff.body.conversationId } });
      expect(resumedConversation.sofiaEnabled).toBe(true);

      const audio = await whatsappWebhook('mock', {
          providerEventId: 'phase8-audio-event',
          providerMessageId: 'phase8-audio-message',
          phone: '+57 316 888 0008',
          messageType: 'AUDIO',
          mediaUrl: 'mock://audio.ogg',
        })
        .expect(201);
      expect(audio.body.sofiaResult.responseText).toContain('confirmes el pedido por texto');
      expect(audio.body.sofiaResult.deliveryOrder).toBeNull();

      const orderPhone = '+57 316 888 0009';
      await whatsappWebhook('mock', {
          providerEventId: 'phase8-order-item-event',
          providerMessageId: 'phase8-order-item-message',
          phone: orderPhone,
          body: 'quiero una hamburguesa 2x1 con domicilio',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        })
        .expect(201);
      await whatsappWebhook('mock', {
          providerEventId: 'phase8-order-name-event',
          providerMessageId: 'phase8-order-name-message',
          phone: orderPhone,
          body: 'soy Cliente Hermes',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        })
        .expect(201);
      await whatsappWebhook('mock', {
          providerEventId: 'phase8-order-address-event',
          providerMessageId: 'phase8-order-address-message',
          phone: orderPhone,
          body: 'mi direccion es Calle 8 # 9-10 barrio Centro',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        })
        .expect(201);
      const confirmed = await whatsappWebhook('mock', {
          providerEventId: 'phase8-order-confirm-event',
          providerMessageId: 'phase8-order-confirm-message',
          phone: orderPhone,
          body: 'si confirmo',
          sandboxNow: '2026-07-01T23:00:00.000Z',
        })
        .expect(201);
      expect(confirmed.body.sofiaResult.deliveryOrder).toBeNull();
      expect(confirmed.body.sofiaResult.paymentLinkUrl).toBeNull();
      expect(confirmed.body.sofiaResult.safeguards.productiveActionBlocked).toBeTruthy();

      const activeDeliveries = await request(app.getHttpServer())
        .get('/orders/delivery-active')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(activeDeliveries.body.some((order: { whatsappDeliveryOrder?: unknown }) => Boolean(order.whatsappDeliveryOrder))).toBe(false);

      const sodaAfter = await prisma.product.findUniqueOrThrow({ where: { code: 'CC-ORG-400' } });
      expect(Number(sodaAfter.currentStock)).toBe(stockBefore);
      expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
      expect(await prisma.sale.count()).toBe(salesBefore);
    } finally {
      process.env.WHATSAPP_MODE = originalEnv.WHATSAPP_MODE;
      process.env.WHATSAPP_PROVIDER = originalEnv.WHATSAPP_PROVIDER;
      process.env.SOFIA_AUTO_REPLY_ENABLED = originalEnv.SOFIA_AUTO_REPLY_ENABLED;
      process.env.SOFIA_REPLY_OUTSIDE_HOURS = originalEnv.SOFIA_REPLY_OUTSIDE_HOURS;
    }
  });

  it('uses DeepSeek as controlled Sofia AI provider with SafetyGuard and rules fallback', async () => {
    const { accessToken } = await login();
    const stockBefore = await prisma.product.aggregate({ _sum: { currentStock: true } });
    const cashMovementsBefore = await prisma.cashMovement.count();
    const salesBefore = await prisma.sale.count();

    const status = await request(app.getHttpServer())
      .get('/admin/sofia/ai/status')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(status.body.provider).toBe('rules');
    expect(status.body.mode).toBe('disabled');
    expect(status.body.apiKeyExposed).toBe(false);
    expect(status.body.backendOnly).toBe(true);
    expect(status.body.hermesSeparated).toBe(true);

    const health = await request(app.getHttpServer())
      .post('/admin/sofia/ai/health-check')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    expect(health.body.provider).toBe('rules');
    expect(health.body.ok).toBe(true);

    const valid = await request(app.getHttpServer())
      .post('/admin/sofia/ai/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        provider: 'deepseek',
        mode: 'suggest',
        scenario: 'valid',
        message: 'quiero un maxi family',
        phone: '+57 316 777 1001',
      })
      .expect(201);
    expect(valid.body.aiProvider.provider).toBe('deepseek');
    expect(valid.body.aiProvider.mode).toBe('suggest');
    expect(valid.body.responseText).toContain('6 burgers');
    expect(valid.body.responseText).toContain('porción personal de papitas');
    expect(valid.body.responseText).toContain('Pepsi 1.5 L');
    expect(valid.body.responseText).not.toMatch(/papas familiares|papas grandes|papas para todos|porción familiar de papas/i);

    const invented = await request(app.getHttpServer())
      .post('/admin/sofia/ai/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        provider: 'deepseek',
        mode: 'suggest',
        scenario: 'invented_product',
        message: 'quiero sushi galactico',
        phone: '+57 316 777 1002',
      })
      .expect(201);
    expect(invented.body.aiProvider.safetyFlags).toContain('AI_SAFETY_BLOCKED_PRODUCT');
    expect(invented.body.responseText).toContain('Déjame confirmarlo');
    expect(invented.body.deliveryOrder).toBeNull();

    const paidClaim = await request(app.getHttpServer())
      .post('/admin/sofia/ai/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        provider: 'deepseek',
        mode: 'suggest',
        scenario: 'mark_paid',
        message: 'ya pague',
        phone: '+57 316 777 1003',
      })
      .expect(201);
    expect(paidClaim.body.aiProvider.safetyFlags).toContain('AI_SAFETY_BLOCKED_PAYMENT');
    expect(paidClaim.body.paymentLinkUrl).toBeNull();

    const fallback = await request(app.getHttpServer())
      .post('/admin/sofia/ai/test')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        provider: 'deepseek',
        mode: 'suggest',
        scenario: 'timeout',
        message: 'quiero un maxi family',
        phone: '+57 316 777 1004',
      })
      .expect(201);
    expect(fallback.body.aiProvider.fallbackUsed).toBe(true);
    expect(fallback.body.aiProvider.diagnostics.join('|')).toContain('AI_PROVIDER_FALLBACK');

    const aiAgent = await request(app.getHttpServer())
      .post('/admin/sofia/agent/process')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-sofia-ai-provider', 'deepseek')
      .set('x-sofia-ai-mode', 'suggest')
      .set('x-sofia-ai-mock-scenario', 'valid')
      .send({
        phone: '+57 316 777 1005',
        customerName: 'Cliente IA',
        message: 'quiero un maxi family',
        messageType: 'TEXT',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(aiAgent.body.aiProvider.provider).toBe('deepseek');
    expect(aiAgent.body.safeguards.aiCannotOperateHermes).toBe(true);
    expect(aiAgent.body.safeguards.aiCannotMarkPaid).toBe(true);

    const whatsappWithAi = await request(app.getHttpServer())
      .post('/integrations/whatsapp/mock/webhook')
      .set('x-sofia-whatsapp-mode', 'supervised')
      .set('x-sofia-whatsapp-provider', 'mock')
      .set('x-sofia-ai-provider', 'deepseek')
      .set('x-sofia-ai-mode', 'suggest')
      .set('x-sofia-ai-mock-scenario', 'valid')
      .send({
        providerEventId: 'phase85-ai-whatsapp-event',
        providerMessageId: 'phase85-ai-whatsapp-message',
        phone: '+57 316 777 1006',
        body: 'quiero un maxi family',
        sandboxNow: '2026-07-01T23:00:00.000Z',
      })
      .expect(201);
    expect(whatsappWithAi.body.sofiaResult.aiProvider.provider).toBe('deepseek');
    expect(whatsappWithAi.body.outbound.status).toBe('APPROVAL_PENDING');
    expect(whatsappWithAi.body.outbound.body).toContain('porción personal de papitas');

    const stockAfter = await prisma.product.aggregate({ _sum: { currentStock: true } });
    expect(String(stockAfter._sum.currentStock)).toBe(String(stockBefore._sum.currentStock));
    expect(await prisma.cashMovement.count()).toBe(cashMovementsBefore);
    expect(await prisma.sale.count()).toBe(salesBefore);
  });
});
