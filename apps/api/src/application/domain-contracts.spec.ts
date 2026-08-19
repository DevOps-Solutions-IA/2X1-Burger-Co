import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { ProductsCatalogReadAdapter } from '../modules/products/catalog-read.adapter';
import { DomainAvailabilityAdapter } from '../modules/inventory/product-availability.adapter';
import { AuthoritativeDeliveryQuoteAdapter } from '../delivery/delivery-quote.adapter';
import { AuthoritativeAuditCommandAdapter } from '../modules/audit/audit-command.adapter';
import { SofiaCustomerResolutionAdapter, SofiaOrderCreationAdapter, SofiaOrderDraftAdapter, SofiaPaymentReadAdapter } from '../modules/sofia/contracts/sofia-contract.adapters';
import { SecureCommandError } from '../modules/secure-command/secure-command.errors';

const actor = { actorId: 'actor-1', roles: ['admin'], source: 'SOFIA_ADMIN' as const };

describe('Phase 1 authoritative domain contracts', () => {
  it('catalog returns persisted prices and excludes inactive products through domain service', async () => {
    const products = {
      findSellable: jest.fn().mockResolvedValue([{ id: 'p1', code: 'P1', name: 'Burger', description: null, imageUrl: null, kind: 'PREPARED', salePrice: 21000, isActive: true, trackStock: true, updatedAt: new Date('2026-01-01'), category: { id: 'c1', name: 'Combos', slug: 'combos' } }]),
      findOne: jest.fn(),
    };
    const adapter = new ProductsCatalogReadAdapter(products as never, { findAll: jest.fn().mockResolvedValue([{ id: 'c1', isActive: true }]) } as never);
    const result = await adapter.listActive();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ persistedPrice: 21000, active: true });
    expect(result[0]).not.toHaveProperty('salePrice');
  });

  it('excludes products in inactive categories and preserves unknown-product failures', async () => {
    const products = {
      findSellable: jest.fn().mockResolvedValue([{ id: 'p1', code: 'P1', name: 'Hidden', description: null, imageUrl: null, kind: 'PREPARED', salePrice: 1000, isActive: true, trackStock: true, updatedAt: new Date(), category: { id: 'c1', name: 'Hidden', slug: 'hidden' } }]),
      findOne: jest.fn().mockRejectedValue(new NotFoundException()),
    };
    const adapter = new ProductsCatalogReadAdapter(products as never, { findAll: jest.fn().mockResolvedValue([{ id: 'c1', isActive: false }]) } as never);
    await expect(adapter.listActive()).resolves.toEqual([]);
    await expect(adapter.getActiveById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    [5, 2, true, 'AVAILABLE'],
    [1, 2, false, 'DIRECT_STOCK_INSUFFICIENT'],
  ])('checks direct stock without reserving it', async (stock, quantity, available, reasonCode) => {
    const products = { findOne: jest.fn().mockResolvedValue({ id: 'p1', isActive: true, kind: 'DIRECT_STOCK', trackStock: true }) };
    const inventory = { findStock: jest.fn().mockResolvedValue({ items: [{ id: 'p1', itemType: 'PRODUCT', currentStock: stock }] }) };
    const adapter = new DomainAvailabilityAdapter(products as never, {} as never, {} as never, inventory as never);
    await expect(adapter.check({ productId: 'p1', quantity })).resolves.toMatchObject({ available, reasonCode });
  });

  it('fails availability closed for inactive products and missing recipes', async () => {
    const inactive = new DomainAvailabilityAdapter(
      { findOne: jest.fn().mockResolvedValue({ id: 'p1', isActive: false }) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(inactive.check({ productId: 'p1', quantity: 1 })).resolves.toMatchObject({ available: false, reasonCode: 'PRODUCT_INACTIVE' });

    const missingRecipe = new DomainAvailabilityAdapter(
      { findOne: jest.fn().mockResolvedValue({ id: 'p2', isActive: true, kind: 'PREPARED', trackStock: true }) } as never,
      { findByProduct: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
    );
    await expect(missingRecipe.check({ productId: 'p2', quantity: 1 })).resolves.toMatchObject({ available: false, reasonCode: 'RECIPE_UNAVAILABLE' });
  });

  it('returns missing recipe ingredients using the authoritative recipe shape', async () => {
    const products = { findOne: jest.fn().mockResolvedValue({ id: 'p1', isActive: true, kind: 'PREPARED', trackStock: true }) };
    const recipes = { findByProduct: jest.fn().mockResolvedValue({ isActive: true, yieldQuantity: 1, items: [{ ingredientId: 'i1', quantity: 2, wastePercent: 0, ingredient: { name: 'Carne', currentStock: 1, isActive: true } }] }) };
    const ingredients = { findOne: jest.fn().mockResolvedValue({ id: 'i1', name: 'Carne', currentStock: 1, isActive: true }) };
    const adapter = new DomainAvailabilityAdapter(products as never, recipes as never, ingredients as never, {} as never);
    await expect(adapter.check({ productId: 'p1', quantity: 1 })).resolves.toMatchObject({ available: false, reasonCode: 'INGREDIENT_STOCK_INSUFFICIENT', missingIngredients: [{ ingredientId: 'i1' }] });
  });

  it('delegates delivery quotes and returns the calculation evidence', async () => {
    const pricing = { estimate: jest.fn().mockResolvedValue({ auditId: 'a1', status: 'AUTO_PRICED', finalFee: 7000, currency: 'COP', distanceKm: 5, estimatedMinutes: 20, reasonCode: 'AUTO_PRICED', calculationVersion: '2x1-delivery-pricing-v1', canCheckout: true }) };
    const adapter = new AuthoritativeDeliveryQuoteAdapter(pricing as never);
    await expect(adapter.quote({ addressText: 'Calle 1', orderSubtotal: 30000, actor })).resolves.toMatchObject({ finalFee: 7000, auditId: 'a1' });
    expect(pricing.estimate).toHaveBeenCalledWith(expect.not.objectContaining({ finalFee: expect.anything() }));
  });

  it('rejects stale drafts and snapshots authoritative service results', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    const sofia = { findDraft: jest.fn().mockResolvedValue({ id: 'd1', updatedAt }), confirmDraft: jest.fn() };
    const adapter = new SofiaOrderDraftAdapter(sofia as never);
    await expect(adapter.confirm('d1', '2025-01-01T00:00:00.000Z', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(sofia.confirmDraft).not.toHaveBeenCalled();
  });

  it('delegates draft snapshots without creating operational records', async () => {
    const authoritative = { id: 'd1', status: 'NEEDS_INFO', updatedAt: new Date(), itemsSnapshot: [{ productId: 'p1', code: 'P1', name: 'Burger', quantity: 1, unitPrice: 22000, totalPrice: 22000 }], missingFields: ['deliveryAddress'], customerName: 'Ana', customerPhone: '***0000', deliveryAddress: null, deliveryNeighborhood: null, subtotal: 22000, deliveryFee: 0, total: 22000 };
    const sofia = { createDraft: jest.fn().mockResolvedValue(authoritative) };
    const adapter = new SofiaOrderDraftAdapter(sofia as never);
    const result = await adapter.create({ items: [{ productId: 'p1', quantity: 1 }] }, actor);
    expect(result.itemsSnapshot[0]?.unitPrice).toBe(22000);
    expect(sofia.createDraft).toHaveBeenCalledWith({ items: [{ productId: 'p1', quantity: 1 }] }, actor.actorId);
    expect(sofia).not.toHaveProperty('createOrderTicket');
  });

  it('resolves normalized CRM customers idempotently through the CRM authority', async () => {
    const customer = { id: 'customer-1', displayName: 'Ana', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), identities: [{ type: 'PHONE', valueMasked: '***0000' }] };
    const crm = { resolveOrCreateByPhone: jest.fn().mockResolvedValue(customer) };
    const adapter = new SofiaCustomerResolutionAdapter(crm as never);
    const command = { phone: '+57 300 000 0000', displayName: 'Ana', idempotencyKey: 'crm:conversation-1', actor };
    const first = await adapter.resolve(command);
    const second = await adapter.resolve(command);
    expect(first.customerId).toBe(second.customerId);
    expect(first.phoneMasked).toBe('***0000');
    expect(crm.resolveOrCreateByPhone).toHaveBeenNthCalledWith(
      1,
      { phone: command.phone, displayName: 'Ana' },
      expect.objectContaining({
        kind: 'TRUSTED_CRM_CUSTOMER_RESOLUTION',
        actorId: actor.actorId,
        source: 'SOFIA_DOMAIN_ADAPTER',
      }),
    );
  });

  it('blocks order creation for a draft missing the phase-4 confirmation binding and produces only a blocked audit decision', async () => {
    // CONFIRMED but without draftHash/confirmationHash/fulfillment/expiresAt (never reached the
    // real phase-4 binding, e.g. the legacy pre-commercial-checkout path): must fail closed before
    // ever touching SecureCommand.
    const draft = { id: 'draft-12345678', status: 'CONFIRMED', updatedAt: new Date('2026-01-01T00:00:00Z') };
    const sofia = { findDraft: jest.fn().mockResolvedValue(draft) };
    const audit = { log: jest.fn().mockResolvedValue({}) };
    const adapter = new SofiaOrderCreationAdapter(sofia as never, audit as never, {} as never);
    await expect(adapter.createFromSofiaDraft({ draftId: draft.id, expectedDraftVersion: draft.updatedAt.toISOString(), idempotencyKey: 'sofia-draft:draft-12345678', actor })).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SOFIA_ORDER_CREATION_BLOCKED', result: 'BLOCKED', reasonCode: 'SOFIA_DRAFT_NOT_CONFIRMABLE' }));
  });

  it('keeps duplicate blocked order commands free of operational side effects', async () => {
    const draft = { id: 'draft-12345678', status: 'CONFIRMED', updatedAt: new Date('2026-01-01T00:00:00Z') };
    const sofia = { findDraft: jest.fn().mockResolvedValue(draft) };
    const adapter = new SofiaOrderCreationAdapter(sofia as never, { log: jest.fn().mockResolvedValue({}) } as never, {} as never);
    const command = { draftId: draft.id, expectedDraftVersion: draft.updatedAt.toISOString(), idempotencyKey: 'sofia-draft:draft-12345678', actor };
    await expect(adapter.createFromSofiaDraft(command)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(adapter.createFromSofiaDraft(command)).rejects.toBeInstanceOf(ForbiddenException);
    expect(sofia).not.toHaveProperty('createOrderTicket');
    expect(sofia).not.toHaveProperty('createDeliveryOrder');
  });

  it('blocks order creation for a fully confirmable draft when SecureCommand governance disables SOFIA_CREATE_ORDER (owner-activation gate)', async () => {
    const now = Date.now();
    const draft = {
      id: 'draft-87654321',
      status: 'CONFIRMED',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      version: 3,
      draftHash: 'hash-abc',
      confirmationHash: 'confirm-abc',
      fulfillment: 'TAKEAWAY',
      expiresAt: new Date(now + 60_000),
    };
    const sofia = { findDraft: jest.fn().mockResolvedValue(draft) };
    const audit = { log: jest.fn().mockResolvedValue({}) };
    const receive = jest.fn().mockResolvedValue({ command: { id: 'cmd-1' }, replayed: false });
    const execute = jest.fn().mockRejectedValue(new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED'));
    const moduleRef = { get: jest.fn().mockReturnValue({ receive, execute }) };
    const adapter = new SofiaOrderCreationAdapter(sofia as never, audit as never, moduleRef as never);
    await expect(
      adapter.createFromSofiaDraft({ draftId: draft.id, idempotencyKey: 'sofia-draft:draft-87654321', actor }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ commandType: 'SOFIA_CREATE_ORDER', idempotencyKey: 'sofia-draft:draft-87654321' }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ commandId: 'cmd-1' }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SOFIA_ORDER_CREATION_BLOCKED', result: 'BLOCKED', reasonCode: 'SOFIA_COMMAND_POLICY_BLOCKED' }));
  });

  it('resolves the ORDER_CREATED branch of the discriminated result contract on a successful command execution', async () => {
    const now = Date.now();
    const draft = {
      id: 'draft-order-created-1',
      status: 'CONFIRMED',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      version: 1,
      draftHash: 'hash-abc',
      confirmationHash: 'confirm-abc',
      fulfillment: 'TAKEAWAY',
      expiresAt: new Date(now + 60_000),
    };
    const sofia = { findDraft: jest.fn().mockResolvedValue(draft) };
    const audit = { log: jest.fn().mockResolvedValue({}) };
    const receive = jest.fn().mockResolvedValue({ command: { id: 'cmd-order-created' }, replayed: false });
    const execute = jest.fn().mockResolvedValue({
      replayed: false,
      result: { sanitizedPayload: { checkoutId: 'checkout-1', orderTicketId: 'order-1', orderNumber: 'N-001', replayed: false } },
    });
    const moduleRef = { get: jest.fn().mockReturnValue({ receive, execute }) };
    const adapter = new SofiaOrderCreationAdapter(sofia as never, audit as never, moduleRef as never);
    const result = await adapter.createFromSofiaDraft({ draftId: draft.id, idempotencyKey: `sofia-draft:${draft.id}`, actor });
    expect(result).toEqual({ type: 'ORDER_CREATED', checkoutId: 'checkout-1', orderTicketId: 'order-1', orderNumber: 'N-001', replayed: false });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('resolves the AWAITING_PAYMENT branch instead of throwing when Kitchen defers eligibility for an unverified online payment', async () => {
    const now = Date.now();
    const draft = {
      id: 'draft-awaiting-payment-1',
      status: 'CONFIRMED',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      version: 1,
      draftHash: 'hash-abc',
      confirmationHash: 'confirm-abc',
      fulfillment: 'DELIVERY',
      expiresAt: new Date(now + 60_000),
    };
    const sofia = { findDraft: jest.fn().mockResolvedValue(draft) };
    const audit = { log: jest.fn().mockResolvedValue({}) };
    const receive = jest.fn().mockResolvedValue({ command: { id: 'cmd-awaiting-payment' }, replayed: false });
    const execute = jest.fn().mockRejectedValue(new ConflictException({ code: 'KITCHEN_NOT_ELIGIBLE' }));
    const moduleRef = { get: jest.fn().mockReturnValue({ receive, execute }) };
    const adapter = new SofiaOrderCreationAdapter(sofia as never, audit as never, moduleRef as never);
    const result = await adapter.createFromSofiaDraft({ draftId: draft.id, idempotencyKey: `sofia-draft:${draft.id}`, actor });
    expect(result).toEqual({ type: 'AWAITING_PAYMENT', checkoutId: null, reasonCode: 'KITCHEN_NOT_ELIGIBLE' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SOFIA_ORDER_AWAITING_PAYMENT', result: 'NO_OP', reasonCode: 'KITCHEN_NOT_ELIGIBLE' }),
    );
  });

  it('still fails closed (does not misclassify as AWAITING_PAYMENT) for an unrelated conflict code', async () => {
    const now = Date.now();
    const draft = {
      id: 'draft-other-conflict-1',
      status: 'CONFIRMED',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      version: 1,
      draftHash: 'hash-abc',
      confirmationHash: 'confirm-abc',
      fulfillment: 'TAKEAWAY',
      expiresAt: new Date(now + 60_000),
    };
    const sofia = { findDraft: jest.fn().mockResolvedValue(draft) };
    const audit = { log: jest.fn().mockResolvedValue({}) };
    const receive = jest.fn().mockResolvedValue({ command: { id: 'cmd-other-conflict' }, replayed: false });
    const execute = jest.fn().mockRejectedValue(new ConflictException({ code: 'CHECKOUT_PAYMENT_COMBINATION_INVALID' }));
    const moduleRef = { get: jest.fn().mockReturnValue({ receive, execute }) };
    const adapter = new SofiaOrderCreationAdapter(sofia as never, audit as never, moduleRef as never);
    await expect(
      adapter.createFromSofiaDraft({ draftId: draft.id, idempotencyKey: `sofia-draft:${draft.id}`, actor }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SOFIA_ORDER_CREATION_BLOCKED', result: 'BLOCKED' }));
  });

  it('keeps the retired legacy payment read fail-closed and enforces role access', async () => {
    const payments = { getOperationalLink: jest.fn(() => { throw new GoneException({ code: 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED' }); }) };
    const adapter = new SofiaPaymentReadAdapter(payments as never);
    await expect(adapter.readOrderPayment('o1', actor)).rejects.toBeInstanceOf(GoneException);
    await expect(adapter.readOrderPayment('o1', { ...actor, roles: ['waiter'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(payments.getOperationalLink).toHaveBeenCalledTimes(1);
  });

  it('delegates redacted audit persistence and preserves transaction clients', async () => {
    const event = { id: 'audit-1', timestamp: new Date('2026-01-01T00:00:00Z') };
    const audit = { log: jest.fn().mockResolvedValue(event) };
    const adapter = new AuthoritativeAuditCommandAdapter(audit as never);
    const client = {};
    await expect(adapter.record({ actor, action: 'TEST', entity: 'draft' }, { auditClient: client })).resolves.toEqual({ auditEventId: 'audit-1', timestamp: event.timestamp.toISOString() });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ source: 'SOFIA_ADMIN' }), client);
  });
});
