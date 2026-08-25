/**
 * A39 (Round 5, blind red team, HIGH) -- PERMANENT REGRESSION of the FIXED behavior, closed by A40.
 *
 * `rebaseTurnOntoFreshState()` intentionally inherits the FRESH authoritative `fulfillment` when THIS
 * turn's own message does not mention fulfillment at all (`parsed.fulfillment` is null) -- see the
 * "FULFILLMENT axis" comment block in `commercial-checkout.service.ts`. That part is correct and is
 * exactly what the A38 CLOSURE doc says it should do.
 *
 * ORIGINAL BUG (A39): the very next block -- the "DESTINATION axis" -- used to run UNCONDITIONALLY
 * whenever `parsed.address || acceptCoordinates` was true, with NO check of what `rebased.fulfillment`
 * had just been set/inherited to:
 *
 *   if (parsed.address || acceptCoordinates) { ... apply THIS turn's own address edit ... }
 *
 * `process()` has the exact analogous ordering (fulfillment block before address block), but there it
 * is safe: both blocks always act on the SAME single message, so a TAKEAWAY-only message never has
 * `parsed.address` truthy for an unrelated address, and an address-only message never touches
 * fulfillment. `rebaseTurnOntoFreshState()` broke that safety: `rebased.fulfillment` can come from a
 * COMPLETELY DIFFERENT, concurrently-committed turn's message (`freshState.fulfillment`), while
 * `parsed`/`acceptCoordinates` still come from THIS turn's own, unrelated message. The two are not
 * guaranteed to be about the same fulfillment decision.
 *
 * ATTACK SCENARIO
 * ----------------
 * Turn 0 (sequential baseline): customer orders a combo for DELIVERY to "Calle 50 # 10-20", pays
 * online -> PENDING draft v1, fulfillment=DELIVERY, address="Calle 50 # 10-20".
 *
 * Two turns then race for the SAME conversation, both reading the SAME `previous` (v1, DELIVERY,
 * "Calle 50 # 10-20") before either commits:
 *   Turn A (wins the race, commits first): "Mejor paso por el local" -- pure fulfillment switch to
 *           TAKEAWAY, no address text, no digits, no quantity words. `process()` correctly clears
 *           address/destinationSnapshot/deliveryFee/binding for this turn -> draft v2, TAKEAWAY,
 *           address=null.
 *   Turn B (loses the race): "Mejor mándalo a la Avenida Central" -- a pure ADDRESS correction. Its
 *           own message contains ZERO fulfillment keywords (`mándalo` does not match the DELIVERY
 *           regex `mandame|mándame|enviame|domicilio|a la casa|me lo mandas|mejor enviamelo` -- verified
 *           against `commercial-intent.engine.ts`), so `parsed.fulfillment` is null for Turn B.
 *
 * Turn B's first CAS attempt (against its own stale v1 snapshot) collides with Turn A's already-
 * committed v2 -> `recoverDraftConflict()` -> `rebaseTurnOntoFreshState()`.
 *
 * ORIGINAL (BUGGY) BEHAVIOR: the retry "succeeded" with `nextAction: 'READY_TO_CONFIRM'` and then
 * `CommercialResponseComposer.compose()` THREW an uncaught `SOFIA_SAFE_TEMPLATE_INVALID:ADDRESS_MISMATCH`
 * -- but only AFTER `persistAndAudit()` had already durably written a self-contradictory hybrid
 * (`fulfillment: 'TAKEAWAY'` + non-null `address`/`destinationSnapshot`) to `sofiaConversationMemory`
 * and `SofiaOrderDraft.deliveryAddress` in Postgres. See git history for the full original write-up.
 *
 * A40 FIX (this spec now asserts the FIXED behavior permanently): the DESTINATION axis in
 * `rebaseTurnOntoFreshState()` is now gated on `rebased.fulfillment === 'DELIVERY'` -- the exact same
 * invariant the TAKEAWAY-clearing branch two lines above already enforces. When THIS turn's own
 * destination edit no longer applies to the fulfillment it was just rebased onto (whether because
 * THIS turn itself just switched to TAKEAWAY, or because a concurrent winner did), the edit is never
 * silently applied NOR silently dropped without a trace: it is recorded as an ambiguity
 * (`'destinationFulfillmentMismatch'`), which makes `rebased.missingFields` non-empty, which makes
 * `recoverDraftConflict()` treat the rebase as NOT safe to hand to `prepareDraft()` and instead fall
 * through to the existing, already-safe `QUOTE_EXPIRED` re-sync response -- reloading the TRUE
 * authoritative (self-consistent) state and asking the customer to confirm/resend, exactly the same
 * "ask again" discipline already used for every other kind of second collision. No inconsistent hybrid
 * is ever handed to `prepareDraft()`, no uncaught exception, no corrupted write.
 *
 * INVARIANT PERMANENTLY ASSERTED BELOW: for a pure address-only stale-baseline retry racing a
 * concurrent TAKEAWAY switch, (1) the customer's turn never throws, (2) the persisted authoritative
 * state is NEVER a TAKEAWAY+address hybrid, and (3) it is instead left exactly as Turn A committed it
 * (TAKEAWAY, address null) -- Turn B's now-inapplicable address text is safely discarded with a
 * recorded ambiguity, not silently merged into a corrupted record.
 *
 * See `commercial-checkout.rebase-fulfillment-matrix.a40.spec.ts` for full combinatorial coverage of
 * every {fresh fulfillment} x {this turn's own parsed delta} pairing that can reach this code path.
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

/** Deterministically pins the NEXT `loadState()` call for a given conversationId to a captured
 * snapshot, then reverts to the real repository for every other call -- identical technique to the
 * A37 permanent regression specs (`commercial-checkout.retry-address-revert.a37.spec.ts` /
 * `commercial-checkout.retry-item-loss.a37.spec.ts`). */
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
  loadStateForUpdate(conversationId: string) { return this.real.loadStateForUpdate(conversationId); }
}

