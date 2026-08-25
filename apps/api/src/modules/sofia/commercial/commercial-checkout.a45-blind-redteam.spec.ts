/**
 * SOFIA Round 5 / A46 CLOSURE (A45 blind red-team finding, HIGH) -- PERMANENT REGRESSION TEST.
 *
 * This file originally documented and reproduced the A45 finding below (`respondDraftAlreadyConfirmed()`'s
 * retry-exhausted fallback silently wiping an already-durably-persisted, rich CONFIRMED narration --
 * `destinationSnapshot`, `deliveryQuoteDestinationBinding`, `confidence`, `intent`, `lastResolvedIntent`,
 * `ambiguities` -- whenever the calling turn's `loadState()` reads, including every bounded retry, simply
 * never observed a commit that had, in fact, already landed). The finding is now FIXED
 * (`commercial-checkout.service.ts::respondDraftAlreadyConfirmed()` +
 * `PrismaCommercialRepository.loadStateForUpdate()`): after the bounded unlocked-poll retry budget is
 * exhausted, the method now performs ONE final LOCKED re-check (`loadStateForUpdate()`, the exact same
 * `SELECT ... FOR UPDATE` row-lock discipline `saveState()` itself uses to serialize concurrent writers)
 * before ever concluding the rich narration genuinely never existed. A locked read forces real
 * serialization against any concurrent committer -- it either observes the true, already-committed value
 * immediately, or blocks until a still-in-flight concurrent write commits and THEN observes it -- closing
 * the exact gap a bare polling `SELECT` cannot close. The test below is KEPT and UPDATED (not
 * deleted/weakened) to assert the FIXED behavior permanently: the real, already-committed
 * `destinationSnapshot` (with its GPS coordinate evidence), `deliveryQuoteDestinationBinding`,
 * `confidence`, `intent`, `lastResolvedIntent` and `ambiguities` must now all SURVIVE correctly even when
 * `loadState()`'s bare read (and every one of its bounded retries) loses the race against a winning
 * concurrent turn. A second test below proves the fix does not regress A43/A44's own genuine-reconstruction
 * case: when the rich narration truly was never persisted (the winning process crashed between
 * `confirmDraft()` and `persistAndAudit()`), the locked check correctly ALSO fails to observe it, and
 * `stateFromConfirmedDraftRecord()`'s neutral-default reconstruction fallback still correctly fires.
 *
 * ============================================================================================
 * ORIGINAL A45 BLIND RED TEAM (Round 5, closing pass) TRACE -- kept for historical/audit record.
 * ============================================================================================
 * fresh, independent attack pass on the A44 closure (`respondDraftAlreadyConfirmed()`'s bounded retry +
 * `SofiaOrderDraft`-reconstruction fallback, plus the `loadConfirmedDraftRecord()` /
 * `stateFromConfirmedDraftRecord()` methods). This pass had NOT seen any prior design rationale beyond
 * what is in the current source comments.
 *
 * ============================================================================================
 * FINDING (HIGH) -- `respondDraftAlreadyConfirmed()`'s retry-exhausted reconstruction fallback
 * unconditionally OVERWRITES an already-durably-persisted, RICH, correct CONFIRMED narration with
 * an impoverished neutral-default reconstruction, whenever the calling turn's `loadState()` reads
 * (including every bounded retry) fail to observe a commit that has, in fact, ALREADY landed (or
 * lands moments later) -- silently destroying real, previously-persisted evidence for a CONFIRMED
 * DELIVERY order (`destinationSnapshot` with its GPS coordinate evidence, `deliveryQuoteDestination
 * Binding`, `confidence`, `intent`, `lastResolvedIntent`, `ambiguities`) with no error and no audit
 * signal distinguishing "reconstructed from truth because nothing else was ever written" from
 * "clobbered real, richer evidence that already existed".
 * ============================================================================================
 *
 * TRACE:
 *
 * A44's own docstring (`commercial-checkout.service.ts`, `RESPOND_ALREADY_CONFIRMED_MAX_RETRIES`
 * comment) frames the retry+fallback design around ONE specific pathological case: "the winning
 * process crashing between `confirmDraft()` and `persistAndAudit()`" -- i.e. the fallback is meant
 * to kick in only when the rich narration was NEVER written at all, in which case reconstructing
 * from `SofiaOrderDraft` with neutral defaults for non-financial fields is the best available truth
 * and loses nothing that ever existed.
 *
 * But the actual code cannot distinguish that case from a much more mundane one: the WINNING turn's
 * `saveState()` call DID complete (or is about to complete) with the full, rich narration, but THIS
 * caller's own `loadState()` reads simply never observe it within the retry budagt (4 attempts *
 * 25ms = 100ms total) -- e.g. connection-pool visibility lag, a slow/loaded DB, or (worse) a
 * genuinely stale read path (a read replica, a caching layer, or simply an unlucky interleaving
 * where every one of the 5 total reads samples a moment strictly before the winning commit even
 * though the commit itself lands only slightly later than the retry window). `respondDraftAlready
 * Confirmed()` has NO way to tell these two situations apart, and `stateFromConfirmedDraftRecord()`
 * always produces a state with `confirmationState: 'CONFIRMED'` -- so `saveState()`'s own
 * anti-regression guard (`prisma-commercial.repository.ts`, A26 CLOSURE: "never let a write regress
 * an already-persisted CONFIRMED marker ... back to a non-CONFIRMED value") does NOT protect
 * against this at all, because the fallback's own `resolved.confirmationState` is ALSO
 * `'CONFIRMED'`. The guard's condition (`state.confirmationState !== 'CONFIRMED'`) is false, so the
 * write sails through unmodified, silently overwriting whatever the true winning turn had already
 * (or will have) persisted with the impoverished reconstruction.
 *
 * Concretely: a real customer sends a DELIVERY order with a real textual address AND a live GPS
 * share. `applyDestinationEdit()` builds a real `destinationSnapshot` (coordinate trust HIGH, real
 * lat/long) that gets correctly carried through `prepareDraft()` -> `persistAndAudit()` ->
 * `confirm()` -> the TRUE confirmed narration in `sofia_conversation_memories`. This is proven
 * durable truth, not a hypothetical in-flight value -- it is fully committed to Postgres BEFORE any
 * racing turn even runs. A second turn (e.g. the customer's WhatsApp client double-sending the
 * confirmation, or an unrelated later turn on the same conversation racing a slow write elsewhere)
 * whose OWN `loadState()` happens to be stale for the whole retry window (this test pins it,
 * standing in for the real-world lag `loadDraftVersion()`'s own docstring names) falls all the way
 * through to `stateFromConfirmedDraftRecord()`, which -- per its own docstring -- resets
 * `destinationSnapshot`, `deliveryQuoteDestinationBinding`, `confidence`, `intent`,
 * `lastResolvedIntent` and `ambiguities` to `emptyState()`'s neutral defaults "because they are not
 * financially binding". `saveState()` then persists this straight over the TRUE, already-landed
 * rich narration, wiping real GPS coordinate evidence for a CONFIRMED DELIVERY order that a moment
 * ago was correctly and durably recorded.
 *
 * This is the exact class of bug A44 itself was supposed to close ("narration/memory never
 * diverging from actual confirmed OR pending canonical state"; "no silent loss ... of
 * confirmed-or-pending evidence under any writer or retry/recovery path") -- A44's own regression
 * test (`commercial-checkout.a43-blind-redteam.spec.ts`) proves `customerId`/`handoffState`/
 * `consentState` survive, but never asserts on `destinationSnapshot` (or `confidence`/`intent`/
 * `lastResolvedIntent`/`ambiguities`), and the fix's own design (reconstruct-from-`SofiaOrderDraft`)
 * is architecturally INCAPABLE of preserving them even when the true value they should have kept
 * already exists, durably, in the very same database, the very same row, mere moments before this
 * fallback's own `saveState()` call executes.
 *
 * BUSINESS IMPACT: a CONFIRMED DELIVERY order's durable conversational narration can silently lose
 * its real GPS-verified destination evidence (and other conversational truth) with no error, no
 * distinguishing audit signal, and no way to recover it (the true SofiaOrderDraft row was never
 * asked to carry this evidence in the first place -- by design, per A44's own docstring -- so once
 * the narration copy is wiped, it is gone). Any operator/support/audit tooling that reads
 * `sofia_conversation_memories.currentOrderIntentJson.destinationSnapshot` for a CONFIRMED delivery
 * (e.g. to see exactly what coordinate evidence the customer's order was actually confirmed
 * against, for a dispute or a courier-routing sanity check) sees a clean but WRONG "no destination
 * snapshot" state for an order that, moments earlier, genuinely had one.
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
 * Simulates a reader whose `loadState()` calls never observe a concurrent winner's commit --
 * standing in for the real-world race `loadDraftVersion()`'s own docstring names (connection-pool
 * visibility lag / a still-in-flight winning transaction / plain scheduling), deterministically
 * rather than fighting real timing. Every OTHER method passes straight through to the REAL,
 * unmocked `PrismaCommercialRepository`.
 */
