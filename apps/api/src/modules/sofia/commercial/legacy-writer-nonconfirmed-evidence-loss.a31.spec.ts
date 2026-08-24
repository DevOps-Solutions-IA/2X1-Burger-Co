/**
 * A31 (Round 5, blind, independent) — NEW RED TEAM FINDING against the A30/round-5-30 state.
 *
 * Invariant(s) violated:
 *   20. "Every writer of durable conversational/commercial state (not just the ones already found)
 *       must respect the same concurrency-safety and evidence-preservation guarantees as the
 *       canonical writer."
 *   18. "Durable state must never silently lose evidence that something was already
 *       confirmed/committed, under ANY writer or ANY interleaving."
 *   14. "Evidence linking between a checkout/conversation's computation and the operational order
 *       it materializes into must be accurate."
 *   1/2/3/4/6/7. destination/coordinate/quote-binding evidence must never be silently discarded.
 *
 * ROOT CAUSE
 * ----------
 * A30 (`PrismaCommercialRepository.saveLegacyConversationContext()`) protects the legacy writer
 * (`SofiaConversationMemoryService.updateContext()`, invoked from `SofiaAgentService.processMessage()`'s
 * pre-canonical-engagement fallback branch whenever `CommercialCheckoutService.shouldHandle()` returns
 * `false` for a given turn) against clobbering `sofiaConversationMemory.currentOrderIntentJson`, but
 * ONLY when the currently-persisted row is a canonical record whose `confirmationState === 'CONFIRMED'`
 * (see the exact guard: `existingIsConfirmedCanonical` in prisma-commercial.repository.ts).
 *
 * A canonical, `schemaVersion: 4` record that is NOT yet confirmed -- i.e. `confirmationState ===
 * 'PENDING'`, fully quote-bound, address-confirmed, GPS-coordinate-bound, with a real
 * `deliveryQuoteAuditId`/`destinationSnapshot`/`deliveryQuoteDestinationBinding` already computed by
 * `CommercialCheckoutService.process()` on a PRIOR turn -- receives NO protection at all. A legacy
 * write landing after it is written unconditionally over the top, exactly like the pre-A26 bug, just
 * one confirmationState value earlier in the lifecycle.
 *
 * WHY THIS IS REACHABLE IN PRODUCTION (not a contrived ordering)
 * ----------------------------------------------------------------
 * `CommercialCheckoutService.shouldHandle()` is:
 *
 *     const existing = await this.repository.loadState(conversationId);
 *     if (existing) return true;
 *     ...
 *
 * `loadState()` treats a row as "existing" ONLY if `currentOrderIntentJson.schemaVersion === 4`. If a
 * legacy write (see below) has just overwritten that JSON with the legacy's own non-`schemaVersion-4`
 * shape, `loadState()` returns `null` again on the VERY NEXT turn -- so `shouldHandle()` can route a
 * SUBSEQUENT ordinary early-conversation message (e.g. "Domicilio a la Calle 45 #12-08" with no
 * "quiero/pedido/confirmo" trigger word -- the exact kind of message A29's own test proves routes to
 * the legacy branch) back through the SAME unprotected legacy writer again. Two real, distinct WhatsApp
 * messages for the same conversation are not guaranteed to be processed by the application in a way
 * that serializes "check shouldHandle" against "commit the legacy write" end-to-end across requests
 * (there is substantial work -- AI provider calls, catalog lookups, message persistence -- between the
 * two in `sofia-agent.service.ts`), so this is a genuinely reachable interleaving, not just a
 * pathological unit-test setup.
 *
 * CONSEQUENCE
 * -----------
 * The conversation silently "forgets" a customer's ALREADY-VALIDATED delivery destination (revision,
 * spatial fingerprint, trusted GPS coordinates, address-confirmed flag) and an ALREADY-COMPUTED,
 * unexpired delivery quote (`deliveryQuoteAuditId`/`deliveryQuoteDestinationBinding`) -- hard-won
 * evidence that took A9/A10/A13/A14 several rounds to make trustworthy in the first place. The
 * customer must re-supply everything from scratch. Worse: the underlying `SofiaOrderDraft` row (real
 * `draftHash`, `status: READY_TO_CONFIRM`, unexpired) is now ORPHANED -- no `sofiaConversationMemory`
 * row references its id any more. This orphaned, canonical-owned draft becomes reachable again by
 * `SofiaAgentRepository.findActiveDraft()` (used by the SAME legacy fallback branch, filtered ONLY by
 * `conversationId` + status -- NOT by `draftHash`), which will resurface it as "activeDraft" on the
 * conversation's next legacy-routed turn. Attempting to legacy-`update()` it correctly throws (A28's
 * `assertLegacyOwnedDraft` / `draftHash === null` ownership check holds), but that throw is UNCAUGHT at
 * the `sofia-agent.service.ts:897-899` call site (`draft = activeDraft ? await this.orderDrafts.update(...)
 * : ...` -- no try/catch), so it will actually blow up that turn's message processing end-to-end for as
 * long as the zombie draft remains active/unexpired.
 *
 * This test proves BOTH parts against REAL Postgres using the REAL, unmocked
 * `PrismaCommercialRepository`, `SofiaConversationMemoryService`, `SofiaAgentRepository`, `SofiaService`
 * and `SofiaOrderDraftAdapter` classes -- no mocks, no simulation of the state machine.
 */

