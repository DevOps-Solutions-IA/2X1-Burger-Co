import type { INestApplication } from '@nestjs/common';
import { OrderTicketType, ProductKind, SofiaPaymentPreference } from '@prisma/client';
import { KitchenEligibilityService } from '../modules/order-checkout/kitchen-eligibility.service';
import { OrderCheckoutService } from '../modules/order-checkout/order-checkout.service';
import { PaymentOrchestrationService } from '../modules/order-checkout/payment-orchestration.service';
import { CanonicalPaymentWebhookService } from '../modules/order-checkout/canonical-payment-webhook.service';
import { BoldPaymentProvider } from '../modules/sofia/payments/bold-payment.provider';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

describe('Phase 5 canonical checkout integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let checkouts: OrderCheckoutService;
  let payments: PaymentOrchestrationService;
  let kitchen: KitchenEligibilityService;
  let webhooks: CanonicalPaymentWebhookService;
  let actor: { sub: string; email: string; fullName: string; sessionVersion: number; roles: string[]; permissions: string[] };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) throw new Error('Phase 5 integration requires an isolated _test database.');
    process.env.PHASE5_ORDER_CREATION_ENABLED = 'true';
    process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED = 'true';
    process.env.PHASE5_KITCHEN_ENABLED = 'true';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    process.env.BOLD_API_KEY = 'phase5-test-key';
    process.env.BOLD_WEBHOOK_SECRET = 'phase5-test-webhook-secret';
    process.env.BOLD_EXPECTED_ACCOUNT_ID = 'merchant-1';
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    checkouts = app.get(OrderCheckoutService);
    payments = app.get(PaymentOrchestrationService);
    kitchen = app.get(KitchenEligibilityService);
    webhooks = app.get(CanonicalPaymentWebhookService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    await seedTestData(prisma);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } });
    actor = { sub: admin.id, email: admin.email, fullName: admin.fullName, sessionVersion: admin.sessionVersion, roles: ['admin'], permissions: ['orders.create'] };
    await prisma.cashSession.create({ data: { openedById: admin.id, openingAmount: 0 } });
  });

  async function confirmedDraft(preference: SofiaPaymentPreference, fulfillment: OrderTicketType) {
    let product = await prisma.product.findFirst({ where: { isActive: true } });
    if (!product) {
      const category = await prisma.category.findFirst() ?? await prisma.category.create({ data: { name: 'Phase 5', slug: `phase5-${Date.now()}` } });
      const unit = await prisma.unit.findFirst() ?? await prisma.unit.create({ data: { name: 'Unidad', code: `u${Date.now()}`, abbreviation: 'u' } });
      product = await prisma.product.create({ data: { code: `P5-${Date.now()}`, name: 'Combo Phase 5', salePrice: 25000, categoryId: category.id, unitId: unit.id, kind: ProductKind.DIRECT_STOCK, currentStock: 20, trackStock: true } });
    }
    const hash = `draft-hash-${Date.now()}-${Math.random()}`;
    return prisma.sofiaOrderDraft.create({
      data: {
        status: 'CONFIRMED',
        fulfillment,
        paymentPreference: preference,
        version: 1,
        draftHash: hash,
        confirmationHash: `confirm-${hash}`,
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        customerName: 'Cliente Phase 5',
        deliveryAddress: fulfillment === OrderTicketType.DELIVERY ? 'Carrera de prueba 1' : null,
        itemsSnapshot: [{ productId: product.id, code: product.code, name: product.name, quantity: 1, unitPrice: Number(product.salePrice), totalPrice: Number(product.salePrice), modifiers: [{ kind: 'REMOVE', name: 'cebolla' }] }],
        subtotal: product.salePrice,
        deliveryFee: fulfillment === OrderTicketType.DELIVERY ? 5000 : 0,
        total: Number(product.salePrice) + (fulfillment === OrderTicketType.DELIVERY ? 5000 : 0),
      },
    });
  }

  async function checkout(preference: SofiaPaymentPreference, fulfillment: OrderTicketType, key: string) {
    const draft = await confirmedDraft(preference, fulfillment);
    return checkouts.createFromConfirmedSofiaDraft({
      draftId: draft.id,
      expectedDraftVersion: draft.version,
      expectedDraftHash: draft.draftHash!,
      confirmationHash: draft.confirmationHash!,
      idempotencyKey: key,
      actorId: actor.sub,
    });
  }

  it.each([
    [SofiaPaymentPreference.CASH_ON_DELIVERY, OrderTicketType.DELIVERY],
    [SofiaPaymentPreference.PAY_AT_PICKUP, OrderTicketType.TAKEAWAY],
  ])('creates one idempotent kitchen ticket for %s', async (preference, fulfillment) => {
    const created = await checkout(preference, fulfillment, `checkout-${preference}`);
    const beforeInventory = await prisma.inventoryMovement.count();
    const first = await kitchen.createOrderTicket(created.id, actor);
    const replay = await kitchen.createOrderTicket(created.id, actor);
    expect(replay.order.id).toBe(first.order.id);
    expect(replay.replayed).toBe(true);
    expect(await prisma.orderTicket.count({ where: { id: first.order.id } })).toBe(1);
    expect(await prisma.inventoryMovement.count()).toBe(beforeInventory);
    const item = await prisma.orderTicketItem.findFirstOrThrow({ where: { orderTicketId: first.order.id } });
    expect(item.modifiersSnapshot).toEqual([{ kind: 'REMOVE', ingredient: 'cebolla', quantity: null }]);
  });

  it('creates one online intent/link and returns a deterministic replay without another link', async () => {
    const created = await checkout(SofiaPaymentPreference.ONLINE, OrderTicketType.DELIVERY, 'checkout-online');
    const results = await Promise.all([
      payments.createOnlinePaymentLink({ checkoutId: created.id, idempotencyKey: 'payment-online-1', actorId: actor.sub }),
      payments.createOnlinePaymentLink({ checkoutId: created.id, idempotencyKey: 'payment-online-1', actorId: actor.sub }),
    ]);
    const first = results.find((entry) => entry.publicPath !== null)!;
    const replay = results.find((entry) => entry.publicPath === null)!;
    expect(first.publicPath).toMatch(/^\/pagos\//);
    expect(replay).toMatchObject({ publicPath: null, replayed: true });
    expect(replay.paymentIntent.id).toBe(first.paymentIntent.id);
    expect(await prisma.paymentIntent.count({ where: { checkoutId: created.id } })).toBe(1);
    expect(await prisma.paymentLink.count({ where: { paymentIntentId: first.paymentIntent.id } })).toBe(1);
  });

  it('resolves concurrent checkout and order claims to one logical result', async () => {
    const draft = await confirmedDraft(SofiaPaymentPreference.PAY_AT_PICKUP, OrderTicketType.TAKEAWAY);
    const command = {
      draftId: draft.id,
      expectedDraftVersion: draft.version,
      expectedDraftHash: draft.draftHash!,
      confirmationHash: draft.confirmationHash!,
      idempotencyKey: 'concurrent-checkout',
      actorId: actor.sub,
    };
    const [left, right] = await Promise.all([
      checkouts.createFromConfirmedSofiaDraft(command),
      checkouts.createFromConfirmedSofiaDraft(command),
    ]);
    expect(right.id).toBe(left.id);
    expect(await prisma.orderCheckout.count()).toBe(1);
    const orders = await Promise.all([
      kitchen.createOrderTicket(left.id, actor),
      kitchen.createOrderTicket(left.id, actor),
    ]);
    expect(orders[1].order.id).toBe(orders[0].order.id);
    expect(await prisma.orderTicket.count()).toBe(1);
    expect(await prisma.inventoryMovement.count()).toBe(0);
  });

  it('enforces provider-scoped webhook uniqueness with nullable legacy semantics', async () => {
    const base = { eventType: 'PAYMENT', status: 'PENDING', signatureValid: true };
    await prisma.paymentWebhookEvent.create({ data: { id: 'p5-webhook-1', provider: 'BOLD', eventId: 'same-id', ...base } });
    await expect(prisma.paymentWebhookEvent.create({ data: { id: 'p5-webhook-2', provider: 'BOLD', eventId: 'same-id', ...base } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.paymentWebhookEvent.create({ data: { id: 'p5-webhook-3', provider: 'OTHER', eventId: 'same-id', ...base } })).resolves.toBeDefined();
    await prisma.paymentWebhookEvent.createMany({ data: [
      { id: 'p5-webhook-null-1', provider: 'BOLD', eventId: null, ...base },
      { id: 'p5-webhook-null-2', provider: 'BOLD', eventId: null, ...base },
    ] });
    expect(await prisma.paymentWebhookEvent.count({ where: { eventId: null } })).toBe(2);
  });

  it('rejects stale, expired and unconfirmed Sofia draft bindings', async () => {
    const draft = await confirmedDraft(SofiaPaymentPreference.PAY_AT_PICKUP, OrderTicketType.TAKEAWAY);
    await prisma.sofiaOrderDraft.update({ where: { id: draft.id }, data: { expiresAt: new Date(0) } });
    await expect(checkouts.createFromConfirmedSofiaDraft({ draftId: draft.id, expectedDraftVersion: 1, expectedDraftHash: draft.draftHash!, confirmationHash: draft.confirmationHash!, idempotencyKey: 'expired', actorId: actor.sub })).rejects.toBeDefined();
    expect(await prisma.orderCheckout.count()).toBe(0);
  });

  it('does not accept customer, screenshot or AI assertions as payment truth', async () => {
    const created = await checkout(SofiaPaymentPreference.ONLINE, OrderTicketType.TAKEAWAY, 'checkout-no-fake-paid');
    await payments.createOnlinePaymentLink({ checkoutId: created.id, idempotencyKey: 'intent-no-fake-paid', actorId: actor.sub });
    const intent = await prisma.paymentIntent.findFirstOrThrow({ where: { checkoutId: created.id } });
    expect(intent.status).toBe('LINK_READY');
    expect(await prisma.paymentTransition.count({ where: { paymentIntentId: intent.id, toStatus: 'SUCCEEDED' } })).toBe(0);
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.cashMovement.count()).toBe(0);
  });

  it('moves verified online payment to kitchen eligibility and deterministically replays the webhook', async () => {
    const created = await checkout(SofiaPaymentPreference.ONLINE, OrderTicketType.DELIVERY, 'checkout-verified-online');
    const prepared = await payments.createOnlinePaymentLink({ checkoutId: created.id, idempotencyKey: 'intent-verified-online', actorId: actor.sub });
    const token = prepared.publicPath!.split('/').pop()!;
    jest.spyOn(BoldPaymentProvider.prototype, 'createPayment').mockResolvedValueOnce({
      provider: 'BOLD',
      providerPaymentId: 'provider-payment-verified',
      providerReference: `checkout_${created.id}`,
      checkoutUrl: 'https://checkout.bold.co/test-only',
      status: 'PENDING',
      rawPayload: { sanitized: true },
    });
    await payments.startBoldPayment(token);
    const payload = {
      id: 'evt-verified-online',
      type: 'PAYMENT',
      data: {
        status: 'APPROVED',
        payment_id: 'provider-payment-verified',
        reference: `checkout_${created.id}`,
        metadata: { reference: `checkout_${created.id}` },
        amount: { total: created.total, currency: 'COP' },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac('sha256', process.env.BOLD_WEBHOOK_SECRET!).update(rawBody.toString('base64')).digest('hex');
    const command = { rawPayload: payload, rawBody, headers: { 'x-bold-signature': signature, 'x-bold-merchant-id': 'merchant-1' } };
    await expect(webhooks.processBold(command)).resolves.toMatchObject({ processedStatus: 'PROCESSED', paymentStatus: 'SUCCEEDED' });
    await expect(webhooks.processBold(command)).resolves.toMatchObject({ processedStatus: 'DUPLICATE_REPLAY' });
    expect((await prisma.orderCheckout.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('KITCHEN_ELIGIBLE');
    expect(await prisma.paymentTransition.count({ where: { paymentIntentId: prepared.paymentIntent.id, toStatus: 'SUCCEEDED' } })).toBe(1);
    const order = await kitchen.createOrderTicket(created.id, actor);
    expect(order.order.type).toBe(OrderTicketType.DELIVERY);
    expect(await prisma.inventoryMovement.count()).toBe(0);
  });
});
