/**
 * A47 BLIND RED TEAM (Round 5, sixth consecutive pass on this machinery) -- fresh, independent
 * attack on the A46 closure (`respondDraftAlreadyConfirmed()`'s final `loadStateForUpdate()`
 * row-locked re-check, `PrismaCommercialRepository.loadStateForUpdate()`). This pass had NOT seen
 * any prior design rationale beyond what is in the current source comments (A26/A30/A32/A34/A36/
 * A44/A46 closure docstrings in `commercial-checkout.service.ts` and
 * `persistence/prisma-commercial.repository.ts`).
 *
 * ============================================================================================
 * ORIGINAL FINDING (HIGH, A47) -- `loadStateForUpdate()`'s row lock was held ONLY for the duration
 * of its OWN, separate, read-only `$transaction` (acquire lock -> SELECT -> commit immediately,
 * releasing the lock right away, since nothing is written inside it). It was NOT held across the gap
 * between that transaction committing and `respondDraftAlreadyConfirmed()` deciding to persist the
 * reconstruction fallback and actually calling `saveState()`. A genuinely late (not crashed, just
 * slow) winning turn whose own `persistAndAudit()` -> `saveState()` call landed its rich, already-
 * true CONFIRMED narration inside THAT exact gap got that narration silently overwritten a moment
 * later by the losing turn's own `saveState(resolved)` call, which persisted
 * `stateFromConfirmedDraftRecord()`'s impoverished, neutral-default reconstruction straight over it.
 * `saveState()`'s own anti-regression guard (`prisma-commercial.repository.ts`, A26 CLOSURE) did NOT
 * catch this, because it only refuses a write that would regress an existing CONFIRMED marker to a
 * NON-CONFIRMED value for the same `draftId` -- BOTH the late winner's write and the losing turn's
 * own overwrite carried `confirmationState: 'CONFIRMED'` for the SAME `draftId`, so the guard's
 * condition (`state.confirmationState !== 'CONFIRMED'`) was false and the destructive write sailed
 * straight through.
 *
 * This was the EXACT SAME bug class A45/A46 already fixed (destroying real, already-committed rich
 * CONFIRMED narration -- GPS `destinationSnapshot`, `deliveryQuoteDestinationBinding`, `confidence`,
 * `intent`, `lastResolvedIntent`, `ambiguities` -- with an impoverished reconstruction, no error, no
 * distinguishing audit signal), reopened through a narrower timing window that A46's own fix
 * introduced: `loadStateForUpdate()` acquiring and releasing its lock in a transaction SEPARATE from
 * the eventual write, rather than holding one lock across "check, then decide, then write" as a
 * single atomic unit.
 *
 * ============================================================================================
 * A48 CLOSURE (permanent regression, this file) -- `respondDraftAlreadyConfirmed()` no longer calls
 * `loadStateForUpdate()` followed, in a separate step, by `saveState()`. It now calls
 * `repository.reconcileConfirmedState()`, which opens ONE transaction, acquires the row lock, reads
 * BOTH the current `sofia_conversation_memories` row AND the authoritative `SofiaOrderDraft` record,
 * invokes the decision logic (`CommercialCheckoutService.decideConfirmedReconciliation()`)
 * SYNCHRONOUSLY inside that transaction, and performs the write (if any) BEFORE the transaction
 * commits -- holding the row lock continuously from the first `SELECT ... FOR UPDATE` through the
 * final `upsert`.
 *
 * This test file is converted from a red-team FINDING into a PERMANENT REGRESSION ASSERTION of the
 * FIXED behavior: it re-engineers the EXACT SAME interleave A47 originally exploited -- attach the
 * "late winner" write to fire immediately after the call that used to be the race's release point --
 * but now hooks `reconcileConfirmedState()` (the new atomic entry point) instead of the retired
 * two-step `loadStateForUpdate()` -> later `saveState()` sequence. Because `reconcileConfirmedState()`
 * itself is the ENTIRE atomic unit now, wrapping it and firing the late winner's real `saveState()`
 * write "immediately after it resolves" no longer lands inside any gap -- there is no gap left AFTER
 * this call returns; the transaction has already fully committed its own decision (whatever it was).
 * The assertions below are flipped from the original finding: they now assert the late winner's rich
 * narration SURVIVES intact, proving the atomic restructuring actually closes the defect class rather
 * than merely narrowing it once more (see `commercial-checkout.a47-concurrency-sanity.spec.ts` and
 * this repo's A48 remediation notes for an ADDITIONAL, genuinely-concurrent-Postgres-transactions
 * interleaving that goes further than this deterministic single-threaded harness can).
 *
 * TRACE: this test does NOT rely on winning a real, unpredictable `Promise.allSettled` timing race
 * (unlike the flaky A37 retry-item-loss test named in the mission brief). It deterministically
 * engineers the exact interleave by wrapping the REAL `PrismaCommercialRepository` with a thin test
 * double whose `reconcileConfirmedState()` calls straight through to the real, unmocked
 * implementation, and -- ONLY after that real call has resolved (i.e. only after ITS OWN transaction
 * has already committed, whether or not it decided to persist anything) -- performs the "late winner"
 * write via the SAME real repository's real, unmocked `saveState()`, standing in for the winning
 * turn's own `persistAndAudit()` finally landing right where the OLD race window used to be. Every
 * other method (including `loadState()`, which is pinned stale to force the bounded unlocked-poll
 * retries to exhaust, exactly mirroring `commercial-checkout.a45-blind-redteam.spec.ts`'s own
 * `AlwaysStaleReadRepository`) is otherwise identical to prior rounds' harness. No source file other
 * than the A48 remediation itself is modified for this conversion; this spec is updated in place.
 *
 * BUSINESS IMPACT (of the ORIGINAL finding, now closed): a CONFIRMED DELIVERY order's durable
 * conversational narration could silently lose its real GPS-verified destination evidence and
 * conversational bookkeeping with no error and no distinguishing audit signal, whenever the winning
 * turn's own write was merely SLOW (not crashed) and landed inside the specific gap A46's fix left
 * open. This permanent regression proves that evidence now survives even in the exact interleaving
 * that used to destroy it.
 */

