import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrderTicketType, PaymentIntentStatus, ProductKind, SofiaOrderDraftStatus, SofiaPaymentPreference } from '@prisma/client';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { PrismaService } from '../../prisma/prisma.service';
import { SecureCommandError } from '../secure-command/secure-command.errors';
import type { CommandActor, CommandRecord } from '../secure-command/secure-command.types';
import { SofiaCreateOrderCommandHandler } from './sofia-create-order-command.handler';

/**
 * PK2 (Payment Initiation) -- SOFIA Wave 2B.
 *
 * Proves the ONLINE branch of SofiaCreateOrderCommandHandler wires the canonical checkout to
 * PaymentOrchestrationService.createOnlinePaymentLink (reused verbatim, never duplicated), never
 * forces KitchenEligibilityService.createOrderTicket for ONLINE, and resolves the deterministic,
 * non-error AWAITING_PAYMENT outcome (via the exact KITCHEN_NOT_ELIGIBLE conflict code
 * SofiaOrderCreationAdapter already recognizes -- see sofia-contract.adapters.ts). The
 * CASH_ON_DELIVERY / PAY_AT_PICKUP branch stays exactly as PK1 left it (synchronous
 * createOrderTicket -> ORDER_CREATED), unchanged by this wave.
 *
 * Real Bold stays OFF throughout: createOnlinePaymentLink never calls BoldPaymentProvider (that
 * only happens in a later step, startBoldPayment, out of scope for this handler), and
 * BOLD_API_KEY/BOLD_WEBHOOK_SECRET are never set in this suite.
 */
