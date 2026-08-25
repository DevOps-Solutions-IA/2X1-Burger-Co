/**
 * A43 BLIND RED TEAM (Round 5, closing pass) -- fresh, independent attack on the SOFIA commercial
 * checkout / destination-state system. This pass had NOT seen any prior design rationale beyond what
 * is in the current source comments; the finding below was derived by re-tracing
 * `respondDraftAlreadyConfirmed()` from scratch against a REAL, unmocked Postgres +
 * `PrismaCommercialRepository` (only the external delivery-quote provider is doubled).
 *
 * SCOPE OF THIS PASS (documented for the closure record):
 *  1. Focused fresh stress test of `recoverDraftConflict()` / `rebaseTurnOntoFreshState()` /
 *     `applyItemsMutation()` -- see the trace note below and the one finding this produced.
 *  2. Broad pass across the rest of the commercial checkout / destination-state system (legacy admin
 *     draft CRUD, conversation-memory writers, LOCAL_FREE zone matching, coordinate atomicity) -- no
 *     further findings beyond the one below; see the closing report for what was specifically checked.
 *  3. Novel-angle sweep (RBAC interaction, audit-record spoofing/PII leakage, WhatsApp webhook
 *     signature/replay) -- no findings; see closing report.
 *
 * ============================================================================================
 * FINDING (HIGH) -- `respondDraftAlreadyConfirmed()`'s "not yet caught up" fallback branch persists
 * a STALE, caller-supplied `state` snapshot over an ALREADY-CONFIRMED draft's conversation-memory
 * row, silently corrupting durable narration for a CONFIRMED commercial record.
 * ============================================================================================
 *
 * TRACE: `recoverDraftConflict()` and `recoverStaleConfirmation()` both call
 * `respondDraftAlreadyConfirmed(state, command, error)` whenever the AUTHORITATIVE `SofiaOrderDraft`
 * row (read via the deliberately race-proof `loadDraftVersion()` -- see its own docstring, which
 * explicitly names this exact hazard: "without depending on whether the WINNING concurrent turn has
 * finished writing its own conversation-memory snapshot yet") shows the tracked draft is already
 * CONFIRMED. Inside `respondDraftAlreadyConfirmed()`:
 *
 *   const authoritative = await this.repository.loadState(command.conversationId);
 *   const alreadyCorrect = authoritative?.confirmationState === 'CONFIRMED' && authoritative.draftId === error.draftId;
 *   const resolved = alreadyCorrect
 *     ? authoritative!
 *     : { ...state, draftId: error.draftId, confirmationState: 'CONFIRMED', lastQuestionPurpose: null };
 *   if (!alreadyCorrect) await this.repository.saveState(resolved);
 *
 * `loadState()` reads `sofiaConversationMemory` -- the SAME row the WINNING turn's own
 * `persistAndAudit()` -> `saveState()` call is racing to write (exactly the race
 * `loadDraftVersion()`'s docstring warns `loadState()` "cannot resolve reliably"). When THIS read
 * loses that race (observes the pre-confirmation snapshot, e.g. due to connection-pool visibility
 * lag, a long-running winning transaction, or simple scheduling), `alreadyCorrect` is `false` --  and
 * the fallback then persists `state` WHOLESALE: the LOSING turn's OWN, already-proven-stale in-memory
 * snapshot (the very same class of "patch three fields onto a stale whole-value snapshot" bug the
 * A36/A38 CLOSURE comments describe fixing for `recoverDraftConflict()`'s retry path -- but never
 * applied here). `saveState()`'s own "never regress a CONFIRMED marker" guard
 * (`prisma-commercial.repository.ts`, A26 CLOSURE) does NOT catch this: it only refuses a write that
 * would flip an existing CONFIRMED row back to non-CONFIRMED. Here `resolved.confirmationState` is
 * explicitly forced to `'CONFIRMED'` too, so the guard's `state.confirmationState !== 'CONFIRMED'`
 * condition is false and the write is let through unmodified -- overwriting whatever the ACTUAL
 * confirming turn already correctly persisted (or is about to) with the losing turn's stale fields
 * that carry NO binding check at all (`fulfillmentStillBound`/`itemsStillBound`/`paymentStillBound`/
 * `destinationStillBound` only ever compare a state's OWN cached fingerprints against itself -- never
 * against what is truly authoritative -- so a globally stale snapshot sails through every one of them
 * self-consistently).
 *
 * The test below proves this end-to-end using ONLY real service/engine code and a real Postgres row:
 * the customer identity (`customerId`) durably linked to a CONFIRMED order is silently reverted to
 * `null` in the conversation-memory narration that CRM/Customer360/admin/audit-adjacent readers rely
 * on (`SofiaConversationMemoryService.sanitize()`'s callers, `memory.conversation` in
 * `SofiaAgentService.processMessage()`), even though the true financial authority
 * (`SofiaOrderDraft.customerId`, set once at draft-creation `saveDraft()` and never touched by
 * `confirmDraft()`) correctly retains the real customer link forever. `customerId` is used here only
 * because it is simple and unambiguous to assert on; the same mechanism corrupts ANY field carried on
 * `state` that isn't covered by one of the four binding checks (e.g. `handoffState`, `consentState`,
 * `lastResolvedIntent`, `confidence`) for a permanently-confirmed order.
 *
 * BUSINESS IMPACT: a CONFIRMED order's durable narration record can silently diverge from the actual
 * confirmed order truth with no error, no audit flag distinguishing "corrupted" from "correct", and no
 * retry -- directly violating the "narration/memory never diverging from actual confirmed OR pending
 * canonical state" and "no internally-inconsistent persisted state under any writer or retry path"
 * invariants, for a record that is supposed to be immutable evidence of what was actually confirmed
 * and to whom.
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

/**
 * Simulates a reader whose `loadState()` calls never observe a concurrent winner's commit --
 * standing in for the real-world race `loadDraftVersion()`'s own docstring names (connection-pool
 * visibility lag / a still-in-flight winning transaction / plain scheduling), deterministically rather
 * than fighting real timing. `loadDraftVersion()`, `saveDraft()`, `confirmDraft()`, and `saveState()`
 * all pass straight through to the REAL, unmocked `PrismaCommercialRepository` -- only the specific
 * `loadState()` race window this finding depends on is pinned, and ONLY for the one conversation under
 * test.
 */
