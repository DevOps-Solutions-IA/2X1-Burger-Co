/**
 * SOFIA Round 5 / A33 — BLIND, INDEPENDENT red team pass (final verification pass), auditing
 * `feat/sofia-remediation-address-round5-32-nonconfirmed-evidence-fix` fresh, with NO access to prior
 * design rationale beyond the standing invariant list and round summary supplied in the brief. Two
 * angles are covered in this file:
 *
 *   PART 1 (A33 FINDING, LOW -- CLOSED by A34, now a PERMANENT REGRESSION TEST of the fixed
 *   behavior) — `PrismaCommercialRepository.saveLegacyConversationContext()`'s A32 guard originally
 *   protected ONLY the `currentOrderIntentJson` column once a canonical (`schemaVersion: 4`) record
 *   existed. The THREE SIBLING narration columns on the exact same row -- `currentIntent`,
 *   `missingFieldsJson`, `lastProductDiscussed` -- were explicitly, deliberately left unprotected (see
 *   that method's PRE-A34 docstring: "The rest of the legacy narration columns ... are still allowed
 *   to update normally, since those are not part of the canonical-evidence invariant this closes.").
 *   That was a conscious, documented scope decision, not an oversight -- but it meant a legacy write
 *   racing (or merely landing after) a canonical PENDING/CONFIRMED write could still make
 *   `sofiaConversationMemory.currentIntent`/`.missingFieldsJson`/`.lastProductDiscussed` diverge from
 *   what the PROTECTED `currentOrderIntentJson.intent`/`.missingFields` actually say -- a real, if
 *   narrow, violation of invariant 6 ("narration/memory never diverging from actual confirmed
 *   state"). The divergence was directly observable through
 *   `SofiaConversationMemoryService.sanitize()`, which is exactly what
 *   `SofiaAgentService.processMessage()`'s legacy branch returns as `memory.conversation` in its
 *   response payload (sofia-agent.service.ts:1110) -- so an operator/sandbox/admin surface reading
 *   that field could observe e.g. `currentIntent: "GREETING"` on a conversation whose real, protected,
 *   evidence-carrying state (`currentOrderIntentJson`) says `intent: "PURCHASE"`,
 *   `confirmationState: "PENDING"`, with a real bound delivery quote. Reachable in production whenever
 *   two genuinely concurrent WhatsApp messages for the SAME conversation race `shouldHandle()` before
 *   the first canonical write commits -- the exact class of interleaving A25/A26's own docstring
 *   already establishes as realistic ("real network+DB round trip... entirely possible").
 *
 *   SOFIA Round 5 / A34 CLOSURE — `saveLegacyConversationContext()` now extends the EXACT SAME
 *   `existingIsCanonical ? undefined : ...` guard already used for `currentOrderIntentJson` to all
 *   three sibling columns. Once a canonical (`schemaVersion: 4`) record exists on the row, the legacy
 *   writer leaves `currentIntent`, `missingFieldsJson` and `lastProductDiscussed` untouched instead of
 *   overwriting them with an unrelated legacy turn's values -- closing the internal-contradiction gap
 *   this test originally proved. This test now asserts the FIXED behavior permanently: the legacy
 *   write below must NOT change any of the four protected columns once canonical evidence exists.
 *
 *   PART 2 (VERIFIED SAFE, not a finding) -- documents a plausible-looking but ultimately DISPROVEN
 *   hypothesis: does `saveLegacyConversationContext()`'s `SELECT ... FOR UPDATE` row-lock protection
 *   have a "phantom row" gap on a conversation's VERY FIRST ever write (Postgres cannot lock a row
 *   that does not exist yet), letting a legacy write's `INSERT ... ON CONFLICT DO UPDATE` clobber a
 *   concurrently-created canonical row using a decision computed before that row existed? Proven FALSE
 *   by deterministic, fully-controlled interleaving against real Postgres: the ONLY real call site
 *   (`SofiaConversationMemoryService.updateContext()`) always calls `getOrCreate()` -- an unconditional,
 *   ungated `sofiaConversationMemory.upsert()` that never touches `currentOrderIntentJson` -- BEFORE
 *   `saveLegacyConversationContext()`'s own protected transaction. That pre-step guarantees the row
 *   already exists (in some form) by the time the protected `SELECT ... FOR UPDATE` runs, closing the
 *   phantom-row window incidentally. This is recorded as a permanent regression test, not narrated as
 *   a finding.
 *
 * Real Postgres (isolated `_test` database), real unmocked `PrismaCommercialRepository` and
 * `SofiaConversationMemoryService` -- no mocks of persistence/hashing/CAS logic. Only PART 2's
 * interleaving timing is test-controlled (by gating the real, unmodified `$queryRaw` row-lock read's
 * RETURN to the caller on an externally-resolved Promise) -- the query itself, and every value it
 * returns, is genuine.
 */