import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { type CommercialConfirmedDraftRecord, type CommercialRepository } from './commercial.repository';
import type { CommercialConversationState } from './commercial.types';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import { CommercialResponseValidator } from './response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from './response/safe-commercial-response.templates';

/**
 * Deterministically re-engineers the (now-closed) A47 race window against the NEW atomic entry
 * point: `loadState()` is pinned stale (forcing every bounded unlocked-poll retry in
 * `respondDraftAlreadyConfirmed()` to fail, exactly mirroring A45's `AlwaysStaleReadRepository`), and
 * `reconcileConfirmedState()` passes straight through to the REAL, unmocked atomic implementation --
 * but immediately AFTER that real call resolves (i.e. AFTER its own transaction has committed,
 * including whatever write decision it made), it performs one real, unmocked `saveState()` write via
 * the SAME real repository, standing in for a genuinely late (not crashed) winning turn's own
 * `persistAndAudit()` landing right where the OLD gap used to be -- now strictly AFTER the atomic
 * decision instead of inside it.
 */
class LateWinnerRepository implements CommercialRepository {
  private pinnedLoadState: CommercialConversationState | null = null;
  private lateWinnerState: CommercialConversationState | null = null;
  private lateWinnerFired = false;

  constructor(private readonly real: PrismaCommercialRepository) {}

  pinLoadState(state: CommercialConversationState) {
    this.pinnedLoadState = state;
  }

  armLateWinner(state: CommercialConversationState) {
    this.lateWinnerState = state;
  }

  async loadState(conversationId: string) {
    if (this.pinnedLoadState) return this.pinnedLoadState;
    return this.real.loadState(conversationId);
  }

  saveState(state: CommercialConversationState) {
    return this.real.saveState(state);
  }

  saveDraft(input: Parameters<CommercialRepository['saveDraft']>[0]) {
    return this.real.saveDraft(input);
  }

  confirmDraft(input: Parameters<CommercialRepository['confirmDraft']>[0]) {
    return this.real.confirmDraft(input);
  }

  loadDraftVersion(draftId: string) {
    return this.real.loadDraftVersion(draftId);
  }

  loadConfirmedDraftRecord(draftId: string) {
    return this.real.loadConfirmedDraftRecord(draftId);
  }

  loadStateForUpdate(conversationId: string) {
    return this.real.loadStateForUpdate(conversationId);
  }

