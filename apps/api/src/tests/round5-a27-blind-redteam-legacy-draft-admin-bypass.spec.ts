/**
 * SOFIA Round 5 / A28 CLOSURE — this file originally captured the A27 blind red-team finding
 * (CRITICAL) below as failing/exploit-succeeding tests. It has since been converted into a PERMANENT
 * regression suite proving the fix: `SofiaService.assertLegacyOwnedDraft()` (sofia.service.ts) now
 * rejects `updateDraft()`/`confirmDraft()`/`cancelDraft()` on any `SofiaOrderDraft` whose `draftHash`
 * is set (the 100%-reliable marker that a draft is owned by the canonical conversational commercial
 * authority -- `PrismaCommercialRepository.saveDraft()` is the ONLY writer of `draftHash`,
 * `fulfillment`, and `paymentPreference`; this legacy CRUD surface never sets any of the three). A
 * third test below proves the legitimate MOCK_ADMIN/manual-walk-in use case this endpoint actually
 * serves (create/update/cancel a draft that never went through the WhatsApp conversational flow, e.g.
 * `app.critical.spec.ts`'s "mock admin core" coverage) is unaffected by the fix.
 *
 * The RBAC surface for these four routes was also tightened at `sofia.controller.ts` from inheriting
 * the class-level `@Roles('admin', 'cashier', 'supervisor')` to an explicit route-level
 * `@Roles('admin', 'supervisor')`, matching the precedent already set by the sibling
 * `POST delivery-orders/from-draft/:draftId` mutation. That is defense-in-depth; the actual close of
 * the financial bypass is the service-layer ownership guard exercised below (these tests call
 * `SofiaService` directly, the same way the original A27 finding did, precisely so they keep proving
 * the guard holds regardless of which role/permission set reaches it).
 *
 * === ORIGINAL A27 FINDING (preserved for record) ===
 * SOFIA Round 5 / A27 — BLIND independent red team pass (fresh audit of
 * feat/sofia-remediation-address-round5-26-conversation-memory-race-fix, the branch that closed A25/A26's
 * `sofiaConversationMemory` lost-update race via a row-locked `saveState()` + `DraftAlreadyConfirmedError`).
 * This auditor had NOT seen any of the prior seven rounds' rationale before reading the code fresh.
 *
 * A26's fix is scoped entirely to `PrismaCommercialRepository`/`CommercialCheckoutService` — the SOFIA
 * *conversational* confirmation path (`process()` -> `confirm()` -> `repository.confirmDraft()`), which
 * independently re-validates destination/fulfillment/items/payment binding (A9/A10, A21/A22, A23/A24)
 * before ever trusting a persisted `SofiaOrderDraft` row.
 *
 * THIS FILE targets an ENTIRELY DIFFERENT, PRE-EXISTING mutation path onto the exact SAME
 * `sofia_order_drafts` table that the task brief explicitly asked this round to look for: "a race between
 * confirm() and an entirely different mutation path (e.g. a legacy-POS-style edit somehow touching the
 * same conversation/order...)".
 *
 * `apps/api/src/modules/sofia/sofia.controller.ts` exposes a SEPARATE staff-facing CRUD surface for
 * `SofiaOrderDraft` rows, entirely independent of `CommercialCheckoutService`:
 *
 *     POST   /sofia/order-drafts            -> SofiaService.createDraft()
 *     PATCH  /sofia/order-drafts/:id        -> SofiaService.updateDraft()
 *     POST   /sofia/order-drafts/:id/confirm -> SofiaService.confirmDraft()
 *     POST   /sofia/order-drafts/:id/cancel  -> SofiaService.cancelDraft()
 *
 * These four routes carry NO route-level `@Roles(...)` override, so they inherit the CONTROLLER
 * class-level guard alone: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin', 'cashier',
 * 'supervisor')` (sofia.controller.ts lines 46-49, 361-398). Any authenticated CASHIER — the lowest of
 * the three listed roles, a routine day-to-day staff account, not an admin/owner credential — can call
 * every one of these four endpoints on ANY `SofiaOrderDraft` row by id, INCLUDING a draft that a live
 * customer WhatsApp conversation currently has PENDING via `CommercialCheckoutService`. Nothing links
 * these two code paths: `SofiaService.updateDraft()`/`confirmDraft()` never read or write
 * `sofiaConversationMemory` (grep confirms zero references to `sofiaConversationMemory` anywhere in
 * `sofia.service.ts`), and never call `applyDestinationEdit`/`destination-revision` (A9's canonical
 * destination-state authority) or `DeliveryQuoteService` at all.
 *
 * Concretely, `SofiaService.updateDraft()` (sofia.service.ts ~1068-1127):
 *   - Accepts a bare `deliveryAddress` string with ZERO geocoding, ZERO coordinate-trust check, ZERO
 *     zone-alias/LOCAL_FREE evaluation, ZERO call to any `DeliveryQuoteService`/distance-pricing engine.
 *   - Recomputes money via `this.draftMoney(items)` -- and CRITICALLY, every call site
 *     (`createDraft` line 998, `updateDraft` line 1085) invokes `draftMoney(items)` WITHOUT ever
 *     supplying the `deliveryFee` parameter, whose signature is `draftMoney(items, deliveryFee = 0)`
 *     (line 307-315). This means ANY `updateDraft()` call UNCONDITIONALLY ZEROES `deliveryFee` on the
 *     row, no matter how the fee got there or how far the address is -- there is no way to pass a
 *     nonzero delivery fee through this endpoint at all.
 *   - Recomputes `subtotal` by summing `item.totalPrice` over the EXISTING items snapshot
 *     (`readItemsSnapshot`, line 236-259, `totalPrice: Number(record.totalPrice ?? 0)`). A
 *     SOFIA-conversation-created draft's `itemsSnapshot` (written by
 *     `PrismaCommercialRepository.saveDraft()`, persistence/prisma-commercial.repository.ts line
 *     71-126) stores `{ productId, code, name, quantity, unitPrice, modifiers }` -- NO `totalPrice`
 *     field is ever written by that path. So `readItemsSnapshot` defaults `totalPrice` to 0 for EVERY
 *     item on a SOFIA-originated draft, and `draftMoney` sums those zeros: `subtotal` collapses to 0
 *     too. The combined effect of one single `PATCH /sofia/order-drafts/:id` call against a
 *     SOFIA-created DELIVERY draft is `subtotal := 0`, `deliveryFee := 0`, `total := 0` --
 *     unconditionally, regardless of what was actually quoted/priced.
 *   - Leaves `version` and `draftHash` on the row COMPLETELY UNTOUCHED (the Prisma `update()` `data`
 *     block at line 1094-1115 never includes either field), so the CAS check inside
 *     `SofiaService.confirmDraft()` (`updateMany where { id, version: draft.version, draftHash:
 *     draft.draftHash, status: READY_TO_CONFIRM, expiresAt: {gt: now} }`, line 1162-1163) -- which
 *     re-reads `version`/`draftHash` FRESH from the row it just patched -- trivially matches, because
 *     nothing ever changed them. The falsified $0 total, falsified address, is confirmed as-is.
 *
 * SEVERITY: CRITICAL. This lets ANY cashier-level account financially confirm an existing customer
 * DELIVERY order at a REWRITTEN address for a REWRITTEN price of exactly $0.00 (both subtotal AND
 * delivery fee), using a "legacy admin" surface that was never wired to any of the seven previous
 * rounds' destination/quote/binding protections, and durable conversation memory is left permanently
 * unaware the draft it still thinks is PENDING was actually confirmed by a totally different code path
 * moments later -- so the customer's own next honest "confirmo" throws an UNCAUGHT `ConflictException`
 * (`SOFIA_STALE_CONFIRMATION`) instead of being told the truth.
 *
 * VIOLATES:
 *   - Invariant 10 (LOCAL_FREE-via-bare-text bypass) -- and goes further: this isn't even a zone-alias
 *     match, it is an UNCONDITIONAL fee zeroing with no address evaluation of any kind.
 *   - Invariant 11 (confirmed price/fulfillment/items/payment must correspond to evidence ACTUALLY
 *     current and trusted "in both SOFIA and legacy POS") -- this IS exactly a "legacy" surface, and it
 *     enforces NONE of that evidence.
 *   - Invariant 13 (an edit that is NOT itself confirming evidence must never silently promote
 *     non-confirmed data into a fresh, re-authorized commercial price) -- `updateDraft()` is a bare
 *     field edit, yet it silently rewrites the row's authoritative price to $0 with no re-quote.
 *   - Invariant 14 (evidence linking between the checkout's computation and what actually gets
 *     confirmed must be accurate).
 *   - Invariant 16 (customer narration vs. durable record must never diverge) -- the customer's
 *     conversation state (and hence anything SOFIA would ever tell them) never learns the draft was
 *     confirmed at all, let alone at the falsified price/address.
 *   - Invariant 18 (durable state must never silently lose evidence that something was already
 *     confirmed) -- `sofiaConversationMemory.currentOrderIntentJson.confirmationState` for this
 *     conversation stays stuck at whatever it was BEFORE this admin confirmation (PENDING), forever,
 *     unless some other message happens to trigger `saveState()` again.
 *
 * Real Postgres (isolated `_test`/round5 database), real unmocked `SofiaService.updateDraft()` /
 * `SofiaService.confirmDraft()`, real unmocked `CommercialCheckoutService` + `PrismaCommercialRepository`
 * for the SOFIA-conversation side that produces the victim draft in the first place. Only the
 * `DeliveryQuoteService`/`CatalogReadService`/`CustomerResolutionService`/`AuditCommandService`/
 * `AuditService`/`ConfigService`/`WhatsappHandoffService` edges are doubled (external/ancillary
 * dependencies, exactly the pattern every prior round-5 spec in this directory already uses) -- none of
 * the code actually under test (`sofia.service.ts`'s draft CRUD, `commercial-checkout.service.ts`,
 * `prisma-commercial.repository.ts`) is mocked.
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
import { SofiaService } from '../modules/sofia/sofia.service';
import type { CommercialMessageCommand } from '../modules/sofia/commercial/commercial.types';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error('A27 requires an isolated _test database (TEST_DATABASE_URL must end in _test).');
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

function cmd(conversationId: string, message: string, phone: string): CommercialMessageCommand {
  return { conversationId, message, phone, displayName: 'Cliente A27', actor };
}

const HAMBURGUESA = {
  id: 'a27-p1-hamburguesa', code: 'HAMB-CLASICA', name: 'Hamburguesa Clasica', description: 'Res',
  imageUrl: null, category: { id: 'cat', name: 'Hamburguesas', slug: 'hamburguesas' }, kind: 'PREPARED' as const,
  persistedPrice: 15000, active: true, trackStock: true, updatedAt: new Date().toISOString(),
};
const PRODUCTS = [HAMBURGUESA];
const QUOTED_DELIVERY_FEE = 12000;

describe('A28 Round 5 (closure of A27 BLIND finding) — legacy /sofia/order-drafts admin CRUD can no longer touch a draft owned by the canonical SOFIA-conversation commercial authority; the legitimate MOCK_ADMIN walk-in use case keeps working', () => {
  jest.setTimeout(30000);
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a27-legacy-' } } }).catch(() => undefined);
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a27-legacy-' } } }).catch(() => undefined);
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a27-legacy-' } } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { displayName: 'Cliente A27' } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  // `SofiaOrderDraft.deliveryQuoteAuditId` carries a real FK to `DeliveryPricingAudit` -- unlike the
  // customer/catalog/order-creation edges, this ISN'T optional to satisfy at the Postgres level, so a
  // real row is created here (still an "external system" boundary -- the actual pricing ENGINE that
  // would have produced this row is not what this file is testing) and its real id is threaded through
  // the quote mock.
  async function createRealDeliveryQuoteAudit(finalFee: number) {
    const audit = await prisma.deliveryPricingAudit.create({
      data: {
        requestJson: { addressText: 'Enviamelo a la Avenida Central', orderSubtotal: 15000 },
        resultJson: { finalFee, canCheckout: true },
        suggestedFee: finalFee,
        finalFee,
        calculationVersion: '2x1-delivery-pricing-v1',
      },
    });
    return audit.id;
  }

  function buildCommercialService(customerId: string, quoteAuditId: string, repository = new PrismaCommercialRepository(prisma as never)) {
    const catalog = {
      listActive: jest.fn(async () => PRODUCTS),
      getActiveById: jest.fn(async (id: string) => PRODUCTS.find((p) => p.id === id)!),
      findActive: jest.fn(),
    };
    const productAvailability = { check: jest.fn(async (input: { productId: string; quantity: number }) => ({ productId: input.productId, quantity: input.quantity, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) };
    const recipeAvailability = { check: jest.fn(async (input: { productId: string; quantity: number }) => ({ productId: input.productId, quantity: input.quantity, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) };
    const responses = new CommercialResponseComposer({ compose: jest.fn(async () => null) }, new CommercialResponseValidator(), new SafeCommercialResponseTemplates());
    const orderCreation = { createFromSofiaDraft: jest.fn(async (input: { draftId: string }) => ({ id: `checkout-${input.draftId}`, replayed: false })) };
    const quote = jest.fn(async (_input: { addressText?: string; latitude?: number; longitude?: number; orderSubtotal: number }) => ({
      auditId: quoteAuditId,
      status: 'AUTO_PRICED',
      finalFee: QUOTED_DELIVERY_FEE,
      currency: 'COP' as const,
      distanceKm: 6.4,
      estimatedMinutes: 22,
      reasonCode: 'AUTO_PRICED',
      calculationVersion: '2x1-delivery-pricing-v1',
      canCheckout: true,
    }));
    const metrics = new CommercialMetricsService();
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), metrics, responses, repository as never,
      catalog as never, productAvailability as never, recipeAvailability as never,
      { resolve: jest.fn(async () => ({ customerId, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service, repository, orderCreation, quote };
  }

  function buildSofiaAdminService() {
    // Doubled edges only: AuditService (ancillary logging, not the code under test),
    // ConfigService/CatalogReadService/WhatsappHandoffService (unused by createDraft/updateDraft/
    // confirmDraft/cancelDraft -- verified by reading sofia.service.ts before writing this test).
    // The FIRST argument is the real, unmocked `prisma` connected to the SAME live Postgres database
    // the SOFIA-conversation side above just wrote to -- `SofiaService.updateDraft()`/`confirmDraft()`
    // themselves are executed for real, with zero mocking of the code under test.
    const fakeAudit = { log: jest.fn(async () => undefined) };
    return new SofiaService(prisma as never, fakeAudit as never, {} as never, { getActiveById: jest.fn(), listActive: jest.fn(), findActive: jest.fn() } as never, {} as never);
  }

  it(
    'CLOSED (A28): a cashier-reachable PATCH+confirm on /sofia/order-drafts can no longer touch a real, geo-quoted $27,000 COP DELIVERY draft at all -- both calls are rejected before any mutation, the honest values survive untouched, and sofiaConversationMemory + the customer\'s own "confirmo" both stay correct',
    async () => {
      const conversationId = `a27-legacy-exploit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001130001';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A27' } });

      // --- Genuine, honest customer conversation: one item, real DELIVERY, real geo-quoted fee. ---
      const quoteAuditId = await createRealDeliveryQuoteAudit(QUOTED_DELIVERY_FEE);
      const { service, quote } = buildCommercialService(customer.id, quoteAuditId);
      await service.process(cmd(conversationId, 'Quiero una hamburguesa clasica', phone));
      await service.process(cmd(conversationId, 'domicilio', phone));
      await service.process(cmd(conversationId, 'pago cuando llegue', phone));
      const ready = await service.process(cmd(conversationId, 'Enviamelo a la Avenida Central', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      expect(ready.state.fulfillment).toBe('DELIVERY');
      expect(quote).toHaveBeenCalled();
      const draftD = ready.state.draftId!;
      expect(draftD).toBeTruthy();

      const beforeAttack = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      // Ground truth: a real, non-trivial, geo-quoted DELIVERY draft -- exactly the kind of record whose
      // integrity invariants 10/11/13/14 are supposed to protect.
      expect(Number(beforeAttack.subtotal)).toBe(15000);
      expect(Number(beforeAttack.deliveryFee)).toBe(QUOTED_DELIVERY_FEE);
      expect(Number(beforeAttack.total)).toBe(15000 + QUOTED_DELIVERY_FEE);
      expect(beforeAttack.deliveryAddress).toBe('Avenida Central');
      expect(beforeAttack.status).toBe('READY_TO_CONFIRM');
      const originalVersion = beforeAttack.version;
      const originalHash = beforeAttack.draftHash;
      expect(originalHash).toBeTruthy();

      const memoryBeforeAttack = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const stateBeforeAttack = memoryBeforeAttack.currentOrderIntentJson as unknown as { confirmationState: string; draftId: string };
      expect(stateBeforeAttack.confirmationState).toBe('PENDING');
      expect(stateBeforeAttack.draftId).toBe(draftD);

      // --- THE ATTACK (now blocked): a routine cashier-level staff account (NOT admin, NOT the
      // customer, NOT SOFIA) hits the legacy /sofia/order-drafts CRUD directly on the SAME draft id the
      // live customer conversation is tracking. `draftHash` on this draft is non-null (it was created by
      // `PrismaCommercialRepository.saveDraft()`), so `SofiaService.assertLegacyOwnedDraft()` must reject
      // the PATCH before touching the row at all. ---
      const cashierActorId = 'malicious-or-compromised-cashier-account';
      const admin = buildSofiaAdminService();
      let updateError: unknown = null;
      try {
        await admin.updateDraft(
          draftD,
          {
            deliveryAddress: 'Direccion inventada por el cajero, jamas geocodificada ni cotizada',
            customerName: 'Cliente Suplantado',
            customerPhone: '3000000000',
          },
          cashierActorId,
        );
      } catch (error) {
        updateError = error;
      }
      expect(updateError).not.toBeNull();
      expect((updateError as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({
        code: 'SOFIA_DRAFT_OWNED_BY_CONVERSATION_AUTHORITY',
      });

      // *** THE FIX: zero mutation happened. Subtotal, delivery fee, total, address, version and hash
      // are BYTE-IDENTICAL to the honest, geo-quoted draft -- the rejected PATCH never reached Prisma. ***
      const afterBlockedUpdate = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      expect(Number(afterBlockedUpdate.subtotal)).toBe(15000);
      expect(Number(afterBlockedUpdate.deliveryFee)).toBe(QUOTED_DELIVERY_FEE);
      expect(Number(afterBlockedUpdate.total)).toBe(15000 + QUOTED_DELIVERY_FEE);
      expect(afterBlockedUpdate.deliveryAddress).toBe('Avenida Central');
      expect(afterBlockedUpdate.version).toBe(originalVersion);
      expect(afterBlockedUpdate.draftHash).toBe(originalHash);
      expect(afterBlockedUpdate.status).toBe('READY_TO_CONFIRM');

      // Even WITHOUT the update step, a bare confirmDraft() call against this canonical-owned draft must
      // be rejected too -- proving the guard closes the mid-conversation-hijack variant (scenario 2
      // below) independently of whether updateDraft() was ever invoked.
      let confirmError: unknown = null;
      try {
        await admin.confirmDraft(draftD, cashierActorId);
      } catch (error) {
        confirmError = error;
      }
      expect(confirmError).not.toBeNull();
      expect((confirmError as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({
        code: 'SOFIA_DRAFT_OWNED_BY_CONVERSATION_AUTHORITY',
      });

      const draftInDb = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      expect(draftInDb.status).toBe('READY_TO_CONFIRM');
      expect(Number(draftInDb.total)).toBe(15000 + QUOTED_DELIVERY_FEE);
      expect(draftInDb.deliveryQuoteAuditId).toBe(quoteAuditId);

      // sofiaConversationMemory correctly still says PENDING -- nothing was confirmed by anyone, so this
      // is now the HONEST state, not a divergence (invariant 18 upheld).
      const memoryAfterAttack = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      const stateAfterAttack = memoryAfterAttack.currentOrderIntentJson as unknown as { confirmationState: string; draftId: string };
      expect(stateAfterAttack.confirmationState).toBe('PENDING');
      expect(stateAfterAttack.draftId).toBe(draftD);

      // The honest customer's own "confirmo" through the REAL SOFIA conversational path now succeeds
      // normally, at the correct, never-tampered-with price and address -- no uncaught exception, no
      // phantom $0 record, invariant 16 upheld end-to-end.
      const { service: honestFollowUp } = buildCommercialService(customer.id, quoteAuditId);
      const confirmResult = await honestFollowUp.process(cmd(conversationId, 'confirmo', phone));
      expect(confirmResult.nextAction).toBe('DRAFT_CONFIRMED');
      expect(confirmResult.state.confirmationState).toBe('CONFIRMED');
      expect(confirmResult.state.draftId).toBe(draftD);

      const finalDraft = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      expect(finalDraft.status).toBe('CONFIRMED');
      expect(Number(finalDraft.total)).toBe(15000 + QUOTED_DELIVERY_FEE);
      expect(finalDraft.deliveryAddress).toBe('Avenida Central');

      console.log(
        `[A28 CLOSURE] conversationId=${conversationId} draftD=${draftD} -- legacy /sofia/order-drafts ` +
          `updateDraft()/confirmDraft() both rejected with SOFIA_DRAFT_OWNED_BY_CONVERSATION_AUTHORITY on ` +
          `the canonical-owned draft; the honest $${15000 + QUOTED_DELIVERY_FEE} order was later confirmed ` +
          `correctly through the real conversational "confirmo" flow.`,
      );
    },
  );

  it(
    'CLOSED (A28): the SAME legacy path can no longer let a cashier CONFIRM (mid-conversation hijack) a canonical-owned draft the customer had not yet said "confirmo" for -- both updateDraft() and confirmDraft() are rejected, and the customer\'s own later "confirmo" still confirms correctly',
    async () => {
      const conversationId = `a27-legacy-midconv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const phone = '573001130002';
      await prisma.whatsappConversation.create({ data: { id: conversationId, phone, provider: 'whatsapp_business_api' } });
      const customer = await prisma.customer.create({ data: { displayName: 'Cliente A27' } });

      const quoteAuditId = await createRealDeliveryQuoteAudit(QUOTED_DELIVERY_FEE);
      const { service, quote } = buildCommercialService(customer.id, quoteAuditId);
      await service.process(cmd(conversationId, 'Quiero una hamburguesa clasica', phone));
      await service.process(cmd(conversationId, 'domicilio', phone));
      await service.process(cmd(conversationId, 'pago cuando llegue', phone));
      const ready = await service.process(cmd(conversationId, 'Enviamelo a la Avenida Central', phone));
      expect(ready.nextAction).toBe('READY_TO_CONFIRM');
      expect(quote).toHaveBeenCalled();
      const draftD = ready.state.draftId!;

      // Customer has NOT yet said "confirmo" -- conversation memory still shows PENDING, which is the
      // CORRECT, honest state (nothing was ever confirmed by the customer).
      const memoryBefore = await prisma.sofiaConversationMemory.findUniqueOrThrow({ where: { conversationId } });
      expect((memoryBefore.currentOrderIntentJson as unknown as { confirmationState: string }).confirmationState).toBe('PENDING');

      // A cashier, with no customer confirmation ever having happened, tries to directly confirm the
      // draft via the legacy admin surface -- after first attempting to "edit" it (same shape as the
      // $0-zeroing attempt above) to prove this is not a benign read-only confirm of an already-correct
      // row. Both calls must now be rejected before touching the row.
      const admin = buildSofiaAdminService();
      let updateError: unknown = null;
      try {
        await admin.updateDraft(draftD, { customerName: 'X', customerPhone: '3000000001' }, 'cashier-2');
      } catch (error) {
        updateError = error;
      }
      expect(updateError).not.toBeNull();
      expect((updateError as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({
        code: 'SOFIA_DRAFT_OWNED_BY_CONVERSATION_AUTHORITY',
      });

      let confirmError: unknown = null;
      try {
        await admin.confirmDraft(draftD, 'cashier-2');
      } catch (error) {
        confirmError = error;
      }
      expect(confirmError).not.toBeNull();
      expect((confirmError as { getResponse?: () => unknown }).getResponse?.()).toMatchObject({
        code: 'SOFIA_DRAFT_OWNED_BY_CONVERSATION_AUTHORITY',
      });

      // The customer NEVER said "confirmo" for this order, and Postgres correctly still holds it
      // READY_TO_CONFIRM (not CONFIRMED) -- invariant 11 upheld: no confirmation without confirming
      // customer evidence, from ANY code path.
      const draftInDb = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      expect(draftInDb.status).toBe('READY_TO_CONFIRM');
      expect(Number(draftInDb.total)).toBe(15000 + QUOTED_DELIVERY_FEE);
      expect(draftInDb.customerName).toBeNull();

      // The customer's own, later "confirmo" through the real conversational path still works
      // correctly, proving the guard did not leave the draft in some unconfirmable limbo state.
      const { service: honestFollowUp } = buildCommercialService(customer.id, quoteAuditId);
      const confirmResult = await honestFollowUp.process(cmd(conversationId, 'confirmo', phone));
      expect(confirmResult.nextAction).toBe('DRAFT_CONFIRMED');
      const finalDraft = await prisma.sofiaOrderDraft.findUniqueOrThrow({ where: { id: draftD } });
      expect(finalDraft.status).toBe('CONFIRMED');
      expect(Number(finalDraft.total)).toBe(15000 + QUOTED_DELIVERY_FEE);
    },
  );

  it(
    'legitimate use case preserved: a genuine MOCK_ADMIN manual walk-in draft (never touched by the conversational commercial authority, draftHash === null) can still be created, edited, and cancelled through the legacy /sofia/order-drafts endpoint exactly as before',
    async () => {
      // Same style of catalog double used throughout this file for the CommercialCheckoutService side
      // (HAMBURGUESA/PRODUCTS above) -- `SofiaService.buildItemsSnapshot()` only ever calls
      // `catalogRead.getActiveById(productId)` and reads `.id/.code/.name/.persistedPrice` off the
      // result, so a real Prisma `Product` row is not required to exercise this code path faithfully.
      const walkinProduct = { id: 'a28-walkin-p1', code: 'HAMB-WALKIN', name: 'Hamburguesa Mostrador', persistedPrice: 18000 };
      const catalogReadStub = { getActiveById: jest.fn(async () => walkinProduct), listActive: jest.fn(), findActive: jest.fn() };
      const admin = new SofiaService(prisma as never, { log: jest.fn(async () => undefined) } as never, {} as never, catalogReadStub as never, {} as never);

      // A staff member manually building a draft for a walk-in/phone customer that never went through
      // WhatsApp -- no conversationId, no draftHash, no phase-4 binding of any kind.
      const created = await admin.createDraft(
        {
          customerName: 'Cliente Mostrador A28',
          customerPhone: '3000000099',
          deliveryAddress: 'Recoge en tienda',
          items: [{ productId: walkinProduct.id, quantity: 2 } as never],
        } as never,
        'walkin-staff-1',
      );
      expect(created.status).toBe('READY_TO_CONFIRM');
      expect(created.draftHash).toBeNull();
      expect(Number(created.subtotal)).toBe(36000);
      expect(Number(created.total)).toBe(36000);

      // updateDraft() and cancelDraft() must NOT be blocked by the new guard -- draftHash is still null.
      const updated = await admin.updateDraft(created.id, { deliveryNotes: 'Recoger antes de las 8pm' }, 'walkin-staff-1');
      expect(updated.deliveryNotes).toBe('Recoger antes de las 8pm');
      expect(Number(updated.total)).toBe(36000);

      const cancelled = await admin.cancelDraft(created.id, 'walkin-staff-1');
      expect(cancelled.status).toBe('CANCELLED');

      await prisma.sofiaOrderDraft.deleteMany({ where: { id: created.id } }).catch(() => undefined);
    },
  );
});