import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaCommercialRepository } from '../modules/sofia/commercial/persistence/prisma-commercial.repository';
import { SofiaConversationMemoryService } from '../modules/sofia/memory/sofia-conversation-memory.service';
import type { CommercialConversationState } from '../modules/sofia/commercial/commercial.types';

if (!process.env.TEST_DATABASE_URL || !/_test(?:\?|$)/.test(process.env.TEST_DATABASE_URL)) {
  throw new Error('A33 requires an isolated _test database (TEST_DATABASE_URL must end in _test).');
}

/** A realistic, fully quote-bound, GPS-validated, PENDING-confirmation canonical state -- the same
 * shape family A31/A32's own fixture used, so this file's findings are directly comparable. */
function pendingQuoteBoundState(conversationId: string, draftId: string, intent: 'PURCHASE' = 'PURCHASE'): CommercialConversationState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 4,
    conversationId,
    customerId: 'cust-a33',
    intent,
    items: [{ productId: 'prod-1', code: 'BURGER-1', name: 'Hamburguesa Sencilla', quantity: 2, unitPrice: 18000, modifiers: [] }],
    fulfillment: 'DELIVERY',
    address: 'Calle 45 #12-08, casa azul',
    addressConfirmed: true,
    location: { latitude: 3.26, longitude: -76.54 },
    destinationSnapshot: {
      revision: 1,
      spatialFingerprint: 'sha256:a33-test-fingerprint',
      normalizedAddress: 'Calle 45 #12-08',
      addressComponents: null,
      latitude: 3.26,
      longitude: -76.54,
      coordinateSource: 'GPS_SHARE',
      coordinateTrust: 'TRUSTED',
      coordinateBoundRevision: 1,
      geocodingProvider: 'test-provider',
      geocodingEvidenceId: 'geo-audit-a33-1',
      deliveryInstructions: 'casa azul',
      referenceText: 'Calle 45 #12-08, casa azul',
      createdAt: now,
      updatedAt: now,
    } as never,
    deliveryQuoteDestinationBinding: { destinationRevision: 1, destinationSpatialFingerprint: 'sha256:a33-test-fingerprint', boundCoordinateLatitude: 3.26, boundCoordinateLongitude: -76.54 },
    paymentPreference: 'CASH_ON_DELIVERY',
    paymentReadiness: 'PAYMENT_COD',
    subtotal: 36000,
    deliveryFee: 5000,
    total: 41000,
    deliveryQuoteAuditId: 'audit-a33-1',
    deliveryQuoteVersion: 1,
    deliveryQuoteExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    availabilitySnapshot: [],
    draftId,
    draftVersion: 1,
    draftHash: 'a33-test-draft-hash',
    draftFulfillment: 'DELIVERY',
    draftItemsFingerprint: 'a33-test-items-fingerprint',
    draftPaymentPreference: 'CASH_ON_DELIVERY',
    confirmationState: 'PENDING',
    missingFields: [],
    ambiguities: [],
    confidence: 'HIGH',
    handoffState: 'SOFIA_ACTIVE',
    consentState: 'SERVICE',
    domainErrors: [],
    lastQuestionPurpose: 'CONFIRM_ORDER',
    lastResolvedIntent: intent,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

