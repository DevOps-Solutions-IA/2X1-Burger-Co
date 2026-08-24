/**
 * A35 (Round 5, blind, FINAL VERIFICATION PASS) — RED TEAM FINDING, CLOSED BY A36, companion to
 * `commercial-checkout.confirm-race.a35.spec.ts`.
 *
 * Same root cause, DIFFERENT (and more common) trigger: `CommercialCheckoutService.prepareDraft()`
 * ultimately calls `repository.saveDraft()`, which performs its own optimistic-concurrency CAS
 * (`sofiaOrderDraft.updateMany({ where: { id, version: version - 1, status: { in: [...] } } })`,
 * prisma-commercial.repository.ts:206). Every call site of `prepareDraft()` in
 * `commercial-checkout.service.ts` (process()'s main path at line 237, confirm()'s expiry-refresh
 * at line 454, confirm()'s price-refresh at line 487) wraps the call in:
 *
 *   try { ... } catch (error) {
 *     if (error instanceof DraftAlreadyConfirmedError) return this.respondDraftAlreadyConfirmed(...);
 *     throw error;
 *   }
 *
 * — i.e. ONLY `DraftAlreadyConfirmedError` (thrown when the CAS fails because the tracked draft is
 * already CONFIRMED) is recovered gracefully. But `saveDraft()`'s CAS can ALSO fail for the much
 * more mundane, much more common reason of two ordinary, non-confirming, genuinely concurrent
 * messages both trying to rebuild the SAME still-PENDING draft — e.g. a customer double/triple-taps
 * "send" on an item-adding message ("También quiero una Coca Cola"), or two unrelated messages
 * about the same order land moments apart. In that case `prisma-commercial.repository.ts:206-212`
 * takes the OTHER branch:
 *
 *   if (updated.count !== 1) {
 *     const prior = await ...; // prior.status is still READY_TO_CONFIRM, NOT CONFIRMED
 *     const priorConfirmedAtExpectedVersion = prior?.status === CONFIRMED && prior.version === version - 1;
 *     if (!priorConfirmedAtExpectedVersion) throw new ConflictException({ code: 'STALE_DRAFT_VERSION' });
 *     ...
 *   }
 *
 * `ConflictException({ code: 'STALE_DRAFT_VERSION' })` is a completely different exception type
 * than `DraftAlreadyConfirmedError` (a plain `Error` subclass) — the `instanceof
 * DraftAlreadyConfirmedError` check does NOT catch it, so it propagates uncaught through
 * `prepareDraft()` -> `process()` -> the caller, exactly like the sibling `confirmDraft()` CAS
 * failure proven in the companion file, but reachable from ANY ordinary duplicate/racing message
 * pair, not only a duplicated confirmation. This is arguably the MORE realistic trigger of the two:
 * item/address/payment edits are the bulk of a real conversation's message volume, confirmations are
 * a single turn.
 *
 * BUSINESS IMPACT (as originally found): same class as the companion file — no financial/evidence
 * corruption (Postgres's CAS correctly let only one writer win at a time and the draft's authoritative
 * state stayed internally consistent), but an ordinary, foreseeable double-send from a real customer
 * produced an UNCAUGHT exception instead of a `CommercialTurnResult`, propagating all the way to
 * `SofiaWhatsappService.processInboundWebhook()`'s outer catch (which marks the inbound claim FAILED
 * and re-throws) for the losing message — violating "no uncaught exceptions on foreseeable business/
 * guard conditions".
 *
 * A36 FIX (this file now proves the FIXED behavior, not the bug)
 * -------------------------------------------------------------
 * Every `prepareDraft()` call site in `CommercialCheckoutService` now routes its catch block through
 * `recoverDraftConflict()`, which recognizes `ConflictException({code:'STALE_DRAFT_VERSION'})` (not
 * only `DraftAlreadyConfirmedError`) and reloads the CURRENT authoritative `SofiaOrderDraft`
 * version/status directly (`repository.loadDraftVersion()`, ground truth independent of whichever
 * table the concurrent winner's conversation-memory write has or hasn't landed in yet). When the draft
 * is not actually CONFIRMED (the ordinary case proven here), it retries `prepareDraft()` ONCE against
 * the fresh version — so the customer's own genuine intent for this turn ("también quiero una Coca
 * Cola") is still honored against current reality — instead of ever rejecting the turn's promise.
 *
 * Proven against REAL, unmocked `CommercialCheckoutService` + `PrismaCommercialRepository` + REAL
 * Postgres.
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

describe('A35/A36: saveDraft() STALE_DRAFT_VERSION CAS failure now retries and recovers gracefully for ordinary concurrent non-confirming messages', () => {
  let prisma: PrismaService;
  let repository: PrismaCommercialRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A35 stale-draft-race test requires an isolated _test database.');
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
    const products = [combo, soda];
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

  it('two genuinely concurrent item-adding turns on the SAME already-PENDING draft: one rebuilds successfully, the other loses the CAS race and now retries-and-succeeds instead of rejecting with an uncaught ConflictException(STALE_DRAFT_VERSION)', async () => {
    const conversationId = `a35b-race-${randomUUID()}`;
    await prisma.whatsappConversation.create({
      data: { id: conversationId, phone: '573001112244', provider: 'mock' },
    });

    const { service } = buildService();

    // Turn 1: an already fully-specified, PENDING-to-confirm TAKEAWAY draft (draftVersion 1) --
    // ordinary state for a conversation that already knows product/fulfillment/payment.
    const built = await service.process({
      conversationId,
      phone: '573001112244',
      message: 'Dame un combo 2x1, lo recojo y pago allá',
      actor,
    });
    expect(built.nextAction).toBe('READY_TO_CONFIRM');
    expect(built.state.draftVersion).toBe(1);
    expect(built.state.confirmationState).toBe('PENDING');

    // Turn 2 and Turn 3: TWO real, distinct WhatsApp messages (a genuine double-tap of the SAME
    // follow-up "add a Coke" message, or simply two ordinary messages landing moments apart)
    // racing each other to rebuild the SAME draft at version 2. Neither has observed the other's
    // result -- both independently read draftVersion=1 from `repository.loadState()`.
    const settled = await Promise.allSettled([
      service.process({ conversationId, phone: '573001112244', message: 'También quiero una Coca Cola', actor }),
      service.process({ conversationId, phone: '573001112244', message: 'También quiero una Coca Cola', actor }),
    ]);

    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof service.process>>>[];
    const rejected = settled.filter((entry) => entry.status === 'rejected') as PromiseRejectedResult[];

    // A36 CLOSURE: NEITHER turn rejects anymore. The turn that loses the initial CAS race no longer
    // gets a raw, uncaught `ConflictException({code:'STALE_DRAFT_VERSION'})` -- `recoverDraftConflict()`
    // reloads the CURRENT authoritative draft version directly from `SofiaOrderDraft` (ground truth,
    // not the possibly-stale conversation-memory snapshot) and retries `prepareDraft()` ONCE against
    // it, uncontested (the winning turn has already committed and nothing else is racing this draft),
    // so BOTH turns resolve to a normal `CommercialTurnResult` and BOTH honor the customer's genuine
    // "add a Coke" intent -- unlike the old behavior, which silently dropped the losing turn's intent
    // entirely by crashing before it was ever persisted.
    expect(rejected).toHaveLength(0);
    expect(fulfilled).toHaveLength(2);
    for (const entry of fulfilled) {
      expect(entry.value.nextAction).toBe('READY_TO_CONFIRM');
      expect(entry.value.state.confirmationState).toBe('PENDING');
      expect(entry.value.state.draftId).toBe(built.state.draftId);
      // Both racing turns' own independently-parsed "add a Coke" intent landed: the retried turn
      // rebuilds from ITS OWN already-mutated `state.items` (computed before the CAS conflict was
      // ever hit), just against the corrected version -- so neither turn silently drops the item.
      expect(entry.value.state.items.map((item) => item.productId).sort()).toEqual(['p1', 'p2']);
      // Every successful (re)build strictly increases the draft version -- no version regression,
      // no silent overwrite of the other turn's committed write.
      expect(entry.value.state.draftVersion).toBeGreaterThan(1);
    }

    // The durable, authoritative draft reflects the LAST successful write (whichever turn committed
    // second, whether that was the original winner or the recovered retry) and stays internally
    // consistent -- no duplicate draft, no lost item, no corrupted version.
    const finalState = await repository.loadState(conversationId);
    expect(finalState!.draftId).toBe(built.state.draftId);
    expect(finalState!.confirmationState).toBe('PENDING');
    expect(finalState!.items.map((item) => item.productId).sort()).toEqual(['p1', 'p2']);
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a35b-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a35b-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a35b-' } } });
  });
});