import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { SofiaOrderDraftStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditContextService } from '../../audit/audit-context.service';
import { AuditService } from '../../audit/audit.service';
import { SofiaOrderDraftAdapter } from '../contracts/sofia-contract.adapters';
import { SofiaConversationMemoryService } from '../memory/sofia-conversation-memory.service';
import { SofiaAgentRepository } from '../repositories/sofia-agent.repository';
import { SofiaService } from '../sofia.service';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import type { CommercialConversationState } from './commercial.types';

/**
 * A realistic, fully quote-bound, GPS-validated, PENDING-confirmation canonical state -- exactly the
 * shape `CommercialCheckoutService.process()` persists after a customer has shared their location,
 * had it geocoded/validated, and received a priced delivery quote, but has not yet said "confirmo".
 */
function pendingQuoteBoundState(conversationId: string, draftId: string): CommercialConversationState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 4,
    conversationId,
    customerId: 'cust-a31',
    intent: 'PURCHASE',
    items: [
      { productId: 'prod-1', code: 'BURGER-1', name: 'Hamburguesa Sencilla', quantity: 2, unitPrice: 18000, modifiers: [] },
    ],
    fulfillment: 'DELIVERY',
    address: 'Calle 45 #12-08, casa azul',
    addressConfirmed: true,
    // TRUSTED, real GPS evidence for the CURRENT destination revision -- exactly the class of
    // evidence A9/A10/A13 exist to protect from stale reuse/loss.
    location: { latitude: 3.26, longitude: -76.54 },
    destinationSnapshot: {
      revision: 1,
      spatialFingerprint: 'sha256:a31-test-fingerprint',
      normalizedAddress: 'Calle 45 #12-08',
      addressComponents: { street: 'Calle 45', number: '12-08', neighborhood: null, city: 'Cali', municipality: null, postalCode: null, locality: null },
      latitude: 3.26,
      longitude: -76.54,
      coordinateSource: 'GPS_SHARE',
      coordinateTrust: 'TRUSTED',
      coordinateBoundRevision: 1,
      geocodingProvider: 'test-provider',
      geocodingEvidenceId: 'geo-audit-a31-1',
      deliveryInstructions: 'casa azul',
      referenceText: 'Calle 45 #12-08, casa azul',
      createdAt: now,
      updatedAt: now,
    },
    deliveryQuoteDestinationBinding: {
      destinationRevision: 1,
      destinationSpatialFingerprint: 'sha256:a31-test-fingerprint',
      boundCoordinateLatitude: 3.26,
      boundCoordinateLongitude: -76.54,
    },
    paymentPreference: 'CASH_ON_DELIVERY',
    paymentReadiness: 'PAYMENT_COD',
    subtotal: 36000,
    deliveryFee: 5000,
    total: 41000,
    deliveryQuoteAuditId: 'audit-a31-1',
    deliveryQuoteVersion: 1,
    deliveryQuoteExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    availabilitySnapshot: [],
    draftId,
    draftVersion: 1,
    draftHash: 'a31-test-draft-hash',
    draftFulfillment: 'DELIVERY',
    draftItemsFingerprint: 'a31-test-items-fingerprint',
    draftPaymentPreference: 'CASH_ON_DELIVERY',
    // THE FACT THIS TEST IS ABOUT: real, already-validated, already-quoted evidence, ONE STEP before
    // confirmation. Not yet CONFIRMED -- so A30's guard does not apply to it at all.
    confirmationState: 'PENDING',
    missingFields: [],
    ambiguities: [],
    confidence: 'HIGH',
    handoffState: 'SOFIA_ACTIVE',
    consentState: 'SERVICE',
    domainErrors: [],
    lastQuestionPurpose: 'CONFIRM_ORDER',
    lastResolvedIntent: 'PURCHASE',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