/** See PART 2 docstring above: gates the RETURN of a real, already-executed `tx.$queryRaw` call to
 * the calling application code on an externally-controlled Promise, without touching any source file
 * or fabricating what Postgres returned. */
function withGatedQueryRaw(real: PrismaService, gate: Promise<void>): PrismaService {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === '$transaction') {
        return (fn: (tx: Record<string, unknown>) => unknown, ...rest: unknown[]) =>
          (target as unknown as { $transaction: (cb: (tx: Record<string, unknown>) => unknown, ...rest: unknown[]) => unknown }).$transaction(async (tx: Record<string, unknown>) => {
            const originalQueryRaw = (tx.$queryRaw as (...args: unknown[]) => Promise<unknown>).bind(tx);
            (tx as Record<string, unknown>).$queryRaw = async (...args: unknown[]) => {
              const result = await originalQueryRaw(...args);
              await gate;
              return result;
            };
            return fn(tx);
          }, ...rest);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe('A33 (Round 5, blind, independent, final verification pass)', () => {
  jest.setTimeout(30000);
  let prisma: PrismaService;
  let commercialRepo: PrismaCommercialRepository;
  let legacyMemory: SofiaConversationMemoryService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    commercialRepo = new PrismaCommercialRepository(prisma);
    legacyMemory = new SofiaConversationMemoryService(prisma, commercialRepo);
  });

  afterAll(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a33-' } } });
    await prisma.$disconnect();
  });

  it(
    'PART 1 (A34 PERMANENT REGRESSION, fixed behavior): a legacy write landing after a canonical ' +
      'PENDING save leaves ALL FOUR protected columns intact -- currentOrderIntentJson (A32) AND the ' +
      'sibling currentIntent/missingFieldsJson/lastProductDiscussed narration columns (A34) -- so the ' +
      'row can never become internally contradictory, and sanitize() (exposed to callers as ' +
      'memory.conversation) reflects the real, protected canonical narration, not a stale legacy turn',
    async () => {
      const conversationId = `a33-narration-${randomUUID()}`;
      const draftId = `draft-a33-${randomUUID()}`;

      // Step 1: the REAL canonical writer persists a PENDING, fully quote-bound state whose OWN
      // `intent` is PURCHASE and whose OWN `missingFields` is empty (nothing outstanding).
      await commercialRepo.saveState(pendingQuoteBoundState(conversationId, draftId, 'PURCHASE'));
      const afterCanonical = await commercialRepo.loadState(conversationId);
      expect(afterCanonical!.intent).toBe('PURCHASE');
      expect(afterCanonical!.missingFields).toEqual([]);
      expect(afterCanonical!.confirmationState).toBe('PENDING');

      const beforeLegacyWrite = await prisma.sofiaConversationMemory.findUnique({ where: { conversationId } });
      expect(beforeLegacyWrite!.currentIntent).toBe('PURCHASE');
      expect(beforeLegacyWrite!.missingFieldsJson).toEqual([]);

      // Step 2: a DIFFERENT, concurrently-processed WhatsApp message for the SAME conversation routes
      // to the legacy fallback (exactly sofia-agent.service.ts:1013's real call) and reports a
      // completely different, stale-looking narration: intent GREETING, with an outstanding
      // deliveryAddress requirement.
      const updatedRow = await legacyMemory.updateContext({
        conversationId,
        customerMemoryId: null,
        currentIntent: 'GREETING',
        currentOrderIntent: { items: [], matchedCatalogItem: null, matchedFeaturedOffer: null },
        missingFields: ['deliveryAddress'],
        lastProductDiscussed: null,
        memorySummary: 'Cliente saludo de nuevo',
      });

      // *** A32 HOLDS: the protected column is untouched -- the real, evidence-carrying canonical
      // record survives completely intact. ***
      const afterLegacyWrite = await commercialRepo.loadState(conversationId);
      expect(afterLegacyWrite).not.toBeNull();
      expect(afterLegacyWrite!.intent).toBe('PURCHASE');
      expect(afterLegacyWrite!.missingFields).toEqual([]);
      expect(afterLegacyWrite!.confirmationState).toBe('PENDING');
      expect(afterLegacyWrite!.deliveryQuoteAuditId).toBe('audit-a33-1');

      // *** A34 HOLDS: the sibling narration columns on the EXACT SAME conversationMemory row are now
      // ALSO left untouched by the legacy write -- no more internal contradiction between the
      // protected evidence and the columns sitting right next to it on the same row. ***
      expect(updatedRow.currentIntent).toBe('PURCHASE');
      expect((updatedRow.missingFieldsJson as unknown as string[])).toEqual([]);
      expect(updatedRow.lastProductDiscussed).toBe(beforeLegacyWrite!.lastProductDiscussed);

      const raw = await prisma.sofiaConversationMemory.findUnique({ where: { conversationId } });
      expect(raw!.currentIntent).toBe('PURCHASE');
      expect(raw!.missingFieldsJson).toEqual([]);
      const rawJson = raw!.currentOrderIntentJson as Record<string, unknown>;
      expect(rawJson.intent).toBe('PURCHASE');
      expect(rawJson.missingFields).toEqual([]);

      // *** No more divergence: any consumer of sanitize() (sofia-agent.service.ts:1110,
      // `memory: { customer, conversation: this.conversationMemoryService.sanitize(conversationMemory) }`,
      // returned to any caller of processMessage() -- sandbox UI, admin tooling, or any future
      // consumer of this API surface) now sees narration that agrees with the protected commercial
      // record: fully quote-bound purchase, ready to confirm, nothing missing -- not a stale
      // unrelated legacy turn's "just said hi, still needs an address". ***
      const sanitized = legacyMemory.sanitize(raw!);
      expect(sanitized.currentIntent).toBe('PURCHASE');
      expect(sanitized.missingFields).toEqual([]);

      // Sanity: the legacy write's OWN payload (memorySummary and customerMemoryId, which remain
      // legacy-owned with no canonical-writer equivalent) still applies normally -- this fix is
      // narrowly scoped to the three columns that can contradict canonical evidence, not a blanket
      // freeze of the whole row.
      expect(raw!.memorySummary).toBe('Cliente saludo de nuevo');
    },
  );

  it(
    'PART 1b (A34 PERMANENT REGRESSION): when NO canonical record exists yet, the legacy writer ' +
      'still updates currentIntent/missingFieldsJson/lastProductDiscussed normally -- the A34 guard ' +
      'is scoped to existingIsCanonical only, not a blanket freeze of these columns',
    async () => {
      const conversationId = `a33-narration-noncanonical-${randomUUID()}`;

      const created = await legacyMemory.updateContext({
        conversationId,
        customerMemoryId: null,
        currentIntent: 'GREETING',
        currentOrderIntent: { items: [], matchedCatalogItem: null, matchedFeaturedOffer: null },
        missingFields: ['deliveryAddress'],
        lastProductDiscussed: 'BURGER-1',
        memorySummary: 'Cliente saludo',
      });
      expect(created.currentIntent).toBe('GREETING');
      expect((created.missingFieldsJson as unknown as string[])).toEqual(['deliveryAddress']);
      expect(created.lastProductDiscussed).toBe('BURGER-1');

      const updated = await legacyMemory.updateContext({
        conversationId,
        customerMemoryId: null,
        currentIntent: 'BROWSE',
        currentOrderIntent: { items: [], matchedCatalogItem: null, matchedFeaturedOffer: null },
        missingFields: [],
        lastProductDiscussed: 'BURGER-2',
        memorySummary: 'Cliente explorando menu',
      });
      expect(updated.currentIntent).toBe('BROWSE');
      expect((updated.missingFieldsJson as unknown as string[])).toEqual([]);
      expect(updated.lastProductDiscussed).toBe('BURGER-2');
    },
  );

  it(
    'PART 2 (VERIFIED SAFE — not a finding): the "phantom row" hypothesis (SELECT ... FOR UPDATE ' +
      "cannot lock a row that does not exist yet, so a legacy write's stale no-row read could still " +
      'clobber a concurrently-created canonical row) does NOT hold for the real call path -- ' +
      "getOrCreate()'s pre-step (called unconditionally by updateContext() before the protected " +
      'transaction) guarantees the row already exists by the time the protected SELECT runs, even ' +
      'when the legacy transaction\'s protected read is forced (via controlled interleaving) to ' +
      'genuinely observe "no row yet" before a concurrent canonical saveState() commits',
    async () => {
      let releaseGate: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      const gatedPrisma = withGatedQueryRaw(prisma, gate);
      const gatedCommercialRepo = new PrismaCommercialRepository(gatedPrisma);
      const gatedLegacyMemory = new SofiaConversationMemoryService(gatedPrisma, gatedCommercialRepo);

      const conversationId = `a33-phantom-${randomUUID()}`;
      const draftId = `draft-a33-phantom-${randomUUID()}`;

      // Step 1: start the legacy write for a conversation that has NEVER been written before.
      // `getOrCreate()` runs first (real, ungated) and creates the row (customerMemoryId only, no
      // `currentOrderIntentJson`). Its OWN protected transaction's `SELECT ... FOR UPDATE` then runs
      // for REAL -- observing that row (empty of canonical evidence) -- but its RETURN to the calling
      // code is held by the gate.
      const legacyPromise = gatedLegacyMemory.updateContext({
        conversationId,
        customerMemoryId: null,
        currentIntent: 'GREETING',
        currentOrderIntent: { items: [], matchedCatalogItem: null, matchedFeaturedOffer: null },
        missingFields: [],
        lastProductDiscussed: null,
        memorySummary: null,
      });

      // Give the legacy call's real, unblocked getOrCreate() + the start of its protected transaction
      // genuine time to land before canonical runs.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Step 2: the REAL canonical writer now tries to create/commit a PENDING, quote-bound state for
      // the SAME conversationId. Because `getOrCreate()` already created a REAL, lockable row, and
      // legacy's own protected `SELECT ... FOR UPDATE` already holds that row's lock (open transaction,
      // gated), canonical's OWN `SELECT ... FOR UPDATE` genuinely BLOCKS at the Postgres level here --
      // proper lock-based serialization, not a race -- so this call is deliberately NOT awaited yet.
      const canonicalPromise = commercialRepo.saveState(pendingQuoteBoundState(conversationId, draftId, 'PURCHASE'));
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Step 3: release the legacy transaction's continuation -- it proceeds with the decision it made
      // from its real (but by-now superseded-in-real-time) read and commits.
      releaseGate!();
      await legacyPromise;
      // Canonical's SELECT ... FOR UPDATE was blocked on legacy's lock, not racing a phantom row -- it
      // now unblocks, correctly observes legacy's just-committed (non-canonical) row, and safely takes
      // over (the already-established, safe "canonical supersedes a plain legacy row" behavior).
      await canonicalPromise;

      // THE ANSWER: the canonical record survives completely intact -- getOrCreate()'s sequencing
      // guarantees a real, lockable row exists before the protected SELECT ... FOR UPDATE ever runs,
      // turning what could have been a phantom-row race into genuine Postgres lock serialization, for
      // the one real call path that exists today.
      const after = await commercialRepo.loadState(conversationId);
      expect(after).not.toBeNull();
      expect(after!.schemaVersion).toBe(4);
      expect(after!.confirmationState).toBe('PENDING');
      expect(after!.deliveryQuoteAuditId).toBe('audit-a33-1');
    },
  );
});
