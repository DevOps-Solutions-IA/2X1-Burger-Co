import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import { CommercialCheckoutService } from './commercial-checkout.service';
import type { CommercialConversationState } from './commercial.types';

/**
 * SOFIA Round 5 / A49 — blind, independent red-team re-verification of A48's
 * `reconcileConfirmedState()` atomic transaction (the fix for A37/A39/A41/A43/A45/A47's six
 * consecutive "narrow the window" races on `respondDraftAlreadyConfirmed()`).
 *
 * Unlike `commercial-checkout.a47-concurrency-sanity.spec.ts` (which proves the LOCK itself does
 * not deadlock/hang under concurrency, using a toy `decide` callback), this file exercises the
 * REAL, unmodified `CommercialCheckoutService.decideConfirmedReconciliation()` /
 * `stateFromConfirmedDraftRecord()` production decision logic — reached here via the same private
 * method the repository actually invokes inside its locked transaction — under:
 *
 *   1. A genuine 4-way race of DIFFERENT losing turns (distinct stale in-memory snapshots) all
 *      reconciling the SAME conversation+draft concurrently, verifying the outcome is always a
 *      single, internally-consistent record and NEVER a hybrid of two losers' stale fields.
 *   2. A genuine race between several losing reconciles AND a REAL, genuinely-late winning
 *      `saveState()` write (the exact gap A48's docstring describes: `confirmDraft()` committed,
 *      but the winning turn's own `persistAndAudit()` has not landed yet) — repeated across many
 *      trials with a fresh conversation each time, to catch any ordering-dependent corruption that
 *      a single run could miss.
 *   3. High-fan-out (10-way) concurrent reconciliation to check for uncaught exceptions escaping
 *      the atomic transaction under realistic contention.
 *
 * No source file is modified. Only this spec is added.
 */