describe('A31 (NEW, blind): legacy updateContext() writer silently destroys PENDING (not-yet-confirmed) canonical destination/quote evidence, and the resulting orphaned draft is reachable again by the legacy fallback', () => {
  let prisma: PrismaService;
  let commercialRepo: PrismaCommercialRepository;
  let legacyMemory: SofiaConversationMemoryService;
  let agentRepository: SofiaAgentRepository;
  let sofiaService: SofiaService;
  let orderDraftAdapter: SofiaOrderDraftAdapter;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A31 test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    commercialRepo = new PrismaCommercialRepository(prisma);
    legacyMemory = new SofiaConversationMemoryService(prisma, commercialRepo);
    agentRepository = new SofiaAgentRepository(prisma);
    const auditService = new AuditService(prisma, new AuditContextService());
    sofiaService = new SofiaService(
      prisma,
      auditService,
      new ConfigService(),
      // catalogRead / handoffService are never reached: `assertLegacyOwnedDraft()` throws before
      // `updateDraft()` touches either collaborator (see sofia.service.ts:1106-1116).
      undefined as never,
      undefined as never,
    );
    orderDraftAdapter = new SofiaOrderDraftAdapter(sofiaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a31-' } } });
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a31-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a31-' } } });
  });

  it('PART 1: a legacy updateContext() write AFTER a canonical PENDING (quote-bound, GPS-validated, not-yet-confirmed) saveState() silently destroys that evidence -- A30 does not protect it', async () => {
    const conversationId = `a31-pending-${randomUUID()}`;
    const draftId = `draft-a31-${randomUUID()}`;

    // Step 1: the REAL canonical writer persists a PENDING, fully quote-bound, GPS-validated state --
    // exactly what `CommercialCheckoutService.process()` writes after the customer shared their
    // location and got a real, priced quote, one turn before saying "confirmo".
    await commercialRepo.saveState(pendingQuoteBoundState(conversationId, draftId));

    const afterQuote = await commercialRepo.loadState(conversationId);
    expect(afterQuote).not.toBeNull();
    expect(afterQuote!.confirmationState).toBe('PENDING');
    expect(afterQuote!.draftId).toBe(draftId);
    expect(afterQuote!.destinationSnapshot?.coordinateTrust).toBe('TRUSTED');
    expect(afterQuote!.deliveryQuoteAuditId).toBe('audit-a31-1');

    // Step 2: a DIFFERENT, later-processed WhatsApp message for the SAME conversation routes to the
    // legacy fallback (`shouldHandle()` can legitimately return `false` for an ordinary turn -- see
    // A29's own "CAUSAL CONTEXT" test for a real, unmocked proof of this routing) and calls the REAL,
    // unmocked `SofiaConversationMemoryService.updateContext()` -- exactly the call at
    // sofia-agent.service.ts:984.
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

    // THE BUG: unlike the CONFIRMED case (A30, closed), a PENDING canonical record gets NO
    // protection at all. The legacy write's non-schemaVersion-4 payload silently wins.
    const afterLegacyWrite = await commercialRepo.loadState(conversationId);
    expect(afterLegacyWrite).toBeNull(); // <-- all canonical destination/quote evidence is now GONE

    const raw = await prisma.sofiaConversationMemory.findUnique({ where: { conversationId } });
    const rawJson = raw!.currentOrderIntentJson as Record<string, unknown> | null;
    // The row still exists, but it no longer carries schemaVersion 4 -- the TRUSTED GPS coordinates,
    // the destinationSnapshot, the deliveryQuoteAuditId/binding and the draftId are all unreachable
    // from the conversation's canonical state now, even though NOTHING was ever confirmed and NOTHING
    // about this evidence was stale, wrong, or superseded by anything more current.
    expect(rawJson).not.toHaveProperty('schemaVersion', 4);
    expect(rawJson).not.toHaveProperty('destinationSnapshot');
    expect(rawJson).not.toHaveProperty('deliveryQuoteAuditId');
    expect(rawJson).not.toHaveProperty('draftId');
  });

  it('PART 2: the orphaned canonical SofiaOrderDraft (real draftHash, READY_TO_CONFIRM, unexpired) becomes reachable again via the legacy fallback\'s findActiveDraft(), and the legacy update() call the fallback branch makes on it throws UNCAUGHT at that call site', async () => {
    const conversationId = `a31-orphan-${randomUUID()}`;
    const draftId = `draft-a31-orphan-${randomUUID()}`;

    // A real conversation row, exactly as `SofiaAgentService.processMessage()` would have via
    // `findConversation()`/`getOrCreateConversation()` -- required by the FK on `sofia_order_drafts`.
    await prisma.whatsappConversation.create({
      data: { id: conversationId, phone: '+573001234567', provider: 'qr_gateway' },
    });

    // Reproduce the exact state PrismaCommercialRepository.saveDraft() would have persisted for this
    // conversation's PENDING quote-bound draft (real draftHash, READY_TO_CONFIRM, unexpired) -- the
    // SofiaOrderDraft side of the evidence destroyed in PART 1.
    await prisma.sofiaOrderDraft.create({
      data: {
        id: draftId,
        conversationId,
        status: SofiaOrderDraftStatus.READY_TO_CONFIRM,
        fulfillment: 'DELIVERY',
        paymentPreference: 'CASH_ON_DELIVERY',
        version: 1,
        draftHash: 'a31-test-draft-hash',
        expiresAt: new Date(Date.now() + 30 * 60_000),
        deliveryAddress: 'Calle 45 #12-08, casa azul',
        itemsSnapshot: [{ productId: 'prod-1', code: 'BURGER-1', name: 'Hamburguesa Sencilla', quantity: 2, unitPrice: 18000, totalPrice: 36000 }],
        subtotal: 36000,
        deliveryFee: 5000,
        total: 41000,
        addressConfirmedAt: new Date(),
      },
    });
    // ... and the conversation-memory side of the evidence, PENDING, exactly as PART 1 proved it
    // ends up (schemaVersion-4 tracking already destroyed by a prior legacy write in this
    // conversation's history).
    await prisma.sofiaConversationMemory.create({
      data: { conversationId, currentIntent: 'UNKNOWN', currentOrderIntentJson: { items: [], matchedCatalogItem: null, matchedFeaturedOffer: null } },
    });

    // `CommercialCheckoutService.shouldHandle()` will see no schemaVersion-4 state and (for an
    // ordinary non-transactional-looking follow-up) route back to the legacy fallback -- which calls
    // the REAL, unmocked `SofiaAgentRepository.findActiveDraft()` exactly as sofia-agent.service.ts:796
    // does.
    const activeDraft = await agentRepository.findActiveDraft(conversationId);
    expect(activeDraft).not.toBeNull();
    expect(activeDraft!.id).toBe(draftId);
    expect(activeDraft!.draftHash).toBe('a31-test-draft-hash'); // <-- a REAL canonical-owned draft
    expect(activeDraft!.status).toBe(SofiaOrderDraftStatus.READY_TO_CONFIRM);

    // The legacy fallback branch then does exactly this (sofia-agent.service.ts:897-899), with NO
    // try/catch around it:
    //   draft = activeDraft
    //     ? await this.orderDrafts.update(activeDraft.id, activeDraft.updatedAt.toISOString(), draftPayload, actor)
    //     : await this.orderDrafts.create(...)
    // A28's ownership guard correctly rejects mutating a canonical (`draftHash` truthy) draft through
    // the legacy path -- but the resulting exception is UNCAUGHT at that call site, so it propagates
    // out of `processMessage()` and fails that entire turn's message processing (not merely "declines
    // to update the draft and continues gracefully").
    await expect(
      orderDraftAdapter.update(
        activeDraft!.id,
        activeDraft!.updatedAt.toISOString(),
        { deliveryAddress: 'Otra direccion nueva', deliveryNotes: 'Borrador supervisado por Sofía.' },
        { actorId: 'system-a31', roles: ['system'], source: 'SOFIA_WHATSAPP' },
      ),
    ).rejects.toThrow(ConflictException);

    await expect(
      orderDraftAdapter.update(
        activeDraft!.id,
        activeDraft!.updatedAt.toISOString(),
        { deliveryAddress: 'Otra direccion nueva' },
        { actorId: 'system-a31', roles: ['system'], source: 'SOFIA_WHATSAPP' },
      ),
    ).rejects.toMatchObject({ response: { code: 'SOFIA_DRAFT_OWNED_BY_CONVERSATION_AUTHORITY' } });

    // The zombie draft is untouched (still READY_TO_CONFIRM, still unexpired, still real draftHash) --
    // it cannot be confirmed via this path either (A28 holds), but the conversation is now stuck
    // hitting this uncaught exception on every legacy-routed turn until the draft expires.
    const stillThere = await prisma.sofiaOrderDraft.findUnique({ where: { id: draftId } });
    expect(stillThere?.status).toBe(SofiaOrderDraftStatus.READY_TO_CONFIRM);
    expect(stillThere?.draftHash).toBe('a31-test-draft-hash');
  });
});