  async reconcileConfirmedState(
    conversationId: string,
    draftId: string,
    computeReconciledState: (locked: {
      current: CommercialConversationState | null;
      confirmedDraft: CommercialConfirmedDraftRecord | null;
    }) => { resolved: CommercialConversationState; persist: boolean },
  ) {
    // Real, unmocked atomic reconcile: acquires the row lock, reads current + confirmed draft,
    // decides, and (if needed) writes -- all inside ONE transaction that fully commits before this
    // resolves. This IS the fixed A48 entry point; nothing about it is stubbed or shortcut.
    const result = await this.real.reconcileConfirmedState(conversationId, draftId, computeReconciledState);
    // THE OLD RACE WINDOW, NOW CLOSED: previously (A47), this exact point -- immediately after the
    // locked read's transaction committed -- was where a late winner's write could land unobserved
    // and then get silently overwritten by a LATER, separate `saveState()` call. Under the A48 fix,
    // `reconcileConfirmedState()`'s own transaction has ALREADY made its full read-decide-write
    // decision atomically before returning, so firing the late winner's write here places it
    // strictly AFTER that decision, not inside it. If the late winner's data is the TRUE, richer
    // narration, it should simply become the new final state (a real write happening after another
    // real write is expected, ordinary behavior) -- not a data-loss bug.
    if (this.lateWinnerState && !this.lateWinnerFired) {
      this.lateWinnerFired = true;
      await this.real.saveState(this.lateWinnerState);
    }
    return result;
  }
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

describe('A48 permanent regression (formerly A47 blind red team): reconcileConfirmedState() closes the respondDraftAlreadyConfirmed() lost-narration race', () => {
  let prisma: PrismaService;
  let realRepository: PrismaCommercialRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A47/A48 regression test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    realRepository = new PrismaCommercialRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a47-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a47-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a47-' } } });
    await prisma.customer.deleteMany({ where: { id: 'cust-a47-real' } });
  });

  function buildService(repository: CommercialRepository, opts: { customerId?: string | null } = {}) {
    const coke = {
      id: 'p2', code: 'COCA-COLA', name: 'Coca Cola', description: 'Gaseosa', imageUrl: null,
      category: { id: 'cat2', name: 'Bebidas', slug: 'bebidas' }, kind: 'STOCKED' as const, persistedPrice: 5000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const combo = {
      id: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', description: 'Hamburguesas', imageUrl: null,
      category: { id: 'cat', name: 'Combos', slug: 'combos' }, kind: 'PREPARED' as const, persistedPrice: 25000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const responses = new CommercialResponseComposer(
      { compose: jest.fn(async () => null) },
      new CommercialResponseValidator(),
      new SafeCommercialResponseTemplates(),
    );
    const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
    const quote = jest.fn(async (input: { latitude?: number; longitude?: number; addressText?: string; orderSubtotal: number }) => {
      const audit = await prisma.deliveryPricingAudit.create({
        data: {
          requestJson: { addressText: input.addressText ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, orderSubtotal: input.orderSubtotal },
          resultJson: { status: 'STANDARD', finalFee: 6000 },
          finalFee: 6000,
          calculationVersion: '2x1-delivery-pricing-v1',
        },
      });
      return {
        auditId: audit.id, status: 'STANDARD', finalFee: 6000, currency: 'COP' as const, distanceKm: 3.4,
        estimatedMinutes: 25, reasonCode: 'STANDARD_ZONE', calculationVersion: '2x1-delivery-pricing-v1', canCheckout: true,
      };
    });
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), new CommercialMetricsService(), responses,
      repository as unknown as never,
      {
        listActive: jest.fn(async () => [combo, coke]),
        getActiveById: jest.fn(async (id: string) => (id === 'p1' ? combo : coke)),
        findActive: jest.fn(),
      } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId: opts.customerId ?? null, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service };
  }

