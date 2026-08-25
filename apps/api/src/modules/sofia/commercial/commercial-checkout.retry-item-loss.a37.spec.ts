/**
 * A37 (Round 5, blind, FINAL VERIFICATION PASS) — RED TEAM FINDING.
 *
 * Directly stress-tests the thing this round's brief calls out by name: A36's new
 * `recoverDraftConflict()` retry-once logic. The brief asks: "Does the 'retry once then
 * safe-respond' design ever leave the customer's genuine intent silently dropped in a way that's
 * worse than the original uncaught-exception bug, even if it no longer crashes?"
 *
 * ANSWER: yes, for a THREE-WAY-adjacent scenario the existing A35/A36 regression spec
 * (`commercial-checkout.stale-draft-race.a35.spec.ts`) does not cover, because that spec's two
 * concurrent turns add the SAME product ("También quiero una Coca Cola" / "También quiero una Coca
 * Cola") -- so whichever turn's write lands last happens to carry an item list byte-identical to the
 * other's, masking any merge/overwrite behavior entirely. Two concurrent turns adding TWO DIFFERENT
 * products expose the real mechanism.
 *
 * ROOT CAUSE
 * ----------
 * `CommercialCheckoutService.recoverDraftConflict()` (commercial-checkout.service.ts:326-382), on a
 * `STALE_DRAFT_VERSION` conflict, does:
 *
 *   const fresh = state.draftId ? await this.repository.loadDraftVersion(state.draftId) : null;
 *   ...
 *   const prepared = await this.prepareDraft({ ...state, draftVersion: fresh.version }, command, options);
 *
 * `state` here is the LOSING turn's OWN, already-mutated, now-stale in-memory `state.items` --
 * computed once at the top of `process()`, BEFORE the CAS conflict was ever discovered. The retry
 * bumps ONLY `draftVersion` to the fresh authoritative value; it never re-reads or re-merges the
 * WINNING concurrent turn's own item mutation. `prepareDraft()` -> `saveDraft()` then persists the
 * retrying turn's items UNCONDITIONALLY as a whole-array replace
 * (`prisma-commercial.repository.ts:190`, `itemsSnapshot: input.items`) at the new version -- there is
 * no per-field merge, only a version-number CAS. Because the CAS only checks "does the version number
 * match", not "were these two edits to disjoint parts of the draft", a version bump is sufficient to
 * let the retry silently overwrite a completely different, already-committed, already-priced item
 * addition from the concurrent winner.
 *
 * ATTACK SCENARIO
 * ----------------
 * A customer conversation reaches an established PENDING draft (one Combo, TAKEAWAY, pay-at-pickup).
 * Two ordinary, realistic follow-up WhatsApp messages then land moments apart (double network jitter,
 * two devices, or simply an impatient customer re-sending because the first reply was slow) --
 * genuinely DIFFERENT text, DIFFERENT intent content, not a dedup-eligible duplicate:
 *   Turn A: "También quiero una Coca Cola"
 *   Turn B: "También quiero unas papas"
 * Both read the SAME `draftVersion` from `repository.loadState()` before either commits. One wins the
 * `saveDraft()` CAS outright; A36's retry logic lets the loser "succeed" too -- but the loser's retry
 * commits ONLY its own item (papas), silently discarding the winner's already-persisted, already
 * customer-facing-confirmed item (Coca Cola) with NO error, NO renewed ask, NO indication to either
 * turn's customer that anything was lost. The very `CommercialTurnResult` returned to Turn A's customer
 * claims `items` includes the Coca Cola (`SUMMARIZE_DRAFT`/`READY_TO_CONFIRM`) -- a promise the
 * following retry-loser write breaks a moment later without any further customer-facing signal.
 * If the customer then says "Confirmo", they confirm and pay for an order missing an item they were
 * explicitly told (in a still-fresh WhatsApp reply) had been added.
 *
 * INVARIANT VIOLATED
 * -------------------
 * "narration/memory never diverging from actual confirmed OR pending canonical state" -- Turn A's own
 * `CommercialTurnResult.factEnvelope.items` (delivered to the customer as a WhatsApp reply) diverges,
 * within the same request/response cycle's aftermath, from what is actually left in
 * `SofiaOrderDraft`/`sofiaConversationMemory` once Turn B's retry lands. "No silent loss of
 * confirmed-or-pending evidence under any writer" -- Turn A's genuine, already-priced item addition is
 * unconditionally destroyed by Turn B's retry-and-overwrite, with no CAS failure, no exception, no
 * recovery narration at all (unlike every OTHER race in this file, which at minimum tells the customer
 * "please resend" or "already confirmed"). This is a strictly WORSE outcome than the pre-A36 crash:
 * before A36 the loser's whole turn rejected (visibly, recoverably, nothing corrupted); after A36 the
 * loser's turn reports full success while quietly erasing the winner's committed contribution.
 *
 * Proven against REAL, unmocked `CommercialCheckoutService` + `PrismaCommercialRepository` + REAL
 * Postgres (only the catalog/availability/quote/audit/order-creation SOFIA_DOMAIN_CONTRACTS ports are
 * doubled, exactly as every sibling A33/A35/A36 spec in this directory already does).
 *
 * SOFIA Round 5 / A38 CLOSURE — this finding is FIXED. `recoverDraftConflict()`'s retry now re-derives
 * the retry-loser's OWN item delta (`CommercialCheckoutService.applyItemsMutation()`) on top of a
 * freshly reloaded authoritative items list (`rebaseTurnOntoFreshState()`) instead of blindly
 * persisting its own stale whole-array `state.items` snapshot. This spec is kept as a PERMANENT
 * regression test of the fixed behavior (see the assertions at the end of the test below) — the
 * original finding narrative above is retained as historical documentation of the exact mechanism
 * that must never regress.
 */

