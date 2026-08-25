/**
 * SOFIA Round 5 / A38 — permanent regression test for a genuine THREE-WAY concurrent collision against
 * `recoverDraftConflict()`'s rebase-and-retry fix (see `rebaseTurnOntoFreshState()` /
 * `applyItemsMutation()` in `commercial-checkout.service.ts`, and the sibling A37 permanent regression
 * specs `commercial-checkout.retry-address-revert.a37.spec.ts` /
 * `commercial-checkout.retry-item-loss.a37.spec.ts` for the two-way findings this fix closes).
 *
 * Turn A commits first (draft v1 -> v2). Turn B (pinned to the pre-Turn-A stale baseline) loses its
 * first CAS, triggering `recoverDraftConflict()`'s retry. Between the moment the retry reads the
 * "fresh" draft version (`loadDraftVersion`) and the moment its own rebased
 * `prepareDraft()`/`saveDraft()` actually executes its CAS, Turn C (a third, genuinely different
 * concurrent write) is deterministically injected and commits (v2 -> v3). This means Turn B's retry is
 * now ALSO stale by the time its own CAS runs, forcing a genuine SECOND consecutive
 * `STALE_DRAFT_VERSION` collision for the SAME turn — exactly the case the A36/A38 "retry once, then
 * safe respond" discipline exists for.
 *
 * REQUIRED (permanent assertions below): Turn B's turn must NOT crash, must NOT loop/retry a second
 * time, and must NOT corrupt or silently drop Turn A's or Turn C's already-committed items — it must
 * degrade to the safe `QUOTE_EXPIRED` re-sync response, and the final authoritative draft must contain
 * exactly Turn A's and Turn C's contributions (Turn B's own item is safely absent, with no corruption
 * of anything else).
 */

import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import type { CommercialRepository } from './commercial.repository';
import type { CommercialConversationState } from './commercial.types';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import { CommercialResponseValidator } from './response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from './response/safe-commercial-response.templates';

/** Wraps the real repository so the FIRST `loadDraftVersion()` call for a pinned draftId (the one
 * `recoverDraftConflict()` makes to discover the "fresh" version to retry against) also triggers a
 * REAL, complete, concurrent Turn C write to land immediately afterward — deterministically forcing
 * the retry's own CAS to be stale by the time it runs. */
class ThirdTurnInjectingRepository implements CommercialRepository {
  private armed: { draftId: string; runTurnC: () => Promise<void> } | null = null;
  constructor(private readonly real: PrismaCommercialRepository) {}
  arm(draftId: string, runTurnC: () => Promise<void>) { this.armed = { draftId, runTurnC }; }
  async loadDraftVersion(draftId: string) {
    const fresh = await this.real.loadDraftVersion(draftId);
    if (this.armed && this.armed.draftId === draftId) {
      const { runTurnC } = this.armed;
      this.armed = null; // fire once only
      await runTurnC();
    }
    return fresh;
  }
  loadState(conversationId: string) { return this.real.loadState(conversationId); }
  saveState(state: CommercialConversationState) { return this.real.saveState(state); }
  saveDraft(input: Parameters<CommercialRepository['saveDraft']>[0]) { return this.real.saveDraft(input); }
  confirmDraft(input: Parameters<CommercialRepository['confirmDraft']>[0]) { return this.real.confirmDraft(input); }
  loadConfirmedDraftRecord(draftId: string) { return this.real.loadConfirmedDraftRecord(draftId); }
  loadStateForUpdate(conversationId: string) { return this.real.loadStateForUpdate(conversationId); }
}