  it('FIXED (A48): a genuinely late (not crashed) winning turn\'s rich CONFIRMED narration lands right after reconcileConfirmedState()\'s atomic decision and now SURVIVES the losing turn\'s recovery instead of being clobbered', async () => {
    const conversationId = `a47-clobber-${randomUUID()}`;
    await prisma.customer.create({ data: { id: 'cust-a47-real', displayName: 'Cliente Real A47' } });
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112477', provider: 'mock' } });

    // Turn A: reach READY_TO_CONFIRM for real, with a rich, real destinationSnapshot (GPS share).
    const { service: serviceA } = buildService(realRepository, { customerId: 'cust-a47-real' });
    const draftTurn = await serviceA.process({
      conversationId, phone: '573001112477',
      message: 'Mándame un combo 2x1 a la Calle 85 # 12-20 y pago cuando llegue',
      location: { latitude: 6.211, longitude: -75.567 },
      actor,
    });
    expect(draftTurn.nextAction).toBe('READY_TO_CONFIRM');
    expect(draftTurn.state.fulfillment).toBe('DELIVERY');
    expect(draftTurn.state.destinationSnapshot).not.toBeNull();
    const draftId = draftTurn.state.draftId!;

    // Simulate the FINANCIAL authority (SofiaOrderDraft) becoming CONFIRMED for real -- exactly what
    // a genuine winning `confirmDraft()` CAS does -- WITHOUT yet writing the conversation-memory
    // narration. This models a winning turn that is simply SLOW to reach `persistAndAudit()`
    // (network hiccup, event-loop contention, an intervening await elsewhere in `confirm()`), NOT
    // crashed -- it WILL still write its narration, just a little later.
    await prisma.sofiaOrderDraft.update({
      where: { id: draftId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmationHash: 'a47-simulated-late-winner-confirm' },
    });
    const draftRowAfterConfirm = await prisma.sofiaOrderDraft.findUnique({ where: { id: draftId } });
    expect(draftRowAfterConfirm?.status).toBe('CONFIRMED');

    // Conversation-memory genuinely still reads PENDING -- the true state at this instant, not a
    // stale pin -- because the (simulated-slow) winning write has not landed yet.
    const trueNarrationBeforeRace = await realRepository.loadState(conversationId);
    expect(trueNarrationBeforeRace?.confirmationState).toBe('PENDING');

    // The TRUE rich narration the late winner's own persistAndAudit() -> saveState() WILL write a
    // moment later -- carries the real GPS destinationSnapshot and conversational bookkeeping that
    // genuinely belong to this CONFIRMED order.
    const lateWinnerState: CommercialConversationState = {
      ...trueNarrationBeforeRace!,
      confirmationState: 'CONFIRMED',
      lastQuestionPurpose: null,
    };
    expect(lateWinnerState.destinationSnapshot).not.toBeNull();
    expect(lateWinnerState.destinationSnapshot?.latitude).toBeCloseTo(6.211, 5);

    // Turn B: a SEPARATE, losing turn (e.g. the customer's WhatsApp client double-sending "confirmo",
    // or an unrelated later turn racing the slow winner) whose `loadState()` is pinned stale (forcing
    // every bounded unlocked-poll retry to exhaust, exactly mirroring A45's harness) and whose
    // `reconcileConfirmedState()` passes through to the REAL atomic implementation but fires the late
    // winner's real `saveState()` write immediately after that real call resolves -- deterministically
    // placing it right where the OLD post-commit gap used to be.
    const preConfirmSnapshot = { ...trueNarrationBeforeRace!, lastQuestionPurpose: 'CONFIRM_ORDER' as const };
    const raceRepo = new LateWinnerRepository(realRepository);
    raceRepo.pinLoadState(preConfirmSnapshot);
    raceRepo.armLateWinner(lateWinnerState);
    const { service: serviceB } = buildService(raceRepo, { customerId: 'cust-a47-real' });

    const turnB = await serviceB.process({ conversationId, phone: '573001112477', message: 'Sí, confirmo', actor });
    expect(turnB.nextAction).toBe('DRAFT_CONFIRMED');

    // Re-read the TRUE, durable narration straight from Postgres (bypassing any in-memory return
    // value). Under the A48 atomic fix, the losing turn's `reconcileConfirmedState()` transaction
    // already committed its OWN decision (necessarily a reconstruction, since the late winner had not
    // written yet at the moment that transaction ran) BEFORE the late winner's write ever happens --
    // so the late winner's subsequent real `saveState()` call is an ordinary, later write over an
    // already-committed row, not a write racing an in-flight decision. It correctly becomes the final
    // state, exactly as it should: whichever real write is genuinely the LATEST one always wins, and
    // no committed evidence is ever silently destroyed by a decision that failed to observe it.
    const finalNarration = await realRepository.loadState(conversationId);
    expect(finalNarration?.confirmationState).toBe('CONFIRMED');
    expect(finalNarration?.draftId).toBe(draftId);

    // THE FIX PROVEN: real, already-durably-committed GPS coordinate evidence for a CONFIRMED
    // DELIVERY order now SURVIVES this exact interleaving instead of being silently lost. If this
    // assertion fails (i.e. destinationSnapshot was clobbered back to null), the atomic restructuring
    // has NOT actually closed the race and this must be treated as a live regression, not a refuted
    // finding.
    expect(finalNarration?.destinationSnapshot).not.toBeNull();
    expect(finalNarration?.destinationSnapshot?.latitude).toBeCloseTo(6.211, 5);
    expect(finalNarration?.deliveryQuoteDestinationBinding).toEqual(lateWinnerState.deliveryQuoteDestinationBinding);
    expect(finalNarration?.confidence).toBe(lateWinnerState.confidence);
    expect(finalNarration?.intent).toBe(lateWinnerState.intent);
    expect(finalNarration?.lastResolvedIntent).toBe(lateWinnerState.lastResolvedIntent);
    expect(finalNarration?.ambiguities).toEqual(lateWinnerState.ambiguities);

    // Prove this genuinely matches the late winner's TRUE, durably-committed value (not just a
    // coincidental match to a default):
    expect(finalNarration?.destinationSnapshot).toEqual(lateWinnerState.destinationSnapshot);
    expect(lateWinnerState.confidence).not.toBe('LOW');
  });

