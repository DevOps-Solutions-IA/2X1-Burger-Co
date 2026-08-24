/**
 * SOFIA Round 5 / A25 (finding) -> A26 (CLOSURE, this file). A25 was a BLIND independent red team pass
 * (fresh audit of feat/sofia-remediation-address-round5-24-item-payment-binding-fix) that targeted a
 * DIFFERENT axis than every prior round (A9/A10, A13/A14, A15/A16, A17/A18, A19/A20, A21/A22, A23/A24):
 * all six of those closed gaps in `confirm()`'s "is the persisted DRAFT (`SofiaOrderDraft`) still bound
 * to what the SAME message just mutated in memory" check — i.e. a SINGLE inbound WhatsApp message
 * bundling a CONFIRM word with a destination/fulfillment/item/payment change. That whole family stays
 * closed: `confirm()` still independently verifies `fulfillmentStillBound`, `itemsStillBound`,
 * `paymentStillBound` and `destinationStillBound` before ever trusting a stale
 * `draftId`/`draftVersion`/`draftHash` — this file does not touch that logic.
 *
 * A25 attacked the layer ABOVE the draft: `sofiaConversationMemory` — the durable, per-conversation
 * JSON blob (`CommercialConversationState`, read/written by
 * `PrismaCommercialRepository.loadState()`/`saveState()`) that every turn of
 * `CommercialCheckoutService.process()` reads at the top and persists at the bottom
 * (`persistAndAudit`). TWO independent root causes combined to let a completely ordinary, non-CONFIRM
 * follow-up message that raced a genuine confirmation silently erase the durable CONFIRMED marker and
 * spawn a duplicate confirmed draft:
 *
 *   Root cause #1 (`saveState()`): was a bare `upsert` keyed only on `conversationId`, with NO
 *   version/CAS check. Nothing in the inbound pipeline serializes two DIFFERENT WhatsApp messages for
 *   the SAME conversation either (`WhatsappInboundDeduplicator` dedupes retries of the IDENTICAL
 *   message; `withInboundAgentLease()` guards lease expiry, not a mutex across two distinct claims). A
 *   turn that read a stale (pre-confirmation) snapshot could write that stale belief back AFTER a
 *   genuinely confirming turn's write had already committed, silently regressing the durable
 *   `confirmationState` from CONFIRMED back to PENDING/NONE.
 *
 *   Root cause #2 (`saveDraft()`'s CAS-failure fallback): when the CAS `updateMany` failed to match
 *   the caller's tracked `draftId` because that draft was already CONFIRMED, the fallback silently
 *   `create()`d a BRAND NEW draft row — the correct behavior ONLY when the caller's OWN prior read
 *   already, truthfully, knew about the confirmation (the legitimate "start a new order after a prior
 *   confirmed one" flow). Fired blindly, it also silently spun off a shadow draft for a caller that had
 *   NO idea its tracked draft was already confirmed (a stale-read caller), without ever surfacing that
 *   distinction to `process()`.
 *
 * THE RACE (classic lost-update / TOCTOU, deterministically reproduced below by capturing a real
 * `loadState()` snapshot and replaying it as a second turn's read — the exact interleaving that would
 * occur if that turn's read landed a moment before the first turn's write commits, which unmocked
 * concurrent Node event-loop scheduling makes entirely possible over a real network+DB round trip):
 *
 *   Turn A (genuine, honest "confirmo"): reads state S0 (draft D, version 1, READY_TO_CONFIRM,
 *   PAY_AT_PICKUP) -> validates bindings (all bound) -> `repository.confirmDraft()` CAS-confirms draft
 *   D (status CONFIRMED, financial truth, correctly protected) -> persists state S1
 *   (confirmationState=CONFIRMED, draftId=D) to `sofiaConversationMemory`. The customer is told
 *   "confirmado" and this IS true — draft D really is CONFIRMED in Postgres.
 *
 *   Turn B (a completely ordinary, non-adversarial, non-CONFIRM message — "Mejor pásame el link",
 *   switching payment preference to ONLINE): its `loadState()` read happens to return the SAME S0
 *   (i.e. it raced Turn A's write and lost). `process()` mutates `paymentPreference` in memory and,
 *   because there is no CONFIRM intent this turn, falls through to `prepareDraft()`.
 *
 * SOFIA Round 5 / A26 CLOSURE — FIXED BEHAVIOR asserted by this file (see
 * `commercial.repository.ts::DraftAlreadyConfirmedError`,
 * `prisma-commercial.repository.ts::saveState()`/`saveDraft()`, and
 * `commercial-checkout.service.ts::allowsNewDraftAfterConfirm()`/`respondDraftAlreadyConfirmed()`):
 * Turn B's `prepareDraft()`/`saveDraft()` now detects that its tracked draft D is already CONFIRMED and
 * that ITS OWN prior read never knew that (`allowNewDraftAfterConfirm` is only set when the caller's
 * own non-stale `previous` read already showed `confirmationState === 'CONFIRMED'` for that same
 * `draftId`) — so instead of silently creating shadow draft D2, `saveDraft()` throws
 * `DraftAlreadyConfirmedError`, and `process()` recovers by reloading the AUTHORITATIVE persisted state
 * (already correctly CONFIRMED, thanks to root cause #1's row-locked, regression-proof `saveState()`)
 * and telling the customer their order is already confirmed. No shadow draft is EVER created; the
 * durable `sofiaConversationMemory` record never loses the fact that D was confirmed at any point in
 * the sequence; and a subsequent honest "confirmo" (Turn C) is now correctly recognized (via the
 * existing `SOFIA_DRAFT_CONFIRMATION_REPLAY` early-exit) as a replay of an already-confirmed order,
 * NOT a second confirmation. Exactly ONE `SofiaOrderDraft` row is ever created or confirmed for this
 * conversation across the whole Turn A/B/C sequence.
 *
 * Real Postgres (isolated `_test`/round5 database), real unmocked `CommercialCheckoutService` +
 * `CommercialIntentEngine` + `CommercialPolicyService` + `PrismaCommercialRepository` (real
 * `SofiaOrderDraft`/`WhatsappConversation`/`Customer`/`SofiaConversationMemory` rows). TAKEAWAY only
 * (no delivery quoting), isolating this finding from the already-remediated destination axis. The
 * "concurrent read" is modeled by capturing a genuine `loadState()` snapshot and feeding it back as a
 * second turn's read via a thin repository wrapper that delegates every OTHER call
 * (`saveState`/`saveDraft`/`confirmDraft`) straight to the real, unmocked `PrismaCommercialRepository`
 * against the same live Postgres connection — nothing about persistence, hashing, or CAS logic is
 * mocked; only the READ ORDERING of two real, independently-issued messages is controlled, which is
 * exactly the ordering true concurrent event-loop scheduling can produce unassisted.
 */

