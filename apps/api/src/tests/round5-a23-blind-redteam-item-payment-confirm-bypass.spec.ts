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
 * ~line 362-367) covers EXACTLY TWO axes:
 *
 *   const fulfillmentStillBound = state.draftFulfillment === state.fulfillment;
 *   const destinationStillBound = state.fulfillment !== 'DELIVERY' || (... isQuoteBoundToCurrentDestination ...);
 *   const quoteStillBound = fulfillmentStillBound && destinationStillBound;
 *
 * It does NOT check items/quantity/modifiers, and does NOT check paymentPreference. A22 argued this
 * was safe because `PrismaCommercialRepository.confirmDraft()` (persistence/prisma-commercial.repository.ts)
 * gates on an EXACT `{ id, version, draftHash, status: READY_TO_CONFIRM, expiresAt: { gt: now } }`
 * WHERE clause — so the row that actually flips to CONFIRMED, and the ONLY row
 * `SofiaCreateOrderCommandHandler`/`OrderCheckoutService.createFromConfirmedSofiaDraft` ever read
 * from later, is byte-for-byte whatever `saveDraft()` last persisted for that `draftId`+`version` —
 * never anything mutated in `state` afterwards. This test file independently re-derives and PROVES
 * that specific claim end-to-end against real Postgres, and then goes one step further to show the
 * part A22 did NOT examine: `CommercialCheckoutService.process()` mutates `state.items` /
 * `state.paymentPreference` IN MEMORY *before* routing into `confirm()` in the exact same call (a
 * single WhatsApp message can bundle "confirmo" with "y agregame un perro caliente" or "mejor pasame
 * el link", parsed independently by `CommercialIntentEngine.interpret()` and the item/product
 * resolution block in `process()`, exactly like A21's fulfillment-switch bundling) — and `confirm()`
 * happily proceeds to CONFIRM the OLD, untouched draft under those conditions because NEITHER
 * `fulfillmentStillBound` NOR `destinationStillBound` cares about items or payment at all.
 *
 * VERDICT: the underlying commercial AUTHORITY record (the `SofiaOrderDraft` row, and therefore
 * whatever `SofiaCreateOrderCommandHandler` would materialize into a real `OrderTicket`) is
 * genuinely protected — A22's claim about `confirmDraft()`'s WHERE clause holds. NO free items, no
 * price manipulation, no double-charge, no payment-method downgrade is achievable this way, because
 * the row that gets marked CONFIRMED, and the row `OrderCheckoutService` later re-reads, is always
 * whatever `saveDraft()` most recently wrote — items/quantity/paymentPreference bundled into the SAME
 * message as "confirmo" are simply never priced/persisted into that row.
 *
 * BUT: this is NOT "genuinely inert". `CommercialCheckoutService.confirm()`'s SUCCESS path (the
 * `DRAFT_CONFIRMED` branch, lines ~404-423) unconditionally treats the in-memory `state` object —
 * which by now DOES contain the unpersisted item/payment mutation — as authoritative for:
 *   (a) the customer-facing `respond()` / `factEnvelope` narration (items list, total, "confirmed"
 *       language), which is composed from `state`, not from a fresh read of the persisted draft row;
 *   (b) `sofiaConversationMemory.currentOrderIntentJson` (`persistAndAudit` -> `saveState(state)`),
 *       the durable conversation-memory record a support agent / later turn / CRM view would read as
 *       "what this conversation confirmed".
 * Both of those durably diverge from the actual confirmed `SofiaOrderDraft` row — violating invariant
 * 14 ("the order that gets dispatched/checked out must reflect the SAME [...] that was actually
 * confirmed, never a substituted or stale one") from the CUSTOMER-COMMUNICATION side, even though the
 * FINANCIAL/OPERATIONAL side (the row itself) stays correctly anchored. A customer who bundles an
 * item addition or a payment-method switch with "confirmo" is told "confirmado" listing/implying
 * their new item/payment choice, while the kitchen ticket that actually gets dispatched (built from
 * the untouched, OLD `itemsSnapshot`/`paymentPreference` on the confirmed row) silently omits it —
 * and, for the payment case, `PaymentOrchestrationService.createOnlinePaymentLink` (order-checkout/
 * payment-orchestration.service.ts:33-36: `if (checkout.paymentPreference !== SofiaPaymentPreference.ONLINE)
 * checkoutConflict('CHECKOUT_PAYMENT_COMBINATION_INVALID')`) will use the STALE `PAY_AT_PICKUP` value
 * from the confirmed row, never generating the payment link the customer explicitly asked for in the
 * same "confirmo" message.
 *
 * Real Postgres (isolated `_test`/round5 database), real unmocked `CommercialCheckoutService` +
 * `CommercialIntentEngine` + `CommercialPolicyService` + `PrismaCommercialRepository` (real FK-backed
 * `SofiaOrderDraft`/`WhatsappConversation`/`Customer`/`SofiaConversationMemory` rows) — no delivery
 * quoting is exercised at all in this file (every scenario is TAKEAWAY, deliberately isolating the
 * item/payment axes from the already-covered destination/fulfillment axes), so there is no external
 * HTTP provider to double. `orderCreation` is a spy (as in A19-A22's precedent), not because it needs
 * mocking for this finding — the finding is fully proven from the persisted `SofiaOrderDraft` row
 * plus the returned `factEnvelope`/`state` — but to record exactly which `draftId` a real
 * SecureCommand(`SOFIA_CREATE_ORDER`) dispatch would be told to materialize.
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
  throw new Error('A23 requires an isolated _test database (TEST_DATABASE_URL must end in _test).');
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

describe('A23 Round 5 — BLIND: single-message "confirmo" bundled with an ITEM or PAYMENT-PREFERENCE change is not covered by quoteStillBound', () => {
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
    // Spy, not a functional mock — matches A19-A22 precedent. This finding is fully proven from the
    // persisted `SofiaOrderDraft` row + returned `factEnvelope`/`state` alone.
    const orderCreation = { createFromSofiaDraft: jest.fn(async (input: { draftId: string }) => ({ id: `checkout-${input.draftId}`, replayed: false })) };
    const metrics = new CommercialMetricsService();
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), metrics, responses, repository as never,
      catalog as never, productAvailability as never, recipeAvailability as never,
      { resolve: jest.fn(async () => ({ customerId, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote: jest.fn(async () => { throw new Error('A23: no DELIVERY quoting expected in this file'); }) } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service, orderCreation };
  }

  it(
    'FINDING A23-1 (item bundled with confirm): "Confirmo, y agregame un perro caliente" gets ' +
      'DRAFT_CONFIRMED / narrates 2 items, but the CONFIRMED SofiaOrderDraft row (the ONLY thing ' +
      'SecureCommand(SOFIA_CREATE_ORDER) ever reads) still has only 1 item and the OLD total — the ' +
      'kitchen ticket that would actually be dispatched silently omits what the customer was just ' +
      'told was confirmed',
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
      const originalDraftId = ready.state.draftId!;
      expect(originalDraftId).toBeTruthy();

      const draftBeforeAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftBeforeAttack.status).toBe('READY_TO_CONFIRM');
      expect((draftBeforeAttack.itemsSnapshot as unknown as Array<{ productId: string }>)).toHaveLength(1);
      expect(Number(draftBeforeAttack.total)).toBe(15000);

      // Turn 2 (THE ATTACK): a single, entirely ordinary Spanish message that both confirms AND adds
      // a brand-new, never-priced item in the same breath. No separate turn, no re-prepare.
      const attack = await service.process(cmd(conversationId, 'Confirmo, y agregame un perro caliente', phone));

      // The system DOES report a successful, final confirmation...
      expect(attack.nextAction).toBe('DRAFT_CONFIRMED');
      expect(attack.state.confirmationState).toBe('CONFIRMED');
      // ...narrating BOTH items to the customer as part of what was "confirmed"...
      expect(attack.state.items).toHaveLength(2);
      expect(attack.state.items.map((i) => i.productId).sort()).toEqual([HAMBURGUESA.id, PERRO.id].sort());
      expect(attack.factEnvelope.items).toHaveLength(2);
      // ...while the narrated total is the STALE pre-attack total (15000), NOT the sum a genuine
      // 2-item draft would have priced (24000) — an internally inconsistent message on its own, and
      // SecureCommand(SOFIA_CREATE_ORDER) WAS actually dispatched against the OLD draftId:
      expect(attack.state.total).toBe(15000);
      expect(attack.factEnvelope.total).toBe(15000);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: originalDraftId }));

      // Ground truth: reload the CONFIRMED row fresh from Postgres, independent of anything the
      // process() call chain claimed in memory. This is the ONLY row SofiaCreateOrderCommandHandler
      // (`requiredConfirmedSofiaDraftBinding`) will ever read to materialize a real OrderTicket.
      const draftAfterAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterAttack.status).toBe('CONFIRMED');
      const itemsOnConfirmedRow = draftAfterAttack.itemsSnapshot as unknown as Array<{ productId: string }>;
      // *** The confirmed authority record never learned about the perro caliente at all ***
      expect(itemsOnConfirmedRow).toHaveLength(1);
      expect(itemsOnConfirmedRow[0]!.productId).toBe(HAMBURGUESA.id);
      expect(Number(draftAfterAttack.total)).toBe(15000);

      // The durable conversation-memory record (what a support agent / CRM view / later turn would
      // read as "what this conversation confirmed") DOES persist the phantom 2nd item — a durable,
      // silent divergence from the row that will actually govern the dispatched order.
      const memoryRow = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const persistedState = memoryRow.currentOrderIntentJson as unknown as { items: Array<{ productId: string }>; total: number; confirmationState: string };
      expect(persistedState.confirmationState).toBe('CONFIRMED');
      expect(persistedState.items).toHaveLength(2);
      expect(persistedState.total).toBe(15000);

      // A subsequent, entirely passive "sí" (already-confirmed replay path, commercial-checkout
      // .service.ts:103-106) durably REPLAYS the same divergent 2-item narration back to the
      // customer, with no further server-side mutation — the lie is now permanent for this
      // conversation, not a one-turn artifact.
      const replay = await service.process(cmd(conversationId, 'si', phone));
      expect(replay.nextAction).toBe('DRAFT_CONFIRMED');
      expect(replay.state.items).toHaveLength(2);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1); // no additional dispatch, but no correction either

      console.log(
        `[A23-1] conversationId=${conversationId} draftId=${originalDraftId} confirmed row items=` +
          `${JSON.stringify(itemsOnConfirmedRow)} total=${draftAfterAttack.total} while narrated ` +
          `state.items had ${attack.state.items.length} entries and narrated total=${attack.state.total} ` +
          `(a genuine 2-item TAKEAWAY draft would total 24000).`,
      );
    },
  );

  it(
    'FINDING A23-2 (paymentPreference bundled with confirm): "Confirmo, pasame el link" (PAY_AT_PICKUP ' +
      '-> ONLINE) gets DRAFT_CONFIRMED, but the CONFIRMED SofiaOrderDraft row still says PAY_AT_PICKUP ' +
      '— PaymentOrchestrationService would never generate the payment link the customer explicitly ' +
      'asked for in the very message that confirmed the order',
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
      const originalDraftId = ready.state.draftId!;

      const draftBeforeAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftBeforeAttack.paymentPreference).toBe('PAY_AT_PICKUP');

      // Turn 2 (THE ATTACK): confirms AND switches payment preference to ONLINE in the same message
      // — a valid TAKEAWAY payment option (['ONLINE','PAY_AT_PICKUP']), so CommercialPolicyService
      // .validatePayment() does NOT reject it and does NOT reset it to UNKNOWN/ambiguous. No item
      // change this time, isolating the PAYMENT axis alone.
      const attack = await service.process(cmd(conversationId, 'Confirmo, pasame el link', phone));

      expect(attack.nextAction).toBe('DRAFT_CONFIRMED');
      expect(attack.state.confirmationState).toBe('CONFIRMED');
      // The in-memory/narrated state says the customer is now paying ONLINE...
      expect(attack.state.paymentPreference).toBe('ONLINE');
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: originalDraftId }));

      // Ground truth: the CONFIRMED row — the one SofiaCreateOrderCommandHandler /
      // OrderCheckoutService.createFromConfirmedSofiaDraft actually reads, and the one
      // PaymentOrchestrationService.createOnlinePaymentLink gates its `if (checkout.paymentPreference
      // !== SofiaPaymentPreference.ONLINE) return { required: false }` branch on — still says
      // PAY_AT_PICKUP. No payment link would ever be generated for this customer.
      const draftAfterAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterAttack.status).toBe('CONFIRMED');
      expect(draftAfterAttack.paymentPreference).toBe('PAY_AT_PICKUP');

      const memoryRow = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const persistedState = memoryRow.currentOrderIntentJson as unknown as { paymentPreference: string; confirmationState: string };
      expect(persistedState.confirmationState).toBe('CONFIRMED');
      expect(persistedState.paymentPreference).toBe('ONLINE'); // durably diverges from the confirmed row

      console.log(
        `[A23-2] conversationId=${conversationId} draftId=${originalDraftId} confirmed row ` +
          `paymentPreference=${draftAfterAttack.paymentPreference} while narrated/persisted-memory ` +
          `state.paymentPreference=${attack.state.paymentPreference}.`,
      );
    },
  );

  it(
    'FINDING A23-3 (quantity bundled with confirm, single-item fast path): "Confirmo, mejor dos" ' +
      'narrates quantity=2 and confirms, but the CONFIRMED row keeps quantity=1 and the OLD total — ' +
      'proving the SAME gap reproduces via the independent `state.items.length === 1 && parsed.quantity` ' +
      'mutation path in process(), not just the product-mention path exercised by A23-1',
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

      expect(attack.nextAction).toBe('DRAFT_CONFIRMED');
      expect(attack.state.confirmationState).toBe('CONFIRMED');
      expect(attack.state.items[0]!.quantity).toBe(2); // narrated as 2
      expect(attack.state.total).toBe(15000); // but total still reflects qty=1 -- internally inconsistent
      expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: originalDraftId }));

      const draftAfterAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: originalDraftId } });
      expect(draftAfterAttack.status).toBe('CONFIRMED');
      const itemsOnConfirmedRow = draftAfterAttack.itemsSnapshot as unknown as Array<{ quantity: number }>;
      expect(itemsOnConfirmedRow[0]!.quantity).toBe(1); // the dispatched authority never learned about the 2nd unit
      expect(Number(draftAfterAttack.total)).toBe(15000);

      console.log(
        `[A23-3] conversationId=${conversationId} draftId=${originalDraftId} confirmed row quantity=` +
          `${itemsOnConfirmedRow[0]!.quantity} while narrated state.items[0].quantity=${attack.state.items[0]!.quantity}.`,
      );
    },
  );
});
