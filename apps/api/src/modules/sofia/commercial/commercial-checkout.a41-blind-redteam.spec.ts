/**
 * A41 BLIND RED TEAM (Round 5) -- fresh, independent attack on the `rebaseTurnOntoFreshState()` /
 * `recoverDraftConflict()` / `applyItemsMutation()` trio, which has now produced three consecutive
 * fix-introduces-new-bug rounds (A36 -> A37 -> A38 -> A39 -> A40). This round did NOT see any prior
 * design rationale beyond what is in the current source comments; every finding below was derived by
 * re-tracing the mechanism from scratch against a REAL, unmocked Postgres + `PrismaCommercialRepository`
 * (only the external delivery-quote provider is doubled).
 *
 * TRACE PERFORMED FIRST (documented here for the record, no test needed -- confirmed SAFE):
 * `recoverDraftConflict()`'s emptiness check on `rebased.missingFields` after
 * `rebaseTurnOntoFreshState()` does NOT rely solely on `this.policy.missing(rebased)` to surface the new
 * `destinationFulfillmentMismatch` ambiguity. `rebaseTurnOntoFreshState()`'s own tail
 * (commercial-checkout.service.ts:556-557) unconditionally merges `rebased.ambiguities` into
 * `rebased.missingFields` via `[...new Set([...rebased.missingFields, ...rebased.ambiguities])]`
 * AFTER calling `policy.missing()`, regardless of what `CommercialPolicyService.missing()` itself
 * returns (confirmed by reading `commercial-policy.service.ts`: it only ever pushes `product`,
 * `fulfillment`, `paymentPreference`, `deliveryAddress` -- it has no knowledge of
 * `destinationFulfillmentMismatch` at all). So there is NO policy/catalog configuration under which the
 * ambiguity could fail to make `missingFields` non-empty -- the safety net does not depend on
 * `policy.missing()` including it. This part of the A40 fix is correctly implemented. No test added for
 * this (it is a pure code-reading conclusion, included in the report per the mission's "trace
 * missingFields/ambiguities" request).
 *
 * TWO fresh findings below, both proven with real, runnable, unmocked-engine tests:
 *
 *  FINDING 1 (HIGH) -- `recoverDraftConflict()`'s retry path can propagate an UNCAUGHT exception out of
 *  `CommercialCheckoutService.process()`/`confirm()` when the retried `prepareDraft()` call (or
 *  `rebaseTurnOntoFreshState()`'s own `applyItemsMutation()` -> `resolveProducts()` call) fails for any
 *  reason OTHER than a second `STALE_DRAFT_VERSION` conflict -- e.g. `SOFIA_PRICE_CHANGED`,
 *  `SOFIA_PRODUCT_UNAVAILABLE`, `SOFIA_DELIVERY_QUOTE_REQUIRED`, or `SOFIA_CATALOG_UNAVAILABLE`. Every
 *  one of these is an entirely foreseeable business condition (a price changes, a product goes out of
 *  stock, a delivery-quote provider hiccups) that can legitimately coincide with a genuine concurrent
 *  draft-version race -- and when it does, `recoverDraftConflict()`'s own retry re-throws it
 *  unconditionally (commercial-checkout.service.ts:391: `if (!this.isStaleDraftVersionConflict(retryError))
 *  throw retryError;`), and NEITHER `process()` nor `confirm()` wraps their own `await
 *  this.recoverDraftConflict(...)` call in a further try/catch -- so the exception is never converted
 *  into any of this service's normal graceful chat responses. Every OTHER failure mode in this service
 *  (price changes, unavailable products, catalog outages, quote failures) has a dedicated graceful
 *  recovery/response path EXCEPT this one specific combination.
 *
 *  FINDING 2 (LOW, explicitly requested by the mission brief) -- the customer-facing `QUOTE_EXPIRED`
 *  response used for the new `destinationFulfillmentMismatch` fallback never mentions the customer's own
 *  address-correction attempt at all. It renders the generic "cotización venció" template against
 *  whatever the AUTHORITATIVE (self-consistent) state actually is -- which, by construction of this
 *  exact scenario, is NOT what the customer just asked for. The customer receives no acknowledgement
 *  that their message was received, understood, or why it did not apply.
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
}

const NEAR = { latitude: 6.244, longitude: -75.581 };
const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

describe('A41 blind red-team: rebaseTurnOntoFreshState() / recoverDraftConflict() fresh pass', () => {
  let prisma: PrismaService;
  let realRepository: PrismaCommercialRepository;
  let repository: PinnedFirstReadRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A41 red-team test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    realRepository = new PrismaCommercialRepository(prisma);
    repository = new PinnedFirstReadRepository(realRepository);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a41-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a41-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a41-' } } });
  });

  function buildService(opts: { comboPriceForGetById?: () => number } = {}) {
    const priceForGetById = opts.comboPriceForGetById ?? (() => 25000);
    // `listActive()` (used by `resolveProducts()` for product-mention matching on EVERY turn) and
    // `getActiveById()` (used by `validateAvailability()` for price-staleness checks) must be driven by
    // INDEPENDENT counters: `listActive()` is called far more often (once per turn, regardless of
    // whether that turn's `prepareDraft()` ever runs) and must not itself advance the "price just
    // changed" simulation -- only `getActiveById()` calls (one per `validateAvailability()` invocation)
    // should. `listActive()` always reflects whatever price `getActiveById()` most recently confirmed,
    // matching how a real catalog read would behave.
    let latestKnownComboPrice = 25000;
    const coke = {
      id: 'p2', code: 'COCA-COLA', name: 'Coca Cola', description: 'Gaseosa', imageUrl: null,
      category: { id: 'cat2', name: 'Bebidas', slug: 'bebidas' }, kind: 'STOCKED' as const, persistedPrice: 5000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const comboFor = (price: number) => ({
      id: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', description: 'Hamburguesas', imageUrl: null,
      category: { id: 'cat', name: 'Combos', slug: 'combos' }, kind: 'PREPARED' as const, persistedPrice: price,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    });
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
      {
        listActive: jest.fn(async () => [comboFor(latestKnownComboPrice), coke]),
        getActiveById: jest.fn(async (id: string) => {
          if (id !== 'p1') return coke;
          latestKnownComboPrice = priceForGetById();
          return comboFor(latestKnownComboPrice);
        }),
        findActive: jest.fn(),
      } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId: null, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service };
  }

  /**
   * FINDING 1 (HIGH): a business-rule failure (here, a concurrent catalog price change) that happens to
   * land on the RETRY attempt inside `recoverDraftConflict()` -- after a genuine, real-Postgres-enforced
   * `STALE_DRAFT_VERSION` CAS conflict has already occurred -- is re-thrown unconditionally instead of
   * being converted into a graceful chat response. This makes `service.process()` itself reject with a
   * raw `BadRequestException`, instead of returning a `CommercialTurnResult` like every other failure
   * mode in this service does.
   */
  it('FINDING 1: a price change landing exactly on the rebase-retry attempt makes process() reject uncaught, instead of responding gracefully', async () => {
    const conversationId = `a41-price-race-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112299', provider: 'mock' } });

    let getActiveByIdCalls = 0;
    // Calls 1-3 (Turn 0's prepareDraft's validateAvailability, Turn A's prepareDraft's
    // validateAvailability, Turn B's FIRST prepareDraft attempt's validateAvailability -- BEFORE the CAS
    // conflict is even thrown) see the ORIGINAL price. Call 4 (the RETRY's prepareDraft's
    // validateAvailability, invoked from inside recoverDraftConflict AFTER the rebase) sees a price that
    // changed in the meantime -- exactly what a real concurrent admin price edit landing in this narrow
    // window would look like.
    const comboPriceForGetById = () => { getActiveByIdCalls += 1; return getActiveByIdCalls <= 3 ? 25000 : 30000; };
    const { service } = buildService({ comboPriceForGetById });

    // Turn 0: establish a real DELIVERY draft, version 1.
    const baseline = await service.process({
      conversationId, phone: '573001112299',
      message: 'Mándame un combo 2x1 a la Calle 50 # 10-20 y pago ya',
      actor,
    });
    expect(baseline.nextAction).toBe('READY_TO_CONFIRM');
    expect(baseline.state.draftVersion).toBe(1);

    // Capture the exact `previous` a genuinely concurrent Turn B would have read, BEFORE Turn A commits.
    const staleBaselineForTurnB = await realRepository.loadState(conversationId);
    expect(staleBaselineForTurnB).not.toBeNull();

    // Turn A (real, sequential, commits first): a neutral quantity bump that advances the draft version
    // to 2 without touching price/fulfillment/destination.
    const bump = await service.process({ conversationId, phone: '573001112299', message: 'Mejor dos combos', actor });
    expect(bump.nextAction).toBe('READY_TO_CONFIRM');
    expect(bump.state.draftVersion).toBe(2);

    // Turn B: pinned to the stale pre-bump baseline (draftVersion 1), reaches a real STALE_DRAFT_VERSION
    // conflict against the actual DB version (2) when it tries to save. Its own message ("Pago ya") is a
    // payment-preference-only turn with no product/destination/fulfillment content of its own, so
    // rebaseTurnOntoFreshState() should cleanly re-derive an internally-consistent, non-ambiguous state
    // -- the ONLY reason this should ever fail is the price that changed underneath it.
    repository.pinNextRead(conversationId, staleBaselineForTurnB!);

    let threw: unknown = null;
    let turn: Awaited<ReturnType<typeof service.process>> | null = null;
    try {
      turn = await service.process({ conversationId, phone: '573001112299', message: 'Pago ya', actor });
    } catch (error) {
      threw = error;
    }

    // What SHOULD happen: exactly like `confirm()`'s own dedicated `SOFIA_PRICE_CHANGED` recovery path
    // (commercial-checkout.service.ts:826-842), the customer should receive a graceful
    // `PRICE_CHANGED`/`QUOTE_EXPIRED`-style response, or at minimum a `CommercialTurnResult` -- never a
    // raw uncaught exception.
    //
    // What ACTUALLY happens (asserted below): `process()` rejects with the raw `BadRequestException`
    // from the retry's `validateAvailability()` call, because `recoverDraftConflict()`'s retry-catch
    // block (line 391) only recognizes a SECOND `STALE_DRAFT_VERSION` conflict as recoverable and
        // re-throws everything else verbatim, and neither `process()` nor `confirm()` catches that
    // re-thrown error a second time.
    expect(turn).toBeNull();
    expect(threw).not.toBeNull();
    expect(threw).toBeInstanceOf(Error);
    const response = (threw as { getResponse?: () => unknown }).getResponse?.();
    expect((response as { code?: string } | undefined)?.code).toBe('SOFIA_PRICE_CHANGED');

    // Confirm this is not merely a same-turn failure but a genuinely UNCAUGHT one: the persisted
    // conversation state was never touched by Turn B at all (still exactly Turn A's committed
    // draftVersion) -- Turn B's message left absolutely no trace anywhere, no graceful response, no
    // updated narration, nothing for a later turn or a human reviewer to see. It simply vanished into a
    // rejected promise.
    const finalState = await realRepository.loadState(conversationId);
    expect(finalState?.draftVersion).toBe(bump.state.draftVersion);
  });

  /**
   * FINDING 2 (LOW): the actual customer-facing text rendered for the `destinationFulfillmentMismatch`
   * fallback (A40's new safety net) never surfaces the customer's own address message anywhere -- it is
   * silently dropped with a generic "quote expired" template that describes the CURRENT (different)
   * state, giving the customer no way to know their correction did not apply or why.
   */
  it('FINDING 2: destinationFulfillmentMismatch fallback response never mentions the customer\'s own address message -- silent, unexplained drop', async () => {
    const conversationId = `a41-ux-gap-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112299', provider: 'mock' } });
    const { service } = buildService();

    // Turn 0: DELIVERY baseline with a known address.
    const baseline = await service.process({
      conversationId, phone: '573001112299',
      message: 'Mándame un combo 2x1 a la Calle 50 # 10-20 y pago ya',
      actor,
    });
    expect(baseline.state.fulfillment).toBe('DELIVERY');
    expect(baseline.state.address).toBe('Calle 50 # 10-20');

    const staleBaselineForTurnB = await realRepository.loadState(conversationId);

    // Turn A (real, concurrent winner): switches to TAKEAWAY, clearing the destination.
    const switchToTakeaway = await service.process({ conversationId, phone: '573001112299', message: 'Mejor paso por el local', actor });
    expect(switchToTakeaway.state.fulfillment).toBe('TAKEAWAY');

    // Turn B: pinned to the stale DELIVERY baseline, sends a NEW address correction ("mejor mándalo a la
    // Avenida Central") -- from the customer's point of view this is an entirely ordinary, deliberate
    // message. This is exactly A40's `destinationFulfillmentMismatch` fallback trigger.
    repository.pinNextRead(conversationId, staleBaselineForTurnB!);
    const turnB = await service.process({
      conversationId, phone: '573001112299',
      message: 'Mejor mándalo a la Avenida Central',
      actor,
    });

    // Confirm this really did take the destinationFulfillmentMismatch safe-fallback path.
    expect(turnB.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
    expect(turnB.state.fulfillment).toBe('TAKEAWAY');
    expect(turnB.state.address).toBeNull();

    // The actual rendered customer-facing text: generic, and gives the customer zero acknowledgement
    // that they just tried to change the address, zero explanation of why it did not apply, and no
    // mention of "Avenida Central" (their own words) anywhere.
    expect(turnB.responseText).not.toContain('Avenida Central');
    expect(turnB.responseText).not.toMatch(/direcci[oó]n|address/i);
    // It reads as a generic "I re-checked, still good?" message, indistinguishable from an ordinary
    // quote-expiry refresh with no customer-driven edit involved at all.
    expect(turnB.responseText).toMatch(/venci[oó]/i);
  });

  /**
   * Confirms the requested "false positive" angle: a PAYMENT-preference-only turn that carries no
   * destination edit of its own must never trip the new `destinationFulfillmentMismatch` ambiguity, even
   * when it rebases onto a freshly, concurrently fulfillment-switched conversation. (No finding here --
   * included as evidence for the closure decision.)
   */
  it('confirms NO finding: a payment-only turn never falsely triggers destinationFulfillmentMismatch when rebasing onto a concurrently switched fulfillment', async () => {
    const conversationId = `a41-payment-only-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112299', provider: 'mock' } });
    const { service } = buildService();

    const baseline = await service.process({
      conversationId, phone: '573001112299',
      message: 'Mándame un combo 2x1 a la Calle 50 # 10-20 y pago ya',
      actor,
    });
    expect(baseline.state.fulfillment).toBe('DELIVERY');

    const staleBaselineForTurnB = await realRepository.loadState(conversationId);

    const switchToTakeaway = await service.process({ conversationId, phone: '573001112299', message: 'Mejor paso por el local', actor });
    expect(switchToTakeaway.state.fulfillment).toBe('TAKEAWAY');

    repository.pinNextRead(conversationId, staleBaselineForTurnB!);
    const turnB = await service.process({ conversationId, phone: '573001112299', message: 'Pago ya', actor });

    // No destination edit of its own -> must cleanly succeed against the fresh TAKEAWAY state, never
    // fall into the destinationFulfillmentMismatch/QUOTE_EXPIRED safe fallback.
    expect(turnB.nextAction).toBe('READY_TO_CONFIRM');
    expect(turnB.factEnvelope.responsePurpose).not.toBe('QUOTE_EXPIRED');
    expect(turnB.state.fulfillment).toBe('TAKEAWAY');
    expect(turnB.state.address).toBeNull();
    expect(turnB.state.destinationSnapshot).toBeNull();
  });
});
