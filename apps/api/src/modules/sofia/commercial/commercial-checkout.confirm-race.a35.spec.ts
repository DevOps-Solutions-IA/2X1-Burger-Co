/**
 * A35 (Round 5, blind, FINAL VERIFICATION PASS) — RED TEAM FINDING, CLOSED BY A36.
 *
 * Invariant originally broken: "no uncaught exceptions on foreseeable business/guard conditions"
 * (explicitly in the standing invariant set for this round) + "every durable-state writer ... sharing
 * the same concurrency-safety guarantees" (the FINAL confirmation write was the one CAS in the whole
 * confirm() pipeline that was NOT given the same graceful-recovery treatment its sibling races get).
 *
 * ATTACK SCENARIO
 * ----------------
 * A real customer double/triple-taps "send" on WhatsApp for their confirmation reply ("Sí" /
 * "Confirmo") — three ordinary, human-generated messages with three DIFFERENT provider message
 * IDs and (very likely) three different bodies-hashes/timestamps, arriving moments apart. This is
 * explicitly NOT a dedup-eligible provider retry (WhatsappInboundDeduplicator.claim() dedupes by
 * `eventHash`/`messageId` — see whatsapp-inbound-deduplicator.ts — a genuinely distinct message ID
 * is never deduplicated) and is NOT serialized against itself at the application layer: the only
 * per-conversation exclusivity mechanism is `SofiaWhatsappService.withInboundAgentLease()`
 * (sofia-whatsapp.service.ts:601), which wraps a SINGLE already-claimed inbound event -- it does
 * NOT serialize two DIFFERENT, already-claimed inbound events (two distinct message IDs) against
 * each other. Two worker ticks (or two concurrent webhook deliveries) can therefore genuinely
 * concurrently call `CommercialCheckoutService.process()` for the SAME conversationId with the SAME
 * CONFIRM intent.
 *
 * `CommercialCheckoutService.confirm()` already has a full, well-documented defense for a RELATED
 * race: if `saveDraft()`'s own CAS discovers the tracked draft was already CONFIRMED by another
 * writer, it throws `DraftAlreadyConfirmedError`, and EVERY call site of `prepareDraft()` inside
 * this file (process()'s main path, confirm()'s expiry-refresh path, confirm()'s price-refresh
 * path) explicitly catches it and recovers gracefully via `respondDraftAlreadyConfirmed()` -- which
 * reloads the authoritative persisted state and tells the customer their order is already
 * confirmed, producing a normal `CommercialTurnResult` instead of a rejected promise.
 *
 * But `confirm()`'s OWN, final, unconditional call --
 *
 *   await this.repository.confirmDraft({ draftId: state.draftId, expectedVersion: state.draftVersion,
 *     expectedHash: state.draftHash, confirmationHash });
 *
 * -- (commercial-checkout.service.ts:500) is NOT wrapped in any try/catch at all.
 * `PrismaCommercialRepository.confirmDraft()` performs its own CAS
 * (`sofiaOrderDraft.updateMany({ where: { id, version, draftHash, status: READY_TO_CONFIRM,
 * expiresAt: { gt: now } } })`) and throws a bare `ConflictException({ code:
 * 'SOFIA_STALE_CONFIRMATION' })` whenever `updated.count !== 1` -- which is EXACTLY what happens
 * when two concurrent "Sí" turns both pass every earlier guard (both read the same PENDING draft,
 * both see `quoteStillBound === true`, both see the quote/draft unexpired) and then race the same
 * UPDATE ... WHERE status = 'READY_TO_CONFIRM'. Postgres correctly serializes the two UPDATEs and
 * only ONE can ever match (this part of the system remains financially sound -- there is only ever
 * ONE OrderCheckout /  ONE CONFIRMED SofiaOrderDraft) -- but the LOSING turn's `confirm()` call, and
 * therefore its whole `CommercialCheckoutService.process()` promise, REJECTS with an uncaught
 * `ConflictException` instead of returning a `CommercialTurnResult` the same way
 * `respondDraftAlreadyConfirmed()` does for the sibling race one layer up.
 *
 * BUSINESS IMPACT (as originally found)
 * ----------------------------------------
 * This was never a financial-correctness bug (no double charge, no duplicate order, no lost evidence
 * -- exactly one confirmation ever lands). It was a robustness/availability gap that was explicitly
 * in scope for this round ("no uncaught exceptions on foreseeable business/guard conditions"):
 *   - `SofiaWhatsappService.processInboundWebhook()`'s outer try/catch (sofia-whatsapp.service.ts:
 *     ~270) marks the inbound claim FAILED and RE-THROWS -- the losing WhatsApp message's turn
 *     produced no `sofia_conversation_memories`/audit update, no composed customer-facing reply,
 *     and surfaced a raw internal exception to whatever calls the webhook handler, exactly the kind
 *     of ungoverned failure mode the sibling `DraftAlreadyConfirmedError` path was hardened
 *     specifically to avoid one layer below.
 *   - The customer's second/third confirming tap got no coherent "ya confirmamos tu pedido"
 *     acknowledgment (unlike a slow-but-legitimate REPLAY, which IS handled gracefully by the
 *     `parsed.affirmative && previous.confirmationState === 'CONFIRMED'` fast path at the TOP of
 *     `process()` -- that fast path only works when the SECOND turn starts strictly AFTER the FIRST
 *     turn's `saveState()` has already committed; the genuinely-concurrent case proven here starts
 *     before either commits).
 *
 * A36 FIX (this file now proves the FIXED behavior, not the bug)
 * -------------------------------------------------------------
 * `CommercialCheckoutService.confirm()`'s final `repository.confirmDraft()` call is now wrapped in a
 * try/catch that recognizes `ConflictException({code:'SOFIA_STALE_CONFIRMATION'})` and routes it to
 * `recoverStaleConfirmation()`, which reads the CURRENT authoritative `SofiaOrderDraft` row directly
 * (`repository.loadDraftVersion()`, bypassing the conversation-memory snapshot the concurrent winner
 * may not have committed yet) and -- when it confirms the draft really is now CONFIRMED, which is the
 * overwhelmingly common cause of this exact CAS failure -- reuses the SAME `respondDraftAlreadyConfirmed()`
 * recovery its sibling `DraftAlreadyConfirmedError` race already had. The losing turn now resolves to a
 * normal `CommercialTurnResult` (`nextAction: 'DRAFT_CONFIRMED'`) instead of a rejected promise.
 *
 * This test proves the FIXED behavior directly against REAL, unmocked `CommercialCheckoutService` +
 * `PrismaCommercialRepository` + REAL Postgres (only the non-financial collaborators --
 * catalog/product-availability/customer-resolution/delivery-quotes/audit/order-creation -- are
 * stubbed, exactly as every other file in this directory does for domain services that are not the
 * subject under test).
 */

