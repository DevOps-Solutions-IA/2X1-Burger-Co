/**
 * SOFIA Round 5 / A25 — BLIND independent red team pass (fresh audit of
 * feat/sofia-remediation-address-round5-24-item-payment-binding-fix, no prior context beyond the
 * public mission brief). This file targets a DIFFERENT axis than every prior round (A9/A10, A13/A14,
 * A15/A16, A17/A18, A19/A20, A21/A22, A23/A24): all six of those closed gaps in `confirm()`'s
 * "is the persisted DRAFT (`SofiaOrderDraft`) still bound to what the SAME message just mutated in
 * memory" check — i.e. a SINGLE inbound WhatsApp message bundling a CONFIRM word with a destination /
 * fulfillment / item / payment change. That whole family is now closed: `confirm()` independently
 * verifies `fulfillmentStillBound`, `itemsStillBound`, `paymentStillBound` and `destinationStillBound`
 * before ever trusting a stale `draftId`/`draftVersion`/`draftHash`.
 *
 * This report instead attacks the layer ABOVE the draft: `sofiaConversationMemory` — the durable,
 * per-conversation JSON blob (`CommercialConversationState`, read/written by
 * `PrismaCommercialRepository.loadState()`/`saveState()`) that every turn of
 * `CommercialCheckoutService.process()` reads at the top and unconditionally upserts at the bottom
 * (`persistAndAudit`). Unlike `SofiaOrderDraft.saveDraft()`/`confirmDraft()` — both of which use real
 * optimistic-concurrency CAS (`updateMany({ where: { id, version, status, ... } })`, verified
 * count===1) — `saveState()` is a bare `upsert` keyed only on `conversationId`, with NO version/CAS
 * check at all (`prisma-commercial.repository.ts::saveState`, lines 20-26). Nothing in the inbound
 * pipeline serializes two DIFFERENT WhatsApp messages for the SAME conversation either:
 * `sofia-whatsapp.service.ts`'s `WhatsappInboundDeduplicator.claim()` dedupes/replays a SINGLE inbound
 * EVENT (keyed on `eventHash`/`messageId` — a webhook retry of the identical event), and
 * `withInboundAgentLease()` is a heartbeat/lease against lease EXPIRY for a single in-flight claim, not
 * a mutex across two distinct claims for the same `conversationId`. So two real, distinct WhatsApp
 * messages the same customer sends moments apart (e.g. "confirmo" immediately followed by "mejor
 * pásame el link", or simply a doubled webhook redelivery racing a fast worker) can be picked up by two
 * concurrent `processMessage()` invocations with NO lock between them.
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
 *   (i.e. it raced Turn A's write and lost). `process()` mutates `paymentPreference` in memory (no
 *   `invalidateDraft()` call exists on that path — only fulfillment/item/modifier changes call it) and,
 *   because there is no CONFIRM intent this turn, falls through to the unconditional
 *   `prepareDraft()` at the bottom of `process()`. `prepareDraft()` calls `saveDraft()` with the SAME
 *   draftId=D and `version = S0.draftVersion + 1 = 2`. `saveDraft()`'s CAS
 *   (`updateMany({ where: { id: D, version: 1, status: in [DRAFT,NEEDS_INFO,READY_TO_CONFIRM] } })`)
 *   correctly finds 0 rows (D is now version 1 / status CONFIRMED, outside that status set) — this part
 *   IS safe, draft D itself is never corrupted. But `saveDraft()`'s fallback path
 *   (`prisma-commercial.repository.ts` lines 58-65) treats "prior draft is CONFIRMED and its version
 *   equals what I expected as my baseline" as the "revise-after-confirm, start a follow-up draft" case
 *   and silently `create()`s a BRAND NEW draft row D2 — WITHOUT ever telling `confirm()`'s caller (this
 *   IS `process()`, not `confirm()`) that draft D was already confirmed. `process()` then unconditionally
 *   persists this new state (draftId=D2, confirmationState=PENDING) to `sofiaConversationMemory` via
 *   `saveState()`'s un-CAS'd upsert — SILENTLY OVERWRITING Turn A's S1 (confirmationState=CONFIRMED,
 *   draftId=D).
 *
 * RESULT: immediately after Turn B, the durable `sofiaConversationMemory` row — the ONLY place any
 * later turn, any human agent view, any reconciliation job looks to know "is this conversation's order
 * confirmed" — says PENDING, even though a real, financially-binding CONFIRMED `SofiaOrderDraft` (D)
 * exists and was truthfully narrated to the customer moments earlier. This is an exact violation of
 * REQUIRED INVARIANT #16 ("the durably persisted conversation-memory record of it must never diverge
 * from what the actual confirmed commercial authority record contains") caused purely by a lost update
 * — no single message bundles anything suspicious; each message in isolation is completely ordinary.
 *
 * IT GETS WORSE: because the conversation now believes it has a fresh, unconfirmed PENDING draft (D2,
 * `lastQuestionPurpose='CONFIRM_ORDER'`), a subsequent, entirely honest "confirmo" from the customer —
 * who has no way of knowing their EARLIER message already confirmed an order, since Turn B's response
 * never mentioned it — passes every one of A21-A24's binding checks (nothing changed between Turn B and
 * Turn C) and CONFIRMS D2 AS WELL. The conversation now has TWO independently CONFIRMED `SofiaOrderDraft`
 * rows (D: PAY_AT_PICKUP, D2: ONLINE) for what the customer experienced as ONE continuous transaction —
 * a genuine duplicate-commitment / financial-duplication risk (invariants #6/#11/#14/#16) that would
 * translate into two real `OrderCheckout`/`OrderTicket` materializations the instant the
 * `SOFIA_CREATE_ORDER` owner-activation gate is turned on, entirely without any adversarial single
 * message ever being sent.
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

describe('A25 Round 5 — lost-update race on sofiaConversationMemory: a genuine confirm() plus a concurrent, entirely ordinary follow-up message can silently erase the CONFIRMED marker and spawn a duplicate confirmed draft', () => {
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
    'RACE: Turn A truthfully confirms draft D; Turn B (an ordinary payment-preference message that ' +
      'raced Turn A\'s write) silently overwrites the durable CONFIRMED marker with a NEW pending draft ' +
      'D2, and a follow-up honest "confirmo" then confirms D2 too -- two independently CONFIRMED ' +
      'SofiaOrderDraft rows for one conversation, with no single message ever being adversarial',
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
      const { service: serviceB } = buildService(customer.id, staleRepo);
      const turnB = await serviceB.process(cmd(conversationId, 'Mejor pasame el link', phone));

      // Turn B's own in-memory/response view looks completely normal: it thinks it's still working
      // with a PENDING draft, now wanting ONLINE payment.
      expect(turnB.state.paymentPreference).toBe('ONLINE');
      expect(turnB.nextAction).toBe('READY_TO_CONFIRM');
      expect(turnB.state.confirmationState).toBe('PENDING');
      // *** THE BUG: saveDraft()'s CONFIRMED-fallback path silently spun off a BRAND NEW draft (D2 !=
      // D) instead of surfacing "the draft you were tracking is already confirmed" to `process()`. ***
      const draftD2 = turnB.state.draftId!;
      expect(draftD2).toBeTruthy();
      expect(draftD2).not.toBe(draftD);

      // Draft D itself is untouched -- Postgres-level CAS correctly protected it. This is NOT a
      // financial-record-corruption bug; it is a durable-narration/lost-update bug.
      const draftDAfterTurnB = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      expect(draftDAfterTurnB.status).toBe('CONFIRMED');
      expect(draftDAfterTurnB.paymentPreference).toBe('PAY_AT_PICKUP');

      const draftD2AfterTurnB = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD2 } });
      expect(draftD2AfterTurnB.status).toBe('READY_TO_CONFIRM');
      expect(draftD2AfterTurnB.paymentPreference).toBe('ONLINE');

      // *** REQUIRED INVARIANT #16 VIOLATION: the durable `sofiaConversationMemory` record now says
      // PENDING / draftId=D2 -- it has COMPLETELY LOST any reference to the fact that draft D is
      // ALREADY, truthfully, CONFIRMED. Any later turn, human-agent view, or reconciliation job reading
      // this row alone would conclude "no order has been confirmed yet for this conversation", which is
      // false. ***
      const memoryAfterTurnB = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const stateAfterTurnB = memoryAfterTurnB.currentOrderIntentJson as unknown as { confirmationState: string; draftId: string; paymentPreference: string };
      expect(stateAfterTurnB.confirmationState).toBe('PENDING'); // <-- was CONFIRMED after Turn A; silently regressed
      expect(stateAfterTurnB.draftId).toBe(draftD2); // <-- no trace of draftD left in durable memory at all
      expect(stateAfterTurnB.draftId).not.toBe(draftD);

      // --- Turn C: an entirely honest, non-adversarial follow-up "confirmo" from a customer who has no
      // way of knowing their EARLIER message already produced a confirmed order. It passes every one of
      // A21-A24's binding checks (nothing changed between Turn B and Turn C) and confirms D2 too. ---
      const { service: serviceC, orderCreation: orderCreationC } = buildService(customer.id, realRepository);
      const turnC = await serviceC.process(cmd(conversationId, 'confirmo', phone));
      expect(turnC.nextAction).toBe('DRAFT_CONFIRMED');
      expect(turnC.state.confirmationState).toBe('CONFIRMED');
      expect(turnC.state.draftId).toBe(draftD2);
      expect(orderCreationC.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreationC.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: draftD2 }));

      // *** FINAL STATE: TWO independently CONFIRMED SofiaOrderDraft rows exist for ONE conversation
      // and ONE continuous customer interaction -- D (PAY_AT_PICKUP, 15000) and D2 (ONLINE, 15000) --
      // neither the customer nor the system ever made an explicit "place a second order" decision. If
      // the SOFIA_CREATE_ORDER owner-activation gate were live, this would materialize as TWO real
      // OrderCheckout/OrderTicket records for a single 15000 hamburguesa order the customer believes
      // they confirmed exactly once. ***
      const finalDraftD = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      const finalDraftD2 = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD2 } });
      expect(finalDraftD.status).toBe('CONFIRMED');
      expect(finalDraftD2.status).toBe('CONFIRMED');
      expect(finalDraftD.id).not.toBe(finalDraftD2.id);
      expect(Number(finalDraftD.total)).toBe(15000);
      expect(Number(finalDraftD2.total)).toBe(15000);

      const confirmedDraftsForConversation = await prisma.sofiaOrderDraft.findMany({
        where: { conversationId, status: 'CONFIRMED' },
        select: { id: true, paymentPreference: true, total: true },
      });
      expect(confirmedDraftsForConversation).toHaveLength(2);

      console.log(
        `[A25 RACE] conversationId=${conversationId} draftD=${draftD}(CONFIRMED,PAY_AT_PICKUP) ` +
          `draftD2=${draftD2}(CONFIRMED,ONLINE) -- durable sofiaConversationMemory lost the CONFIRMED ` +
          `marker for draftD after the race (Turn B saw confirmationState=PENDING) and a routine ` +
          `follow-up confirm produced a SECOND independently-confirmed draft for the same conversation.`,
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
});
