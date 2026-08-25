/**
 * SOFIA Round 5 / A45 BLIND RED TEAM -- fresh, independent attack pass on the A44 closure
 * (`respondDraftAlreadyConfirmed()`'s bounded retry + `SofiaOrderDraft`-reconstruction fallback,
 * plus the new `loadConfirmedDraftRecord()` / `stateFromConfirmedDraftRecord()` methods). This pass
 * had NOT seen any prior design rationale beyond what is in the current source comments.
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
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

describe('A45 BLIND RED TEAM: respondDraftAlreadyConfirmed() retry-exhausted fallback silently destroys already-persisted rich CONFIRMED narration (destinationSnapshot / confidence / intent / lastResolvedIntent / ambiguities)', () => {
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

  it('A45 FINDING: a real, already-durably-persisted destinationSnapshot (GPS coordinate evidence) for a CONFIRMED DELIVERY order is silently wiped to null when a racing turn\'s loadState() retries never catch up and the reconstruction fallback fires', async () => {
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

    // THE FINDING: re-read the TRUE, durable narration straight from Postgres again. It is STILL the
    // SAME confirmed draft (`draftId` unchanged, `confirmationState` still CONFIRMED) -- but the rich
    // destination/coordinate evidence and conversational bookkeeping that were genuinely, durably
    // persisted a moment ago have been silently WIPED by the fallback's neutral-default
    // reconstruction, even though nothing about the true confirmed order actually changed.
    const finalNarration = await realRepository.loadState(conversationId);
    expect(finalNarration?.confirmationState).toBe('CONFIRMED');
    expect(finalNarration?.draftId).toBe(trueDraftId);

    // Real GPS coordinate evidence for a CONFIRMED DELIVERY order, silently destroyed:
    expect(finalNarration?.destinationSnapshot).toBeNull();
    expect(finalNarration?.deliveryQuoteDestinationBinding).toBeNull();

    // Conversational bookkeeping also silently reset, even though the true confirmed turn had
    // resolved, non-neutral values for every one of these:
    expect(finalNarration?.confidence).toBe('LOW');
    expect(finalNarration?.intent).toBe('UNKNOWN');
    expect(finalNarration?.lastResolvedIntent).toBeNull();
    expect(finalNarration?.ambiguities).toEqual([]);

    // The financial authority itself is untouched (as designed) -- but that is exactly why this loss
    // is UNRECOVERABLE: `SofiaOrderDraft` never carried `destinationSnapshot` in the first place.
    const trueDraftRowAfter = await prisma.sofiaOrderDraft.findUnique({ where: { id: trueDraftId } });
    expect(trueDraftRowAfter?.status).toBe('CONFIRMED');
    expect(trueDraftRowAfter?.deliveryAddress).toBe('Calle 80 # 15-30');
  });
});