import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import { CommercialResponseValidator } from './response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from './response/safe-commercial-response.templates';

describe('A35/A36: confirmDraft() CAS failure now recovers gracefully, same as its sibling DraftAlreadyConfirmedError race', () => {
  let prisma: PrismaService;
  let repository: PrismaCommercialRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A35 confirm-race test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaCommercialRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function buildService() {
    const product = {
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
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), new CommercialMetricsService(), responses, repository,
      { listActive: jest.fn(async () => [product]), getActiveById: jest.fn(async () => product), findActive: jest.fn() } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId: null, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote: jest.fn() } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service, orderCreation };
  }

  const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

  it('two genuinely concurrent "Sí" turns for the same conversation: one confirms, the other now resolves gracefully to a coherent "already confirmed" CommercialTurnResult instead of rejecting', async () => {
    const conversationId = `a35-race-${randomUUID()}`;
    // Real FK target for SofiaOrderDraft.conversationId -- mirrors a genuine WhatsApp conversation.
    await prisma.whatsappConversation.create({
      data: { id: conversationId, phone: '573001112233', provider: 'mock' },
    });

    const { service } = buildService();

    // Turn 1: build a real, priced TAKEAWAY draft (no delivery-quote dependency needed) and get it
    // to PENDING confirmation, exactly like every other spec file in this directory.
    const built = await service.process({
      conversationId,
      phone: '573001112233',
      message: 'Dame un combo 2x1, lo recojo y pago allá',
      actor,
    });
    expect(built.nextAction).toBe('READY_TO_CONFIRM');
    expect(built.state.draftId).toBeTruthy();
    expect(built.state.confirmationState).toBe('PENDING');

    // Turn 2 and Turn 3: TWO DIFFERENT, genuinely concurrent WhatsApp messages (different message
    // IDs at the transport layer -- this test proves the CommercialCheckoutService/repository
    // layer, which has no notion of message identity at all) both carrying the SAME confirming
    // intent, racing each other for the SAME conversationId. Neither has observed the other's
    // result yet -- both `process()` calls independently call `repository.loadState()` before
    // either has committed anything.
    const settled = await Promise.allSettled([
      service.process({ conversationId, phone: '573001112233', message: 'Sí', actor }),
      service.process({ conversationId, phone: '573001112233', message: 'Sí', actor }),
    ]);

    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof service.process>>>[];
    const rejected = settled.filter((entry) => entry.status === 'rejected') as PromiseRejectedResult[];

    // THE FINANCIAL OUTCOME IS CORRECT (unchanged by the fix): exactly one turn actually confirms at
    // the DB level. Asserted again below via `repository.loadState()`.

    // A36 CLOSURE: NEITHER turn rejects anymore. Both `process()` calls now resolve to a normal
    // `CommercialTurnResult` -- the losing turn recovers via the SAME graceful path
    // `DraftAlreadyConfirmedError`'s sibling race already used (`respondDraftAlreadyConfirmed()`,
    // reached this time through `recoverStaleConfirmation()`), instead of blowing up the whole call
    // with an uncaught `ConflictException({code:'SOFIA_STALE_CONFIRMATION'})`.
    expect(rejected).toHaveLength(0);
    expect(fulfilled).toHaveLength(2);
    for (const entry of fulfilled) {
      // Both turns tell the customer the SAME true outcome: their order is confirmed. The winning
      // turn reaches this via `confirm()`'s normal success path; the losing turn reaches the exact
      // same `nextAction`/`confirmationState`/`draftId` via `recoverStaleConfirmation()` ->
      // `respondDraftAlreadyConfirmed()`.
      expect(entry.value.nextAction).toBe('DRAFT_CONFIRMED');
      expect(entry.value.state.confirmationState).toBe('CONFIRMED');
      expect(entry.value.state.draftId).toBe(built.state.draftId);
    }

    // Durable state itself stays correct (no duplicate confirmed record, no corruption) -- this
    // closure is about the previously-missing graceful-degradation path, not about financial/evidence
    // correctness, which was always intact.
    const finalState = await repository.loadState(conversationId);
    expect(finalState!.confirmationState).toBe('CONFIRMED');
    expect(finalState!.draftId).toBe(built.state.draftId);
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a35-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a35-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a35-' } } });
  });
});