describe('SofiaCreateOrderCommandHandler ONLINE payment initiation (SOFIA_CREATE_ORDER)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let handler: SofiaCreateOrderCommandHandler;
  let systemCommandActor: CommandActor;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('SOFIA payment initiation wiring requires an isolated _test database.');
    }
    // Phase5RuntimeGate('PAYMENT_ORCHESTRATION') is the owner-governed, cross-cutting test-only
    // gate for this capability -- this agent was explicitly told not to weaken or bypass it. This
    // is the same NODE_ENV=test + explicit-flag pattern already established by
    // sofia-order-creation-wiring.integration.spec.ts / phase5-order-payment.integration.spec.ts.
    process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED = 'true';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    handler = app.get(SofiaCreateOrderCommandHandler);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    await seedTestData(prisma);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } });
    systemCommandActor = { actorId: admin.id, actorType: 'SYSTEM', roles: ['system'] };
  });

  async function activeProduct() {
    let product = await prisma.product.findFirst({ where: { isActive: true } });
    if (!product) {
      const category =
        (await prisma.category.findFirst()) ??
        (await prisma.category.create({ data: { name: 'PK2 Wiring', slug: `pk2-wiring-${Date.now()}` } }));
      const unit =
        (await prisma.unit.findFirst()) ?? (await prisma.unit.create({ data: { name: 'Unidad', code: `u${Date.now()}`, abbreviation: 'u' } }));
      product = await prisma.product.create({
        data: {
          code: `SOFIA-PK2-${Date.now()}`,
          name: 'Combo SOFIA PK2',
          salePrice: 24000,
          categoryId: category.id,
          unitId: unit.id,
          kind: ProductKind.DIRECT_STOCK,
          currentStock: 25,
          trackStock: true,
        },
      });
    }
    return product;
  }

  async function confirmedDraft(
    overrides: Partial<{
      fulfillment: OrderTicketType;
      paymentPreference: SofiaPaymentPreference;
      deliveryAddress: string | null;
      version: number;
      draftHash: string | null;
      confirmationHash: string | null;
      expiresAt: Date | null;
    }> = {},
  ) {
    const product = await activeProduct();
    const hash = `sofia-pk2-hash-${randomUUID()}`;
    const fulfillment = overrides.fulfillment ?? OrderTicketType.TAKEAWAY;
    const paymentPreference = overrides.paymentPreference ?? SofiaPaymentPreference.ONLINE;
    return prisma.sofiaOrderDraft.create({
      data: {
        status: SofiaOrderDraftStatus.CONFIRMED,
        fulfillment,
        paymentPreference,
        version: overrides.version ?? 1,
        draftHash: overrides.draftHash === undefined ? hash : overrides.draftHash,
        confirmationHash: overrides.confirmationHash === undefined ? `confirm-${hash}` : overrides.confirmationHash,
        confirmedAt: new Date(),
        expiresAt: overrides.expiresAt === undefined ? new Date(Date.now() + 30 * 60_000) : overrides.expiresAt,
        customerName: 'Cliente SOFIA PK2',
        customerPhone: '3000000001',
        deliveryAddress:
          overrides.deliveryAddress !== undefined ? overrides.deliveryAddress : fulfillment === OrderTicketType.DELIVERY ? 'Carrera PK2 1' : null,
        itemsSnapshot: [
          { productId: product.id, code: product.code, name: product.name, quantity: 1, unitPrice: Number(product.salePrice), totalPrice: Number(product.salePrice) },
        ],
        subtotal: product.salePrice,
        deliveryFee: fulfillment === OrderTicketType.DELIVERY ? 5000 : 0,
        total: Number(product.salePrice) + (fulfillment === OrderTicketType.DELIVERY ? 5000 : 0),
      },
    });
  }

  function fakeCommand(overrides: Partial<CommandRecord> & { targetId: string; idempotencyKey: string }): CommandRecord {
    return {
      id: randomUUID(),
      commandType: 'SOFIA_CREATE_ORDER',
      scope: 'sofia_order_creation',
      status: 'EXECUTING',
      actorId: systemCommandActor.actorId,
      actorType: 'SYSTEM',
      actorRoles: ['system'],
      source: 'sofia_order_draft_confirmation',
      targetType: 'SofiaOrderDraft',
      expectedVersion: overrides.expectedVersion ?? null,
      payloadHash: 'test-payload-hash',
      policyHash: 'test-policy-hash',
      releaseVersion: 'test',
      correlationId: null,
      traceId: null,
      claimOwnerHash: null,
      leaseExpiresAt: null,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      claimedAt: null,
      completedAt: null,
      failureClass: null,
      failureCode: null,
      retryable: false,
      version: 1,
      result: null,
      ...overrides,
    };
  }

  it('wires ONLINE checkouts to createOnlinePaymentLink and resolves AWAITING_PAYMENT without ever creating an OrderTicket', async () => {
    const draft = await confirmedDraft({ fulfillment: OrderTicketType.TAKEAWAY, paymentPreference: SofiaPaymentPreference.ONLINE });
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    await expect(handler.execute(command)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KITCHEN_NOT_ELIGIBLE' }) });

    const checkout = await prisma.orderCheckout.findFirstOrThrow({ where: { sofiaDraftId: draft.id } });
    expect(checkout.paymentPreference).toBe(SofiaPaymentPreference.ONLINE);
    expect(checkout.orderTicketId).toBeNull();
    expect(checkout.kitchenEligibleAt).toBeNull();

    expect(await prisma.paymentIntent.count({ where: { checkoutId: checkout.id } })).toBe(1);
    const intent = await prisma.paymentIntent.findFirstOrThrow({ where: { checkoutId: checkout.id } });
    expect(intent.status).toBe(PaymentIntentStatus.LINK_READY);
    expect(intent.provider).toBe('BOLD');

    expect(await prisma.paymentLink.count({ where: { paymentIntentId: intent.id } })).toBe(1);
    const link = await prisma.paymentLink.findFirstOrThrow({ where: { paymentIntentId: intent.id } });
    expect(link.status).toBe('ACTIVE');

    expect(await prisma.orderTicket.count()).toBe(0);
  });

  it('PAYMENT_AMOUNT_INVARIANT: PaymentIntent.amount always equals the canonical checkout.total (products + deliveryFee)', async () => {
    const draft = await confirmedDraft({ fulfillment: OrderTicketType.DELIVERY, paymentPreference: SofiaPaymentPreference.ONLINE });
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    await expect(handler.execute(command)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KITCHEN_NOT_ELIGIBLE' }) });

    const checkout = await prisma.orderCheckout.findFirstOrThrow({ where: { sofiaDraftId: draft.id } });
    const intent = await prisma.paymentIntent.findFirstOrThrow({ where: { checkoutId: checkout.id } });

    expect(Number(checkout.subtotal) + Number(checkout.deliveryFee)).toBe(Number(checkout.total));
    expect(Number(intent.amount)).toBe(Number(checkout.total));
    expect(intent.currency).toBe(checkout.currency);
  });

  it('is idempotent on a repeat call with the exact same command: does not create a second PaymentIntent/PaymentLink', async () => {
    const draft = await confirmedDraft({ paymentPreference: SofiaPaymentPreference.ONLINE });
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    await expect(handler.execute(command)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KITCHEN_NOT_ELIGIBLE' }) });
    await expect(handler.execute(command)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KITCHEN_NOT_ELIGIBLE' }) });

    expect(await prisma.orderCheckout.count({ where: { sofiaDraftId: draft.id } })).toBe(1);
    expect(await prisma.paymentIntent.count()).toBe(1);
    expect(await prisma.paymentLink.count()).toBe(1);
  });

  it('replays the same payment link on a duplicate confirmation attempt (independent command objects, same idempotency key)', async () => {
    const draft = await confirmedDraft({ paymentPreference: SofiaPaymentPreference.ONLINE });
    const idempotencyKey = `sofia-draft:${draft.id}`;

    await expect(
      handler.execute(fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey })),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KITCHEN_NOT_ELIGIBLE' }) });
    await expect(
      handler.execute(fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey })),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KITCHEN_NOT_ELIGIBLE' }) });

    expect(await prisma.paymentIntent.count()).toBe(1);
    expect(await prisma.paymentLink.count()).toBe(1);
  });

  it('creates exactly one PaymentIntent and one PaymentLink under concurrent execution attempts for the same checkout', async () => {
    const draft = await confirmedDraft({ paymentPreference: SofiaPaymentPreference.ONLINE });
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    const outcomes = await Promise.allSettled([handler.execute(command), handler.execute(command), handler.execute(command)]);
    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toMatchObject({ response: expect.objectContaining({ code: 'KITCHEN_NOT_ELIGIBLE' }) });
      }
    }

    expect(await prisma.orderCheckout.count({ where: { sofiaDraftId: draft.id } })).toBe(1);
    const intents = await prisma.paymentIntent.count();
    expect(intents).toBe(1);
    expect(await prisma.paymentLink.count()).toBe(1);

    const checkout = await prisma.orderCheckout.findFirstOrThrow({ where: { sofiaDraftId: draft.id } });
    const intent = await prisma.paymentIntent.findFirstOrThrow({ where: { checkoutId: checkout.id } });
    expect(Number(intent.amount)).toBe(Number(checkout.total));
  });

  it('fails closed for an expired confirmed draft before ever touching payment orchestration', async () => {
    const draft = await confirmedDraft({ paymentPreference: SofiaPaymentPreference.ONLINE, expiresAt: new Date(Date.now() - 60_000) });
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    await expect(handler.execute(command)).rejects.toThrow();

    expect(await prisma.orderCheckout.count()).toBe(0);
    expect(await prisma.paymentIntent.count()).toBe(0);
  });

  it('fails closed for an invalid fulfillment/paymentPreference combination instead of assuming ONLINE is always valid', async () => {
    // DELIVERY only ever combines with ONLINE or CASH_ON_DELIVERY -- PAY_AT_PICKUP is invalid here.
    const draft = await confirmedDraft({ fulfillment: OrderTicketType.DELIVERY, paymentPreference: SofiaPaymentPreference.PAY_AT_PICKUP });
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    await expect(handler.execute(command)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CHECKOUT_PAYMENT_COMBINATION_INVALID' }),
    });
    expect(await prisma.paymentIntent.count()).toBe(0);
  });

  it('never opens the payment-orchestration branch for CASH_ON_DELIVERY / PAY_AT_PICKUP: still synchronous createOrderTicket -> ORDER_CREATED', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: systemCommandActor.actorId } });
    await prisma.cashSession.create({ data: { openedById: admin.id, openingAmount: 0 } });
    process.env.PHASE5_ORDER_CREATION_ENABLED = 'true';
    process.env.PHASE5_KITCHEN_ENABLED = 'true';
    try {
      const draft = await confirmedDraft({ fulfillment: OrderTicketType.TAKEAWAY, paymentPreference: SofiaPaymentPreference.PAY_AT_PICKUP });
      const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

      const result = await handler.execute(command);

      expect(result.resultCode).toBe('SOFIA_ORDER_CREATED');
      const payload = result.payload as { checkoutId: string; orderTicketId: string };
      expect(payload.orderTicketId).toBeTruthy();
      expect(await prisma.paymentIntent.count({ where: { checkoutId: payload.checkoutId } })).toBe(0);
      expect(await prisma.paymentLink.count()).toBe(0);
    } finally {
      delete process.env.PHASE5_ORDER_CREATION_ENABLED;
      delete process.env.PHASE5_KITCHEN_ENABLED;
    }
  });

  it('fails closed (wrong checkout id: does not silently bind a second draft to the first draft\'s checkout/payment) when a shared idempotency key is replayed against a different draft', async () => {
    const firstDraft = await confirmedDraft({ paymentPreference: SofiaPaymentPreference.ONLINE });
    const secondDraft = await confirmedDraft({ paymentPreference: SofiaPaymentPreference.ONLINE });
    const sharedKey = `sofia-draft:${firstDraft.id}`;

    await expect(
      handler.execute(fakeCommand({ targetId: firstDraft.id, expectedVersion: String(firstDraft.version), idempotencyKey: sharedKey })),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KITCHEN_NOT_ELIGIBLE' }) });

    // Same idempotency key, bound to a genuinely different draft/checkout: the canonical checkout
    // authority (OrderCheckoutService.createFromConfirmedSofiaDraft, re-used unchanged by this
    // handler) must reject this before payment orchestration is ever reached -- never silently
    // attach the second draft's order to the first draft's checkout or payment intent.
    await expect(
      handler.execute(fakeCommand({ targetId: secondDraft.id, expectedVersion: String(secondDraft.version), idempotencyKey: sharedKey })),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CHECKOUT_IDEMPOTENCY_CONFLICT' }) });

    expect(await prisma.orderCheckout.count()).toBe(1);
    expect(await prisma.orderCheckout.count({ where: { sofiaDraftId: firstDraft.id } })).toBe(1);
    expect(await prisma.orderCheckout.count({ where: { sofiaDraftId: secondDraft.id } })).toBe(0);
    expect(await prisma.paymentIntent.count()).toBe(1);
  });

  it('rejects a stale draft-version binding before ever touching payment orchestration', async () => {
    const draft = await confirmedDraft({ paymentPreference: SofiaPaymentPreference.ONLINE });
    const staleCommand = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version + 1), idempotencyKey: `sofia-draft:${draft.id}` });

    await expect(handler.execute(staleCommand)).rejects.toBeInstanceOf(SecureCommandError);
    expect(await prisma.orderCheckout.count()).toBe(0);
    expect(await prisma.paymentIntent.count()).toBe(0);
  });

  it('fails closed (CHECKOUT_OPERATION_DISABLED, not a false AWAITING_PAYMENT) when Payment Orchestration is disabled', async () => {
    delete process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED;
    try {
      const draft = await confirmedDraft({ paymentPreference: SofiaPaymentPreference.ONLINE });
      const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

      await expect(handler.execute(command)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CHECKOUT_OPERATION_DISABLED', capability: 'PAYMENT_ORCHESTRATION' }),
      });
      expect(await prisma.paymentIntent.count()).toBe(0);
    } finally {
      process.env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED = 'true';
    }
  });

  it('never opens the ORDER_CREATION or KITCHEN governance gates for the ONLINE branch (independent capability gating)', async () => {
    // Force PHASE5_ORDER_CREATION_ENABLED / PHASE5_KITCHEN_ENABLED disabled regardless of what any
    // other test left behind: if the ONLINE branch accidentally depended on either, this would fail
    // with CHECKOUT_OPERATION_DISABLED for the wrong capability instead of the expected
    // KITCHEN_NOT_ELIGIBLE/AWAITING_PAYMENT outcome.
    delete process.env.PHASE5_ORDER_CREATION_ENABLED;
    delete process.env.PHASE5_KITCHEN_ENABLED;

    const draft = await confirmedDraft({ paymentPreference: SofiaPaymentPreference.ONLINE });
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    await expect(handler.execute(command)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'KITCHEN_NOT_ELIGIBLE' }) });
    expect(await prisma.paymentIntent.count()).toBe(1);
  });
});