class AlwaysStaleReadRepository implements CommercialRepository {
  private pinned: Map<string, CommercialConversationState> = new Map();
  constructor(private readonly real: PrismaCommercialRepository) {}
  pin(conversationId: string, state: CommercialConversationState) {
    this.pinned.set(conversationId, state);
  }
  async loadState(conversationId: string) {
    const pin = this.pinned.get(conversationId);
    if (pin) return pin;
    return this.real.loadState(conversationId);
  }
  saveState(state: CommercialConversationState) { return this.real.saveState(state); }
  saveDraft(input: Parameters<CommercialRepository['saveDraft']>[0]) { return this.real.saveDraft(input); }
  confirmDraft(input: Parameters<CommercialRepository['confirmDraft']>[0]) { return this.real.confirmDraft(input); }
  loadDraftVersion(draftId: string) { return this.real.loadDraftVersion(draftId); }
  loadConfirmedDraftRecord(draftId: string) { return this.real.loadConfirmedDraftRecord(draftId); }
  // SOFIA Round 5 / A46 CLOSURE: deliberately NOT pinned/stale, same as `loadConfirmedDraftRecord()`
  // above -- a `SELECT ... FOR UPDATE` locked read cannot be served from a stale replica/cache by
  // construction (Postgres does not allow taking a row lock against anything but the primary), so a
  // reader whose bare `loadState()` is persistently stale would still observe truth here. This is
  // exactly the real-world distinction the fix relies on: passing this through to the REAL repository
  // models that correctly, rather than "gaming" this test double.
  loadStateForUpdate(conversationId: string) { return this.real.loadStateForUpdate(conversationId); }
  reconcileConfirmedState(conversationId: string, draftId: string, computeReconciledState: Parameters<CommercialRepository['reconcileConfirmedState']>[2]) { return this.real.reconcileConfirmedState(conversationId, draftId, computeReconciledState); }
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

describe('A46 CLOSURE (A45 blind red-team finding, HIGH, permanent regression): respondDraftAlreadyConfirmed() never destroys already-persisted rich CONFIRMED narration (destinationSnapshot / confidence / intent / lastResolvedIntent / ambiguities), even when every bounded unlocked retry loses the race', () => {
  let prisma: PrismaService;
  let realRepository: PrismaCommercialRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A45 red-team test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    realRepository = new PrismaCommercialRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a45-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a45-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a45-' } } });
    await prisma.customer.deleteMany({ where: { id: 'cust-a45-real' } });
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

  it('A46 CLOSURE (FIXED): a real, already-durably-persisted destinationSnapshot (GPS coordinate evidence) for a CONFIRMED DELIVERY order SURVIVES even when a racing turn\'s loadState() retries never catch up -- the final locked re-check observes the true committed narration instead of reconstructing over it', async () => {
    const conversationId = `a45-clobber-${randomUUID()}`;
    await prisma.customer.create({ data: { id: 'cust-a45-real', displayName: 'Cliente Real A45' } });
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112399', provider: 'mock' } });

    // Turn A: the REAL, canonical flow. A customer with a resolved CRM identity places a DELIVERY
    // order with BOTH a textual address AND a live GPS share, producing a rich `destinationSnapshot`
    // (coordinate trust HIGH, real lat/long) that is carried through to the confirmed draft.
    const { service: serviceA } = buildService(realRepository, { customerId: 'cust-a45-real' });
    const draftTurn = await serviceA.process({
      conversationId, phone: '573001112399',
      message: 'Mándame un combo 2x1 a la Calle 80 # 15-30 y pago cuando llegue',
      location: { latitude: 6.244203, longitude: -75.581212 },
      actor,
    });
    expect(draftTurn.nextAction).toBe('READY_TO_CONFIRM');
    expect(draftTurn.state.fulfillment).toBe('DELIVERY');
    expect(draftTurn.state.destinationSnapshot).not.toBeNull();
    expect(draftTurn.state.destinationSnapshot?.latitude).toBeCloseTo(6.244203, 5);
    expect(draftTurn.state.destinationSnapshot?.longitude).toBeCloseTo(-75.581212, 5);

    // Turn A actually confirms for real -- the true, authoritative, FULLY DURABLE commercial record,
    // including its rich `destinationSnapshot`. This is not a hypothetical in-flight value: by the
    // time this `await` resolves, `saveState()`'s transaction has already committed.
    const confirmed = await serviceA.process({ conversationId, phone: '573001112399', message: 'Sí, confirmo', actor });
    expect(confirmed.nextAction).toBe('DRAFT_CONFIRMED');
    expect(confirmed.state.confirmationState).toBe('CONFIRMED');

    const trueDraftId = confirmed.state.draftId!;
    const trueDraftRow = await prisma.sofiaOrderDraft.findUnique({ where: { id: trueDraftId } });
    expect(trueDraftRow?.status).toBe('CONFIRMED');

    // Independently re-read the durable narration straight from Postgres (bypassing any in-memory
    // return value) to prove the rich destinationSnapshot is genuinely, durably persisted BEFORE any
    // racing turn even starts.
    const trueNarrationBeforeRace = await realRepository.loadState(conversationId);
    expect(trueNarrationBeforeRace?.confirmationState).toBe('CONFIRMED');
    expect(trueNarrationBeforeRace?.destinationSnapshot).not.toBeNull();
    expect(trueNarrationBeforeRace?.destinationSnapshot?.latitude).toBeCloseTo(6.244203, 5);
    expect(trueNarrationBeforeRace?.destinationSnapshot?.longitude).toBeCloseTo(-75.581212, 5);
    expect(trueNarrationBeforeRace?.deliveryQuoteDestinationBinding).not.toBeNull();
    expect(trueNarrationBeforeRace?.confidence).not.toBe('LOW');
    expect(trueNarrationBeforeRace?.intent).not.toBe('UNKNOWN');
    expect(trueNarrationBeforeRace?.lastResolvedIntent).not.toBeNull();

    // Turn B: a SEPARATE service instance whose `loadState()` NEVER observes Turn A's already-landed
    // commit -- not just once, but for EVERY read, including all of `respondDraftAlreadyConfirmed()`'s
    // bounded retries (A44 CLOSURE). This models a reader that is stale for the whole retry window
    // (connection-pool visibility lag / a stale replica / plain unlucky scheduling) EVEN THOUGH the
    // true rich narration is, in fact, already fully committed in the very same database.
    // `loadDraftVersion()` (the deliberately race-proof financial-authority read) still correctly and
    // truthfully reports CONFIRMED, exactly as it would in the real race -- which is precisely what
    // routes this turn into `respondDraftAlreadyConfirmed()`'s reconstruction fallback.
    const preConfirmSnapshot = { ...trueNarrationBeforeRace!, confirmationState: 'PENDING' as const, lastQuestionPurpose: 'CONFIRM_ORDER' as const };
    const staleRepo = new AlwaysStaleReadRepository(realRepository);
    staleRepo.pin(conversationId, preConfirmSnapshot);
    const { service: serviceB } = buildService(staleRepo, { customerId: 'cust-a45-real' });

    const turnB = await serviceB.process({ conversationId, phone: '573001112399', message: 'Sí, confirmo', actor });
    expect(turnB.nextAction).toBe('DRAFT_CONFIRMED');

    // THE FIX: re-read the TRUE, durable narration straight from Postgres again. It is STILL the SAME
    // confirmed draft (`draftId` unchanged, `confirmationState` still CONFIRMED) -- AND the rich
    // destination/coordinate evidence and conversational bookkeeping that were genuinely, durably
    // persisted a moment ago now correctly SURVIVE, because the final locked re-check
    // (`loadStateForUpdate()`) observed the true committed narration instead of the reconstruction
    // fallback firing on a false "nothing else was ever written" premise.
    const finalNarration = await realRepository.loadState(conversationId);
    expect(finalNarration?.confirmationState).toBe('CONFIRMED');
    expect(finalNarration?.draftId).toBe(trueDraftId);

    // Real GPS coordinate evidence for a CONFIRMED DELIVERY order, correctly PRESERVED:
    expect(finalNarration?.destinationSnapshot).not.toBeNull();
    expect(finalNarration?.destinationSnapshot?.latitude).toBeCloseTo(6.244203, 5);
    expect(finalNarration?.destinationSnapshot?.longitude).toBeCloseTo(-75.581212, 5);
    expect(finalNarration?.deliveryQuoteDestinationBinding).not.toBeNull();
    expect(finalNarration?.deliveryQuoteDestinationBinding).toEqual(trueNarrationBeforeRace?.deliveryQuoteDestinationBinding);

    // Conversational bookkeeping also correctly PRESERVED, matching exactly what the true confirmed
    // turn had actually resolved -- never reset to neutral defaults and never overwritten with any
    // stale/pinned value either:
    expect(finalNarration?.confidence).toBe(trueNarrationBeforeRace?.confidence);
    expect(finalNarration?.confidence).not.toBe('LOW');
    expect(finalNarration?.intent).toBe(trueNarrationBeforeRace?.intent);
    expect(finalNarration?.intent).not.toBe('UNKNOWN');
    expect(finalNarration?.lastResolvedIntent).toBe(trueNarrationBeforeRace?.lastResolvedIntent);
    expect(finalNarration?.lastResolvedIntent).not.toBeNull();
    expect(finalNarration?.ambiguities).toEqual(trueNarrationBeforeRace?.ambiguities);

    // The financial authority remains untouched, exactly as before -- and now the narration copy
    // genuinely matches it instead of diverging into a clean-but-wrong impoverished reconstruction.
    const trueDraftRowAfter = await prisma.sofiaOrderDraft.findUnique({ where: { id: trueDraftId } });
    expect(trueDraftRowAfter?.status).toBe('CONFIRMED');
    expect(trueDraftRowAfter?.deliveryAddress).toBe('Calle 80 # 15-30');
  });

  it('A46 CLOSURE regression guard: when the rich narration GENUINELY was never persisted (the winning process crashed between confirmDraft() and persistAndAudit()), the new locked re-check also correctly fails to observe it, and stateFromConfirmedDraftRecord()\'s neutral-default reconstruction fallback still correctly fires -- proving the fix does not regress A43/A44\'s original closure', async () => {
    const conversationId = `a45-genuine-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112400', provider: 'mock' } });

    // Turn A: reach READY_TO_CONFIRM for real (draft + PENDING conversation-memory narration both
    // genuinely persisted, including a real destinationSnapshot).
    const { service: serviceA } = buildService(realRepository, { customerId: null });
    const draftTurn = await serviceA.process({
      conversationId, phone: '573001112400',
      message: 'Mándame un combo 2x1 a la Calle 90 # 20-40 y pago cuando llegue',
      location: { latitude: 6.25, longitude: -75.58 },
      actor,
    });
    expect(draftTurn.nextAction).toBe('READY_TO_CONFIRM');
    const draftId = draftTurn.state.draftId!;

    // Simulate the exact pathological case A44's own docstring names: the winning process's
    // `confirmDraft()` CAS succeeds (the financial authority, `SofiaOrderDraft`, is genuinely
    // CONFIRMED) but it crashes BEFORE `persistAndAudit()` -> `saveState()` ever runs -- so the
    // conversation-memory narration genuinely, permanently never observes the confirmation. Applied
    // directly at the Postgres level (bypassing `confirmDraft()`'s own CAS plumbing) to model this
    // deterministically rather than trying to kill a process mid-flight.
    await prisma.sofiaOrderDraft.update({
      where: { id: draftId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmationHash: 'a46-simulated-crash-confirmation' },
    });
    const draftRowAfterSimulatedConfirm = await prisma.sofiaOrderDraft.findUnique({ where: { id: draftId } });
    expect(draftRowAfterSimulatedConfirm?.status).toBe('CONFIRMED');

    // The conversation-memory row still genuinely reads PENDING -- this is the TRUE state, not a stale
    // pin -- because the (simulated-crashed) winning write never touched it.
    const trueNarrationStillPending = await realRepository.loadState(conversationId);
    expect(trueNarrationStillPending?.confirmationState).toBe('PENDING');

    // Turn B: a plain, non-stale service instance (real repository throughout, no pinning at all)
    // sends "Sí, confirmo". `confirmDraft()`'s own CAS fails (the draft is no longer READY_TO_CONFIRM),
    // routing this into `recoverStaleConfirmation()` -> `respondDraftAlreadyConfirmed()`. Both the
    // bounded unlocked-poll retries AND the new locked re-check correctly observe the TRUE state
    // (genuinely still PENDING, not CONFIRMED) every single time, because there is truly nothing else
    // to observe -- proving the locked check does not create any false positives of its own.
    const { service: serviceB } = buildService(realRepository, { customerId: null });
    const turnB = await serviceB.process({ conversationId, phone: '573001112400', message: 'Sí, confirmo', actor });
    expect(turnB.nextAction).toBe('DRAFT_CONFIRMED');

    // The reconstruction fallback correctly fires: the persisted narration is now CONFIRMED, sourced
    // from the authoritative `SofiaOrderDraft` row, with neutral defaults for the fields that record
    // genuinely never carried -- exactly A43/A44's original, still-correct behavior for this genuine
    // case.
    const finalNarration = await realRepository.loadState(conversationId);
    expect(finalNarration?.confirmationState).toBe('CONFIRMED');
    expect(finalNarration?.draftId).toBe(draftId);
    expect(finalNarration?.fulfillment).toBe('DELIVERY');
    expect(finalNarration?.address).toBe('Calle 90 # 20-40');
    expect(finalNarration?.destinationSnapshot).toBeNull();
    expect(finalNarration?.deliveryQuoteDestinationBinding).toBeNull();
    expect(finalNarration?.confidence).toBe('LOW');
    expect(finalNarration?.intent).toBe('UNKNOWN');
    expect(finalNarration?.lastResolvedIntent).toBeNull();
    expect(finalNarration?.ambiguities).toEqual([]);
  });
});