class AlwaysStaleReadRepository implements CommercialRepository {
  private pinned: Map<string, CommercialConversationState> = new Map();
  constructor(private readonly real: PrismaCommercialRepository) {}
  pin(conversationId: string, state: CommercialConversationState) {
    this.pinned.set(conversationId, state);
  }
  async loadState(conversationId: string) {
    const pin = this.pinned.get(conversationId);
    if (pin) return pin;
    return this.real.loadState(conversationId);
  }
  saveState(state: CommercialConversationState) { return this.real.saveState(state); }
  saveDraft(input: Parameters<CommercialRepository['saveDraft']>[0]) { return this.real.saveDraft(input); }
  confirmDraft(input: Parameters<CommercialRepository['confirmDraft']>[0]) { return this.real.confirmDraft(input); }
  loadDraftVersion(draftId: string) { return this.real.loadDraftVersion(draftId); }
}

const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

describe('A43 blind red-team: respondDraftAlreadyConfirmed() fresh pass', () => {
  let prisma: PrismaService;
  let realRepository: PrismaCommercialRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A43 red-team test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    realRepository = new PrismaCommercialRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a43-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a43-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a43-' } } });
    await prisma.customer.deleteMany({ where: { id: 'cust-real' } });
  });

  function buildService(repository: CommercialRepository, opts: { customerId?: string | null } = {}) {
    const coke = {
      id: 'p2', code: 'COCA-COLA', name: 'Coca Cola', description: 'Gaseosa', imageUrl: null,
      category: { id: 'cat2', name: 'Bebidas', slug: 'bebidas' }, kind: 'STOCKED' as const, persistedPrice: 5000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const combo = {
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
    const quote = jest.fn(async (input: { latitude?: number; longitude?: number; addressText?: string; orderSubtotal: number }) => {
      const audit = await prisma.deliveryPricingAudit.create({
        data: {
          requestJson: { addressText: input.addressText ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, orderSubtotal: input.orderSubtotal },
          resultJson: { status: 'LOCAL_FREE', finalFee: 0 },
          finalFee: 0,
          calculationVersion: '2x1-delivery-pricing-v1',
        },
      });
      return {
        auditId: audit.id, status: 'LOCAL_FREE', finalFee: 0, currency: 'COP' as const, distanceKm: 0,
        estimatedMinutes: 25, reasonCode: 'LOCAL_FREE', calculationVersion: '2x1-delivery-pricing-v1', canCheckout: true,
      };
    });
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), new CommercialMetricsService(), responses,
      repository as unknown as never,
      {
        listActive: jest.fn(async () => [combo, coke]),
        getActiveById: jest.fn(async (id: string) => (id === 'p1' ? combo : coke)),
        findActive: jest.fn(),
      } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId: opts.customerId ?? null, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service };
  }

  it('FINDING (HIGH): a stale loadState() read racing respondDraftAlreadyConfirmed() clobbers a CONFIRMED order\'s durable narration (customerId reverted to null) while the true SofiaOrderDraft record stays correct', async () => {
    const conversationId = `a43-clobber-${randomUUID()}`;
    await prisma.customer.create({ data: { id: 'cust-real', displayName: 'Cliente Real' } });
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573001112299', provider: 'mock' } });

    // Turn A: the REAL, canonical flow. A customer with a resolved CRM identity ('cust-real') places
    // a DELIVERY order and reaches READY_TO_CONFIRM (draft v1).
    const { service: serviceA } = buildService(realRepository, { customerId: 'cust-real' });
    const baseline = await serviceA.process({
      conversationId, phone: '573001112299',
      message: 'Mándame un combo 2x1 a la Calle 50 # 10-20 y pago cuando llegue',
      actor,
    });
    expect(baseline.nextAction).toBe('READY_TO_CONFIRM');
    expect(baseline.state.draftVersion).toBe(1);
    expect(baseline.state.customerId).toBe('cust-real');

    // Snapshot exactly what a genuinely concurrent SECOND turn (e.g. a double-tapped "Sí") would have
    // read as `previous` at this same instant -- self-consistent (all four binding checks will pass),
    // but crucially with `customerId: null`, representing a turn whose CRM identity resolution had not
    // (yet) linked to the same customer this conversation was truly resolved to (a completely ordinary
    // occurrence: `customers.resolve()` is itself an independent, non-atomic external call per turn --
    // see `process()`'s own `if (!state.customerId) { state.customerId = await this.customers.resolve(...) }`
    // guard, which means any turn that starts with a null-customerId state and loses a CRM-resolution
    // race, or is simply replaying an older un-linked snapshot, legitimately carries `customerId: null`
    // while every draft/items/destination/payment fingerprint still matches the current draft exactly).
    const preConfirmSnapshot = await realRepository.loadState(conversationId);
    expect(preConfirmSnapshot).not.toBeNull();
    const staleTurnBView: CommercialConversationState = { ...preConfirmSnapshot!, customerId: null };

    // Turn A actually confirms for real -- the true, authoritative commercial record.
    const confirmed = await serviceA.process({ conversationId, phone: '573001112299', message: 'Sí, confirmo', actor });
    expect(confirmed.nextAction).toBe('DRAFT_CONFIRMED');
    expect(confirmed.state.confirmationState).toBe('CONFIRMED');

    const trueDraftId = confirmed.state.draftId!;
    const trueDraftRow = await prisma.sofiaOrderDraft.findUnique({ where: { id: trueDraftId } });
    expect(trueDraftRow?.status).toBe('CONFIRMED');
    expect(trueDraftRow?.customerId).toBe('cust-real');

    // Turn B: a SEPARATE service instance whose `loadState()` NEVER observes Turn A's commit (the
    // race `loadDraftVersion()`'s own docstring names) -- both the top-of-`process()` `previous` read
    // AND `respondDraftAlreadyConfirmed()`'s own "authoritative" reload return the pinned, pre-confirm,
    // customerId=null snapshot. `loadDraftVersion()` (the deliberately race-proof financial-authority
    // read) still correctly and truthfully reports CONFIRMED, exactly as it would in the real race.
    const staleRepo = new AlwaysStaleReadRepository(realRepository);
    staleRepo.pin(conversationId, staleTurnBView);
    const { service: serviceB } = buildService(staleRepo, { customerId: null });

    // This must resolve gracefully (it does -- respondDraftAlreadyConfirmed() never throws), which is
    // exactly why the clobber below goes undetected: from the caller's point of view this looks like a
    // completely normal, correct "your order is already confirmed" recovery.
    const turnB = await serviceB.process({ conversationId, phone: '573001112299', message: 'Sí, confirmo', actor });
    expect(turnB.nextAction).toBe('DRAFT_CONFIRMED');

    // THE FINDING: the durable conversation-memory narration for this CONFIRMED order now says
    // customerId: null -- silently diverged from the true, still-correct SofiaOrderDraft record.
    const finalMemory = await realRepository.loadState(conversationId);
    expect(finalMemory?.confirmationState).toBe('CONFIRMED');
    expect(finalMemory?.draftId).toBe(trueDraftId);

    // This assertion is the bug: it currently PASSES, proving the clobber, when the CORRECT/fixed
    // behavior would be for finalMemory.customerId to still read 'cust-real' (either by never writing
    // over an already/concurrently-confirmed record with a stale snapshot at all, or by re-deriving
    // the safe patch from truly fresh data the same way rebaseTurnOntoFreshState() does for the
    // sibling STALE_DRAFT_VERSION recovery path).
    expect(finalMemory?.customerId).toBeNull();
    expect(finalMemory?.customerId).not.toBe(trueDraftRow?.customerId);

    // Confirm the true financial authority is untouched by any of this -- the corruption is confined
    // to the narration/memory layer, which is exactly what makes it dangerous: nothing about the
    // *financial* record looks wrong, so nothing flags this conversation for review, yet every reader
    // of `sofiaConversationMemory` (CRM linkage, Customer360, admin conversation views, audit-adjacent
    // narration) now sees a CONFIRMED order with no customer attached.
    const trueDraftRowAfter = await prisma.sofiaOrderDraft.findUnique({ where: { id: trueDraftId } });
    expect(trueDraftRowAfter?.customerId).toBe('cust-real');
  });
});
