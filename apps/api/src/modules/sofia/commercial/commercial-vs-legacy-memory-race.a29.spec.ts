/**
 * A29 (Round 5, blind) — RED TEAM FINDING.
 *
 * Invariant(s) broken:
 *   18. "Durable state must never silently lose evidence that something was already
 *       confirmed/committed."
 *   17. "Concurrent/racing messages/requests must never produce two independently-confirmed
 *       commercial records for what was, from the customer's perspective, one continuous
 *       interaction -- unless genuinely intended."
 *   9.  "Process/conversation restarts must not weaken any of the above."
 *
 * ROOT CAUSE
 * ----------
 * `sofiaConversationMemory.currentOrderIntentJson` has EXACTLY TWO real writers in this codebase:
 *
 *   (A) `PrismaCommercialRepository.saveState()` (apps/api/src/modules/sofia/commercial/persistence/
 *       prisma-commercial.repository.ts) -- the CANONICAL writer used by
 *       `CommercialCheckoutService.process()`. A26 (a prior round) hardened this with a real
 *       `SELECT ... FOR UPDATE` row lock plus a "never regress an already-persisted CONFIRMED
 *       marker for the same draftId" guard.
 *
 *   (B) `SofiaConversationMemoryService.updateContext()` (apps/api/src/modules/sofia/memory/
 *       sofia-conversation-memory.service.ts) -- used by `SofiaAgentService.processMessage()`'s
 *       LEGACY/pre-canonical-engagement branch (`sofia-agent.service.ts`, invoked whenever
 *       `CommercialCheckoutService.shouldHandle()` returns `false` for a given turn -- which it
 *       does for very ordinary early-conversation messages that carry a fulfillment/address signal
 *       but no PURCHASE/CHANGE_ORDER/CONFIRM trigger word, e.g. a bare "Domicilio a la Calle 45
 *       #12-08" with no "quiero/dame/pedido/..." in it). This writer performs a PLAIN
 *       `prisma.sofiaConversationMemory.update()` -- NO row lock, NO version/CAS check, NO
 *       awareness of writer (A) at all, and the JSON payload it writes has NO `schemaVersion` field.
 *
 * A26 only hardened writer (A) against RACES WITH ITSELF (two concurrent canonical `process()`
 * calls). It never considered writer (B), a totally different, unlocked code path touching the
 * exact same column for the exact same conversation. Because `shouldHandle()` legitimately routes
 * SOME early turns of a REAL, transactional conversation through the legacy branch (see the
 * concrete message above), and because WhatsApp inbound delivery is not guaranteed to be serialized
 * per-conversation at the application layer (`WhatsappInboundGateway.receive()` dedupes/rate-limits
 * per EVENT, not per conversation; `SofiaWhatsappService.withInboundAgentLease()` renews a
 * processing lease for a single claimed event, it does not mutex the conversation against a
 * DIFFERENT event being processed concurrently by another request/worker), two real inbound
 * messages for the same conversation can race so that:
 *
 *   - message A takes the CANONICAL path, confirms a real, priced draft, and durably persists
 *     `confirmationState: 'CONFIRMED'` + `draftId` via `saveState()` (writer A, row-locked), and
 *   - message B takes the LEGACY fallback path and, moments later, calls `updateContext()`
 *     (writer B, unlocked) for the SAME conversationId,
 *
 * writer B's plain `.update()` unconditionally overwrites `currentOrderIntentJson` with its own
 * non-canonical, non-`schemaVersion:4` payload. The next `loadState()` call (by design: it treats
 * anything without `schemaVersion === 4` as "no state") now returns `null` -- the conversational
 * layer has PERMANENTLY and SILENTLY forgotten that this conversation ever had a CONFIRMED draft,
 * even though the underlying `SofiaOrderDraft` row is still sitting there with `status: CONFIRMED`
 * and real evidence. A follow-up "¿ya confirmé mi pedido?" from the customer would now be answered
 * from a totally empty state, and — worse — the customer could be walked through building and
 * confirming a SECOND, independent draft for what they experience as the SAME continuous order.
 *
 * This test proves the corruption directly against REAL Postgres using the REAL, unmocked
 * `PrismaCommercialRepository` and `SofiaConversationMemoryService` classes — no mocks, no
 * simulation of the state machine. It does not touch `commercial-checkout.service.ts`,
 * `prisma-commercial.repository.ts`, `orders.service.ts`, or any file under `destination-state/`;
 * it only adds this new spec file.
 */

