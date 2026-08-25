/**
 * A47 BLIND RED TEAM (Round 5, sixth consecutive pass on this machinery) -- fresh, independent
 * attack on the A46 closure (`respondDraftAlreadyConfirmed()`'s final `loadStateForUpdate()`
 * row-locked re-check, `PrismaCommercialRepository.loadStateForUpdate()`). This pass had NOT seen
 * any prior design rationale beyond what is in the current source comments (A26/A30/A32/A34/A36/
 * A44/A46 closure docstrings in `commercial-checkout.service.ts` and
 * `persistence/prisma-commercial.repository.ts`).
 *
 * ============================================================================================
 * FINDING (HIGH) -- `loadStateForUpdate()`'s row lock is held ONLY for the duration of its OWN,
 * separate, read-only `$transaction` (acquire lock -> SELECT -> commit immediately, releasing the
 * lock right away, since nothing is written inside it). It is NOT held across the gap between that
 * transaction committing and `respondDraftAlreadyConfirmed()` deciding to persist the
 * reconstruction fallback and actually calling `saveState()`. A genuinely late (not crashed, just
 * slow) winning turn whose own `persistAndAudit()` -> `saveState()` call lands its rich, already-
 * true CONFIRMED narration inside THIS exact gap gets that narration silently overwritten a moment
 * later by the losing turn's own `saveState(resolved)` call, which persists
 * `stateFromConfirmedDraftRecord()`'s impoverished, neutral-default reconstruction straight over it.
 * `saveState()`'s own anti-regression guard (`prisma-commercial.repository.ts`, A26 CLOSURE) does
 * NOT catch this, because it only refuses a write that would regress an existing CONFIRMED marker
 * to a NON-CONFIRMED value for the same `draftId` -- here BOTH the late winner's write and the
 * losing turn's own overwrite carry `confirmationState: 'CONFIRMED'` for the SAME `draftId`, so the
 * guard's condition (`state.confirmationState !== 'CONFIRMED'`) is false and the destructive write
 * sails straight through.
 *
 * This is the EXACT SAME bug class A45/A46 already fixed (destroying real, already-committed rich
 * CONFIRMED narration -- GPS `destinationSnapshot`, `deliveryQuoteDestinationBinding`, `confidence`,
 * `intent`, `lastResolvedIntent`, `ambiguities` -- with an impoverished reconstruction, no error, no
 * distinguishing audit signal), reopened through a NEW, narrower timing window that A46's own fix
 * introduced: `loadStateForUpdate()` acquiring and releasing its lock in a transaction SEPARATE from
 * the eventual write, rather than holding one lock across "check, then decide, then write" as a
 * single atomic unit. A46's docstring frames the locked re-check as closing the race
 * ("eliminating the ... gap a bounded unlocked poll cannot close") -- this test proves it only
 * NARROWS the window from ~100ms (4 retries * 25ms) down to the single async gap between
 * `loadStateForUpdate()` resolving and `saveState(resolved)` being called; it does not close it.
 *
 * TRACE: this test does NOT rely on winning a real, unpredictable `Promise.allSettled` timing race
 * (unlike the flaky A37 retry-item-loss test named in the mission brief). It deterministically
 * engineers the exact interleave by wrapping the REAL `PrismaCommercialRepository` with a thin test
 * double whose `loadStateForUpdate()` calls straight through to the real, unmocked implementation,
 * and -- ONLY after that real call has resolved (i.e. only after its own transaction has already
 * committed and released the row lock) -- performs the "late winner" write via the SAME real
 * repository's real, unmocked `saveState()`, standing in for the winning turn's own
 * `persistAndAudit()` finally landing in that exact gap. Every other method (including `loadState()`,
 * which is pinned stale to force the bounded unlocked-poll retries to exhaust, exactly mirroring
 * `commercial-checkout.a45-blind-redteam.spec.ts`'s own `AlwaysStaleReadRepository`) is otherwise
 * identical to prior rounds' harness. No source file is modified; only this new spec file is added.
 *
 * BUSINESS IMPACT: identical to A45's -- a CONFIRMED DELIVERY order's durable conversational
 * narration can silently lose its real GPS-verified destination evidence and conversational
 * bookkeeping with no error and no distinguishing audit signal, whenever the winning turn's own
 * write is merely SLOW (not crashed) and lands inside the specific gap A46's fix left open. Any
 * operator/support/audit tooling reading `sofia_conversation_memories.currentOrderIntentJson` for a
 * CONFIRMED delivery order sees a clean but WRONG "no destination snapshot" state for an order that,
 * moments earlier, genuinely and durably had one -- and the TRUE evidence is unrecoverable once
 * overwritten (the `SofiaOrderDraft` row was never asked to carry it in the first place, by A44's
 * own design).
 */

import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { type CommercialRepository } from './commercial.repository';
import type { CommercialConversationState } from './commercial.types';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import { CommercialResponseValidator } from './response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from './response/safe-commercial-response.templates';

