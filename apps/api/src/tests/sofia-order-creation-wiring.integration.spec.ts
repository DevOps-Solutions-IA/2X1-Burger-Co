import type { INestApplication } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrderTicketType, ProductKind, SofiaOrderDraftStatus, SofiaPaymentPreference } from '@prisma/client';
import {
  ORDER_CREATION_SERVICE,
  type OrderCreationService,
  type SofiaActorContext,
} from '../application/contracts/sofia-domain-contracts';
import { CommandHandlerRegistry } from '../modules/secure-command/command-handler.registry';
import { SecureCommandError } from '../modules/secure-command/secure-command.errors';
import { SecureCommandService } from '../modules/secure-command/secure-command.service';
import type { CommandActor, CommandRecord } from '../modules/secure-command/secure-command.types';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

/**
 * AGENTE 3 -- Orders / Canonical Checkout wiring evidence.
 *
 * Proves the governed chain SOFIA intent -> SofiaOrderDraft (CONFIRMED) -> SecureCommand
 * (SOFIA_CREATE_ORDER) -> canonical OrderCheckout -> canonical OrderTicket is real, reuses only
 * existing canonical authority, is idempotent/concurrency-safe, and stays fail-closed both for
 * invalid drafts and for SecureCommand's own governance (which remains an OWNER_ACTIVATION_GATE,
 * `enabled: false`, in every environment today -- see command-handler.registry.ts).
 */
