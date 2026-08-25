/**
 * A40 CLOSURE (Round 5) -- COMBINATORIAL regression matrix for `rebaseTurnOntoFreshState()`.
 *
 * Context: A36 -> A37 -> A38 -> A39 was a chain of THREE consecutive rounds where a fix for one bug in
 * this exact retry/rebase mechanism (`recoverDraftConflict()` / `rebaseTurnOntoFreshState()`)
 * introduced a new one. A39 (HIGH) found that the DESTINATION axis inside `rebaseTurnOntoFreshState()`
 * ran unconditionally regardless of what the FULFILLMENT axis had just resolved to a few lines above,
 * producing an internally-contradictory `TAKEAWAY` + non-null `address`/`destinationSnapshot` hybrid
 * whenever a stale-baseline, fulfillment-silent retry rebased onto a freshly, concurrently TAKEAWAY-
 * switched conversation. A40 fixed it by gating the destination block on
 * `rebased.fulfillment === 'DELIVERY'` and recording an ambiguity (forcing the existing safe
 * `QUOTE_EXPIRED` fallback) instead of silently applying or silently dropping an inapplicable edit.
 *
 * Given the track record of this exact mechanism, this spec does NOT stop at re-testing the one
 * reported scenario. It exhaustively covers every {fresh authoritative fulfillment} x {this turn's own
 * parsed delta} pairing named in the A40 mission brief that can plausibly reach the rebase path, and
 * asserts, for EVERY combination, that the final PERSISTED state is internally consistent:
 *   - never `TAKEAWAY` with a non-null `address` / `destinationSnapshot` / `location`.
 *   - never `DELIVERY` with a null `address` (would mean no destination to route to at all).
 *   - the customer's turn never throws (`CommercialResponseComposer` never sees an inconsistent fact
 *     envelope to crash on).
 *   - a legitimate combined/overriding turn (this turn's OWN explicit fulfillment decision, with or
 *     without its own address) always wins regardless of what the fresh state says -- the A40 fix must
 *     not become so conservative that it blocks turns that are entirely self-consistent.
 *
 * MATRIX (2 fresh fulfillment states x 6 own-turn delta shapes = 12 scenarios):
 *
 *   fresh=DELIVERY (Calle 50 # 10-20)      fresh=TAKEAWAY (no address)
 *   ----------------------------------      ----------------------------------
 *   1. address-only                         7. address-only
 *   2. coordinates-only                     8. coordinates-only
 *   3. items-only                           9. items-only
 *   4. payment-only                        10. payment-only
 *   5. fulfillment-only (-> TAKEAWAY)      11. fulfillment-only (-> DELIVERY, no address)
 *   6. fulfillment+address combined        12. fulfillment+address combined
 *      (-> DELIVERY, new address)              (-> DELIVERY, new address)
 *
 * Each scenario is driven end-to-end against a REAL, unmocked Postgres + `PrismaCommercialRepository`
 * (only the external delivery-quote provider is doubled, per mission rules), using the same
 * `PinnedFirstReadRepository` stale-read simulation technique as the A37/A38/A39 permanent regressions.
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

class PinnedFirstReadRepository implements CommercialRepository {
  private pinned: Map<string, CommercialConversationState> = new Map();
  constructor(private readonly real: PrismaCommercialRepository) {}
  pinNextRead(conversationId: string, state: CommercialConversationState) {
    this.pinned.set(conversationId, state);
  }
  async loadState(conversationId: string) {
    const pin = this.pinned.get(conversationId);
    if (pin) {
      this.pinned.delete(conversationId);
      return pin;
    }
    return this.real.loadState(conversationId);
  }
  saveState(state: CommercialConversationState) { return this.real.saveState(state); }
  saveDraft(input: Parameters<CommercialRepository['saveDraft']>[0]) { return this.real.saveDraft(input); }
  confirmDraft(input: Parameters<CommercialRepository['confirmDraft']>[0]) { return this.real.confirmDraft(input); }
  loadDraftVersion(draftId: string) { return this.real.loadDraftVersion(draftId); }
  loadConfirmedDraftRecord(draftId: string) { return this.real.loadConfirmedDraftRecord(draftId); }
}

const NEAR = { latitude: 6.244, longitude: -75.581 };

describe('A40: rebaseTurnOntoFreshState() combinatorial matrix -- fresh fulfillment x this-turn own delta', () => {
  let prisma: PrismaService;
  let realRepository: PrismaCommercialRepository;
  let repository: PinnedFirstReadRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A40 rebase-fulfillment-matrix test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    realRepository = new PrismaCommercialRepository(prisma);
    repository = new PinnedFirstReadRepository(realRepository);
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
    const coke = {
      id: 'p2', code: 'COCA-COLA', name: 'Coca Cola', description: 'Gaseosa', imageUrl: null,
      category: { id: 'cat2', name: 'Bebidas', slug: 'bebidas' }, kind: 'STOCKED' as const, persistedPrice: 5000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const products = [combo, coke];
    const responses = new CommercialResponseComposer(
      { compose: jest.fn(async () => null) },
      new CommercialResponseValidator(),
      new SafeCommercialResponseTemplates(),
    );
    const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
    const quote = jest.fn(async (input: { latitude?: number; longitude?: number; addressText?: string; orderSubtotal: number }) => {
      const hasCoords = input.latitude != null && input.longitude != null;
      const finalFee = hasCoords ? 5000 : 0;
      const audit = await prisma.deliveryPricingAudit.create({
        data: {
          requestJson: { addressText: input.addressText ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, orderSubtotal: input.orderSubtotal },
          resultJson: { status: hasCoords ? 'AUTO_PRICED' : 'LOCAL_FREE', finalFee },
          finalFee,
          calculationVersion: '2x1-delivery-pricing-v1',
        },
      });
      return {
        auditId: audit.id,
        status: hasCoords ? 'AUTO_PRICED' : 'LOCAL_FREE',
        finalFee,
        currency: 'COP' as const,
        distanceKm: hasCoords ? 3 : 0,
        estimatedMinutes: 25,
        reasonCode: hasCoords ? 'AUTO_PRICED' : 'LOCAL_FREE',
        calculationVersion: '2x1-delivery-pricing-v1',
        canCheckout: true,
      };
    });
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), new CommercialMetricsService(), responses,
      repository as unknown as never,
      { listActive: jest.fn(async () => products), getActiveById: jest.fn(async (id: string) => products.find((p) => p.id === id)!), findActive: jest.fn() } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId: null, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service };
  }

  const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

  /** Asserts the persisted state is never an internally-contradictory hybrid, regardless of whether
   * this scenario is expected to succeed (READY_TO_CONFIRM/SUMMARIZE_DRAFT) or fail closed
   * (QUOTE_EXPIRED, "ask again"). */
  function assertConsistent(state: CommercialConversationState) {
    // TAKEAWAY must NEVER carry a destination -- unconditionally, in every reachable conversation
    // state (this is the exact A39 finding). A pickup order has no destination, full stop.
    if (state.fulfillment === 'TAKEAWAY') {
      expect(state.address).toBeNull();
      expect(state.destinationSnapshot).toBeNull();
      expect(state.location).toBeNull();
    }
    // DELIVERY-without-an-address is only a violation once a draft has actually been PREPARED/PRICED
    // (`confirmationState === 'PENDING'`) -- `policy.missing()` already guarantees `prepareDraft()`
    // itself can never be reached with `fulfillment === 'DELIVERY' && !address`. A conversation
    // legitimately, momentarily sits in "customer picked DELIVERY, hasn't given an address yet"
    // (`confirmationState === 'NONE'`, `lastQuestionPurpose === 'DELIVERY_ADDRESS'`) while SOFIA is
    // actively asking for it -- that is NOT a hybrid, it is the ordinary ASK_MISSING flow.
    if (state.fulfillment === 'DELIVERY' && state.confirmationState === 'PENDING') {
      expect(state.address).not.toBeNull();
    }
  }

  type Scenario = {
    name: string;
    freshFulfillment: 'DELIVERY' | 'TAKEAWAY';
    turnBMessage: string;
    turnBLocation?: { latitude: number; longitude: number };
    expect: (result: { threw: unknown; turn: Awaited<ReturnType<CommercialCheckoutService['process']>> | null; finalState: CommercialConversationState }) => void;
  };

  const scenarios: Scenario[] = [
    // ---- fresh = DELIVERY (Calle 50 # 10-20) ------------------------------------------------------
    {
      name: '1. DELIVERY fresh x address-only -> address applies, stays DELIVERY',
      freshFulfillment: 'DELIVERY',
      turnBMessage: 'Mejor mándalo a la Avenida Central',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(finalState.fulfillment).toBe('DELIVERY');
        expect(finalState.address).toBe('Avenida Central');
      },
    },
    {
      name: '2. DELIVERY fresh x coordinates-only -> GPS binds to current address, stays DELIVERY',
      freshFulfillment: 'DELIVERY',
      turnBMessage: 'Mejor te comparto la ubicación',
      turnBLocation: NEAR,
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(finalState.fulfillment).toBe('DELIVERY');
        expect(finalState.address).toBe('Calle 50 # 10-20');
        expect(finalState.location).toEqual(NEAR);
      },
    },
    {
      name: '3. DELIVERY fresh x items-only -> item list updates, destination untouched',
      freshFulfillment: 'DELIVERY',
      turnBMessage: 'También quiero una Coca Cola',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(finalState.fulfillment).toBe('DELIVERY');
        expect(finalState.address).toBe('Calle 50 # 10-20');
        expect(finalState.items.some((item) => item.productId === 'p2')).toBe(true);
      },
    },
    {
      name: '4. DELIVERY fresh x payment-only -> fresh DELIVERY destination/binding stays intact (symmetric case explicitly called out in the A40 brief)',
      freshFulfillment: 'DELIVERY',
      turnBMessage: 'Pago ya',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(finalState.fulfillment).toBe('DELIVERY');
        expect(finalState.address).toBe('Calle 50 # 10-20');
        expect(finalState.destinationSnapshot).not.toBeNull();
        expect(finalState.paymentPreference).toBe('ONLINE');
      },
    },
    {
      name: '5. DELIVERY fresh x fulfillment-only (-> TAKEAWAY) -> own turn wins, destination cleared, no hybrid',
      freshFulfillment: 'DELIVERY',
      turnBMessage: 'Mejor paso por el local',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(finalState.fulfillment).toBe('TAKEAWAY');
        expect(finalState.address).toBeNull();
      },
    },
    {
      name: '6. DELIVERY fresh x fulfillment+address combined (-> DELIVERY, new address) -> own explicit combined decision wins',
      freshFulfillment: 'DELIVERY',
      turnBMessage: 'Mejor mándamelo a la Avenida Central',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(finalState.fulfillment).toBe('DELIVERY');
        expect(finalState.address).toBe('Avenida Central');
      },
    },
    // ---- fresh = TAKEAWAY (no address) -------------------------------------------------------------
    {
      name: '7. TAKEAWAY fresh x address-only -> A39 core finding: address must NOT apply, fails closed',
      freshFulfillment: 'TAKEAWAY',
      turnBMessage: 'Mejor mándalo a la Avenida Central',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(turn!.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
        expect(finalState.fulfillment).toBe('TAKEAWAY');
        expect(finalState.address).toBeNull();
      },
    },
    {
      name: '8. TAKEAWAY fresh x coordinates-only -> GPS must NOT apply, fails closed',
      freshFulfillment: 'TAKEAWAY',
      turnBMessage: 'Mejor te comparto la ubicación',
      turnBLocation: NEAR,
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(turn!.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
        expect(finalState.fulfillment).toBe('TAKEAWAY');
        expect(finalState.address).toBeNull();
        expect(finalState.location).toBeNull();
      },
    },
    {
      name: '9. TAKEAWAY fresh x items-only -> item list updates normally, still TAKEAWAY, no address',
      freshFulfillment: 'TAKEAWAY',
      turnBMessage: 'También quiero una Coca Cola',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(finalState.fulfillment).toBe('TAKEAWAY');
        expect(finalState.address).toBeNull();
        expect(finalState.items.some((item) => item.productId === 'p2')).toBe(true);
      },
    },
    {
      name: '10. TAKEAWAY fresh x payment-only -> unaffected, still TAKEAWAY, no address',
      freshFulfillment: 'TAKEAWAY',
      turnBMessage: 'Pago ya',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(finalState.fulfillment).toBe('TAKEAWAY');
        expect(finalState.address).toBeNull();
        expect(finalState.paymentPreference).toBe('ONLINE');
      },
    },
    {
      name: '11. TAKEAWAY fresh x fulfillment-only (own turn restates DELIVERY, no NEW address given -- its stale-baseline address gets orphaned by a concurrent TAKEAWAY switch) -> must fail closed, never persist DELIVERY-with-no-address',
      freshFulfillment: 'TAKEAWAY',
      // Turn B's OWN message merely reaffirms DELIVERY (matching what IT still believes, from its
      // stale DELIVERY+address baseline) without repeating the address -- entirely ordinary from the
      // customer's point of view, since as far as they know nothing about the address changed. This
      // is a DIFFERENT trap than scenarios 7/8 (own destination edit orphaned): here `rebased
      // .fulfillment` ends up DELIVERY (THIS turn's own explicit, genuine choice -- not silently
      // inherited), but `rebased.address` is null because the FRESH state a concurrent winner just
      // committed (TAKEAWAY) had cleared it. Proves `policy.missing()`'s pre-existing "DELIVERY needs
      // an address" check independently guards this exact corner, with no reliance on the A40
      // destination-axis guard at all (parsed.address is null here, so that guard never even fires).
      turnBMessage: 'Mándame por favor',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(turn!.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
        // The authoritative persisted state must remain exactly what Turn A committed (TAKEAWAY, no
        // address) -- NEVER a half-switched DELIVERY-with-no-destination record.
        expect(finalState.fulfillment).toBe('TAKEAWAY');
        expect(finalState.address).toBeNull();
      },
    },
    {
      name: '12. TAKEAWAY fresh x fulfillment+address combined (-> DELIVERY, new address) -> own explicit combined decision wins even over a TAKEAWAY fresh state',
      freshFulfillment: 'TAKEAWAY',
      turnBMessage: 'Mejor mándamelo a la Avenida Central',
      expect: ({ threw, turn, finalState }) => {
        expect(threw).toBeNull();
        expect(turn!.nextAction).toBe('READY_TO_CONFIRM');
        expect(finalState.fulfillment).toBe('DELIVERY');
        expect(finalState.address).toBe('Avenida Central');
      },
    },
  ];

  it.each(scenarios.map((s) => [s.name, s] as const))('%s', async (_name, scenario) => {
    const conversationId = `a40-matrix-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112299', provider: 'mock' } });

    const { service } = buildService();

    // Turn 0: ALWAYS establish a DELIVERY-with-address baseline, uniformly, regardless of the
    // scenario's target FRESH fulfillment. This is deliberate: it guarantees Turn B's OWN first
    // (stale-baseline) attempt never trips `policy.missing()`'s unrelated "DELIVERY needs an address"
    // check on its own (which would short-circuit into ASK_MISSING before ever reaching
    // `prepareDraft()`/the CAS conflict at all, for the fulfillment-only-to-DELIVERY sub-case) --
    // every scenario below is guaranteed to reach a REAL version-CAS conflict and genuinely exercise
    // `rebaseTurnOntoFreshState()`, not just structurally avoid needing to.
    const baseline = await service.process({
      conversationId, phone: '573001112299',
      message: 'Mándame un combo 2x1 a la Calle 50 # 10-20 y pago ya',
      actor,
    });
    expect(baseline.nextAction).toBe('READY_TO_CONFIRM');
    expect(baseline.state.fulfillment).toBe('DELIVERY');
    expect(baseline.state.address).toBe('Calle 50 # 10-20');
    expect(baseline.state.draftVersion).toBe(1);

    // Capture EXACTLY what a genuinely concurrent Turn B would have read as `previous`, BEFORE the
    // concurrent "Turn A" winner below ever commits.
    const staleBaselineForTurnB = await realRepository.loadState(conversationId);
    expect(staleBaselineForTurnB).not.toBeNull();

    // Turn A (real, sequential, commits first): drives the conversation to the scenario's target
    // FRESH fulfillment -- either a neutral "dos combos" quantity bump that keeps DELIVERY/address
    // intact, or an explicit switch to TAKEAWAY (clearing address/destination, exactly like the A39
    // attack's Turn A) -- exactly what a genuinely concurrent, unrelated winner looks like from Turn
    // B's point of view.
    const turnAMessage = scenario.freshFulfillment === 'DELIVERY' ? 'Mejor dos combos' : 'Mejor paso por el local';
    const bump = await service.process({ conversationId, phone: '573001112299', message: turnAMessage, actor });
    expect(bump.nextAction).toBe('READY_TO_CONFIRM');
    expect(bump.state.fulfillment).toBe(scenario.freshFulfillment);
    expect(bump.state.draftVersion).toBeGreaterThan(1);

    // Turn B: pin its `loadState()` read to the PRE-bump baseline, then run for real against the REAL
    // repository for every write and every CAS/recovery path.
    repository.pinNextRead(conversationId, staleBaselineForTurnB!);
    let turn: Awaited<ReturnType<typeof service.process>> | null = null;
    let threw: unknown = null;
    try {
      turn = await service.process({
        conversationId, phone: '573001112299',
        message: scenario.turnBMessage,
        actor,
        ...(scenario.turnBLocation ? { location: scenario.turnBLocation } : {}),
      });
    } catch (error) {
      threw = error;
    }

    const finalState = await realRepository.loadState(conversationId);
    expect(finalState).not.toBeNull();

    // Universal invariants for EVERY combination, regardless of the scenario-specific expectation.
    assertConsistent(finalState!);

    scenario.expect({ threw, turn, finalState: finalState! });
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a40-matrix-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a40-matrix-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a40-matrix-' } } });
  });
});