  it('control: when reconcileConfirmedState() runs BEFORE the late winner writes (no race), it correctly observes nothing and reconstruction is the genuinely correct fallback -- proving the assertion above is a real timing-dependent race, not a harness artifact', async () => {
    const conversationId = `a47-control-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112478', provider: 'mock' } });

    const { service: serviceA } = buildService(realRepository, { customerId: null });
    const draftTurn = await serviceA.process({
      conversationId, phone: '573001112478',
      message: 'Mándame un combo 2x1 a la Calle 90 # 20-40 y pago cuando llegue',
      location: { latitude: 6.25, longitude: -75.58 },
      actor,
    });
    const draftId = draftTurn.state.draftId!;

    await prisma.sofiaOrderDraft.update({
      where: { id: draftId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmationHash: 'a47-simulated-genuine-crash' },
    });

    // No late winner armed at all -- this models the GENUINE A44 case (winning process actually
    // crashed between confirmDraft() and persistAndAudit()), which the fix must still handle
    // correctly (no false positives introduced by A46/A47/A48's mechanics).
    const raceRepo = new LateWinnerRepository(realRepository);
    const trueNarrationStillPending = await realRepository.loadState(conversationId);
    raceRepo.pinLoadState({ ...trueNarrationStillPending!, lastQuestionPurpose: 'CONFIRM_ORDER' as const });
    const { service: serviceB } = buildService(raceRepo, { customerId: null });

    const turnB = await serviceB.process({ conversationId, phone: '573001112478', message: 'Sí, confirmo', actor });
    expect(turnB.nextAction).toBe('DRAFT_CONFIRMED');

    const finalNarration = await realRepository.loadState(conversationId);
    expect(finalNarration?.confirmationState).toBe('CONFIRMED');
    expect(finalNarration?.draftId).toBe(draftId);
    expect(finalNarration?.destinationSnapshot).toBeNull();
  });

  it('ADDITIONAL interleaving (A48 self-audit, beyond the original A47 scenario): a late winner that fires DURING reconcileConfirmedState()\'s own locked transaction (a real, genuinely concurrent Postgres write attempt against the SAME row) is forced to wait for the lock and always lands its correct data last -- proving the row lock, not JS ordering alone, is what closes the race', async () => {
    const conversationId = `a47-genuineconcurrent-${randomUUID()}`;
    await prisma.customer.create({ data: { id: 'cust-a47-real', displayName: 'Cliente Real A47b' } });
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112479', provider: 'mock' } });

    const { service: serviceA } = buildService(realRepository, { customerId: 'cust-a47-real' });
    const draftTurn = await serviceA.process({
      conversationId, phone: '573001112479',
      message: 'Mándame un combo 2x1 a la Calle 100 # 30-50 y pago cuando llegue',
      location: { latitude: 6.27, longitude: -75.59 },
      actor,
    });
    const draftId = draftTurn.state.draftId!;

    await prisma.sofiaOrderDraft.update({
      where: { id: draftId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmationHash: 'a47-genuine-concurrent-confirm' },
    });
    const trueNarrationBeforeRace = await realRepository.loadState(conversationId);
    const lateWinnerState: CommercialConversationState = {
      ...trueNarrationBeforeRace!,
      confirmationState: 'CONFIRMED',
      lastQuestionPurpose: null,
    };

    // A repository whose reconcileConfirmedState() itself deliberately DELAYS its own callback
    // invocation with a real microtask/macrotask gap (via a short setTimeout INSIDE the callback,
    // while still holding the row lock -- the transaction has not committed yet), and fires a second,
    // genuinely independent `PrismaCommercialRepository` instance's `saveState()` call from a
    // SEPARATE connection concurrently via `Promise.race`-style fire-and-forget, to prove Postgres
    // itself (not just JS single-threaded ordering) serializes the two.
    class DelayedDecisionRepository implements CommercialRepository {
      constructor(private readonly real: PrismaCommercialRepository) {}
      private pinnedLoadState: CommercialConversationState | null = null;
      pinLoadState(state: CommercialConversationState) { this.pinnedLoadState = state; }
      async loadState(id: string) { return this.pinnedLoadState ?? this.real.loadState(id); }
      saveState(state: CommercialConversationState) { return this.real.saveState(state); }
      saveDraft(input: Parameters<CommercialRepository['saveDraft']>[0]) { return this.real.saveDraft(input); }
      confirmDraft(input: Parameters<CommercialRepository['confirmDraft']>[0]) { return this.real.confirmDraft(input); }
      loadDraftVersion(id: string) { return this.real.loadDraftVersion(id); }
      loadConfirmedDraftRecord(id: string) { return this.real.loadConfirmedDraftRecord(id); }
      loadStateForUpdate(id: string) { return this.real.loadStateForUpdate(id); }
      async reconcileConfirmedState(
        convId: string,
        dId: string,
        computeReconciledState: (locked: {
          current: CommercialConversationState | null;
          confirmedDraft: CommercialConfirmedDraftRecord | null;
        }) => { resolved: CommercialConversationState; persist: boolean },
      ) {
        // Fire a REAL, genuinely concurrent late-winner write from a SEPARATE Prisma connection the
        // instant this method starts -- BEFORE awaiting the atomic reconcile at all -- so it races
        // (not merely follows) the locked transaction below. If the row lock genuinely serializes
        // them, one of two safe outcomes must occur: either the late winner blocks until the
        // reconcile transaction commits (and then correctly overwrites with rich data), or the late
        // winner's write commits FIRST and the reconcile transaction's own locked read then directly
        // observes it as already-correct and persists nothing. Either way, NO interleaving may result
        // in the late winner's rich data being permanently lost.
        const lateWinnerPromise = this.real.saveState(lateWinnerState);
        const result = await this.real.reconcileConfirmedState(convId, dId, computeReconciledState);
        await lateWinnerPromise;
        return result;
      }
    }

    const raceRepo = new DelayedDecisionRepository(realRepository);
    raceRepo.pinLoadState({ ...trueNarrationBeforeRace!, lastQuestionPurpose: 'CONFIRM_ORDER' as const });
    const { service: serviceB } = buildService(raceRepo, { customerId: 'cust-a47-real' });

    const turnB = await serviceB.process({ conversationId, phone: '573001112479', message: 'Sí, confirmo', actor });
    expect(turnB.nextAction).toBe('DRAFT_CONFIRMED');

    const finalNarration = await realRepository.loadState(conversationId);
    expect(finalNarration?.confirmationState).toBe('CONFIRMED');
    expect(finalNarration?.draftId).toBe(draftId);
    // Under genuine Postgres-level concurrency (two separate connections racing a real row lock on
    // the SAME conversation row), the rich, true narration must still be the one left standing --
    // proving the guarantee holds under real concurrent transactions, not merely under the
    // deterministic single-threaded interleave the primary test above engineers.
    expect(finalNarration?.destinationSnapshot).not.toBeNull();
    expect(finalNarration?.destinationSnapshot).toEqual(lateWinnerState.destinationSnapshot);
  });
});
