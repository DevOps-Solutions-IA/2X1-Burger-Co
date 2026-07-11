import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../modules/orders/orders.service';
import { WhatsappService } from '../modules/whatsapp/whatsapp.service';
import {
  renderDeliveryReceiptPdf,
  sanitizeForReceipt,
  type DeliveryReceiptRenderData,
} from '../modules/orders/delivery-receipt.renderer';

/* ------------------------------------------------------------------ */
/*  Renderer puro (sin base de datos)                                  */
/* ------------------------------------------------------------------ */

describe('Delivery receipt renderer (Phase A)', () => {
  const baseData: DeliveryReceiptRenderData = {
    businessName: '2X1 Burger Co.',
    businessAddress: 'Cra 10 # 12-34, Jamundí',
    businessPhone: '+57 316 052 7403',
    receiptFooter: 'Gracias por tu pedido',
    updated: false,
    orderNumber: 'DOM-0001',
    version: 1,
    generatedAt: new Date('2026-07-10T18:30:00-05:00'),
    customerName: 'Cliente Prueba',
    deliveryReference: 'Calle 1 # 2-3',
    paymentMethodLabel: 'Nequi',
    paymentTarget: '3160527403',
    items: [{ name: 'Hamburguesa 2x1', quantity: 1, unitPrice: 22000, totalPrice: 22000 }],
    itemsSubtotal: 22000,
    deliveryFee: 6000,
    total: 28000,
    qrBuffer: null,
  };

  it('sanitizes emoji and non WinAnsi characters while preserving Spanish accents', () => {
    expect(sanitizeForReceipt('Hamburguesa 2X1\u{1F488}')).toBe('Hamburguesa 2X1');
    expect(sanitizeForReceipt('Adición: carne extra 🍔')).toBe('Adición: carne extra');
    expect(sanitizeForReceipt('Ñáñez Gutiérrez — “premium”')).toBe('Ñáñez Gutiérrez — “premium”');
    expect(sanitizeForReceipt(null)).toBe('');
  });

  it('renders a valid single-page PDF for a short order', async () => {
    const pdf = await renderDeliveryReceiptPdf(baseData);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(countPages(pdf)).toBe(1);
  });

  it('renders a long order (14 items) as a single continuous page without truncation', async () => {
    const longData: DeliveryReceiptRenderData = {
      ...baseData,
      items: Array.from({ length: 14 }).map((_, index) => ({
        name: 'Hamburguesa Doble Todo con tocineta extra y queso cheddar en lonjas',
        quantity: (index % 4) + 1,
        unitPrice: 15000,
        totalPrice: ((index % 4) + 1) * 15000,
      })),
      itemsSubtotal: 500000,
      total: 506000,
    };
    const shortPdf = await renderDeliveryReceiptPdf(baseData);
    const longPdf = await renderDeliveryReceiptPdf(longData);
    expect(countPages(longPdf)).toBe(1);
    expect(pageHeight(longPdf)).toBeGreaterThan(pageHeight(shortPdf));
  });

  it('does not crash rendering items with corrupt characters (known 2X1 emoji case)', async () => {
    const pdf = await renderDeliveryReceiptPdf({
      ...baseData,
      items: [
        {
          name: 'Hamburguesa 2X1\u{1F488}',
          quantity: 1,
          unitPrice: 24000,
          totalPrice: 24000,
          notes: 'Adición 🍔',
        },
      ],
    });
    expect(countPages(pdf)).toBe(1);
  });

  function countPages(pdf: Buffer): number {
    return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  }

  function pageHeight(pdf: Buffer): number {
    const match = pdf.toString('latin1').match(/\/MediaBox\s*\[0 0 [\d.]+ ([\d.]+)\]/);
    return match ? Number(match[1]) : 0;
  }
});

/* ------------------------------------------------------------------ */
/*  Versionado, cuenta vigente e idempotencia (integración)            */
/* ------------------------------------------------------------------ */

