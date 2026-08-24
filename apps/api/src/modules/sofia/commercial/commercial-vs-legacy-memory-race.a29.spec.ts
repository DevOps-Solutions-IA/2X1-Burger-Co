/**
 * A29 (Round 5, blind) — RED TEAM FINDING, CLOSED BY A30.
 *
 * Invariant(s) originally broken (see A30 fix below for how each is now protected):
 *   18. "Durable state must never silently lose evidence that something was already
 *       confirmed/committed."
 *   17. "Concurrent/racing messages/requests must never produce two independently-confirmed
 *       commercial records for what was, from the customer's perspective, one continuous
 *       interaction -- unless genuinely intended."
 *   9.  "Process/conversation restarts must not weaken any of the above."
 *
 * ORIGINAL ROOT CAUSE (A29)
 * --------------------------
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
 *       #12-08" with no "quiero/dame/pedido/..." in it). This writer used to perform a PLAIN
 *       `prisma.sofiaConversationMemory.update()` -- NO row lock, NO version/CAS check, NO
 *       awareness of writer (A) at all, and the JSON payload it writes has NO `schemaVersion` field.
 *
 * A26 only hardened writer (A) against RACES WITH ITSELF (two concurrent canonical `process()`
 * calls). It never considered writer (B), a totally different, unlocked code path touching the
 * exact same column for the exact same conversation. Because `shouldHandle()` legitimately routes
 * SOME early turns of a REAL, transactional conversation through the legacy branch (see the
 * concrete message above), and because WhatsApp inbound delivery is not guaranteed to be serialized
 * per-conversation at the application layer, two real inbound messages for the same conversation
 * could race so that message A confirms a real, priced draft via the canonical, row-locked path, and
 * message B -- moments later -- hits the legacy, UNLOCKED `updateContext()` for the SAME
 * conversationId, silently and irrecoverably destroying the only durable evidence the conversation
 * ever had a CONFIRMED commercial record.
 *
 * A30 FIX (this file now proves the FIXED behavior, not the bug)
 * ----------------------------------------------------------------
 * `SofiaConversationMemoryService.updateContext()` no longer runs its own independent, unlocked
 * `prisma.sofiaConversationMemory.update()`. It now delegates to a new
 * `PrismaCommercialRepository.saveLegacyConversationContext()` method that REUSES A26's exact
 * row-lock primitive (`SELECT ... FOR UPDATE` inside the same transaction shape as `saveState()`)
 * and applies the correct, symmetric guarantee for a writer that has NO `draftId` concept of its
 * own: if the currently-persisted row is already a canonical, CONFIRMED commercial record
 * (`schemaVersion === 4 && confirmationState === 'CONFIRMED'`), the legacy write's
 * `currentOrderIntentJson` payload is unconditionally dropped in favor of the existing canonical
 * truth.
 *
 * SOFIA Round 5 / A34 AMENDMENT (A33 blind red-team finding, LOW) — this file originally asserted
 * that the OTHER legacy narration columns (`currentIntent`, `missingFieldsJson`,
 * `lastProductDiscussed`) still updated normally even once a canonical record existed, on the
 * reasoning that they were "not part of the confirmed-evidence invariant this closes". A33 proved
 * that reasoning left the row internally CONTRADICTORY (protected `currentOrderIntentJson` says one
 * thing, sibling columns on the same row say another, both surfaced together by
 * `SofiaConversationMemoryService.sanitize()`). A34 extended the SAME `existingIsCanonical` guard to
 * those three columns too, so this file's assertions below now reflect the FIXED, ALWAYS-CONSISTENT
 * behavior: once canonical evidence exists, none of the four columns are legacy-writable.
 * `memorySummary`/`customerMemoryId` remain intentionally legacy-writable (no canonical-writer
 * equivalent, no contradiction risk).
 *
 * This test proves the FIX directly against REAL Postgres using the REAL, unmocked
 * `PrismaCommercialRepository` and `SofiaConversationMemoryService` classes — no mocks, no
 * simulation of the state machine.
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

describe('A29/A30 CLOSED: legacy SofiaConversationMemoryService.updateContext() must never clobber the CAS-protected canonical commercial state', () => {
  let prisma: PrismaService;
  let commercialRepo: PrismaCommercialRepository;
  let legacyMemory: SofiaConversationMemoryService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A29/A30 race test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    commercialRepo = new PrismaCommercialRepository(prisma);
    // A30: the legacy memory service now requires the canonical repository as a collaborator --
    // this is the fix itself (route the legacy writer through A26's row-locked primitive).
    legacyMemory = new SofiaConversationMemoryService(prisma, commercialRepo);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a29-' } } });
  });

  it('FIXED (sequential, deterministic): a legacy updateContext() write AFTER a canonical CONFIRMED saveState() no longer destroys the durable CONFIRMED marker', async () => {
    const conversationId = `a29-seq-${randomUUID()}`;
    const draftId = `draft-${randomUUID()}`;

    // Step 1: simulate message A -- the CANONICAL CommercialCheckoutService.process() path
    // confirming a real, priced draft via the real, row-locked `saveState()`.
    await commercialRepo.saveState(confirmedState(conversationId, draftId));

    const afterConfirm = await commercialRepo.loadState(conversationId);
    expect(afterConfirm).not.toBeNull();
    expect(afterConfirm!.confirmationState).toBe('CONFIRMED');
    expect(afterConfirm!.draftId).toBe(draftId);

    // Step 2: simulate message B -- a DIFFERENT, later-processed WhatsApp message for the SAME
    // conversation that routes to the legacy fallback, which calls the REAL, unmocked
    // `SofiaConversationMemoryService.updateContext()` -- exactly the call at
    // sofia-agent.service.ts:984. This call still has NO knowledge of `draftId`/`confirmationState`,
    // but as of A30 it is routed through the SAME row-locked primitive `saveState()` uses.
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

    // Step 3: THE FIX -- the durable evidence that this conversation had a REAL CONFIRMED commercial
    // record MUST survive the legacy write untouched.
    const afterLegacyWrite = await commercialRepo.loadState(conversationId);
    expect(afterLegacyWrite).not.toBeNull();
    expect(afterLegacyWrite!.confirmationState).toBe('CONFIRMED');
    expect(afterLegacyWrite!.draftId).toBe(draftId);

    // Prove it precisely at the raw-column level too, so there is no ambiguity that the CONFIRMED
    // marker genuinely survived and this is not a test-harness artifact.
    const raw = await prisma.sofiaConversationMemory.findUnique({ where: { conversationId } });
    const rawJson = raw!.currentOrderIntentJson as Record<string, unknown> | null;
    expect(rawJson).not.toBeNull();
    expect(rawJson!.schemaVersion).toBe(4);
    expect(rawJson!.confirmationState).toBe('CONFIRMED');
    expect(rawJson!.draftId).toBe(draftId);

    // A34: the legacy write's OTHER narration columns (currentIntent, missingFieldsJson,
    // lastProductDiscussed) are now ALSO protected once the row is canonical -- they stay exactly
    // what the canonical writer itself left them as (currentIntent = the canonical state's own
    // 'CONFIRM' intent; lastProductDiscussed was never touched by saveState(), so it stays unset),
    // instead of being overwritten by this unrelated legacy turn's 'UNKNOWN'/'Hamburguesa Sencilla'.
    expect(raw!.currentIntent).toBe('CONFIRM');
    expect(raw!.lastProductDiscussed).toBeNull();
  });

  it('FIXED (genuine concurrency, Promise.all): racing the canonical confirm write against the legacy fallback write for the same conversationId can no longer corrupt the CONFIRMED marker, regardless of commit order', async () => {
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

    // THE FIX: no matter which writer's transaction physically commits last, the row lock
    // (`SELECT ... FOR UPDATE`) serializes the two writers, and the legacy writer's own guard
    // (never overwrite `currentOrderIntentJson` when the row it observes under lock is already a
    // canonical CONFIRMED record) means the CONFIRMED marker is now REACHABLE in every ordering --
    // never merely "usually" surviving.
    const finalState = await commercialRepo.loadState(conversationId);
    expect(finalState).not.toBeNull();
    expect(finalState!.confirmationState).toBe('CONFIRMED');
    expect(finalState!.draftId).toBe(draftId);

    const raw = await prisma.sofiaConversationMemory.findUnique({ where: { conversationId } });
    const rawJson = raw!.currentOrderIntentJson as Record<string, unknown> | null;
    expect(rawJson!.schemaVersion).toBe(4);
    expect(rawJson!.confirmationState).toBe('CONFIRMED');

    // Additionally: fire a THIRD, unambiguously-later legacy write (after the race above has fully
    // settled) to prove the protection is not a one-shot accident of ordering -- a legacy write that
    // is DEFINITELY the last writer chronologically must still be unable to destroy the CONFIRMED
    // marker.
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
    expect(afterForcedLegacyWrite).not.toBeNull();
    expect(afterForcedLegacyWrite!.confirmationState).toBe('CONFIRMED');
    expect(afterForcedLegacyWrite!.draftId).toBe(draftId);
  });

  it('CAUSAL CONTEXT (informational, unchanged by the fix): an ordinary, unambiguous delivery message with no fresh canonical state still routes to the LEGACY fallback, not the canonical engine', async () => {
    // This documents WHY the race above is realistically reachable in production: `shouldHandle()`
    // legitimately routes some ordinary early-conversation turns to the legacy branch. A30
    // deliberately does NOT change `shouldHandle()`'s routing (see the A30 report for the blast-radius
    // reasoning) -- instead it closes the gap by making the legacy WRITER safe regardless of when it
    // runs. This test is kept as informational context, proven against the REAL, unmocked
    // `CommercialCheckoutService.shouldHandle()` and `CommercialIntentEngine`.
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

    const realisticFirstMessage = 'Hola, soy Carlos. Es domicilio, a la Calle 45 #12-08, casa azul, condados de la alborada.';

    const handled = await service.shouldHandle(conversationId, realisticFirstMessage);

    const parsed = new CommercialIntentEngine().interpret(realisticFirstMessage, null);
    expect(parsed.fulfillment).toBe('DELIVERY');
    expect(parsed.address).not.toBeNull();
    expect(handled).toBe(false);
  });
});
