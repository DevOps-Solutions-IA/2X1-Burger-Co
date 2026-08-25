/**
 * A39 (Round 5, blind red team) — NEW FINDING against `rebaseTurnOntoFreshState()` (A38 CLOSURE).
 *
 * `rebaseTurnOntoFreshState()` intentionally inherits the FRESH authoritative `fulfillment` when THIS
 * turn's own message does not mention fulfillment at all (`parsed.fulfillment` is null) — see the
 * "FULFILLMENT axis" comment block in `commercial-checkout.service.ts`. That part is correct and is
 * exactly what the A38 CLOSURE doc says it should do.
 *
 * BUT the very next block — the "DESTINATION axis" — runs UNCONDITIONALLY whenever
 * `parsed.address || acceptCoordinates` is true, with NO check of what `rebased.fulfillment` was just
 * set/inherited to:
 *
 *   if (parsed.address || acceptCoordinates) {
 *     ...
 *     const { snapshot } = applyDestinationEdit(this.baselineDestinationSnapshot(rebased), destinationEdit);
 *     rebased.destinationSnapshot = snapshot;
 *     rebased.address = snapshot.referenceText;
 *     rebased.addressConfirmed = Boolean(snapshot.referenceText);
 *     ...
 *   }
 *
 * `process()` has the exact analogous ordering (fulfillment block before address block), but there it
 * is safe: both blocks act on the SAME single message, so a TAKEAWAY-only message never has
 * `parsed.address` truthy for an unrelated address, and an address-only message never touches
 * fulfillment. `rebaseTurnOntoFreshState()` breaks that safety: `rebased.fulfillment` can now come from
 * a COMPLETELY DIFFERENT, concurrently-committed turn's message (`freshState.fulfillment`), while
 * `parsed`/`acceptCoordinates` still come from THIS turn's own, unrelated message. The two are no
 * longer guaranteed to be about the same fulfillment decision.
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
 * EXPECTED (per the fix's own stated intent): Turn B has no opinion on fulfillment, so it should
 * inherit the FRESH, correct TAKEAWAY fulfillment Turn A just committed -- and, having no delivery
 * destination to speak of anymore, Turn B's own stray address text should either be rejected/ignored
 * or the retry should fail closed (ask again), NOT silently attach a "delivery address" to a takeaway
 * order.
 *
 * ACTUAL (proven below against REAL Postgres + the REAL, unmocked `PrismaCommercialRepository`): the
 * retry "succeeds" with `nextAction: 'READY_TO_CONFIRM'`, and the final authoritative
 * `sofiaConversationMemory` / `SofiaOrderDraft` rows are left in a self-contradictory hybrid state:
 * `fulfillment: 'TAKEAWAY'` (correctly inherited from Turn A) together with a non-null
 * `address` / `destinationSnapshot` / `addressConfirmed: true` (Turn B's own stale-turn contribution,
 * applied on top with no regard for the fulfillment it was just rebased onto). `SofiaOrderDraft
 * .deliveryAddress` persists this exact contradiction: a TAKEAWAY (pickup) order carrying a stored
 * "delivery address" and `deliveryFee: 0` / no delivery quote audit at all -- internally inconsistent
 * evidence that nothing downstream re-validates.
 *
 * INVARIANT VIOLATED
 * -------------------
 * "no inconsistent hybrid state under any writer or retry path" and "narration/memory never diverging
 * from actual confirmed OR pending canonical state" -- explicitly called out as an angle to probe in
 * this round's brief ("could it end up in an inconsistent hybrid (e.g. TAKEAWAY fulfillment but a
 * destinationSnapshot still attached...)"). This is a genuinely NEW angle: A37/A38 were about ONE axis
 * (destination OR items) reverting/being lost; this is TWO axes (fulfillment + destination) ending up
 * mutually inconsistent because they were rebased from two DIFFERENT turns' realities without a
 * cross-axis consistency re-check.
 *
 * BUSINESS IMPACT: operationally confusing/misleading persisted state -- a "pickup" order that still
 * carries a delivery address and `addressConfirmed: true`, which could mislead staff/reporting (e.g. a
 * naive downstream consumer showing "entregar en: Avenida Central" for an order that will never be
 * delivered), and leaves stale destination-revision state attached to a TAKEAWAY conversation that
 * could resurface incorrectly if the customer later switches back to DELIVERY without re-stating an
 * address (see the second assertion block below).
 *
 * SEVERITY: HIGH -- upgraded from an initial MEDIUM (pure data-integrity) assessment once the actual
 * runtime behavior was observed. This hybrid is not merely a silently-tolerated inconsistency: it is
 * severe enough that `CommercialResponseValidator.validate()`'s `ADDRESS_MISMATCH` check (SafeTemplate
 * for a TAKEAWAY `SUMMARIZE_DRAFT` never mentions an address, but `factEnvelope.addressSafe` is
 * non-null because `state.address` is non-null) legitimately fires, and
 * `CommercialResponseComposer.compose()` THROWS (`SOFIA_SAFE_TEMPLATE_INVALID:ADDRESS_MISMATCH`) --
 * see `commercial-checkout.service.ts`'s `respond()` -> `commercial-response.composer.ts:52`.
 *
 * Critically, by the time that throw happens, `process()` has ALREADY called `persistAndAudit(prepared,
 * ...)` (line ~248, BEFORE `return this.respond(...)`) -- so the corrupted hybrid state is durably
 * committed to `sofiaConversationMemory` AND `SofiaOrderDraft` in Postgres, and only THEN does the
 * customer's turn crash with an uncaught exception out of `process()`. This is exactly the failure
 * pattern this program's invariants explicitly prohibit ("no uncaught exceptions on foreseeable
 * business/guard conditions") -- and it is worse than a clean crash: the write already landed, so a
 * caller that retries/resends after seeing the failure resumes from an already-corrupted conversation
 * state, not a clean pre-write one. `financial-safety` is not directly compromised (no delivery fee
 * charged, `draftFulfillment === fulfillment` so A22's binding guard is not fooled, and `confirm()`'s
 * `destinationStillBound` check is short-circuited by `state.fulfillment !== 'DELIVERY'`), but customer
 * turn availability and durable-state integrity both are.
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
}

describe('A39: concurrent fulfillment-switch (TAKEAWAY) vs. a stale-baseline address-only retry -- rebaseTurnOntoFreshState() produces a TAKEAWAY+address hybrid', () => {
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

  it('Turn A switches to TAKEAWAY and commits; Turn B (stale-baseline, address-only, no fulfillment words) rebases into a TAKEAWAY+address hybrid', async () => {
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

    console.log('A39 finding evidence (immediate turn result):', JSON.stringify({
      threw: addressOnlyTurnThrew ? String(addressOnlyTurnThrew) : null,
      nextAction: addressOnlyTurn?.nextAction ?? null,
      responsePurpose: addressOnlyTurn?.factEnvelope.responsePurpose ?? null,
      fulfillment: addressOnlyTurn?.state.fulfillment ?? null,
      address: addressOnlyTurn?.state.address ?? null,
    }));

    // ACTUAL OBSERVED BEHAVIOR: the customer's turn crashes with an UNCAUGHT exception
    // (`SOFIA_SAFE_TEMPLATE_INVALID:ADDRESS_MISMATCH`) rather than returning a graceful response --
    // `CommercialResponseValidator` correctly detects that the composed TAKEAWAY summary text cannot
    // truthfully include `factEnvelope.addressSafe` (a TAKEAWAY summary template never mentions an
    // address) and refuses to render, but `CommercialResponseComposer.compose()` THROWS instead of
    // degrading to a safe fallback -- and this happens strictly AFTER `persistAndAudit()` already
    // committed the corrupted hybrid state to Postgres (see `process()`: persistAndAudit runs BEFORE
    // `respond()`). This assertion documents the actual (worse) behavior; see the block below for the
    // durable-state proof.
    expect(addressOnlyTurnThrew).not.toBeNull();
    expect(String(addressOnlyTurnThrew)).toContain('SOFIA_SAFE_TEMPLATE_INVALID');
    expect(String(addressOnlyTurnThrew)).toContain('ADDRESS_MISMATCH');

    // Reload ground truth from Postgres via the REAL, unmocked repository. PROOF that the hybrid
    // state was durably persisted BEFORE the customer-facing turn crashed -- a caller that catches
    // this exception and simply tells the customer "something went wrong, please try again" resumes
    // from an ALREADY-CORRUPTED conversation state, not a clean one.
    const finalState = await realRepository.loadState(conversationId);
    const finalDraft = await prisma.sofiaOrderDraft.findUnique({ where: { id: finalState!.draftId! } });

    console.log('A39 finding evidence (authoritative persisted state):', JSON.stringify({
      fulfillment: finalState!.fulfillment,
      address: finalState!.address,
      addressConfirmed: finalState!.addressConfirmed,
      destinationSnapshotPresent: finalState!.destinationSnapshot !== null,
      draftFulfillmentColumn: finalDraft?.fulfillment,
      draftDeliveryAddressColumn: finalDraft?.deliveryAddress,
      draftDeliveryFee: finalDraft?.deliveryFee?.toString(),
      draftDeliveryQuoteAuditId: finalDraft?.deliveryQuoteAuditId,
    }));

    if (finalState!.fulfillment === 'TAKEAWAY' && finalState!.address !== null) {
      throw new Error(
        `A39 FINDING CONFIRMED: rebaseTurnOntoFreshState() produced an internally-inconsistent hybrid `
        + `state -- fulfillment correctly rebased to the fresh authoritative "TAKEAWAY" (Turn A's `
        + `committed change) but Turn B's own stale-turn address contribution ("${finalState!.address}") `
        + `was still applied UNCONDITIONALLY on top, with no check that it still made sense for the `
        + `fulfillment it was just rebased onto. Persisted SofiaOrderDraft.deliveryAddress = `
        + `"${finalDraft?.deliveryAddress}" for a TAKEAWAY (pickup) draft with deliveryFee=`
        + `${finalDraft?.deliveryFee?.toString()} and no delivery quote audit -- a self-contradictory, `
        + `durably-persisted record that nothing downstream re-validates.`,
      );
    }

    // If the implementation is ever hardened to close this gap (e.g. by discarding/ignoring a stray
    // address edit once fulfillment has been rebased to TAKEAWAY, or by falling through to a safe
    // re-ask instead of silently persisting the hybrid), this is the expected safe shape: TAKEAWAY
    // fulfillment with NO address attached.
    expect(finalState!.fulfillment).toBe('TAKEAWAY');
    expect(finalState!.address).toBeNull();
    expect(finalState!.destinationSnapshot).toBeNull();
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a39-fulfillhybrid-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a39-fulfillhybrid-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a39-fulfillhybrid-' } } });
  });
});