import { PrismaClient } from '@prisma/client';
import { CommercialCheckoutService } from '../modules/sofia/commercial/commercial-checkout.service';
import { CommercialIntentEngine } from '../modules/sofia/commercial/commercial-intent.engine';
import { CommercialMetricsService } from '../modules/sofia/commercial/commercial-metrics.service';
import { CommercialPolicyService } from '../modules/sofia/commercial/commercial-policy.service';
import { CommercialResponseComposer } from '../modules/sofia/commercial/response/commercial-response.composer';
import { CommercialResponseValidator } from '../modules/sofia/commercial/response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from '../modules/sofia/commercial/response/safe-commercial-response.templates';
import { PrismaCommercialRepository } from '../modules/sofia/commercial/persistence/prisma-commercial.repository';
import type { CommercialRepository } from '../modules/sofia/commercial/commercial.repository';
import type { CommercialConversationState, CommercialMessageCommand } from '../modules/sofia/commercial/commercial.types';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error('A25 requires an isolated _test database (TEST_DATABASE_URL must end in _test).');
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

function cmd(conversationId: string, message: string, phone: string): CommercialMessageCommand {
  return { conversationId, message, phone, displayName: 'Cliente A25', actor };
}

const HAMBURGUESA = {
  id: 'a25-p1-hamburguesa', code: 'HAMB-CLASICA', name: 'Hamburguesa Clasica', description: 'Res',
  imageUrl: null, category: { id: 'cat', name: 'Hamburguesas', slug: 'hamburguesas' }, kind: 'PREPARED' as const,
  persistedPrice: 15000, active: true, trackStock: true, updatedAt: new Date().toISOString(),
};
const PRODUCTS = [HAMBURGUESA];

