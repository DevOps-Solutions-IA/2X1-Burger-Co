import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import type { CommercialConversationState } from './commercial.types';

describe('A47 concurrency sanity: loadStateForUpdate() self-concurrency and cross-writer lock cycles', () => {
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
});