describe('A39/A40: concurrent fulfillment-switch (TAKEAWAY) vs. a stale-baseline address-only retry -- rebaseTurnOntoFreshState() must never produce a TAKEAWAY+address hybrid', () => {
  let prisma: PrismaService;
  let realRepository: PrismaCommercialRepository;
  let repository: PinnedFirstReadRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A39 rebase-fulfillment-hybrid test requires an isolated _test database.');
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
    const products = [combo];
    const responses = new CommercialResponseComposer(
      { compose: jest.fn(async () => null) },
      new CommercialResponseValidator(),
      new SafeCommercialResponseTemplates(),
    );
    const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
    // Only the EXTERNAL delivery-quote provider is doubled (per mission rules). It still creates a REAL
    // audit row via the real prisma client for every quote it computes.
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

  it('Turn A switches to TAKEAWAY and commits; Turn B (stale-baseline, address-only, no fulfillment words) never produces a hybrid -- it fails closed with QUOTE_EXPIRED and leaves Turn A\'s committed TAKEAWAY state untouched', async () => {
    const conversationId = `a39-fulfillhybrid-${randomUUID()}`;
    await prisma.whatsappConversation.create({
      data: { id: conversationId, phone: '573001112288', provider: 'mock' },
    });

    const { service } = buildService();

    // Turn 0: baseline DELIVERY order to "Calle 50 # 10-20", ONLINE payment (valid for BOTH
    // fulfillment types, so a later fulfillment switch cannot itself trip the payment/fulfillment
    // validity guard and short-circuit into an unrelated ambiguity).
    const baseline = await service.process({
      conversationId, phone: '573001112288',
      message: 'Mándame un combo 2x1 a la Calle 50 # 10-20 y pago ya',
      actor,
    });
    expect(baseline.nextAction).toBe('READY_TO_CONFIRM');
    expect(baseline.state.fulfillment).toBe('DELIVERY');
    expect(baseline.state.address).toBe('Calle 50 # 10-20');
    expect(baseline.state.paymentPreference).toBe('ONLINE');
    expect(baseline.state.draftVersion).toBe(1);

    // Capture EXACTLY what a genuinely concurrent Turn B would have read as `previous` had it started
    // before Turn A's fulfillment switch committed.
    const staleBaselineForTurnB = await realRepository.loadState(conversationId);
    expect(staleBaselineForTurnB).not.toBeNull();
    expect(staleBaselineForTurnB!.fulfillment).toBe('DELIVERY');

    // Turn A runs to completion (real, sequential, commits first): pure fulfillment switch to
    // TAKEAWAY. No address text, no digits, no quantity words in this message.
    const takeaway = await service.process({
      conversationId, phone: '573001112288',
      message: 'Mejor paso por el local',
      actor,
    });
    expect(takeaway.nextAction).toBe('READY_TO_CONFIRM');
    expect(takeaway.state.fulfillment).toBe('TAKEAWAY');
    expect(takeaway.state.address).toBeNull();
    expect(takeaway.state.destinationSnapshot).toBeNull();
    expect(takeaway.state.draftVersion).toBe(2);

    // Sanity: the fulfillment switch really is durable right now, before Turn B ever runs.
    const afterTakeaway = await realRepository.loadState(conversationId);
    expect(afterTakeaway!.fulfillment).toBe('TAKEAWAY');
    expect(afterTakeaway!.address).toBeNull();

    // Turn B: pin its `loadState()` read to the PRE-Turn-A baseline (exactly what an actually
    // concurrent read would have returned), then let it run for real against the REAL repository for
    // every write and every CAS/recovery path. Turn B's own message is a PURE address correction --
    // "mándalo" does NOT match the DELIVERY fulfillment regex (only "mándame"/"mandame" do), so
    // `parsed.fulfillment` is null for this turn. No digits, no quantity words either, so this
    // isolates the fulfillment/destination hybrid from the unrelated street-number-as-quantity
    // ambiguity that would otherwise also fire on a numbered address.
    repository.pinNextRead(conversationId, staleBaselineForTurnB!);
    let addressOnlyTurn: Awaited<ReturnType<typeof service.process>> | null = null;
    let addressOnlyTurnThrew: unknown = null;
    try {
      addressOnlyTurn = await service.process({
        conversationId, phone: '573001112288',
        message: 'Mejor mándalo a la Avenida Central',
        actor,
      });
    } catch (error) {
      addressOnlyTurnThrew = error;
    }

    console.log('A40 fix evidence (immediate turn result):', JSON.stringify({
      threw: addressOnlyTurnThrew ? String(addressOnlyTurnThrew) : null,
      nextAction: addressOnlyTurn?.nextAction ?? null,
      responsePurpose: addressOnlyTurn?.factEnvelope.responsePurpose ?? null,
      fulfillment: addressOnlyTurn?.state.fulfillment ?? null,
      address: addressOnlyTurn?.state.address ?? null,
    }));

    // FIXED BEHAVIOR (A40): the customer's turn NEVER throws. `rebaseTurnOntoFreshState()` detects
    // that the fresh fulfillment it just inherited (TAKEAWAY) no longer admits Turn B's own stale
    // destination edit, records that as an ambiguity instead of applying it, which makes
    // `recoverDraftConflict()` fall through to the existing safe `QUOTE_EXPIRED` re-sync response
    // instead of a corrupted "success".
    expect(addressOnlyTurnThrew).toBeNull();
    expect(addressOnlyTurn).not.toBeNull();
    expect(addressOnlyTurn!.nextAction).toBe('READY_TO_CONFIRM');
    expect(addressOnlyTurn!.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
    // The response reflects Turn A's true, self-consistent, already-committed state -- NOT a hybrid.
    expect(addressOnlyTurn!.state.fulfillment).toBe('TAKEAWAY');
    expect(addressOnlyTurn!.state.address).toBeNull();
    expect(addressOnlyTurn!.state.destinationSnapshot).toBeNull();

    // Reload ground truth from Postgres via the REAL, unmocked repository. PROOF that the durable
    // state was NEVER corrupted: it is exactly Turn A's committed TAKEAWAY/no-address state, byte
    // for byte -- Turn B's now-inapplicable address text was safely discarded (with a recorded
    // ambiguity in-memory for this turn), never silently merged into a persisted hybrid.
    const finalState = await realRepository.loadState(conversationId);
    const finalDraft = await prisma.sofiaOrderDraft.findUnique({ where: { id: finalState!.draftId! } });

    console.log('A40 fix evidence (authoritative persisted state):', JSON.stringify({
      fulfillment: finalState!.fulfillment,
      address: finalState!.address,
      addressConfirmed: finalState!.addressConfirmed,
      destinationSnapshotPresent: finalState!.destinationSnapshot !== null,
      draftVersion: finalState!.draftVersion,
      draftFulfillmentColumn: finalDraft?.fulfillment,
      draftDeliveryAddressColumn: finalDraft?.deliveryAddress,
      draftDeliveryFee: finalDraft?.deliveryFee?.toString(),
      draftDeliveryQuoteAuditId: finalDraft?.deliveryQuoteAuditId,
    }));

    // PERMANENT INVARIANT: never TAKEAWAY-with-a-destination.
    expect(finalState!.fulfillment).toBe('TAKEAWAY');
    expect(finalState!.address).toBeNull();
    expect(finalState!.addressConfirmed).toBe(false);
    expect(finalState!.destinationSnapshot).toBeNull();
    expect(finalState!.location).toBeNull();
    // The rebase attempt must not have produced any additional draft write at all -- still v2, the
    // exact version Turn A committed.
    expect(finalState!.draftVersion).toBe(2);
    expect(finalDraft?.fulfillment).toBe('TAKEAWAY');
    expect(finalDraft?.deliveryAddress).toBeNull();
    expect(finalDraft?.deliveryFee?.toString()).toBe('0');
    expect(finalDraft?.deliveryQuoteAuditId).toBeNull();
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a39-fulfillhybrid-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a39-fulfillhybrid-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a39-fulfillhybrid-' } } });
  });
});