import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import { CommercialResponseValidator } from './response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from './response/safe-commercial-response.templates';

describe('A37: recoverDraftConflict() retry-once silently drops a DIFFERENT concurrent turn\'s already-committed item addition', () => {
  let prisma: PrismaService;
  let repository: PrismaCommercialRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A37 retry-item-loss test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaCommercialRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function buildService() {
    const combo = {
      id: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', description: 'Hamburguesas', imageUrl: null,
      category: { id: 'cat', name: 'Combos', slug: 'combos' }, kind: 'PREPARED' as const, persistedPrice: 25000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const soda = {
      id: 'p2', code: 'COCA-400', name: 'Coca Cola', description: 'Gaseosa', imageUrl: null,
      category: { id: 'cat', name: 'Bebidas', slug: 'bebidas' }, kind: 'DIRECT' as const, persistedPrice: 5000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const fries = {
      id: 'p3', code: 'PAPAS-01', name: 'Papas', description: 'Papas a la francesa', imageUrl: null,
      category: { id: 'cat2', name: 'Acompanamientos', slug: 'acompanamientos' }, kind: 'DIRECT' as const, persistedPrice: 6000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const products = [combo, soda, fries];
    const responses = new CommercialResponseComposer(
      { compose: jest.fn(async () => null) },
      new CommercialResponseValidator(),
      new SafeCommercialResponseTemplates(),
    );
    const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), new CommercialMetricsService(), responses, repository,
      { listActive: jest.fn(async () => products), getActiveById: jest.fn(async (id: string) => products.find((p) => p.id === id)!), findActive: jest.fn() } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId: null, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote: jest.fn() } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service, orderCreation };
  }

  const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

  it('two concurrent turns adding DIFFERENT products: the retry-loser silently overwrites the retry-winner\'s already-persisted item instead of merging or failing safely', async () => {
    const conversationId = `a37-itemloss-${randomUUID()}`;
    await prisma.whatsappConversation.create({
      data: { id: conversationId, phone: '573001112255', provider: 'mock' },
    });

    const { service } = buildService();

    // Establish a PENDING, ready-to-confirm TAKEAWAY draft with one Combo -- ordinary baseline state.
    const built = await service.process({
      conversationId,
      phone: '573001112255',
      message: 'Dame un combo 2x1, lo recojo y pago allá',
      actor,
    });
    expect(built.nextAction).toBe('READY_TO_CONFIRM');
    expect(built.state.draftVersion).toBe(1);
    expect(built.state.confirmationState).toBe('PENDING');

    // Two REAL, DIFFERENT customer messages, each adding a DIFFERENT product, racing each other for
    // the SAME draft. Neither has observed the other's result -- both independently read
    // draftVersion=1 from repository.loadState().
    const settled = await Promise.allSettled([
      service.process({ conversationId, phone: '573001112255', message: 'También quiero una Coca Cola', actor }),
      service.process({ conversationId, phone: '573001112255', message: 'También quiero unas papas', actor }),
    ]);

    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof service.process>>>[];
    const rejected = settled.filter((entry) => entry.status === 'rejected') as PromiseRejectedResult[];

    // A36's retry-once logic means NEITHER turn rejects -- both report full, ordinary success.
    expect(rejected).toHaveLength(0);
    expect(fulfilled).toHaveLength(2);
    for (const entry of fulfilled) {
      expect(entry.value.nextAction).toBe('READY_TO_CONFIRM');
      expect(entry.value.state.confirmationState).toBe('PENDING');
      expect(entry.value.state.draftId).toBe(built.state.draftId);
    }

    // Collect what each individual turn's own response claimed was in the draft (useful evidence
    // regardless of outcome -- the retry-loser's own response necessarily predates the OTHER turn's
    // eventual merge onto fresh state, so it may legitimately claim fewer items than the final
    // authoritative truth; that alone is not a bug, see assertions below for what MUST hold).
    const claimedProductSets = fulfilled.map((entry) => entry.value.state.items.map((item) => item.productId).sort());

    // Reload ground truth: what is ACTUALLY left in the authoritative SofiaOrderDraft/conversation
    // memory after both turns have settled.
    const finalState = await repository.loadState(conversationId);
    const finalDraft = await repository.loadDraftVersion(built.state.draftId!);
    const finalProducts = finalState!.items.map((item) => item.productId).sort();

    console.log('A38 regression evidence (A37 item-loss FIXED):', JSON.stringify({
      claimedProductSets,
      finalProducts,
      finalDraftVersion: finalDraft,
    }));

    // SOFIA Round 5 / A38 CLOSURE: `recoverDraftConflict()`'s retry now re-derives the retry-loser's
    // OWN item delta (`applyItemsMutation()`) on top of a FRESHLY reloaded authoritative items list
    // (`rebaseTurnOntoFreshState()`) instead of blindly persisting its own stale whole-array
    // `state.items` snapshot. Both concurrently-added, genuinely different products MUST survive in
    // the final authoritative draft -- neither turn's already-committed contribution may be silently
    // erased by the other's retry.
    const bothProductsSurvived = finalProducts.includes('p2') && finalProducts.includes('p3');
    if (!bothProductsSurvived) {
      // REGRESSION: the A37 HIGH finding has come back -- exactly one of the two concurrently-added
      // products survived, even though BOTH turns independently reported success. See the A37 spec
      // history (git log this file) and the A38 CLOSURE doc on
      // `CommercialCheckoutService.rebaseTurnOntoFreshState()` / `applyItemsMutation()` for the exact
      // mechanism this must never regress to.
      throw new Error(
        `A38 REGRESSION: the A37 item-loss finding reproduced again -- final products are `
        + `${JSON.stringify(finalProducts)}, expected BOTH "p2" (Coca Cola) and "p3" (Papas) to survive `
        + `alongside the baseline "p1" (Combo). recoverDraftConflict()'s retry is once again `
        + `whole-array-overwriting items instead of rebasing this turn's own delta onto fresh `
        + `authoritative state.`,
      );
    }

    // FIXED BEHAVIOR (permanent assertion): the baseline Combo plus BOTH concurrently-added products
    // all survive intact in the final authoritative draft -- nothing a customer was told was added is
    // ever silently dropped by a sibling turn's unrelated retry.
    expect(finalProducts).toEqual(['p1', 'p2', 'p3']);
    expect(finalState!.items).toHaveLength(3);
    for (const productId of ['p1', 'p2', 'p3']) {
      const item = finalState!.items.find((entry) => entry.productId === productId);
      expect(item?.quantity).toBe(1);
    }
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a37-itemloss-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a37-itemloss-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a37-itemloss-' } } });
  });
});