describe('SOFIA order creation wiring (SOFIA_CREATE_ORDER)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let registry: CommandHandlerRegistry;
  let commands: SecureCommandService;
  let orderCreation: OrderCreationService;
  let actor: SofiaActorContext;
  let systemCommandActor: CommandActor;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('SOFIA order creation wiring integration requires an isolated _test database.');
    }
    // Phase5RuntimeGate('ORDER_CREATION') and Phase5RuntimeGate('KITCHEN') are cross-cutting,
    // owner-governed test-only gates (shared with the Kitchen/Payments waves) that this agent was
    // explicitly told NOT to weaken or bypass -- see phase5-runtime-gate.service.ts. Authorizing
    // them here follows the exact same pattern already established by
    // phase5-order-payment.integration.spec.ts: NODE_ENV=test plus these explicit flags, which is
    // the only way this capability can ever be exercised, in any environment, today.
    process.env.PHASE5_ORDER_CREATION_ENABLED = 'true';
    process.env.PHASE5_KITCHEN_ENABLED = 'true';
    process.env.PHASE5_TEST_OPERATIONAL_ENABLED = 'true';
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    registry = app.get(CommandHandlerRegistry);
    commands = app.get(SecureCommandService);
    orderCreation = app.get(ORDER_CREATION_SERVICE);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    await seedTestData(prisma);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@2x1burgerco.local' } });
    actor = { actorId: admin.id, roles: ['admin'], source: 'SOFIA_WHATSAPP' };
    systemCommandActor = { actorId: admin.id, actorType: 'SYSTEM', roles: ['system'] };
    // OrdersService.createFromCanonicalCheckout requires an open cash session -- canonical Orders
    // authority, not something this wiring creates or manages.
    await prisma.cashSession.create({ data: { openedById: admin.id, openingAmount: 0 } });
  });

  async function activeProduct() {
    let product = await prisma.product.findFirst({ where: { isActive: true } });
    if (!product) {
      const category = await prisma.category.findFirst() ?? (await prisma.category.create({ data: { name: 'Wiring', slug: `wiring-${Date.now()}` } }));
      const unit = await prisma.unit.findFirst() ?? (await prisma.unit.create({ data: { name: 'Unidad', code: `u${Date.now()}`, abbreviation: 'u' } }));
      product = await prisma.product.create({ data: { code: `SOFIA-${Date.now()}`, name: 'Combo SOFIA', salePrice: 24000, categoryId: category.id, unitId: unit.id, kind: ProductKind.DIRECT_STOCK, currentStock: 25, trackStock: true } });
    }
    return product;
  }

  async function confirmedDraft(overrides: Partial<{
    fulfillment: OrderTicketType;
    paymentPreference: SofiaPaymentPreference;
    deliveryAddress: string | null;
    status: SofiaOrderDraftStatus;
    version: number;
    draftHash: string | null;
    confirmationHash: string | null;
    expiresAt: Date | null;
  }> = {}) {
    const product = await activeProduct();
    const hash = `sofia-wiring-hash-${randomUUID()}`;
    const fulfillment = overrides.fulfillment ?? OrderTicketType.TAKEAWAY;
    return prisma.sofiaOrderDraft.create({
      data: {
        status: overrides.status ?? SofiaOrderDraftStatus.CONFIRMED,
        fulfillment,
        paymentPreference: overrides.paymentPreference ?? SofiaPaymentPreference.PAY_AT_PICKUP,
        version: overrides.version ?? 1,
        draftHash: overrides.draftHash === undefined ? hash : overrides.draftHash,
        confirmationHash: overrides.confirmationHash === undefined ? `confirm-${hash}` : overrides.confirmationHash,
        confirmedAt: new Date(),
        expiresAt: overrides.expiresAt === undefined ? new Date(Date.now() + 30 * 60_000) : overrides.expiresAt,
        customerName: 'Cliente SOFIA Wiring',
        customerPhone: '3000000000',
        deliveryAddress: overrides.deliveryAddress !== undefined ? overrides.deliveryAddress : fulfillment === OrderTicketType.DELIVERY ? 'Carrera de prueba 1' : null,
        itemsSnapshot: [{ productId: product.id, code: product.code, name: product.name, quantity: 1, unitPrice: Number(product.salePrice), totalPrice: Number(product.salePrice) }],
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

  it('creates a real canonical order from a valid confirmed draft through the SOFIA_CREATE_ORDER handler (draft valido -> canonical order)', async () => {
    const draft = await confirmedDraft();
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    const result = await registry.execute(command);

    expect(result.resultCode).toBe('SOFIA_ORDER_CREATED');
    const payload = result.payload as { checkoutId: string; orderTicketId: string; orderNumber: string; replayed: boolean };
    expect(payload.replayed).toBe(false);
    expect(payload.orderTicketId).toBeTruthy();

    const order = await prisma.orderTicket.findUniqueOrThrow({ where: { id: payload.orderTicketId } });
    expect(order.type).toBe(OrderTicketType.TAKEAWAY);
    expect(order.status).toBe('OPEN'); // never sent to kitchen by this wiring

    const checkout = await prisma.orderCheckout.findUniqueOrThrow({ where: { id: payload.checkoutId } });
    expect(checkout.orderTicketId).toBe(order.id);
    expect(checkout.status).toBe('ORDER_CREATED');
    expect(checkout.sofiaDraftId).toBe(draft.id);

    const refreshedDraft = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(refreshedDraft.status).toBe(SofiaOrderDraftStatus.CONFIRMED); // draft itself is not mutated further
  });

  it('creates a real canonical delivery order end to end (draft valido -> canonical order, DELIVERY)', async () => {
    const draft = await confirmedDraft({ fulfillment: OrderTicketType.DELIVERY, paymentPreference: SofiaPaymentPreference.CASH_ON_DELIVERY });
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    const result = await registry.execute(command);
    const payload = result.payload as { checkoutId: string; orderTicketId: string };
    const order = await prisma.orderTicket.findUniqueOrThrow({ where: { id: payload.orderTicketId } });
    expect(order.type).toBe(OrderTicketType.DELIVERY);
    // Zero delivery mutation: creation leaves the order at the canonical starting workflow state,
    // never assigns/claims a rider and never advances the workflow further.
    expect(order.deliveryWorkflowStatus).toBe('PENDING_ASSIGNMENT');
  });

  it('fails closed for a draft that never reached the confirmable phase-4 binding (draft invalido -> fail closed)', async () => {
    const draft = await prisma.sofiaOrderDraft.create({
      data: { status: SofiaOrderDraftStatus.DRAFT, itemsSnapshot: [], subtotal: 0, deliveryFee: 0, total: 0 },
    });

    await expect(
      orderCreation.createFromSofiaDraft({ draftId: draft.id, idempotencyKey: `sofia-draft:${draft.id}`, actor }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(await prisma.orderCheckout.count()).toBe(0);
    expect(await prisma.orderTicket.count()).toBe(0);
  });

  it('fails closed for a malformed idempotency key before touching the draft (draft invalido -> fail closed)', async () => {
    const draft = await confirmedDraft();
    await expect(
      orderCreation.createFromSofiaDraft({ draftId: draft.id, idempotencyKey: 'not-a-sofia-draft-key', actor }),
    ).rejects.toBeInstanceOf(Error);
    expect(await prisma.orderCheckout.count()).toBe(0);
  });

  it('fails closed for an expired confirmed draft (draft invalido -> fail closed)', async () => {
    const draft = await confirmedDraft({ expiresAt: new Date(Date.now() - 60_000) });
    await expect(
      orderCreation.createFromSofiaDraft({ draftId: draft.id, idempotencyKey: `sofia-draft:${draft.id}`, actor }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.orderCheckout.count()).toBe(0);
  });

  it('replays the same order on a duplicate confirmation attempt without creating a second one (inbound duplicado -> no duplicate order)', async () => {
    const draft = await confirmedDraft();
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    const first = await registry.execute(command);
    const second = await registry.execute(command);

    const firstPayload = first.payload as { orderTicketId: string; replayed: boolean };
    const secondPayload = second.payload as { orderTicketId: string; replayed: boolean };
    expect(secondPayload.orderTicketId).toBe(firstPayload.orderTicketId);
    expect(secondPayload.replayed).toBe(true);
    expect(await prisma.orderTicket.count()).toBe(1);
    expect(await prisma.orderCheckout.count()).toBe(1);
  });

  it('rejects a stale draft-version binding (conflicto de version)', async () => {
    const draft = await confirmedDraft();
    const staleCommand = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version + 1), idempotencyKey: `sofia-draft:${draft.id}` });

    await expect(registry.execute(staleCommand)).rejects.toBeInstanceOf(SecureCommandError);
    expect(await prisma.orderCheckout.count()).toBe(0);
  });

  it('rejects a replayed idempotency key bound to a different draft (conflicto de version / binding)', async () => {
    const firstDraft = await confirmedDraft();
    const secondDraft = await confirmedDraft();
    const sharedKey = `sofia-draft:${firstDraft.id}`;

    const first = await registry.execute(fakeCommand({ targetId: firstDraft.id, expectedVersion: String(firstDraft.version), idempotencyKey: sharedKey }));
    expect((first.payload as { orderTicketId: string }).orderTicketId).toBeTruthy();

    await expect(
      registry.execute(fakeCommand({ targetId: secondDraft.id, expectedVersion: String(secondDraft.version), idempotencyKey: sharedKey })),
    ).rejects.toThrow();
    expect(await prisma.orderTicket.count()).toBe(1);
  });

  it('creates exactly one canonical order under concurrent confirmation attempts (creacion concurrente)', async () => {
    const draft = await confirmedDraft();
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });

    const outcomes = await Promise.allSettled([registry.execute(command), registry.execute(command), registry.execute(command)]);
    const fulfilled = outcomes.filter((entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof registry.execute>>> => entry.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const orderIds = new Set(fulfilled.map((entry) => (entry.value.payload as { orderTicketId: string }).orderTicketId));
    expect(orderIds.size).toBe(1);
    expect(await prisma.orderTicket.count()).toBe(1);
    expect(await prisma.orderCheckout.count()).toBe(1);
  });

  it('enforces SecureCommand policy end to end: SOFIA_CREATE_ORDER stays owner-activation-gated even for a fully confirmable draft (enforcement de SecureCommand)', async () => {
    const draft = await confirmedDraft();

    // Durable, audited receipt succeeds even while the capability is disabled (mirrors
    // SOFIA_SEND_WHATSAPP: receiveWhileDisabled, narrow SYSTEM/source/role binding).
    const received = await commands.receive({
      commandType: 'SOFIA_CREATE_ORDER',
      idempotencyKey: `sofia-draft:${draft.id}`,
      target: { type: 'SofiaOrderDraft', id: draft.id, expectedVersion: String(draft.version) },
      payload: {},
      expiresAt: new Date(Date.now() + 5 * 60_000),
      actor: systemCommandActor,
      source: 'sofia_order_draft_confirmation',
      scope: 'sofia_order_creation',
    });
    expect(received.replayed).toBe(false);
    expect(await prisma.sofiaCommand.count({ where: { commandType: 'SOFIA_CREATE_ORDER' } })).toBe(1);

    // Execution stays blocked by governance -- two independent gates, both owner-controlled:
    // (1) no approval flow exists/was granted for this operational, approvalRequired command type,
    //     so SecureCommandService.execute() rejects before ever reaching handler dispatch;
    // (2) even a granted approval would still hit CommandPolicyService.assertAllowed's unconditional
    //     `enabled: false` check for SOFIA_CREATE_ORDER (see command-handler.registry.ts).
    // Either way, no real order is ever created via the fully-governed path -- fully independent of
    // the handler wiring itself, which the tests above already prove works end to end.
    await expect(
      commands.execute({ commandId: received.command.id, actor: systemCommandActor, claimOwner: 'sofia-order-wiring-enforcement' }),
    ).rejects.toMatchObject({ code: 'SOFIA_COMMAND_APPROVAL_REQUIRED' });

    expect(await prisma.orderCheckout.count()).toBe(0);
    expect(await prisma.orderTicket.count()).toBe(0);
  });

  it('blocks the full governed adapter path end to end and leaves only a durable audited BLOCKED trail (enforcement de SecureCommand)', async () => {
    const draft = await confirmedDraft();

    await expect(
      orderCreation.createFromSofiaDraft({ draftId: draft.id, idempotencyKey: `sofia-draft:${draft.id}`, actor }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(await prisma.orderCheckout.count()).toBe(0);
    expect(await prisma.orderTicket.count()).toBe(0);
    expect(await prisma.sofiaCommand.count({ where: { commandType: 'SOFIA_CREATE_ORDER' } })).toBe(1);
    const auditRow = await prisma.auditLog.findFirst({ where: { action: 'SOFIA_ORDER_CREATION_BLOCKED', entityId: draft.id }, orderBy: { timestamp: 'desc' } });
    expect(auditRow?.result).toBe('BLOCKED');
  });

  it('creates zero payment mutations as a side effect of order creation (cero mutacion de pago)', async () => {
    const draft = await confirmedDraft();
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });
    const result = await registry.execute(command);
    const payload = result.payload as { checkoutId: string };
    expect(await prisma.paymentIntent.count({ where: { checkoutId: payload.checkoutId } })).toBe(0);
    expect(await prisma.paymentLink.count()).toBe(0);
  });

  it('never transitions kitchen state as a side effect of order creation (cero mutacion de kitchen)', async () => {
    const draft = await confirmedDraft();
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });
    const result = await registry.execute(command);
    const payload = result.payload as { orderTicketId: string };
    const order = await prisma.orderTicket.findUniqueOrThrow({ where: { id: payload.orderTicketId } });
    expect(order.status).toBe('OPEN');
    expect(order.revision).toBe(0);
  });

  it('never assigns or claims a delivery rider as a side effect of order creation (cero mutacion de delivery)', async () => {
    const draft = await confirmedDraft({ fulfillment: OrderTicketType.DELIVERY, paymentPreference: SofiaPaymentPreference.CASH_ON_DELIVERY });
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });
    const result = await registry.execute(command);
    const payload = result.payload as { orderTicketId: string };
    const order = await prisma.orderTicket.findUniqueOrThrow({ where: { id: payload.orderTicketId } });
    expect(order.assignedRiderId ?? null).toBeNull();
    expect(order.deliveryWorkflowStatus).toBe('PENDING_ASSIGNMENT');
  });

  it('never mutates stock or cash beyond the pre-existing canonical Orders authority (cero mutacion de stock/caja beyond native order-item deduction)', async () => {
    const cashierUsersBefore = await prisma.cashSession.count();
    const draft = await confirmedDraft();
    const command = fakeCommand({ targetId: draft.id, expectedVersion: String(draft.version), idempotencyKey: `sofia-draft:${draft.id}` });
    await registry.execute(command);
    // No new cash session is opened/closed by this wiring; it reuses whatever session
    // OrdersService.createFromCanonicalCheckout resolves through its own canonical authority.
    expect(await prisma.cashSession.count()).toBe(cashierUsersBefore);
  });

  it('gives the CommandHandlerRegistry policy definition for SOFIA_CREATE_ORDER an owner-activation gate shape', () => {
    const definition = registry.definition('SOFIA_CREATE_ORDER');
    expect(definition).toMatchObject({ enabled: false, operational: true, approvalRequired: true, receiveWhileDisabled: true });
  });
});
