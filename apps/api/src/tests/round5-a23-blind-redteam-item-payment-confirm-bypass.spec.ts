/**
 * SOFIA Round 5 / A23 — BLIND independent red team pass (fresh audit of
 * feat/sofia-remediation-address-round5-22-fulfillment-switch-fix, no prior context beyond the
 * public mission brief). Rounds A9/A10, A13/A14, A15/A16, A17/A18, A19/A20 and A21/A22 each closed a
 * distinct gap in the same family: "does `confirm()` refuse to trust a stale draftId/draftVersion/
 * draftHash when something load-bearing changed in the SAME message as the CONFIRM word." A21/A22
 * closed the FULFILLMENT axis (DELIVERY<->TAKEAWAY bundled with "confirmo") via a new
 * `draftFulfillment` binding check, mirroring A9/A10's `deliveryQuoteDestinationBinding` check for
 * the DESTINATION axis.
 *
 * The A22 remediation report explicitly flagged — but declared out of scope / lower severity — that
 * `quoteStillBound` in `CommercialCheckoutService.confirm()` (commercial-checkout.service.ts,
 * ~line 362-367, PRE-FIX) covered EXACTLY TWO axes:
 *
 *   const fulfillmentStillBound = state.draftFulfillment === state.fulfillment;
 *   const destinationStillBound = state.fulfillment !== 'DELIVERY' || (... isQuoteBoundToCurrentDestination ...);
 *   const quoteStillBound = fulfillmentStillBound && destinationStillBound;
 *
 * It did NOT check items/quantity/modifiers, and did NOT check paymentPreference. This original A23
 * bug report independently re-derived and PROVED end-to-end against real Postgres that A22's claim
 * about `PrismaCommercialRepository.confirmDraft()`'s exact `{id, version, draftHash, status,
 * expiresAt}` WHERE clause holds (the persisted `SofiaOrderDraft` row itself never silently picks up
 * unpersisted items/quantity/paymentPreference mutations) — but went one step further to show that
 * `CommercialCheckoutService.process()` mutates `state.items` / `state.paymentPreference` IN MEMORY
 * *before* routing into `confirm()` in the exact same call (a single WhatsApp message can bundle
 * "confirmo" with "y agregame un perro caliente" or "mejor pasame el link", parsed independently by
 * `CommercialIntentEngine.interpret()` and the item/product resolution block in `process()`, exactly
 * like A21's fulfillment-switch bundling) — and pre-fix `confirm()` happily proceeded to CONFIRM the
 * OLD, untouched draft under those conditions because NEITHER `fulfillmentStillBound` NOR
 * `destinationStillBound` cared about items or payment at all, while `confirm()`'s SUCCESS path
 * unconditionally narrated the MUTATED in-memory `state` back to the customer and into
 * `sofiaConversationMemory.currentOrderIntentJson` — a durable customer-trust/operational-consistency
 * bug (a customer told "confirmado" reflecting a change the confirmed draft never actually persisted;
 * a payment-method switch to ONLINE bundled with confirm that would never actually produce a payment
 * link, since `PaymentOrchestrationService.createOnlinePaymentLink` gates on the confirmed row's
 * stale `paymentPreference`).
 *
 * ============================== A24 FIX (see commercial-checkout.service.ts) ==============================
 * `CommercialConversationState.draftItemsFingerprint` (a SHA-256 fingerprint of `state.items` via the
 * new `commercialItemsFingerprint()` helper — `commercial-draft-hash.ts`) and
 * `CommercialConversationState.draftPaymentPreference` now record, respectively, the items and
 * payment preference that were ACTUALLY current when `draftId`/`draftVersion`/`draftHash` were last
 * (re)computed by `prepareDraft()` — mirroring the exact pattern `draftFulfillment` already
 * established for the FULFILLMENT axis (A21/A22). `confirm()`'s guard is now:
 *
 *   const fulfillmentStillBound = state.draftFulfillment === state.fulfillment;
 *   const itemsStillBound = state.draftItemsFingerprint === commercialItemsFingerprint(state.items);
 *   const paymentStillBound = state.draftPaymentPreference === state.paymentPreference;
 *   const destinationStillBound = state.fulfillment !== 'DELIVERY' || (... isQuoteBoundToCurrentDestination ...);
 *   const quoteStillBound = fulfillmentStillBound && itemsStillBound && paymentStillBound && destinationStillBound;
 *
 * A mismatch on ANY axis now invalidates the draft and forces a `prepareDraft()` re-derivation (same
 * requote/re-confirm path already used for fulfillment/destination/price changes) instead of
 * confirming a stale row and narrating a divergent lie to the customer. A conversation whose items and
 * payment preference genuinely did not change in the same turn as "confirmo" still takes the cheap
 * fast path — both fingerprints match trivially, no re-pricing required.
 * ============================================================================================
 *
 * The test bodies below have been converted from "prove the attack succeeds" to "prove the attack is
 * now blocked / safely requoted" — i.e. this file now asserts the FIXED behavior permanently, not the
 * vulnerability. All three original scenarios (item bundled with confirm, paymentPreference bundled
 * with confirm, bare quantity bundled with confirm) are preserved.
 *
 * Real Postgres (isolated `_test`/round5 database), real unmocked `CommercialCheckoutService` +
 * `CommercialIntentEngine` + `CommercialPolicyService` + `PrismaCommercialRepository` (real FK-backed
 * `SofiaOrderDraft`/`WhatsappConversation`/`Customer`/`SofiaConversationMemory` rows) — no delivery
 * quoting is exercised at all in this file (every scenario is TAKEAWAY, deliberately isolating the
 * item/payment axes from the already-covered destination/fulfillment axes), so there is no external
 * HTTP provider to double. `orderCreation` is a spy (as in A19-A22's precedent): it must now be
 * proven NEVER invoked for a turn that was correctly blocked/requoted, and invoked exactly once, with
 * the TRUE final draftId, once an honest follow-up confirm actually confirms.
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
import type { CommercialMessageCommand } from '../modules/sofia/commercial/commercial.types';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error('A23/A24 requires an isolated _test database (TEST_DATABASE_URL must end in _test).');
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

function cmd(conversationId: string, message: string, phone: string): CommercialMessageCommand {
  return { conversationId, message, phone, displayName: 'Cliente A23', actor };
}

const HAMBURGUESA = {
  id: 'a23-p1-hamburguesa', code: 'HAMB-CLASICA', name: 'Hamburguesa Clasica', description: 'Res',
  imageUrl: null, category: { id: 'cat', name: 'Hamburguesas', slug: 'hamburguesas' }, kind: 'PREPARED' as const,
  persistedPrice: 15000, active: true, trackStock: true, updatedAt: new Date().toISOString(),
};
const PERRO = {
  id: 'a23-p2-perro', code: 'PERRO-CALIENTE', name: 'Perro Caliente', description: 'Salchicha',
  imageUrl: null, category: { id: 'cat', name: 'Perros', slug: 'perros' }, kind: 'PREPARED' as const,
  persistedPrice: 9000, active: true, trackStock: true, updatedAt: new Date().toISOString(),
};
const PRODUCTS = [HAMBURGUESA, PERRO];

describe('A23/A24 Round 5 — single-message "confirmo" bundled with an ITEM, PAYMENT-PREFERENCE, or QUANTITY change: the FIX now blocks/requotes instead of confirming a stale draft', () => {
  jest.setTimeout(30000);
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a23-item-payment-' } } }).catch(() => undefined);
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a23-item-payment-' } } }).catch(() => undefined);
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a23-item-payment-' } } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { displayName: 'Cliente A23' } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  function buildService(customerId: string) {
    const repository = new PrismaCommercialRepository(prisma as never);
    const catalog = {
      listActive: jest.fn(async () => PRODUCTS),
      getActiveById: jest.fn(async (id: string) => PRODUCTS.find((p) => p.id === id)!),
      findActive: jest.fn(),
    };
    const productAvailability = { check: jest.fn(async (input: { productId: string; quantity: number }) => ({ productId: input.productId, quantity: input.quantity, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) };
    const recipeAvailability = { check: jest.fn(async (input: { productId: string; quantity: number }) => ({ productId: input.productId, quantity: input.quantity, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) };
    const responses = new CommercialResponseComposer({ compose: jest.fn(async () => null) }, new CommercialResponseValidator(), new SafeCommercialResponseTemplates());
    // Spy, not a functional mock — matches A19-A22 precedent. This proves its assertions purely from
    // the persisted `SofiaOrderDraft` row plus how many times a real SecureCommand(SOFIA_CREATE_ORDER)
    // dispatch would have been triggered — it must be zero for any turn that was correctly
    // blocked/requoted.
    const orderCreation = { createFromSofiaDraft: jest.fn(async (input: { draftId: string }) => ({ id: `checkout-${input.draftId}`, replayed: false })) };
    const metrics = new CommercialMetricsService();
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), metrics, responses, repository as never,
      catalog as never, productAvailability as never, recipeAvailability as never,
      { resolve: jest.fn(async () => ({ customerId, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote: jest.fn(async () => { throw new Error('A23/A24: no DELIVERY quoting expected in this file'); }) } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service, orderCreation };
  }

  it(
    'FIXED (A23-1, item bundled with confirm): "Confirmo, y agregame un perro caliente" no longer ' +
      'confirms the OLD 1-item draft verbatim — it is blocked/requoted with a TRUE 2-item re-priced ' +
      'draft, and only a SUBSEQUENT honest "confirmo" actually confirms it',
    async () => {
      const conversationId = `a23-item-payment-items-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001110001';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A23' } });
      const { service, orderCreation } = buildService(customer.id);

      // Turn 1: single-item TAKEAWAY order, pay-at-pickup -> READY_TO_CONFIRM. Deliberately TAKEAWAY
      // (fee=0, no address/GPS) to isolate the ITEM axis from the already-fixed destination/
      // fulfillment axes.
      const ready = await service.process(cmd(conversationId, 'Quiero una hamburguesa clasica, lo recojo yo mismo y pago alla', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      expect(ready.state.fulfillment).toBe('TAKEAWAY');
      expect(ready.state.items).toHaveLength(1);
      expect(ready.state.items[0]!.productId).toBe(HAMBURGUESA.id);
      expect(ready.state.total).toBe(15000);
      expect(ready.state.draftFulfillment).toBe('TAKEAWAY');
      expect(ready.state.draftItemsFingerprint).toBeTruthy();
      const originalDraftId = ready.state.draftId!;
      expect(originalDraftId).toBeTruthy();

      const draftBeforeAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftBeforeAttack.status).toBe('READY_TO_CONFIRM');
      expect((draftBeforeAttack.itemsSnapshot as unknown as Array<{ productId: string }>)).toHaveLength(1);
      expect(Number(draftBeforeAttack.total)).toBe(15000);

      // Turn 2 (THE ATTACK): a single, entirely ordinary Spanish message that both confirms AND adds
      // a brand-new, never-priced item in the same breath. No separate turn, no re-prepare.
      const attack = await service.process(cmd(conversationId, 'Confirmo, y agregame un perro caliente', phone));

      // FIX: the in-memory/response layer reflects the new 2-item cart (correct, unchanged from
      // before)...
      expect(attack.state.items).toHaveLength(2);
      expect(attack.state.items.map((i) => i.productId).sort()).toEqual([HAMBURGUESA.id, PERRO.id].sort());
      // ...but confirmation is now BLOCKED, not granted: the mismatch between the just-mutated
      // `state.items` and the draft's recorded `draftItemsFingerprint` (still the 1-item fingerprint
      // from turn 1) forces a re-derivation instead of confirming the stale row.
      expect(attack.nextAction).toBe('READY_TO_CONFIRM');
      expect(attack.state.confirmationState).toBe('PENDING');
      expect(attack.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
      // The re-prepared draft is TRUTHFULLY re-priced against BOTH items — no more internal
      // inconsistency between narrated total and confirmed total.
      expect(attack.state.total).toBe(24000);
      expect(attack.factEnvelope.total).toBe(24000);
      expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();

      // Reload fresh from Postgres: the SAME draftId was re-prepared in place (new version), NOT
      // confirmed.
      const draftAfterAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterAttack.status).toBe('READY_TO_CONFIRM');
      const itemsAfterAttack = draftAfterAttack.itemsSnapshot as unknown as Array<{ productId: string }>;
      expect(itemsAfterAttack).toHaveLength(2);
      expect(Number(draftAfterAttack.total)).toBe(24000);

      // The durable conversation-memory record now agrees with the (not-yet-confirmed) draft — no
      // divergence, and confirmationState correctly says PENDING, not CONFIRMED.
      const memoryRowAfterAttack = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const persistedAfterAttack = memoryRowAfterAttack.currentOrderIntentJson as unknown as { items: Array<{ productId: string }>; total: number; confirmationState: string };
      expect(persistedAfterAttack.confirmationState).toBe('PENDING');
      expect(persistedAfterAttack.items).toHaveLength(2);
      expect(persistedAfterAttack.total).toBe(24000);

      // Turn 3: an HONEST follow-up "confirmo" now succeeds, and truthfully confirms the TRUE 2-item
      // draft — narration and persisted authority finally agree, and only NOW does
      // SecureCommand(SOFIA_CREATE_ORDER) get dispatched.
      const honestConfirm = await service.process(cmd(conversationId, 'confirmo', phone));
      expect(honestConfirm.nextAction).toBe('DRAFT_CONFIRMED');
      expect(honestConfirm.state.confirmationState).toBe('CONFIRMED');
      expect(honestConfirm.state.items).toHaveLength(2);
      expect(honestConfirm.state.total).toBe(24000);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: originalDraftId }));

      const draftAfterHonestConfirm = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterHonestConfirm.status).toBe('CONFIRMED');
      const itemsOnConfirmedRow = draftAfterHonestConfirm.itemsSnapshot as unknown as Array<{ productId: string }>;
      expect(itemsOnConfirmedRow).toHaveLength(2);
      expect(itemsOnConfirmedRow.map((i) => i.productId).sort()).toEqual([HAMBURGUESA.id, PERRO.id].sort());
      expect(Number(draftAfterHonestConfirm.total)).toBe(24000);

      // *** The confirmed authority record now TRULY reflects the perro caliente — narration and
      // persisted state never diverged from what was actually confirmed. ***
      const memoryRow = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const persistedState = memoryRow.currentOrderIntentJson as unknown as { items: Array<{ productId: string }>; total: number; confirmationState: string };
      expect(persistedState.confirmationState).toBe('CONFIRMED');
      expect(persistedState.items).toHaveLength(2);
      expect(persistedState.total).toBe(24000);

      console.log(
        `[A23/A24-1 FIXED] conversationId=${conversationId} draftId=${originalDraftId} attack turn ` +
          `was blocked/requoted (status stayed READY_TO_CONFIRM, items truthfully re-priced to 24000); ` +
          `only the honest follow-up confirm actually confirmed CONFIRMED ` +
          `sofia_order_drafts items=${JSON.stringify(itemsOnConfirmedRow)} total=${draftAfterHonestConfirm.total}.`,
      );
    },
  );

  it(
    'FIXED (A23-2, paymentPreference bundled with confirm): "Confirmo, pasame el link" (PAY_AT_PICKUP ' +
      '-> ONLINE) no longer confirms the OLD PAY_AT_PICKUP draft verbatim — it is blocked/requoted with ' +
      'a TRUE ONLINE draft, so PaymentOrchestrationService will actually generate the payment link once ' +
      'an honest follow-up confirm succeeds',
    async () => {
      const conversationId = `a23-item-payment-payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001110002';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A23' } });
      const { service, orderCreation } = buildService(customer.id);

      // Turn 1: TAKEAWAY, PAY_AT_PICKUP -> READY_TO_CONFIRM.
      const ready = await service.process(cmd(conversationId, 'Quiero una hamburguesa clasica, lo recojo yo mismo y pago alla', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      expect(ready.state.fulfillment).toBe('TAKEAWAY');
      expect(ready.state.paymentPreference).toBe('PAY_AT_PICKUP');
      expect(ready.state.draftPaymentPreference).toBe('PAY_AT_PICKUP');
      const originalDraftId = ready.state.draftId!;

      const draftBeforeAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftBeforeAttack.paymentPreference).toBe('PAY_AT_PICKUP');

      // Turn 2 (THE ATTACK): confirms AND switches payment preference to ONLINE in the same message
      // — a valid TAKEAWAY payment option (['ONLINE','PAY_AT_PICKUP']), so CommercialPolicyService
      // .validatePayment() does NOT reject it and does NOT reset it to UNKNOWN/ambiguous. No item
      // change this time, isolating the PAYMENT axis alone.
      const attack = await service.process(cmd(conversationId, 'Confirmo, pasame el link', phone));

      // FIX: the in-memory/response layer reflects ONLINE (correct, unchanged from before)...
      expect(attack.state.paymentPreference).toBe('ONLINE');
      // ...but confirmation is now BLOCKED, not granted: the mismatch between the just-mutated
      // `state.paymentPreference` and the draft's recorded `draftPaymentPreference` (still
      // PAY_AT_PICKUP, from turn 1) forces a re-derivation instead of confirming the stale row.
      expect(attack.nextAction).toBe('READY_TO_CONFIRM');
      expect(attack.state.confirmationState).toBe('PENDING');
      expect(attack.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
      expect(attack.state.draftPaymentPreference).toBe('ONLINE'); // re-prepared draft now correctly bound to ONLINE
      expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();

      // Reload fresh from Postgres: the SAME draftId was re-prepared in place, NOT confirmed, and now
      // TRUTHFULLY says ONLINE.
      const draftAfterAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterAttack.status).toBe('READY_TO_CONFIRM');
      expect(draftAfterAttack.paymentPreference).toBe('ONLINE');

      const memoryRowAfterAttack = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const persistedAfterAttack = memoryRowAfterAttack.currentOrderIntentJson as unknown as { paymentPreference: string; confirmationState: string };
      expect(persistedAfterAttack.confirmationState).toBe('PENDING');
      expect(persistedAfterAttack.paymentPreference).toBe('ONLINE'); // matches the (not-yet-confirmed) draft, no divergence

      // Turn 3: an HONEST follow-up "confirmo" now succeeds, truthfully confirming ONLINE — a real
      // payment link WOULD be generated for this customer downstream, unlike the pre-fix behavior.
      const honestConfirm = await service.process(cmd(conversationId, 'confirmo', phone));
      expect(honestConfirm.nextAction).toBe('DRAFT_CONFIRMED');
      expect(honestConfirm.state.confirmationState).toBe('CONFIRMED');
      expect(honestConfirm.state.paymentPreference).toBe('ONLINE');
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: originalDraftId }));

      const draftAfterHonestConfirm = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterHonestConfirm.status).toBe('CONFIRMED');
      // *** The confirmed authority record now TRULY says ONLINE — no more silent
      // PaymentOrchestrationService payment-link gap. ***
      expect(draftAfterHonestConfirm.paymentPreference).toBe('ONLINE');

      const memoryRow = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const persistedState = memoryRow.currentOrderIntentJson as unknown as { paymentPreference: string; confirmationState: string };
      expect(persistedState.confirmationState).toBe('CONFIRMED');
      expect(persistedState.paymentPreference).toBe('ONLINE'); // now truthfully matches the confirmed row

      console.log(
        `[A23/A24-2 FIXED] conversationId=${conversationId} draftId=${originalDraftId} attack turn ` +
          `was blocked/requoted (status stayed READY_TO_CONFIRM, paymentPreference truthfully ` +
          `re-bound to ONLINE); only the honest follow-up confirm actually confirmed CONFIRMED ` +
          `sofia_order_drafts.paymentPreference=${draftAfterHonestConfirm.paymentPreference}.`,
      );
    },
  );

  it(
    'FIXED (A23-3, quantity bundled with confirm, single-item fast path): "Confirmo, mejor dos" no ' +
      'longer confirms the OLD quantity=1 draft verbatim — it is blocked/requoted with a TRUE ' +
      'quantity=2 re-priced draft, proving the SAME fix covers the independent ' +
      '`state.items.length === 1 && parsed.quantity` mutation path in process(), not just the ' +
      'product-mention path exercised by A23-1',
    async () => {
      const conversationId = `a23-item-payment-qty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001110003';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A23' } });
      const { service, orderCreation } = buildService(customer.id);

      const ready = await service.process(cmd(conversationId, 'Quiero una hamburguesa clasica, lo recojo yo mismo y pago alla', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      expect(ready.state.items).toHaveLength(1);
      expect(ready.state.items[0]!.quantity).toBe(1);
      expect(ready.state.total).toBe(15000);
      const originalDraftId = ready.state.draftId!;

      // "mejor" would normally route to CHANGE_ORDER, but the intent engine checks the CONFIRM regex
      // FIRST in its ternary chain (commercial-intent.engine.ts line 19), so a message containing
      // BOTH "confirmo" and a bare quantity token resolves to intent=CONFIRM while still being parsed
      // for `quantity` by the separate, unconditional quantity regex on the same line.
      const attack = await service.process(cmd(conversationId, 'Confirmo, mejor dos', phone));

      // FIX: the in-memory/response layer reflects quantity=2 (correct, unchanged from before)...
      expect(attack.state.items[0]!.quantity).toBe(2);
      // ...but confirmation is now BLOCKED, not granted: the mismatch between the just-mutated
      // quantity and the draft's recorded `draftItemsFingerprint` (still the qty=1 fingerprint from
      // turn 1) forces a re-derivation instead of confirming the stale row.
      expect(attack.nextAction).toBe('READY_TO_CONFIRM');
      expect(attack.state.confirmationState).toBe('PENDING');
      expect(attack.factEnvelope.responsePurpose).toBe('QUOTE_EXPIRED');
      expect(attack.state.total).toBe(30000); // truthfully re-priced for qty=2, no internal inconsistency
      expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();

      const draftAfterAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterAttack.status).toBe('READY_TO_CONFIRM');
      const itemsAfterAttack = draftAfterAttack.itemsSnapshot as unknown as Array<{ quantity: number }>;
      expect(itemsAfterAttack[0]!.quantity).toBe(2);
      expect(Number(draftAfterAttack.total)).toBe(30000);

      // Turn 3: an HONEST follow-up "confirmo" now succeeds, truthfully confirming quantity=2.
      const honestConfirm = await service.process(cmd(conversationId, 'confirmo', phone));
      expect(honestConfirm.nextAction).toBe('DRAFT_CONFIRMED');
      expect(honestConfirm.state.items[0]!.quantity).toBe(2);
      expect(honestConfirm.state.total).toBe(30000);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: originalDraftId }));

      const draftAfterHonestConfirm = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterHonestConfirm.status).toBe('CONFIRMED');
      const itemsOnConfirmedRow = draftAfterHonestConfirm.itemsSnapshot as unknown as Array<{ quantity: number }>;
      // *** The confirmed authority record now TRULY reflects quantity=2. ***
      expect(itemsOnConfirmedRow[0]!.quantity).toBe(2);
      expect(Number(draftAfterHonestConfirm.total)).toBe(30000);

      console.log(
        `[A23/A24-3 FIXED] conversationId=${conversationId} draftId=${originalDraftId} attack turn ` +
          `was blocked/requoted (status stayed READY_TO_CONFIRM, quantity truthfully re-priced to 2); ` +
          `only the honest follow-up confirm actually confirmed CONFIRMED confirmed row quantity=` +
          `${itemsOnConfirmedRow[0]!.quantity}.`,
      );
    },
  );

  it(
    'REGRESSION LOCK-IN: a genuine, non-bundled "confirmo" (no item/payment/quantity change in the ' +
      'SAME message) still confirms in ONE turn — the A24 fix must not add a spurious requote to the ' +
      'legitimate fast path',
    async () => {
      const conversationId = `a23-item-payment-honest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001110004';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A23' } });
      const { service, orderCreation } = buildService(customer.id);

      const ready = await service.process(cmd(conversationId, 'Quiero una hamburguesa clasica, lo recojo yo mismo y pago alla', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      const originalDraftId = ready.state.draftId!;

      const honestConfirm = await service.process(cmd(conversationId, 'confirmo', phone));
      expect(honestConfirm.nextAction).toBe('DRAFT_CONFIRMED'); // fast path: confirms in ONE more turn, no spurious requote
      expect(honestConfirm.state.items).toHaveLength(1);
      expect(honestConfirm.state.total).toBe(15000);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: originalDraftId }));

      const draft = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draft.status).toBe('CONFIRMED');
      expect(Number(draft.total)).toBe(15000);
    },
  );
});