describe('A38 self-verification: three-way collision degrades safely (no crash, no data loss)', () => {
  let prisma: PrismaService;
  let realRepository: PrismaCommercialRepository;
  let repository: ThirdTurnInjectingRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A38 three-way verification requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    realRepository = new PrismaCommercialRepository(prisma);
    repository = new ThirdTurnInjectingRepository(realRepository);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function buildService(repo: CommercialRepository) {
    const combo = { id: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', description: 'Hamburguesas', imageUrl: null, category: { id: 'cat', name: 'Combos', slug: 'combos' }, kind: 'PREPARED' as const, persistedPrice: 25000, active: true, trackStock: true, updatedAt: new Date().toISOString() };
    const soda = { id: 'p2', code: 'COCA-400', name: 'Coca Cola', description: 'Gaseosa', imageUrl: null, category: { id: 'cat', name: 'Bebidas', slug: 'bebidas' }, kind: 'DIRECT' as const, persistedPrice: 5000, active: true, trackStock: true, updatedAt: new Date().toISOString() };
    const fries = { id: 'p3', code: 'PAPAS-01', name: 'Papas', description: 'Papas a la francesa', imageUrl: null, category: { id: 'cat2', name: 'Acompanamientos', slug: 'acompanamientos' }, kind: 'DIRECT' as const, persistedPrice: 6000, active: true, trackStock: true, updatedAt: new Date().toISOString() };
    const lemonade = { id: 'p4', code: 'LIMON-01', name: 'Limonada', description: 'Limonada natural', imageUrl: null, category: { id: 'cat', name: 'Bebidas', slug: 'bebidas' }, kind: 'DIRECT' as const, persistedPrice: 4000, active: true, trackStock: true, updatedAt: new Date().toISOString() };
    const products = [combo, soda, fries, lemonade];
    const responses = new CommercialResponseComposer(
      { compose: jest.fn(async () => null) },
      new CommercialResponseValidator(),
      new SafeCommercialResponseTemplates(),
    );
    const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
    return new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), new CommercialMetricsService(), responses, repo,
      { listActive: jest.fn(async () => products), getActiveById: jest.fn(async (id: string) => products.find((p) => p.id === id)!), findActive: jest.fn() } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId: null, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote: jest.fn() } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
  }

  const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

  it('three genuinely concurrent turns: A commits, B loses twice (real 2nd collision), C commits mid-retry -- B degrades safely, A+C survive intact, nothing crashes or corrupts', async () => {
    const conversationId = `a38-3way-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112277', provider: 'mock' } });

    const serviceOthers = buildService(realRepository); // A and C run against the plain real repo

    const built = await serviceOthers.process({ conversationId, phone: '573001112277', message: 'Dame un combo 2x1, lo recojo y pago allá', actor });
    expect(built.nextAction).toBe('READY_TO_CONFIRM');
    expect(built.state.draftVersion).toBe(1);

    // Turn B's own pinned-stale read: captured now, BEFORE Turn A ever commits.
    const staleBaseline = await realRepository.loadState(conversationId);

    // Turn A commits for real: v1 -> v2.
    const turnA = await serviceOthers.process({ conversationId, phone: '573001112277', message: 'También quiero una Coca Cola', actor });
    expect(turnA.state.draftVersion).toBe(2);

    // Arm the injector: the FIRST time Turn B's recoverDraftConflict() reads the fresh draft version
    // (v2, right after Turn A), fire a REAL Turn C write that advances v2 -> v3 before Turn B's retry
    // ever gets to save -- guaranteeing Turn B's retry CAS is stale too.
    let turnCResult: Awaited<ReturnType<typeof serviceOthers.process>> | null = null;
    repository.arm(built.state.draftId!, async () => {
      turnCResult = await serviceOthers.process({ conversationId, phone: '573001112277', message: 'También quiero una limonada', actor });
    });

    // Turn B: pin its OWN loadState() read to the pre-Turn-A baseline by constructing its own state
    // manually via a repository whose loadState is stubbed once. Simplest: use a small local wrapper.
    const pinnedOnceRepo: CommercialRepository = {
      loadState: (() => {
        let used = false;
        return async (id: string) => {
          if (!used) { used = true; return staleBaseline; }
          return repository.loadState(id);
        };
      })(),
      saveState: (s) => repository.saveState(s),
      saveDraft: (i) => repository.saveDraft(i),
      confirmDraft: (i) => repository.confirmDraft(i),
      loadDraftVersion: (id) => repository.loadDraftVersion(id),
      loadConfirmedDraftRecord: (id) => repository.loadConfirmedDraftRecord(id),
      loadStateForUpdate: (id) => repository.loadStateForUpdate(id),
    };
    const serviceBPinned = buildService(pinnedOnceRepo);

    let turnBResult: Awaited<ReturnType<typeof serviceBPinned.process>> | null = null;
    let turnBThrew: unknown = null;
    try {
      turnBResult = await serviceBPinned.process({ conversationId, phone: '573001112277', message: 'También quiero unas papas', actor });
    } catch (error) {
      turnBThrew = error;
    }

    console.log('A38 three-way collision evidence:', JSON.stringify({
      turnBThrew: turnBThrew ? String(turnBThrew) : null,
      turnBNextAction: turnBResult?.nextAction ?? null,
      turnBResponsePurpose: turnBResult?.factEnvelope.responsePurpose ?? null,
      turnCDraftVersion: (turnCResult as Awaited<ReturnType<typeof serviceOthers.process>> | null)?.state.draftVersion ?? null,
    }));

    // PROPERTY 1: never crash. The customer's turn must always get a response, not an uncaught
    // exception (this was the original pre-A36 bug).
    expect(turnBThrew).toBeNull();
    expect(turnBResult).not.toBeNull();

    // PROPERTY 2: never loop / never silently corrupt. A genuine SECOND consecutive collision must
    // fall through to the safe re-sync response, never a third blind retry.
    expect(turnBResult!.nextAction).toBe('READY_TO_CONFIRM');
    expect(turnBResult!.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');

    // PROPERTY 3: no silent data loss for the turns that DID genuinely commit -- Turn A's and Turn C's
    // items must both be intact in the final authoritative draft, and Turn B's own item must simply be
    // absent (not half-applied, not corrupting the others).
    const finalState = await realRepository.loadState(conversationId);
    const finalProducts = finalState!.items.map((i) => i.productId).sort();
    console.log('A38 three-way final state:', JSON.stringify({ finalProducts, finalDraftVersion: finalState!.draftVersion }));
    expect(finalProducts).toEqual(['p1', 'p2', 'p4']); // combo + Turn A's coca-cola + Turn C's limonada
    expect(finalProducts).not.toContain('p3'); // Turn B's papas never silently landed
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a38-3way-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a38-3way-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a38-3way-' } } });
  });
});
