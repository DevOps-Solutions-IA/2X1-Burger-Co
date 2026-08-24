import { PrismaClient, SofiaOrderDraftStatus } from '@prisma/client';
import { PrismaCommercialRepository } from '../modules/sofia/commercial/persistence/prisma-commercial.repository';
import { DraftAlreadyConfirmedError } from '../modules/sofia/commercial/commercial.repository';
import type { CommercialConversationState } from '../modules/sofia/commercial/commercial.types';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/_test(?:\?|$)/.test(databaseUrl)) throw new Error('Commercial integration requires an isolated _test database.');

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const repository = new PrismaCommercialRepository(prisma as never);

const base = (conversationId: string, draftId?: string, version = 1) => ({
  conversationId, draftId, version, customerId: null, fulfillment: 'TAKEAWAY', paymentPreference: 'PAY_AT_PICKUP',
  items: [{ productId: 'p1', code: 'P1', name: 'Producto', quantity: 1, unitPrice: 10000, modifiers: [] }],
  subtotal: 10000, deliveryFee: 0, total: 10000, address: null, addressConfirmed: false, deliveryQuoteAuditId: null,
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

  it(
    'preserves a confirmed draft and creates a new historical version for material changes ONLY when the ' +
      'caller explicitly authorizes it via allowNewDraftAfterConfirm (SOFIA Round 5 / A26 CLOSURE)',
    async () => {
      const created = await repository.saveDraft(base(conversationId));
      await repository.confirmDraft({ draftId: created.id, expectedVersion: 1, expectedHash: created.draftHash, confirmationHash: 'confirmation-hash' });
      const changed = await repository.saveDraft({ ...base(conversationId, created.id, 2), total: 12000, allowNewDraftAfterConfirm: true });
      expect(changed.id).not.toBe(created.id);
      expect(changed.version).toBe(2);
      const rows = await prisma.sofiaOrderDraft.findMany({ where: { conversationId }, orderBy: { version: 'asc' } });
      expect(rows.map((row) => [row.version, row.status])).toEqual([[1, 'CONFIRMED'], [2, 'READY_TO_CONFIRM']]);
    },
  );

  it(
    'SOFIA Round 5 / A26 CLOSURE (root cause #2, HIGH regression) — refuses to silently spin off a shadow ' +
      'draft when the tracked draft is already CONFIRMED and the caller did NOT explicitly authorize a new ' +
      'draft: this is exactly the A25 lost-update hazard (a caller that read a stale, pre-confirmation ' +
      'snapshot has no idea its tracked draft was already confirmed) reproduced at the repository layer, ' +
      'independent of CommercialCheckoutService',
    async () => {
      const created = await repository.saveDraft(base(conversationId));
      await repository.confirmDraft({ draftId: created.id, expectedVersion: 1, expectedHash: created.draftHash, confirmationHash: 'confirmation-hash' });
      await expect(repository.saveDraft({ ...base(conversationId, created.id, 2), total: 12000 })).rejects.toBeInstanceOf(DraftAlreadyConfirmedError);
      await expect(repository.saveDraft({ ...base(conversationId, created.id, 2), total: 12000, allowNewDraftAfterConfirm: false })).rejects.toBeInstanceOf(DraftAlreadyConfirmedError);
      // No shadow draft was ever created -- exactly one row for this conversation, still CONFIRMED.
      const rows = await prisma.sofiaOrderDraft.findMany({ where: { conversationId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe(SofiaOrderDraftStatus.CONFIRMED);
    },
  );

  it(
    'SOFIA Round 5 / A26 CLOSURE (root cause #1, HIGH regression) — saveState() never regresses an ' +
      'already-persisted CONFIRMED confirmationState for the SAME draftId back to a non-CONFIRMED value, ' +
      'even when a racing writer\'s stale-read write lands AFTER the confirming write already committed ' +
      '(the exact lost-update the A25 finding demonstrated one turn above this layer)',
    async () => {
      const draftId = 'a26-repo-draft-1';
      const memoryState = (overrides: Partial<CommercialConversationState> = {}): CommercialConversationState => ({
        schemaVersion: 4, conversationId, customerId: null, intent: 'PURCHASE', items: [], fulfillment: 'TAKEAWAY',
        address: null, addressConfirmed: false, location: null, destinationSnapshot: null, deliveryQuoteDestinationBinding: null,
        paymentPreference: 'PAY_AT_PICKUP', paymentReadiness: 'PAYMENT_AT_PICKUP', subtotal: 10000, deliveryFee: 0, total: 10000,
        deliveryQuoteAuditId: null, deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [],
        draftId, draftVersion: 1, draftHash: 'hash', draftFulfillment: 'TAKEAWAY', draftItemsFingerprint: 'fp',
        draftPaymentPreference: 'PAY_AT_PICKUP', confirmationState: 'PENDING', missingFields: [], ambiguities: [],
        confidence: 'HIGH', handoffState: 'SOFIA_ACTIVE', consentState: 'SERVICE', domainErrors: [],
        lastQuestionPurpose: 'CONFIRM_ORDER', lastResolvedIntent: 'PURCHASE', expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      });
      // Turn A's stale-read winner: captures a PENDING snapshot BEFORE any confirmation happens --
      // this is exactly what a racing turn's own `loadState()` would have returned had it read a
      // moment too early.
      const staleSnapshot = memoryState();
      // Turn A's actual confirming write lands first and commits.
      await repository.saveState(memoryState({ confirmationState: 'CONFIRMED' }));
      expect((await repository.loadState(conversationId))?.confirmationState).toBe('CONFIRMED');
      // Turn B: a racing writer whose OWN belief (built from the stale snapshot above) never saw the
      // confirmation -- same draftId, still PENDING, now also switching payment preference, exactly
      // like the A25 finding's Turn B.
      await repository.saveState({ ...staleSnapshot, paymentPreference: 'ONLINE', confirmationState: 'PENDING' });
      const afterRace = await repository.loadState(conversationId);
      // The durable CONFIRMED marker for this draftId MUST survive the stale write -- this is the
      // single invariant root cause #1 exists to protect.
      expect(afterRace?.confirmationState).toBe('CONFIRMED');
      expect(afterRace?.draftId).toBe(draftId);
    },
  );

  it('rejects expired and legacy unbound drafts', async () => {
    const created = await repository.saveDraft(base(conversationId));
    await prisma.sofiaOrderDraft.update({ where: { id: created.id }, data: { expiresAt: new Date(0) } });
    await expect(repository.confirmDraft({ draftId: created.id, expectedVersion: 1, expectedHash: created.draftHash, confirmationHash: 'x' })).rejects.toBeDefined();
    const legacy = await prisma.sofiaOrderDraft.create({ data: { conversationId, itemsSnapshot: [], status: 'READY_TO_CONFIRM' } });
    await expect(repository.confirmDraft({ draftId: legacy.id, expectedVersion: 1, expectedHash: '', confirmationHash: 'x' })).rejects.toBeDefined();
  });
});