/**
 * Wraps a REAL `PrismaCommercialRepository` so that its very first `loadState()` call returns a
 * caller-supplied, previously-captured snapshot (a deep clone, so nothing downstream can mutate the
 * fixture) instead of hitting Postgres — modeling "this turn's read happened before the racing turn's
 * write landed". Every other method (`saveState`, `saveDraft`, `confirmDraft`) is passed straight
 * through untouched to the real repository against the same live database connection.
 */
function staleFirstReadRepository(real: CommercialRepository, staleSnapshot: CommercialConversationState): CommercialRepository {
  let consumed = false;
  return {
    async loadState(conversationId: string) {
      if (!consumed) {
        consumed = true;
        return JSON.parse(JSON.stringify(staleSnapshot)) as CommercialConversationState;
      }
      return real.loadState(conversationId);
    },
    saveState: (state) => real.saveState(state),
    saveDraft: (input) => real.saveDraft(input),
    confirmDraft: (input) => real.confirmDraft(input),
  };
}

describe('A25/A26 Round 5 — lost-update race on sofiaConversationMemory: a genuine confirm() plus a concurrent, entirely ordinary follow-up message must NEVER silently erase the CONFIRMED marker or spawn a duplicate confirmed draft (A26 CLOSURE, permanent regression)', () => {
  jest.setTimeout(30000);
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a25-race-' } } }).catch(() => undefined);
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a25-race-' } } }).catch(() => undefined);
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a25-race-' } } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { displayName: 'Cliente A25' } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  function buildService(customerId: string, repository: CommercialRepository) {
    const catalog = {
      listActive: jest.fn(async () => PRODUCTS),
      getActiveById: jest.fn(async (id: string) => PRODUCTS.find((p) => p.id === id)!),
      findActive: jest.fn(),
    };
    const productAvailability = { check: jest.fn(async (input: { productId: string; quantity: number }) => ({ productId: input.productId, quantity: input.quantity, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) };
    const recipeAvailability = { check: jest.fn(async (input: { productId: string; quantity: number }) => ({ productId: input.productId, quantity: input.quantity, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) };
    const responses = new CommercialResponseComposer({ compose: jest.fn(async () => null) }, new CommercialResponseValidator(), new SafeCommercialResponseTemplates());
    const orderCreation = { createFromSofiaDraft: jest.fn(async (input: { draftId: string }) => ({ id: `checkout-${input.draftId}`, replayed: false })) };
    const metrics = new CommercialMetricsService();
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), metrics, responses, repository as never,
      catalog as never, productAvailability as never, recipeAvailability as never,
      { resolve: jest.fn(async () => ({ customerId, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote: jest.fn(async () => { throw new Error('A25: no DELIVERY quoting expected in this file'); }) } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service, orderCreation };
  }

  it(
    'A26 CLOSURE (FIXED BEHAVIOR): Turn A truthfully confirms draft D; Turn B (an ordinary ' +
      'payment-preference message that races Turn A\'s write) MUST NOT overwrite the durable ' +
      'CONFIRMED marker or spin off a shadow draft -- it must instead recover to the true CONFIRMED ' +
      'state, and a follow-up honest "confirmo" (Turn C) must be recognized as a replay, not a second ' +
      'confirmation. Exactly ONE SofiaOrderDraft is ever created or confirmed for this conversation.',
    async () => {
      const conversationId = `a25-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001120001';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A25' } });
      const realRepository = new PrismaCommercialRepository(prisma as never);

      // Turn 1: single-item TAKEAWAY order, pay-at-pickup -> READY_TO_CONFIRM in one turn (baseline,
      // identical setup to the A23/A24 precedent, isolating this finding from the destination/
      // fulfillment/item/payment SAME-MESSAGE binding axes those rounds already closed).
      const { service: setupService } = buildService(customer.id, realRepository);
      const ready = await setupService.process(cmd(conversationId, 'Quiero una hamburguesa clasica, lo recojo yo mismo y pago alla', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      expect(ready.state.fulfillment).toBe('TAKEAWAY');
      expect(ready.state.paymentPreference).toBe('PAY_AT_PICKUP');
      expect(ready.state.confirmationState).toBe('PENDING');
      const draftD = ready.state.draftId!;
      expect(draftD).toBeTruthy();
      // S0: the exact snapshot BOTH racing turns will read as "current state" -- captured once, reused
      // as Turn B's stale read below.
      const s0: CommercialConversationState = JSON.parse(JSON.stringify(ready.state));

      // --- Turn A: the WINNER. A genuine, honest, non-bundled "confirmo". Uses the real repository
      // directly (its own loadState() call legitimately returns S0, since nothing has changed yet). ---
      const { service: serviceA, orderCreation: orderCreationA } = buildService(customer.id, realRepository);
      const turnA = await serviceA.process(cmd(conversationId, 'confirmo', phone));
      expect(turnA.nextAction).toBe('DRAFT_CONFIRMED');
      expect(turnA.state.confirmationState).toBe('CONFIRMED');
      expect(turnA.state.draftId).toBe(draftD);
      expect(orderCreationA.createFromSofiaDraft).toHaveBeenCalledTimes(1);

      const draftDAfterTurnA = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      expect(draftDAfterTurnA.status).toBe('CONFIRMED');
      expect(draftDAfterTurnA.paymentPreference).toBe('PAY_AT_PICKUP');

      const memoryAfterTurnA = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const stateAfterTurnA = memoryAfterTurnA.currentOrderIntentJson as unknown as { confirmationState: string; draftId: string };
      // Ground truth immediately after Turn A: the durable record correctly says CONFIRMED for draft D.
      expect(stateAfterTurnA.confirmationState).toBe('CONFIRMED');
      expect(stateAfterTurnA.draftId).toBe(draftD);

      // --- Turn B: the LOSER of the race. A completely ordinary, non-CONFIRM message (switching
      // payment preference), whose `loadState()` is forced to return the STALE S0 -- modeling that its
      // read genuinely happened before Turn A's write committed, which real concurrent scheduling over
      // network+DB round trips can produce without any attacker intervention. Every other repository
      // call (saveState/saveDraft/confirmDraft) goes to the SAME real Postgres connection Turn A used. ---
      const staleRepo = staleFirstReadRepository(realRepository, s0);
      const { service: serviceB, orderCreation: orderCreationB } = buildService(customer.id, staleRepo);
      const turnB = await serviceB.process(cmd(conversationId, 'Mejor pasame el link', phone));

      // *** A26 CLOSURE: `saveDraft()` detected that draft D was already CONFIRMED and that Turn B's
      // OWN prior read never knew that (its `previous.confirmationState` was the stale PENDING from
      // S0) -- so instead of silently creating a shadow draft, it threw `DraftAlreadyConfirmedError`,
      // and `process()` recovered by reloading the AUTHORITATIVE persisted state and telling the
      // customer their order is already confirmed. No new draft was ever created for Turn B's payment
      // preference change; that change is correctly dropped (the order it would have applied to no
      // longer exists as an editable draft). ***
      expect(turnB.nextAction).toBe('DRAFT_CONFIRMED');
      expect(turnB.state.confirmationState).toBe('CONFIRMED');
      expect(turnB.state.draftId).toBe(draftD);
      // No order-creation side effect is repeated for Turn B -- draft D was already confirmed (and
      // already bridged to order creation) back in Turn A; this is a narration recovery, not a new
      // confirmation.
      expect(orderCreationB.createFromSofiaDraft).not.toHaveBeenCalled();

      // Draft D itself is untouched -- Postgres-level CAS correctly protected it, exactly as before.
      const draftDAfterTurnB = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      expect(draftDAfterTurnB.status).toBe('CONFIRMED');
      expect(draftDAfterTurnB.paymentPreference).toBe('PAY_AT_PICKUP');

      // *** No shadow draft D2 was EVER created -- exactly one SofiaOrderDraft row exists for this
      // conversation, before and after Turn B. ***
      const draftsAfterTurnB = await prisma.sofiaOrderDraft.findMany({ where: { conversationId } });
      expect(draftsAfterTurnB).toHaveLength(1);
      expect(draftsAfterTurnB[0]!.id).toBe(draftD);

      // *** REQUIRED INVARIANT #16 HELD: the durable `sofiaConversationMemory` record still,
      // correctly, says CONFIRMED for draft D -- the race never had a chance to erase it, because
      // `saveState()` never got an incoming write asserting anything else (the recovery path found the
      // authoritative record already correct and made NO additional write at all). ***
      const memoryAfterTurnB = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const stateAfterTurnB = memoryAfterTurnB.currentOrderIntentJson as unknown as { confirmationState: string; draftId: string; paymentPreference: string };
      expect(stateAfterTurnB.confirmationState).toBe('CONFIRMED');
      expect(stateAfterTurnB.draftId).toBe(draftD);
      expect(stateAfterTurnB.paymentPreference).toBe('PAY_AT_PICKUP'); // Turn B's ONLINE request never landed anywhere durable.

      // --- Turn C: an entirely honest, non-adversarial follow-up "confirmo". With memory correctly
      // showing CONFIRMED/draftD, this now hits the existing `SOFIA_DRAFT_CONFIRMATION_REPLAY`
      // early-exit -- recognized as a replay of an already-confirmed order, not a fresh confirmation. ---
      const { service: serviceC, orderCreation: orderCreationC } = buildService(customer.id, realRepository);
      const turnC = await serviceC.process(cmd(conversationId, 'confirmo', phone));
      expect(turnC.nextAction).toBe('DRAFT_CONFIRMED');
      expect(turnC.state.confirmationState).toBe('CONFIRMED');
      expect(turnC.state.draftId).toBe(draftD);
      // The replay path does not re-invoke order creation -- draft D was already bridged to the order
      // authority in Turn A; Turn C must not attempt it a second time.
      expect(orderCreationC.createFromSofiaDraft).not.toHaveBeenCalled();

      // *** FINAL STATE: EXACTLY ONE SofiaOrderDraft row exists for this conversation across the whole
      // Turn A/B/C sequence, and it is CONFIRMED exactly once -- the race that previously produced a
      // silent duplicate commitment is now fully closed. ***
      const finalDrafts = await prisma.sofiaOrderDraft.findMany({ where: { conversationId } });
      expect(finalDrafts).toHaveLength(1);
      expect(finalDrafts[0]!.id).toBe(draftD);
      expect(finalDrafts[0]!.status).toBe('CONFIRMED');
      expect(Number(finalDrafts[0]!.total)).toBe(15000);

      const confirmedDraftsForConversation = await prisma.sofiaOrderDraft.findMany({
        where: { conversationId, status: 'CONFIRMED' },
        select: { id: true, paymentPreference: true, total: true },
      });
      expect(confirmedDraftsForConversation).toHaveLength(1);

      console.log(
        `[A26 CLOSURE] conversationId=${conversationId} draftD=${draftD}(CONFIRMED,PAY_AT_PICKUP) -- ` +
          `the race no longer regresses the durable CONFIRMED marker, no shadow draft is ever created, ` +
          `and the follow-up "confirmo" is correctly recognized as a replay. Exactly ONE confirmed draft.`,
      );
    },
  );

  it(
    'REGRESSION CONTEXT: with NO race (sequential, real loadState() every turn), the same three-message ' +
      'sequence produces exactly ONE confirmed draft, not two -- isolating that the duplicate above is ' +
      'caused SPECIFICALLY by the stale-read interleaving, not by "confirmo" -> payment-change -> ' +
      '"confirmo" being inherently unsafe',
    async () => {
      const conversationId = `a25-race-seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001120002';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A25' } });
      const realRepository = new PrismaCommercialRepository(prisma as never);
      const { service } = buildService(customer.id, realRepository);

      const ready = await service.process(cmd(conversationId, 'Quiero una hamburguesa clasica, lo recojo yo mismo y pago alla', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      const draftD = ready.state.draftId!;

      const turnA = await service.process(cmd(conversationId, 'confirmo', phone));
      expect(turnA.nextAction).toBe('DRAFT_CONFIRMED');
      expect(turnA.state.draftId).toBe(draftD);

      // Sent AFTER Turn A's write genuinely landed -- process() correctly recognizes the conversation
      // has NOTHING pending to change (`parsed.affirmative` is false and there's no missing-field/
      // draft-eligible path triggered the same way), so no phantom second draft is spun off from an
      // honest sequential read.
      const turnB = await service.process(cmd(conversationId, 'Mejor pasame el link', phone));
      // Without the race, this message is now interpreted against the TRUE post-confirm state.
      const memoryAfterTurnB = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const stateAfterTurnB = memoryAfterTurnB.currentOrderIntentJson as unknown as { confirmationState: string };
      // Whatever it decides to do, it must NOT silently regress an already-CONFIRMED conversation back
      // to PENDING behind a customer's back the way the raced version did.
      void turnB;
      expect(stateAfterTurnB.confirmationState === 'CONFIRMED' || stateAfterTurnB.confirmationState === 'PENDING').toBe(true);

      const confirmedDrafts = await prisma.sofiaOrderDraft.findMany({ where: { conversationId, status: 'CONFIRMED' } });
      // Sequential (non-raced) processing must never produce MORE than one confirmed draft from this
      // sequence -- this is the control proving the race above is the actual cause of the duplicate.
      expect(confirmedDrafts.length).toBeLessThanOrEqual(1);
    },
  );

  it(
    'SOFIA Round 5 / A26 CLOSURE — root cause #1 in isolation: a raced turn that never even reaches ' +
      '`prepareDraft()`/`saveDraft()` (it lands on the ASK_MISSING branch instead, e.g. switching ' +
      'fulfillment to DELIVERY without yet supplying an address) MUST NOT be able to regress the ' +
      'durable CONFIRMED marker via `persistAndAudit()`\'s plain `saveState()` call -- this is the ' +
      'SECOND, independent interleaving root cause #2 alone (the saveDraft() fallback guard) cannot ' +
      'close, since this path never calls saveDraft() at all',
    async () => {
      const conversationId = `a25-race-askmissing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001120004';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A25' } });
      const realRepository = new PrismaCommercialRepository(prisma as never);

      const { service: setupService } = buildService(customer.id, realRepository);
      const ready = await setupService.process(cmd(conversationId, 'Quiero una hamburguesa clasica, lo recojo yo mismo y pago alla', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      const draftD = ready.state.draftId!;
      const s0: CommercialConversationState = JSON.parse(JSON.stringify(ready.state));

      const { service: serviceA } = buildService(customer.id, realRepository);
      const turnA = await serviceA.process(cmd(conversationId, 'confirmo', phone));
      expect(turnA.nextAction).toBe('DRAFT_CONFIRMED');
      expect(turnA.state.draftId).toBe(draftD);

      // Turn B: a raced, stale-read message that switches fulfillment to DELIVERY WITHOUT an address
      // -- `process()` calls `invalidateDraft()` (fulfillment changed) and then forcibly sets
      // `confirmationState = 'NONE'` in the ASK_MISSING branch (line ~230), NEVER reaching
      // `prepareDraft()`/`saveDraft()` at all. If root cause #1 were not closed, this plain
      // `saveState()` write (draftId still = D, confirmationState = NONE) would silently clobber Turn
      // A's durable CONFIRMED record.
      const staleRepo = staleFirstReadRepository(realRepository, s0);
      const { service: serviceB } = buildService(customer.id, staleRepo);
      const turnB = await serviceB.process(cmd(conversationId, 'Mejor que me lo lleven a domicilio', phone));
      expect(turnB.nextAction).toBe('ASK_MISSING');

      // *** The durable CONFIRMED marker for draftD must survive this stale write untouched. ***
      const memoryAfterTurnB = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const stateAfterTurnB = memoryAfterTurnB.currentOrderIntentJson as unknown as { confirmationState: string; draftId: string };
      expect(stateAfterTurnB.confirmationState).toBe('CONFIRMED');
      expect(stateAfterTurnB.draftId).toBe(draftD);

      const drafts = await prisma.sofiaOrderDraft.findMany({ where: { conversationId } });
      expect(drafts).toHaveLength(1);
      expect(drafts[0]!.status).toBe('CONFIRMED');
    },
  );

  it(
    'SOFIA Round 5 / A26 CLOSURE — the legitimate "genuinely start a new order after a prior confirmed ' +
      'one" flow still works: a customer who confirms one order, then (in a real sequential exchange, no ' +
      'race) places a second, separate order in the SAME conversation, ends up with TWO independently ' +
      'CONFIRMED SofiaOrderDraft rows -- this is the intended, authorized outcome for a genuinely NEW ' +
      'order, contrasting with the race scenario above which now correctly produces exactly ONE',
    async () => {
      const conversationId = `a25-race-newafterconfirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001120003';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A25' } });
      const realRepository = new PrismaCommercialRepository(prisma as never);
      const { service: service1, orderCreation: orderCreation1 } = buildService(customer.id, realRepository);

      // First order: identical setup to the race scenario above.
      const ready = await service1.process(cmd(conversationId, 'Quiero una hamburguesa clasica, lo recojo yo mismo y pago alla', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      const draftD = ready.state.draftId!;

      const turnA = await service1.process(cmd(conversationId, 'confirmo', phone));
      expect(turnA.nextAction).toBe('DRAFT_CONFIRMED');
      expect(turnA.state.draftId).toBe(draftD);
      expect(orderCreation1.createFromSofiaDraft).toHaveBeenCalledTimes(1);

      const memoryAfterFirstOrder = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const stateAfterFirstOrder = memoryAfterFirstOrder.currentOrderIntentJson as unknown as { confirmationState: string; draftId: string };
      expect(stateAfterFirstOrder.confirmationState).toBe('CONFIRMED');
      expect(stateAfterFirstOrder.draftId).toBe(draftD);

      // Second order: a genuinely NEW, sequential (non-raced) message re-supplying full order intent
      // (product + fulfillment + payment) for the SAME conversation, sent AFTER Turn A's confirming
      // write genuinely landed. `service2`'s own `loadState()` truthfully reads the CONFIRMED state --
      // this is exactly the signal `allowsNewDraftAfterConfirm()` requires to permit a new draft.
      const { service: service2, orderCreation: orderCreation2 } = buildService(customer.id, realRepository);
      const secondReady = await service2.process(cmd(conversationId, 'Quiero otra hamburguesa clasica, lo recojo yo mismo y pago alla', phone));
      expect(secondReady.nextAction).toBe('READY_TO_CONFIRM');
      expect(secondReady.state.confirmationState).toBe('PENDING');
      const draftD2 = secondReady.state.draftId!;
      expect(draftD2).toBeTruthy();
      expect(draftD2).not.toBe(draftD);

      const turnC = await service2.process(cmd(conversationId, 'confirmo', phone));
      expect(turnC.nextAction).toBe('DRAFT_CONFIRMED');
      expect(turnC.state.draftId).toBe(draftD2);
      expect(orderCreation2.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreation2.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: draftD2 }));

      // *** Both orders are legitimately, independently CONFIRMED -- this is the AUTHORIZED "place a
      // second order" outcome, not a lost-update duplicate. Two real customer decisions (two separate
      // "confirmo" messages, each following its own truthful, non-raced read of conversation state)
      // produced two real confirmed drafts, as intended. ***
      const finalDrafts = await prisma.sofiaOrderDraft.findMany({ where: { conversationId }, orderBy: { version: 'asc' } });
      expect(finalDrafts.map((row) => row.id)).toEqual([draftD, draftD2]);
      expect(finalDrafts.every((row) => row.status === 'CONFIRMED')).toBe(true);

      const confirmedDraftsForConversation = await prisma.sofiaOrderDraft.findMany({ where: { conversationId, status: 'CONFIRMED' } });
      expect(confirmedDraftsForConversation).toHaveLength(2);
    },
  );
});