import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { SofiaConversationMemoryService } from '../memory/sofia-conversation-memory.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import type { CommercialConversationState } from './commercial.types';

function confirmedState(conversationId: string, draftId: string): CommercialConversationState {
  return {
    schemaVersion: 4,
    conversationId,
    customerId: 'cust-a29',
    intent: 'CONFIRM',
    items: [
      { productId: 'prod-1', code: 'BURGER-1', name: 'Hamburguesa Sencilla', quantity: 2, unitPrice: 18000, modifiers: [] },
    ],
    fulfillment: 'DELIVERY',
    address: 'Calle 45 #12-08, casa azul',
    addressConfirmed: true,
    location: { latitude: 3.26, longitude: -76.54 },
    destinationSnapshot: null,
    deliveryQuoteDestinationBinding: null,
    paymentPreference: 'CASH_ON_DELIVERY',
    paymentReadiness: 'PAYMENT_COD',
    subtotal: 36000,
    deliveryFee: 5000,
    total: 41000,
    deliveryQuoteAuditId: 'audit-a29-1',
    deliveryQuoteVersion: 1,
    deliveryQuoteExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    availabilitySnapshot: [],
    draftId,
    draftVersion: 1,
    draftHash: 'a29-test-draft-hash',
    draftFulfillment: 'DELIVERY',
    draftItemsFingerprint: 'a29-test-items-fingerprint',
    draftPaymentPreference: 'CASH_ON_DELIVERY',
    // This is the fact this whole test is about: a REAL, durable, CONFIRMED commercial record.
    confirmationState: 'CONFIRMED',
    missingFields: [],
    ambiguities: [],
    confidence: 'HIGH',
    handoffState: 'SOFIA_ACTIVE',
    consentState: 'SERVICE',
    domainErrors: [],
    lastQuestionPurpose: null,
    lastResolvedIntent: 'CONFIRM',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

describe('A29 RED TEAM: unlocked legacy SofiaConversationMemoryService.updateContext() clobbers the CAS-protected canonical commercial state', () => {
  let prisma: PrismaService;
  let commercialRepo: PrismaCommercialRepository;
  let legacyMemory: SofiaConversationMemoryService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A29 race test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    commercialRepo = new PrismaCommercialRepository(prisma);
    legacyMemory = new SofiaConversationMemoryService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a29-' } } });
  });

  it('FINDING (sequential, deterministic): a legacy updateContext() write AFTER a canonical CONFIRMED saveState() destroys the durable CONFIRMED marker', async () => {
    const conversationId = `a29-seq-${randomUUID()}`;
    const draftId = `draft-${randomUUID()}`;

    // Step 1: simulate message A -- the CANONICAL CommercialCheckoutService.process() path
    // confirming a real, priced draft. This is EXACTLY what `persistAndAudit(state, command,
    // 'SOFIA_DRAFT_CONFIRMED')` does inside commercial-checkout.service.ts's confirm() branch: it
    // calls the real, row-locked `saveState()`.
    await commercialRepo.saveState(confirmedState(conversationId, draftId));

    const afterConfirm = await commercialRepo.loadState(conversationId);
    expect(afterConfirm).not.toBeNull();
    expect(afterConfirm!.confirmationState).toBe('CONFIRMED');
    expect(afterConfirm!.draftId).toBe(draftId);

    // Step 2: simulate message B -- a DIFFERENT, later-processed WhatsApp message for the SAME
    // conversation that (per `CommercialCheckoutService.shouldHandle()`'s own documented heuristic:
    // `existing` state check aside, a message with no PURCHASE/CHANGE_ORDER/CONFIRM trigger word
    // routes to the legacy branch) is handled by `SofiaAgentService`'s legacy fallback, which calls
    // the REAL, unmocked `SofiaConversationMemoryService.updateContext()` -- exactly the call at
    // sofia-agent.service.ts:984. This call has NO knowledge of `draftId`/`confirmationState` and
    // no CAS/version check of any kind.
    await legacyMemory.updateContext({
      conversationId,
      customerMemoryId: null,
      currentIntent: 'UNKNOWN',
      currentOrderIntent: {
        items: [{ name: 'Hamburguesa Sencilla', quantity: 1 }],
        matchedCatalogItem: null,
        matchedFeaturedOffer: null,
      },
      missingFields: ['deliveryAddress'],
      lastProductDiscussed: 'Hamburguesa Sencilla',
      memorySummary: null,
    });

    // Step 3: the durable evidence that this conversation had a REAL CONFIRMED commercial record
    // is now gone -- not merely stale, but structurally invisible to `loadState()` because the
    // legacy payload never carries `schemaVersion: 4`.
    const afterLegacyWrite = await commercialRepo.loadState(conversationId);

    // THE FINDING: durable proof of confirmation has been silently destroyed by an unrelated,
    // unlocked writer. This must never happen (invariant 18).
    expect(afterLegacyWrite).toBeNull();

    // Prove it precisely at the raw-column level too, so there is no ambiguity that this is a
    // genuine loss of the CONFIRMED marker and not a test-harness artifact.
    const raw = await prisma.sofiaConversationMemory.findUnique({ where: { conversationId } });
    const rawJson = raw!.currentOrderIntentJson as Record<string, unknown> | null;
    expect(rawJson).not.toBeNull();
    expect(rawJson!.schemaVersion).not.toBe(4);
    expect(rawJson!.confirmationState).not.toBe('CONFIRMED');
    expect(rawJson!.draftId).toBeUndefined();
  });

  it('FINDING (genuine concurrency, Promise.all): racing the canonical confirm write against the legacy fallback write for the same conversationId non-deterministically corrupts the CONFIRMED marker', async () => {
    const conversationId = `a29-race-${randomUUID()}`;
    const draftId = `draft-${randomUUID()}`;

    // Seed a NEEDS_INFO-equivalent row first (mirrors `getOrCreate()` inside updateContext(), and
    // mirrors a real conversation that has exchanged at least one prior message) so both writers
    // target an existing row via UPDATE, which is the realistic shape of the race in production.
    await prisma.sofiaConversationMemory.create({
      data: { conversationId, currentIntent: 'UNKNOWN', currentOrderIntentJson: undefined },
    });

    await Promise.all([
      commercialRepo.saveState(confirmedState(conversationId, draftId)),
      legacyMemory.updateContext({
        conversationId,
        customerMemoryId: null,
        currentIntent: 'UNKNOWN',
        currentOrderIntent: { items: [], matchedCatalogItem: null, matchedFeaturedOffer: null },
        missingFields: ['items'],
        lastProductDiscussed: null,
        memorySummary: null,
      }),
    ]);

    const finalState = await commercialRepo.loadState(conversationId);

    // Whichever writer happened to commit last wins outright -- there is no reconciliation, no
    // conflict detection, and (critically) no protection of an already-CONFIRMED marker against
    // this SPECIFIC writer the way A26 protects `saveState()` against a second `saveState()` call.
    // The canonical repository's own A26 "never regress a CONFIRMED marker for the same draftId"
    // guard is entirely bypassed because writer B never goes anywhere near
    // `PrismaCommercialRepository`, so this test must be able to observe the CONFIRMED marker
    // missing at least when the legacy writer lands last. We assert the concrete, reproducible bad
    // outcome (legacy overwrote canonical) is REACHABLE, which by itself is the violation: a well
    // behaved system must make this outcome IMPOSSIBLE, not merely unlikely.
    const raw = await prisma.sofiaConversationMemory.findUnique({ where: { conversationId } });
    const rawJson = raw!.currentOrderIntentJson as Record<string, unknown> | null;

    // Regardless of which write physically landed last, prove the two writers are NOT
    // coordinated: if the legacy write landed last, canonical CONFIRMED evidence for a real,
    // priced draft is gone from durable state with zero trace and zero conflict signal.
    if (finalState === null) {
      expect(rawJson!.schemaVersion).not.toBe(4);
    } else {
      // If canonical happened to land last in this run, re-run the deterministic ordering above
      // (already proven in test 1) demonstrates the same non-serialized clobber is reachable the
      // other way whenever the legacy write is the later commit -- confirming this is a genuine,
      // unguarded race and not merely one accidental ordering.
      await legacyMemory.updateContext({
        conversationId,
        customerMemoryId: null,
        currentIntent: 'UNKNOWN',
        currentOrderIntent: { items: [], matchedCatalogItem: null, matchedFeaturedOffer: null },
        missingFields: ['items'],
        lastProductDiscussed: null,
        memorySummary: null,
      });
      const afterForcedLegacyWrite = await commercialRepo.loadState(conversationId);
      expect(afterForcedLegacyWrite).toBeNull();
    }
  });

  it('CAUSAL PROOF (real, unmocked CommercialCheckoutService.shouldHandle + real CommercialIntentEngine): an ordinary, unambiguous delivery message with no fresh canonical state routes to the LEGACY fallback, not the canonical engine', async () => {
    // This is the real precondition that makes the race above realistically reachable in
    // production, proven against the REAL `shouldHandle()` method (no mock of it) backed by the
    // REAL `PrismaCommercialRepository` (against Postgres) and the REAL `CommercialIntentEngine`
    // -- only the unrelated constructor dependencies `shouldHandle()` never touches (catalog,
    // availability, CRM, delivery quotes, audit, order creation) are stubbed, exactly like the
    // existing `complaint-inbound.integration.spec.ts` pattern in this same module.
    const conversationId = `a29-shouldhandle-${randomUUID()}`;
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(),
      {} as never,
      {} as never,
      {} as never,
      commercialRepo,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    // A real customer describing a real delivery destination with a real street address and an
    // explicit delivery-fulfillment word ("domicilio"), with no prior canonical state for this
    // brand-new conversation (`loadState()` genuinely returns null -- proven separately above).
    const realisticFirstMessage = 'Hola, soy Carlos. Es domicilio, a la Calle 45 #12-08, casa azul, condados de la alborada.';

    const handled = await service.shouldHandle(conversationId, realisticFirstMessage);

    // THE GAP: even though this message plainly states a delivery fulfillment AND a real,
    // structured street address (`CommercialIntentEngine.interpret()` itself successfully extracts
    // both `fulfillment: 'DELIVERY'` and a non-null `address` from this exact text -- asserted
    // below for proof), `shouldHandle()` returns false because the text contains none of its
    // hard-coded PURCHASE/CHANGE_ORDER/CONFIRM trigger words ("quiero|dame|mandame|enviame|combo|
    // hamburguesa|2x1|pedido|confirmo|mejor|cambia|quita|agrega|dejala|dejalo"). This is the exact
    // routing condition under which `sofia-agent.service.ts` falls through to the unlocked legacy
    // `SofiaConversationMemoryService.updateContext()` writer proven above to be able to destroy a
    // concurrently-confirmed canonical record.
    const parsed = new CommercialIntentEngine().interpret(realisticFirstMessage, null);
    expect(parsed.fulfillment).toBe('DELIVERY');
    expect(parsed.address).not.toBeNull();
    expect(handled).toBe(false);
  });
});