/**
 * Deterministically engineers the A47 race window: `loadState()` is pinned stale (forcing every
 * bounded unlocked-poll retry in `respondDraftAlreadyConfirmed()` to fail, exactly mirroring A45's
 * `AlwaysStaleReadRepository`), and `loadStateForUpdate()` passes straight through to the REAL,
 * unmocked locked-read implementation -- but immediately AFTER that real call resolves (i.e. AFTER
 * its own transaction has committed and released the row lock), it performs one real, unmocked
 * `saveState()` write via the SAME real repository, standing in for a genuinely late (not crashed)
 * winning turn's own `persistAndAudit()` landing in exactly the gap between the lock being released
 * and `respondDraftAlreadyConfirmed()` deciding what to persist.
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

  async loadStateForUpdate(conversationId: string) {
    // Real, unmocked locked read: acquires the row lock, reads, and its transaction commits
    // (releasing the lock) the instant this resolves -- exactly A46's actual implementation.
    const result = await this.real.loadStateForUpdate(conversationId);
    // THE RACE WINDOW: the lock is now released. A genuinely late (not crashed) winning turn's own
    // `persistAndAudit()` -> `saveState()` lands its rich, TRUE CONFIRMED narration right here --
    // AFTER the locked check already committed its (accurate-at-the-time) "not yet observed" read,
    // and BEFORE the caller (`respondDraftAlreadyConfirmed()`) has decided to reconstruct + persist.
    if (this.lateWinnerState && !this.lateWinnerFired) {
      this.lateWinnerFired = true;
      await this.real.saveState(this.lateWinnerState);
    }
    return result;
  }
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

describe('A47 blind red team: loadStateForUpdate() narrows but does not close the respondDraftAlreadyConfirmed() lost-narration race', () => {
  let prisma: PrismaService;
  let realRepository: PrismaCommercialRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A47 red-team test requires an isolated _test database.');
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

  it('FINDING: a genuinely late (not crashed) winning turn\'s rich CONFIRMED narration lands inside loadStateForUpdate()\'s post-commit gap and is silently clobbered by the losing turn\'s own reconstruction-fallback saveState() call', async () => {
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
    // `loadStateForUpdate()` passes through to the REAL locked-read implementation but fires the late
    // winner's real `saveState()` write immediately after that real call resolves -- deterministically
    // landing it inside the exact post-commit gap A46's fix leaves open.
    const preConfirmSnapshot = { ...trueNarrationBeforeRace!, lastQuestionPurpose: 'CONFIRM_ORDER' as const };
    const raceRepo = new LateWinnerRepository(realRepository);
    raceRepo.pinLoadState(preConfirmSnapshot);
    raceRepo.armLateWinner(lateWinnerState);
    const { service: serviceB } = buildService(raceRepo, { customerId: 'cust-a47-real' });

    const turnB = await serviceB.process({ conversationId, phone: '573001112477', message: 'Sí, confirmo', actor });
    expect(turnB.nextAction).toBe('DRAFT_CONFIRMED');

    // Re-read the TRUE, durable narration straight from Postgres (bypassing any in-memory return
    // value). If A46's fix genuinely closed the race, the late winner's rich narration (written
    // DURABLY and CORRECTLY inside the gap) should have survived. It does not: the losing turn's own
    // `saveState(resolved)` call, executed AFTER the late winner's commit, unconditionally overwrites
    // it with `stateFromConfirmedDraftRecord()`'s impoverished neutral-default reconstruction, because
    // `saveState()`'s anti-regression guard only blocks CONFIRMED -> non-CONFIRMED regressions for the
    // same draftId, not a CONFIRMED(rich) -> CONFIRMED(impoverished) overwrite.
    const finalNarration = await realRepository.loadState(conversationId);
    expect(finalNarration?.confirmationState).toBe('CONFIRMED');
    expect(finalNarration?.draftId).toBe(draftId);

    // THE FINDING: real, already-durably-committed GPS coordinate evidence for a CONFIRMED DELIVERY
    // order is silently lost. If this assertion fails (i.e. destinationSnapshot survived), the race
    // has genuinely been closed and this finding should be treated as refuted, not confirmed.
    expect(finalNarration?.destinationSnapshot).toBeNull();
    expect(finalNarration?.deliveryQuoteDestinationBinding).toBeNull();
    expect(finalNarration?.confidence).toBe('LOW');
    expect(finalNarration?.intent).toBe('UNKNOWN');
    expect(finalNarration?.lastResolvedIntent).toBeNull();
    expect(finalNarration?.ambiguities).toEqual([]);

    // Prove this genuinely diverges from the late winner's TRUE, durably-committed value (not just
    // "reset to defaults" by coincidence of the fixture):
    expect(finalNarration?.destinationSnapshot).not.toEqual(lateWinnerState.destinationSnapshot);
    expect(lateWinnerState.confidence).not.toBe('LOW');
  });

  it('control: when loadStateForUpdate() is called BEFORE the late winner writes (no race), it correctly observes nothing and reconstruction is the genuinely correct fallback -- proving the finding above is a real timing-dependent race, not a harness artifact', async () => {
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
    // correctly (no false positives introduced by A46/A47's mechanics).
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
});
