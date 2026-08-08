import { PrismaClient, SofiaOrderDraftStatus } from '@prisma/client';
import { PrismaCommercialRepository } from '../modules/sofia/commercial/persistence/prisma-commercial.repository';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/_test(?:\?|$)/.test(databaseUrl)) throw new Error('Commercial integration requires an isolated _test database.');

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const repository = new PrismaCommercialRepository(prisma as never);

const base = (conversationId: string, draftId?: string, version = 1) => ({
  conversationId, draftId, version, customerId: null, fulfillment: 'TAKEAWAY', paymentPreference: 'PAY_AT_PICKUP',
  items: [{ productId: 'p1', code: 'P1', name: 'Producto', quantity: 1, unitPrice: 10000, modifiers: [] }],
  subtotal: 10000, deliveryFee: 0, total: 10000, address: null, deliveryQuoteAuditId: null,
  deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null,
  availabilitySnapshot: [{ productId: 'p1', checkedAt: new Date(0).toISOString(), reasonCode: 'AVAILABLE' }],
});

describe('commercial draft persistence', () => {
  let conversationId: string;
  beforeEach(async () => {
    await prisma.sofiaOrderDraft.deleteMany();
    await prisma.sofiaConversationMemory.deleteMany();
    await prisma.whatsappConversation.deleteMany();
    const conversation = await prisma.whatsappConversation.create({ data: { phone: `57${Date.now()}`, provider: 'test', mode: 'disabled' } });
    conversationId = conversation.id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('starts at version one and permits one concurrent version winner', async () => {
    const created = await repository.saveDraft(base(conversationId));
    expect(created.version).toBe(1);
    const updates = await Promise.allSettled([
      repository.saveDraft(base(conversationId, created.id, 2)),
      repository.saveDraft({ ...base(conversationId, created.id, 2), total: 11000 }),
    ]);
    expect(updates.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(updates.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: created.id } })).version).toBe(2);
  });

  it('binds confirmation to latest version and hash exactly once', async () => {
    const created = await repository.saveDraft(base(conversationId));
    const confirmation = { draftId: created.id, expectedVersion: 1, expectedHash: created.draftHash, confirmationHash: 'confirmation-hash' };
    await expect(repository.confirmDraft(confirmation)).resolves.toMatchObject({ status: 'CONFIRMED' });
    await expect(repository.confirmDraft(confirmation)).rejects.toMatchObject({ response: { code: 'SOFIA_STALE_CONFIRMATION' } });
    const stored = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored).toMatchObject({ status: SofiaOrderDraftStatus.CONFIRMED, confirmationHash: 'confirmation-hash' });
  });

  it('rejects expired and legacy unbound drafts', async () => {
    const created = await repository.saveDraft(base(conversationId));
    await prisma.sofiaOrderDraft.update({ where: { id: created.id }, data: { expiresAt: new Date(0) } });
    await expect(repository.confirmDraft({ draftId: created.id, expectedVersion: 1, expectedHash: created.draftHash, confirmationHash: 'x' })).rejects.toBeDefined();
    const legacy = await prisma.sofiaOrderDraft.create({ data: { conversationId, itemsSnapshot: [], status: 'READY_TO_CONFIRM' } });
    await expect(repository.confirmDraft({ draftId: legacy.id, expectedVersion: 1, expectedHash: '', confirmationHash: 'x' })).rejects.toBeDefined();
  });
});