describe('A49 blind red-team: reconcileConfirmedState() re-verification with REAL decision logic', () => {
  let prisma: PrismaService;
  let repo: PrismaCommercialRepository;
  let service: CommercialCheckoutService;
  let decide: (
    state: CommercialConversationState,
    draftId: string,
    locked: { current: CommercialConversationState | null; confirmedDraft: unknown },
  ) => { resolved: CommercialConversationState; persist: boolean };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    repo = new PrismaCommercialRepository(prisma);
    // Only decideConfirmedReconciliation()/stateFromConfirmedDraftRecord()/paymentReadinessFor()
    // are exercised below -- all three are pure functions of their arguments with zero I/O and
    // zero use of any injected collaborator, so passing inert stand-ins for the constructor's
    // other dependencies (never invoked by this code path) is faithful to production behavior,
    // not a mock of the mechanism under test.
    service = new CommercialCheckoutService(
      {} as never, {} as never, {} as never, {} as never,
      repo, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    decide = (service as any).decideConfirmedReconciliation.bind(service);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  function baseState(conversationId: string, overrides: Partial<CommercialConversationState> = {}): CommercialConversationState {
    return {
      schemaVersion: 4, conversationId, intent: 'PURCHASE', confirmationState: 'PENDING', draftId: null, draftVersion: null,
      draftHash: null, fulfillment: 'TAKEAWAY', paymentPreference: 'CASH_ON_DELIVERY', paymentReadiness: 'PAYMENT_COD',
      items: [], address: null, addressConfirmed: false, subtotal: 0, deliveryFee: 0, total: 0,
      deliveryQuoteAuditId: null, deliveryQuoteVersion: null, deliveryQuoteExpiresAt: null, availabilitySnapshot: [],
      missingFields: [], expiresAt: null, customerId: null, handoffState: 'SOFIA_ACTIVE', consentState: 'NOT_REQUIRED',
      confidence: 'LOW', lastResolvedIntent: null, ambiguities: [], destinationSnapshot: null, location: null,
      deliveryQuoteDestinationBinding: null, lastQuestionPurpose: null, draftFulfillment: null, draftItemsFingerprint: null,
      draftPaymentPreference: null, domainErrors: [],
      ...overrides,
    } as unknown as CommercialConversationState;
  }

  async function setupConversationAndConfirmedDraft(conversationId: string, phoneSuffix: string) {
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: `57300888${phoneSuffix}`, provider: 'mock' } });
    const customer = await prisma.customer.create({ data: { displayName: `A49 Customer ${phoneSuffix}` } });
    const draft = await prisma.sofiaOrderDraft.create({
      data: {
        conversationId, status: 'READY_TO_CONFIRM', fulfillment: 'TAKEAWAY', paymentPreference: 'CASH_ON_DELIVERY',
        version: 1, draftHash: 'hash-a49', itemsSnapshot: [{ productId: 'p1', name: 'Burger', quantity: 1, unitPrice: 15000, modifiers: [] }],
        subtotal: 15000, deliveryFee: 0, total: 15000, availabilitySnapshot: [],
        expiresAt: new Date(Date.now() + 60_000), customerId: customer.id,
      },
    });
    // Simulate the winning turn's confirmDraft() CAS already having committed (step 1 of
    // `confirm()`) -- this is the exact state `respondDraftAlreadyConfirmed()` is invoked in.
    await prisma.sofiaOrderDraft.update({
      where: { id: draft.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmationHash: 'confirmed-a49' },
    });
    const pending = baseState(conversationId, {
      draftId: draft.id, draftVersion: 1, draftHash: 'hash-a49', confirmationState: 'PENDING',
      lastQuestionPurpose: 'CONFIRM_ORDER',
    });
    await repo.saveState(pending);
    return { draftId: draft.id, customerId: customer.id };
  }

  async function cleanup(conversationId: string, customerId?: string) {
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId } });
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId } });
    await prisma.whatsappConversation.deleteMany({ where: { id: conversationId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  }

  it('FOUR genuinely concurrent reconcileConfirmedState() calls (real decision logic, four DIFFERENT stale losing snapshots) never produce a hybrid/corrupted record', async () => {
    const conversationId = `a49-4way-${randomUUID()}`;
    const { draftId, customerId: realCustomerId } = await setupConversationAndConfirmedDraft(conversationId, '01');

    const losers = [
      baseState(conversationId, { draftId, customerId: 'STALE-LOSER-1', handoffState: 'HUMAN_REQUIRED' }),
      baseState(conversationId, { draftId, customerId: 'STALE-LOSER-2', handoffState: 'HUMAN_REQUIRED' }),
      baseState(conversationId, { draftId, customerId: 'STALE-LOSER-3', missingFields: ['ghost-field'] }),
      baseState(conversationId, { draftId, customerId: 'STALE-LOSER-4', consentState: 'REQUIRED' }),
    ];

    const results = await Promise.all(
      losers.map((loserState) =>
        repo.reconcileConfirmedState(conversationId, draftId, (locked) => decide(loserState, draftId, locked)),
      ),
    );

    // Every concurrent caller must observe the SAME final resolved confirmationState/draftId --
    // no caller may see a torn/partial view.
    for (const r of results) {
      expect(r.confirmationState).toBe('CONFIRMED');
      expect(r.draftId).toBe(draftId);
      // The reconstruction is sourced ONLY from the authoritative SofiaOrderDraft row -- never
      // from any loser's stale in-memory customerId. A hybrid/corrupted record would show one of
      // the STALE-LOSER-* markers here.
      expect(r.customerId).toBe(realCustomerId);
    }

    const finalDb = await repo.loadState(conversationId);
    expect(finalDb?.confirmationState).toBe('CONFIRMED');
    expect(finalDb?.customerId).toBe(realCustomerId);
    expect(finalDb?.draftId).toBe(draftId);

    // Exactly one confirmed conversation-memory row -- no duplicate/split record from the 4-way race.
    const rows = await prisma.sofiaConversationMemory.findMany({ where: { conversationId } });
    expect(rows.length).toBe(1);

    await cleanup(conversationId, realCustomerId);
  }, 20000);

  it('a genuinely late REAL winning saveState() (true rich narration) racing losing reconciles ALWAYS wins, regardless of interleave order -- repeated across many trials', async () => {
    const TRIALS = 12;
    for (let trial = 0; trial < TRIALS; trial++) {
      const conversationId = `a49-latewinner-${trial}-${randomUUID()}`;
      const { draftId, customerId: realCustomerId } = await setupConversationAndConfirmedDraft(conversationId, `${10 + trial}`);

      // The REAL winning turn's true, rich narration -- distinguishable from BOTH the losers'
      // stale data AND the neutral stateFromConfirmedDraftRecord() reconstruction defaults
      // (which always set handoffState back to 'SOFIA_ACTIVE' and missingFields to []).
      const trueRichState = baseState(conversationId, {
        draftId, draftVersion: 1, draftHash: 'hash-a49', confirmationState: 'CONFIRMED', lastQuestionPurpose: null,
        customerId: realCustomerId, handoffState: 'HUMAN_REQUIRED', missingFields: ['TRUE_RICH_MARKER'],
      });

      const loserA = baseState(conversationId, { draftId, customerId: 'STALE-LOSER-A' });
      const loserB = baseState(conversationId, { draftId, customerId: 'STALE-LOSER-B' });
      const loserC = baseState(conversationId, { draftId, customerId: 'STALE-LOSER-C' });

      // Fire the real winner's saveState() (mirrors persistAndAudit()->saveState() in confirm())
      // concurrently with three losing reconciles (mirrors respondDraftAlreadyConfirmed() for
      // three other in-flight turns that all raced the SAME confirmDraft() CAS). Promise.all with
      // no ordering guarantee -- Postgres's own lock-queue ordering decides interleave order.
      await Promise.all([
        repo.saveState(trueRichState),
        repo.reconcileConfirmedState(conversationId, draftId, (locked) => decide(loserA, draftId, locked)),
        repo.reconcileConfirmedState(conversationId, draftId, (locked) => decide(loserB, draftId, locked)),
        repo.reconcileConfirmedState(conversationId, draftId, (locked) => decide(loserC, draftId, locked)),
      ]);

      const finalDb = await repo.loadState(conversationId);
      expect(finalDb?.confirmationState).toBe('CONFIRMED');
      // The TRUE rich narration must be the one left standing -- never a loser's stale customerId,
      // and never the neutral reconstruction (which would show handoffState 'SOFIA_ACTIVE' and
      // missingFields []).
      expect(finalDb?.customerId).toBe(realCustomerId);
      expect(finalDb?.handoffState).toBe('HUMAN_REQUIRED');
      expect(finalDb?.missingFields).toEqual(['TRUE_RICH_MARKER']);

      await cleanup(conversationId, realCustomerId);
    }
  }, 60000);

  it('TEN-way concurrent reconcileConfirmedState() (real decision logic) completes with no uncaught exception and no corruption', async () => {
    const conversationId = `a49-10way-${randomUUID()}`;
    const { draftId, customerId: realCustomerId } = await setupConversationAndConfirmedDraft(conversationId, '99');

    const losers = Array.from({ length: 10 }, (_, i) => baseState(conversationId, { draftId, customerId: `STALE-LOSER-${i}` }));

    let caught: unknown = null;
    let results: CommercialConversationState[] = [];
    try {
      results = await Promise.all(
        losers.map((loserState) =>
          repo.reconcileConfirmedState(conversationId, draftId, (locked) => decide(loserState, draftId, locked)),
        ),
      );
    } catch (error) {
      caught = error;
    }

    // Document, do not silently swallow: if the atomic transaction throws under 10-way
    // contention (e.g. a Prisma interactive-transaction timeout), that is itself evidence for
    // the report -- `respondDraftAlreadyConfirmed()`'s own catch only wraps a SINGLE
    // `reconcileConfirmedState()` call, not this fan-out, so surfacing it here is deliberate.
    expect(caught).toBeNull();
    for (const r of results) {
      expect(r.confirmationState).toBe('CONFIRMED');
      expect(r.customerId).toBe(realCustomerId);
    }
    const rows = await prisma.sofiaConversationMemory.findMany({ where: { conversationId } });
    expect(rows.length).toBe(1);

    await cleanup(conversationId, realCustomerId);
  }, 30000);

  it('FINDING (LOW, narrow): reconcileConfirmedState()\'s unlocked draft read, if ever invoked BEFORE confirmDraft() truly commits, returns the CALLING TURN\'S OWN STALE state mislabeled CONFIRMED (fail-closed case 3) -- DB stays safe (persist:false) but this exact object is what respond() sends to the customer', async () => {
    // IMPORTANT REACHABILITY CAVEAT (verified by full call-graph trace, not assumed): every real
    // production caller of `respondDraftAlreadyConfirmed()` -- `recoverDraftConflict()`'s
    // `DraftAlreadyConfirmedError` branch, its `STALE_DRAFT_VERSION` -> `loadDraftVersion()`
    // branch, and `recoverStaleConfirmation()`'s `SOFIA_STALE_CONFIRMATION` branch -- ALL first
    // perform their OWN read that already observed `status === 'CONFIRMED'` (in
    // `saveDraft()`'s CAS, or an explicit `loadDraftVersion()` check) BEFORE ever calling
    // `respondDraftAlreadyConfirmed()`. Under Postgres READ COMMITTED, once any reader observes a
    // committed value, that write is durably committed and visible to every later reader/writer --
    // so in practice `confirmDraft()` has ALWAYS already committed by the time
    // `reconcileConfirmedState()`'s own unlocked `tx.sofiaOrderDraft.findUnique()` runs. This test
    // therefore does NOT reproduce a reachable production race today.
    //
    // What it DOES prove: `reconcileConfirmedState()` as a repository primitive has NO enforcement
    // of that precondition itself -- it trusts the caller entirely. If fired directly (as here) at
    // the exact instant a raw `sofiaOrderDraft.update()` to CONFIRMED is ALSO in flight for the
    // same row, the unlocked, non-`FOR UPDATE` `tx.sofiaOrderDraft.findUnique()` can observe the
    // PRE-update row and fall into `decideConfirmedReconciliation()`'s case-3 fail-closed branch --
    // which returns `{ ...callerState, confirmationState: 'CONFIRMED' }`, i.e. the CALLING TURN'S
    // OWN unverified, possibly-stale data (wrong customerId/items/price in a real turn), labeled
    // CONFIRMED. `persist: false` protects the DATABASE (proven below: zero rows written), but
    // `respondDraftAlreadyConfirmed()` still calls `this.respond(resolved, ..., 'DRAFT_CONFIRMED')`
    // on that exact object -- i.e. the CUSTOMER-FACING reply would assert "your order is confirmed"
    // sourced from data nothing has actually verified as the true confirmed order. This is a
    // narration/evidence-linking property (`respond()`'s output must never diverge from actual
    // confirmed-or-pending canonical state) that today depends ENTIRELY on every present and future
    // caller of `reconcileConfirmedState()` upholding an unenforced, undocumented-in-the-type-system
    // invariant, rather than the transaction itself refusing to fabricate a CONFIRMED narration it
    // cannot verify. Recommendation: case 3 should mark the response as UNVERIFIED/hand off rather
    // than assert `confirmationState: 'CONFIRMED'` from unverified caller state, and/or
    // `reconcileConfirmedState()` should take its own `FOR UPDATE` lock on the draft row so the
    // precondition is enforced by the mechanism itself, not by caller discipline alone.
    const conversationId = `a49-draftread-${randomUUID()}`;
    await prisma.whatsappConversation.create({ data: { id: conversationId, phone: '573008889999', provider: 'mock' } });
    const draftReadCustomer = await prisma.customer.create({ data: { displayName: 'A49 Draftread Customer' } });
    const draft = await prisma.sofiaOrderDraft.create({
      data: {
        conversationId, status: 'READY_TO_CONFIRM', fulfillment: 'TAKEAWAY', paymentPreference: 'CASH_ON_DELIVERY',
        version: 1, draftHash: 'hash-a49-b', itemsSnapshot: [], subtotal: 0, deliveryFee: 0, total: 0,
        availabilitySnapshot: [], expiresAt: new Date(Date.now() + 60_000), customerId: draftReadCustomer.id,
      },
    });
    await repo.saveState(baseState(conversationId, { draftId: draft.id, draftVersion: 1, draftHash: 'hash-a49-b' }));

    const loserState = baseState(conversationId, { draftId: draft.id, customerId: 'draftread-loser-STALE-DATA' });
    const [, resolved] = await Promise.all([
      prisma.sofiaOrderDraft.update({ where: { id: draft.id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmationHash: 'x' } }),
      repo.reconcileConfirmedState(conversationId, draft.id, (locked) => decide(loserState, draft.id, locked)),
    ]);

    // DB-safety invariant holds regardless of which branch was hit: no corrupted/duplicate row.
    const rows = await prisma.sofiaConversationMemory.findMany({ where: { conversationId } });
    expect(rows.length).toBe(1);

    if (resolved.customerId === 'draftread-loser-STALE-DATA') {
      // Reproduced the fail-closed case-3 branch: DB untouched (still whatever saveState() left,
      // never the stale data), BUT `resolved` -- the exact object respond() uses to build the
      // customer-facing message -- claims CONFIRMED using the caller's own unverified state.
      expect(resolved.confirmationState).toBe('CONFIRMED');
      const dbState = await repo.loadState(conversationId);
      expect(dbState?.customerId).not.toBe('draftread-loser-STALE-DATA'); // DB never corrupted
    } else {
      // The more common (and, per the reachability caveat above, production-realistic) outcome:
      // the draft read observed CONFIRMED and reconstructed correctly from authoritative data.
      expect(resolved.customerId).toBe(draftReadCustomer.id);
    }

    await cleanup(conversationId, draftReadCustomer.id);
  }, 15000);
});