describe('Delivery receipt versioning (Phase A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let whatsappService: WhatsappService;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/inventory_fastfood_system?schema=public';
    if (!process.env.DATABASE_URL.includes('_test')) {
      throw new Error(`Phase A tests require a _test database. Received DATABASE_URL=${process.env.DATABASE_URL}`);
    }
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? 'change-this-access-secret-with-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? 'change-this-refresh-secret-with-at-least-32-characters';

    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    ordersService = app.get(OrdersService);
    whatsappService = app.get(WhatsappService);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
  });

  async function login() {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.9.0.1')
      .send({ email: 'admin@2x1burgerco.local', password: 'Admin12345*' });
    expect(response.status).toBe(201);
    return response.body.accessToken as string;
  }

  async function createDeliveryOrder(token: string) {
    await request(app.getHttpServer())
      .post('/cash-register/open')
      .set('Authorization', `Bearer ${token}`)
      .send({ openingAmount: 0 })
      .expect(201);
    const product = await prisma.product.findUniqueOrThrow({ where: { code: 'HAMB-2X1' } });
    const response = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'DELIVERY',
        customerName: 'Cliente Fase A',
        customerPhone: '3009990001',
        deliveryReference: 'Jamundí centro',
        items: [{ productId: product.id, quantity: 1 }],
      });
    expect(response.status).toBe(201);
    return { order: response.body, productId: product.id };
  }

  it('creation starts at commercial version 1 and status endpoint reports ACTIVE', async () => {
    const token = await login();
    const { order } = await createDeliveryOrder(token);

    expect(await ordersService.getDeliveryCommercialVersion(order.id)).toBe(1);

    const status = await request(app.getHttpServer())
      .get(`/orders/${order.id}/delivery-receipt-status`)
      .set('Authorization', `Bearer ${token}`);
    expect(status.status).toBe(200);
    expect(status.body.version).toBe(1);
    expect(status.body.status).toBe('ACTIVE');
    expect(Number(status.body.total)).toBe(Number(order.subtotal));
  });

  it('commercial change increments version, audits REPLACED and keeps a single active version', async () => {
    const token = await login();
    const { order, productId } = await createDeliveryOrder(token);

    const replace = await request(app.getHttpServer())
      .put(`/orders/${order.id}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedRevision: order.revision, items: [{ productId, quantity: 2 }] });
    expect([200, 201]).toContain(replace.status);

    expect(await ordersService.getDeliveryCommercialVersion(order.id)).toBe(2);

    const replaced = await prisma.auditLog.findMany({
      where: { entityId: order.id, action: 'DELIVERY_RECEIPT_REPLACED' },
    });
    expect(replaced).toHaveLength(1);
    const values = replaced[0]!.newValues as Record<string, unknown>;
    const previous = replaced[0]!.oldValues as Record<string, unknown>;
    expect(previous.receiptVersion).toBe(1);
    expect(previous.status).toBe('REPLACED');
    expect(values.receiptVersion).toBe(2);
    expect(values.status).toBe('ACTIVE');

    const history = await request(app.getHttpServer())
      .get(`/orders/${order.id}/delivery-receipt-history`)
      .set('Authorization', `Bearer ${token}`);
    expect(history.status).toBe(200);
    expect(history.body.currentVersion).toBe(2);
    expect(history.body.versions).toHaveLength(2);
    expect(history.body.versions[0]).toMatchObject({ version: 1, status: 'REPLACED', receiptType: 'INITIAL' });
    expect(history.body.versions[1]).toMatchObject({ version: 2, status: 'ACTIVE', receiptType: 'UPDATED' });
  });

  it('logistics-only location bumps technical revision but never the commercial version', async () => {
    const token = await login();
    const { order } = await createDeliveryOrder(token);

    await (ordersService as unknown as {
      applyDeliveryLocationForLogisticsOnly: (order: unknown, lat: number, lng: number, actorId?: string) => Promise<unknown>;
    }).applyDeliveryLocationForLogisticsOnly(
      await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } }),
      3.2611,
      -76.5385,
    );

    const after = await prisma.orderTicket.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.revision).toBe(order.revision + 1);
    expect(await ordersService.getDeliveryCommercialVersion(order.id)).toBe(1);

    const locationAudit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: order.id, action: 'DELIVERY_LOCATION_RECEIVED_LOGISTICS_ONLY' },
    });
    const payload = locationAudit.newValues as Record<string, unknown>;
    expect(payload.phoneMasked).toMatch(/^\*+0001$/);
    expect(JSON.stringify(payload)).not.toContain('3009990001');
  });

  it('initial send is idempotent: a second request is skipped without contacting the socket', async () => {
    const token = await login();
    const { order } = await createDeliveryOrder(token);

    const service = whatsappService as unknown as {
      assertEnabled: () => void;
      ensureConnectedOrThrow: (message: string) => Promise<void>;
      socket: { sendMessage: jest.Mock } | null;
      sendDeliveryOrderSummary: WhatsappService['sendDeliveryOrderSummary'];
    };
    jest.spyOn(service, 'assertEnabled').mockImplementation(() => undefined);
    jest.spyOn(service, 'ensureConnectedOrThrow').mockResolvedValue(undefined);
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    service.socket = { sendMessage } as never;

    const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@2x1burgerco.local' } });
    const first = await whatsappService.sendDeliveryOrderSummary(order.id, admin.id);
    expect(first.success).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const second = await whatsappService.sendDeliveryOrderSummary(order.id, admin.id);
    expect((second as { alreadySent?: boolean }).alreadySent).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const sentAudits = await prisma.auditLog.findMany({
      where: { entityId: order.id, action: 'DELIVERY_RECEIPT_INITIAL_SENT' },
    });
    expect(sentAudits).toHaveLength(1);
    const payload = sentAudits[0]!.newValues as Record<string, unknown>;
    expect(payload.phoneMasked).toBe('********0001');
    expect(JSON.stringify(payload)).not.toContain('573009990001');
    expect(token).toBeTruthy();
  });

  it('current receipt endpoint serves the latest version as PDF', async () => {
    const token = await login();
    const { order, productId } = await createDeliveryOrder(token);

    await request(app.getHttpServer())
      .put(`/orders/${order.id}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedRevision: order.revision, items: [{ productId, quantity: 3 }] });

    const receipt = await request(app.getHttpServer())
      .get(`/orders/${order.id}/delivery-receipt`)
      .set('Authorization', `Bearer ${token}`);
    expect(receipt.status).toBe(200);
    expect(receipt.headers['content-type']).toContain('application/pdf');
    expect(receipt.body.subarray(0, 5).toString()).toBe('%PDF-');

    const status = await request(app.getHttpServer())
      .get(`/orders/${order.id}/delivery-receipt-status`)
      .set('Authorization', `Bearer ${token}`);
    expect(status.body.version).toBe(2);
  });
});
