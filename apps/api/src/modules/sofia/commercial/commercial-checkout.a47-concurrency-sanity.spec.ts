import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import type { CommercialConversationState } from './commercial.types';

describe('A47/A48 concurrency sanity: loadStateForUpdate()/reconcileConfirmedState() self-concurrency and cross-writer lock cycles', () => {
  let prisma: PrismaService;
  let repo: PrismaCommercialRepository;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    repo = new PrismaCommercialRepository(prisma);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('two concurrent loadStateForUpdate() calls for the SAME conversation serialize without deadlock or hang', async () => {
    const conversationId = `a47-selfconc-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573009990001', provider: 'mock' } });
    const state: CommercialConversationState = {
      schemaVersion: 4, conversationId, intent: 'PURCHASE', confirmationState: 'PENDING', draftId: null, draftVersion: null,
      draftHash: null, fulfillment: 'DELIVERY', paymentPreference: 'CASH_ON_DELIVERY', paymentReadiness: 'PAYMENT_COD',
      items: [], address: null, addressConfirmed: false, subtotal: 0, deliveryFee: 0, total: 0,
      deliveryQuoteAuditId: null, deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [],
      missingFields: [], expiresAt: null, customerId: null, handoffState: 'NONE', consentState: 'NOT_REQUIRED',
      confidence: 'LOW', lastResolvedIntent: null, ambiguities: [], destinationSnapshot: null,
      deliveryQuoteDestinationBinding: null, lastQuestionPurpose: null,
    } as unknown as CommercialConversationState;
    await repo.saveState(state);

    const start = Date.now();
    const results = await Promise.all([
      repo.loadStateForUpdate(conversationId),
      repo.loadStateForUpdate(conversationId),
      repo.loadStateForUpdate(conversationId),
      repo.loadStateForUpdate(conversationId),
      repo.loadStateForUpdate(conversationId),
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    for (const r of results) expect(r?.conversationId).toBe(conversationId);

    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId } });
    await prisma.whatsappConversation.deleteMany({ where: { id: conversationId } });
  }, 15000);

  it('mixed concurrent saveState() / saveLegacyConversationContext() / loadStateForUpdate() on the SAME row does not deadlock (each txn takes only one lock on one row)', async () => {
    const conversationId = `a47-mixedconc-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573009990002', provider: 'mock' } });
    const state: CommercialConversationState = {
      schemaVersion: 4, conversationId, intent: 'PURCHASE', confirmationState: 'PENDING', draftId: null, draftVersion: null,
      draftHash: null, fulfillment: 'DELIVERY', paymentPreference: 'CASH_ON_DELIVERY', paymentReadiness: 'PAYMENT_COD',
      items: [], address: null, addressConfirmed: false, subtotal: 0, deliveryFee: 0, total: 0,
      deliveryQuoteAuditId: null, deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [],
      missingFields: [], expiresAt: null, customerId: null, handoffState: 'NONE', consentState: 'NOT_REQUIRED',
      confidence: 'LOW', lastResolvedIntent: null, ambiguities: [], destinationSnapshot: null,
      deliveryQuoteDestinationBinding: null, lastQuestionPurpose: null,
    } as unknown as CommercialConversationState;
    await repo.saveState(state);

    const start = Date.now();
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      ops.push(repo.loadStateForUpdate(conversationId));
      ops.push(repo.saveState({ ...state, missingFields: [`iter-${i}`] }));
      ops.push(repo.saveLegacyConversationContext({ conversationId, memorySummary: `legacy-${i}` }));
    }
    await Promise.all(ops);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10000);

    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId } });
    await prisma.whatsappConversation.deleteMany({ where: { id: conversationId } });
  }, 20000);

  // SOFIA Round 5 / A48 CLOSURE additions -- `reconcileConfirmedState()` (the new atomic entry point
  // that replaced the two-step `loadStateForUpdate()` -> later `saveState()` sequence in
  // `respondDraftAlreadyConfirmed()`) holds its row lock for LONGER than `loadStateForUpdate()` did
  // (through an additional `sofiaOrderDraft.findUnique()` read and, when it decides to persist, the
  // `upsert` write itself, all inside the SAME transaction). These tests exist specifically to prove
  // that longer-held lock still does not introduce a deadlock or an unbounded hang under realistic
  // concurrent load -- the exact same sanity check this file already performed for
  // `loadStateForUpdate()`, extended to the new method.
  it('five concurrent reconcileConfirmedState() calls for the SAME conversation+draft serialize without deadlock or hang', async () => {
    const conversationId = `a48-reconcile-selfconc-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573009990003', provider: 'mock' } });
    const draft = await prisma.sofiaOrderDraft.create({
      data: {
        conversationId, status: 'CONFIRMED', confirmedAt: new Date(), confirmationHash: 'a48-sanity',
        fulfillment: 'TAKEAWAY', paymentPreference: 'CASH_ON_DELIVERY', version: 1, draftHash: 'hash',
        itemsSnapshot: [], subtotal: 0, deliveryFee: 0, total: 0, availabilitySnapshot: [],
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const state: CommercialConversationState = {
      schemaVersion: 4, conversationId, intent: 'PURCHASE', confirmationState: 'PENDING', draftId: draft.id, draftVersion: 1,
      draftHash: 'hash', fulfillment: 'TAKEAWAY', paymentPreference: 'CASH_ON_DELIVERY', paymentReadiness: 'PAYMENT_COD',
      items: [], address: null, addressConfirmed: false, subtotal: 0, deliveryFee: 0, total: 0,
      deliveryQuoteAuditId: null, deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [],
      missingFields: [], expiresAt: null, customerId: null, handoffState: 'NONE', consentState: 'NOT_REQUIRED',
      confidence: 'LOW', lastResolvedIntent: null, ambiguities: [], destinationSnapshot: null,
      deliveryQuoteDestinationBinding: null, lastQuestionPurpose: null,
    } as unknown as CommercialConversationState;
    await repo.saveState(state);

    const decide = (locked: { current: CommercialConversationState | null; confirmedDraft: unknown }) => {
      if (locked.current?.confirmationState === 'CONFIRMED') return { resolved: locked.current, persist: false };
      return { resolved: { ...state, confirmationState: 'CONFIRMED' as const }, persist: true };
    };

    const start = Date.now();
    const results = await Promise.all([
      repo.reconcileConfirmedState(conversationId, draft.id, decide as never),
      repo.reconcileConfirmedState(conversationId, draft.id, decide as never),
      repo.reconcileConfirmedState(conversationId, draft.id, decide as never),
      repo.reconcileConfirmedState(conversationId, draft.id, decide as never),
      repo.reconcileConfirmedState(conversationId, draft.id, decide as never),
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    for (const r of results) expect(r?.confirmationState).toBe('CONFIRMED');

    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId } });
    await prisma.whatsappConversation.deleteMany({ where: { id: conversationId } });
  }, 15000);

  it('mixed concurrent saveState() / saveLegacyConversationContext() / loadStateForUpdate() / reconcileConfirmedState() on the SAME row does not deadlock (each txn takes only one lock on one row)', async () => {
    const conversationId = `a48-mixedconc-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573009990004', provider: 'mock' } });
    const draft = await prisma.sofiaOrderDraft.create({
      data: {
        conversationId, status: 'CONFIRMED', confirmedAt: new Date(), confirmationHash: 'a48-sanity-2',
        fulfillment: 'TAKEAWAY', paymentPreference: 'CASH_ON_DELIVERY', version: 1, draftHash: 'hash',
        itemsSnapshot: [], subtotal: 0, deliveryFee: 0, total: 0, availabilitySnapshot: [],
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const state: CommercialConversationState = {
      schemaVersion: 4, conversationId, intent: 'PURCHASE', confirmationState: 'PENDING', draftId: draft.id, draftVersion: 1,
      draftHash: 'hash', fulfillment: 'TAKEAWAY', paymentPreference: 'CASH_ON_DELIVERY', paymentReadiness: 'PAYMENT_COD',
      items: [], address: null, addressConfirmed: false, subtotal: 0, deliveryFee: 0, total: 0,
      deliveryQuoteAuditId: null, deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [],
      missingFields: [], expiresAt: null, customerId: null, handoffState: 'NONE', consentState: 'NOT_REQUIRED',
      confidence: 'LOW', lastResolvedIntent: null, ambiguities: [], destinationSnapshot: null,
      deliveryQuoteDestinationBinding: null, lastQuestionPurpose: null,
    } as unknown as CommercialConversationState;
    await repo.saveState(state);

    const decide = (locked: { current: CommercialConversationState | null; confirmedDraft: unknown }) => {
      if (locked.current?.confirmationState === 'CONFIRMED') return { resolved: locked.current, persist: false };
      return { resolved: { ...state, confirmationState: 'CONFIRMED' as const }, persist: true };
    };

    const start = Date.now();
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      ops.push(repo.loadStateForUpdate(conversationId));
      ops.push(repo.saveState({ ...state, missingFields: [`iter-${i}`] }));
      ops.push(repo.saveLegacyConversationContext({ conversationId, memorySummary: `legacy-${i}` }));
      ops.push(repo.reconcileConfirmedState(conversationId, draft.id, decide as never));
    }
    await Promise.all(ops);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(15000);

    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId } });
    await prisma.whatsappConversation.deleteMany({ where: { id: conversationId } });
  }, 25000);
});
