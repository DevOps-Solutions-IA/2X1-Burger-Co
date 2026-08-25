/**
 * A37 (Round 5, blind, FINAL VERIFICATION PASS) — RED TEAM FINDING, companion to
 * `commercial-checkout.retry-item-loss.a37.spec.ts`.
 *
 * Same root cause as the item-loss finding, ported to the DESTINATION axis, where the business
 * impact is materially worse: a wrong DELIVERY ADDRESS, not just a missing side item.
 *
 * ROOT CAUSE
 * ----------
 * `PrismaCommercialRepository.saveState()` (persistence/prisma-commercial.repository.ts:44-69) is the
 * writer for `sofiaConversationMemory.currentOrderIntentJson` — the row that carries
 * `destinationSnapshot`/`address`/`deliveryQuoteDestinationBinding`. Its own docstring (A26 CLOSURE)
 * explicitly documents the general hazard: "Two genuinely concurrent
 * `CommercialCheckoutService.process()` calls for the SAME conversation... could interleave". But the
 * fix it actually implements (`wouldRegressConfirmedMarker`) is narrowly scoped to ONE axis only: it
 * refuses to let a write regress an already-persisted CONFIRMED marker for the SAME `draftId`. It does
 * NOT protect `destinationSnapshot`/`address`/`revision` (or items, or payment preference) against the
 * exact same lost-update hazard when the draft is merely PENDING (not yet confirmed) — the write is a
 * bare, version-blind `upsert` of whatever `state` the calling turn happened to compute from ITS OWN,
 * possibly-stale `previous` read.
 *
 * Compounding this, `applyDestinationEdit`'s RULE 3 (`destination-revision.ts`) deliberately does NOT
 * bump `revision` for a coordinate-only edit (by design — GPS refinement of the SAME address should
 * not force a pointless requote). This means a concurrent turn that only shares a GPS pin (no address
 * text) computes its OWN next `destinationSnapshot` by carrying `referenceText`/`revision` forward
 * unchanged from WHATEVER `previous` it read — if that `previous` was stale (predates a sibling turn's
 * real address correction), the GPS-only turn's snapshot silently reverts to the OLD address text
 * while still ending up as the FINAL persisted state if its write lands after the correction's.
 *
 * A36's `recoverDraftConflict()` retry-once path is the exact mechanism that lets this actually reach
 * durable storage instead of failing loudly: when the GPS-only turn's `saveDraft()` loses the initial
 * CAS race (because the address-correcting turn's write already bumped `SofiaOrderDraft.version`), the
 * retry blindly re-attempts `prepareDraft()` with the LOSING turn's OWN (stale, address-reverted)
 * `state` bumped only to the fresh `version` number — with no re-validation that the destination
 * identity it is about to persist still matches reality. The retry "succeeds" (no exception, no
 * customer-facing warning) and its stale content becomes the new authoritative truth.
 *
 * ATTACK SCENARIO
 * ----------------
 * Turn 0 (sequential baseline): customer orders DELIVERY to "Calle 50 # 10-20" and shares a GPS pin
 * in the same message -> PENDING draft, `destinationSnapshot.revision = 1`,
 * `deliveryQuoteDestinationBinding` bound to revision 1 + that GPS pair.
 *
 * Two ordinary, realistic follow-up messages then race (two devices, network jitter, or an impatient
 * customer re-sending) — genuinely different content, not a dedup-eligible duplicate:
 *   Turn A: "Mejor mándalo a la Calle 80 # 20-30" (pure text address CORRECTION, no new GPS)
 *   Turn B: "pago cuando llegue" + a FRESH GPS pin (an ordinary "let me also drop my exact pin" —
 *           the customer's phone auto-attaches location while they finish confirming payment method;
 *           they believe this pin refines their JUST-STATED "Calle 80" address, since from the
 *           customer's point of view Turn A was already sent)
 * Both turns' OWN `process()` call independently read the SAME `previous` conversation-memory
 * snapshot (`destinationSnapshot.revision = 1`, address = "Calle 50 # 10-20") before either commits.
 *
 * RESULT (proven below against REAL Postgres + the REAL, unmocked `PrismaCommercialRepository`): the
 * address correction to "Calle 80 # 20-30" is silently and completely discarded. The final
 * authoritative `sofiaConversationMemory`/`SofiaOrderDraft` state reverts to the OLD "Calle 50 # 10-20"
 * address — internally self-consistent (revision/fingerprint/binding all agree with each other), so
 * NOTHING downstream (including `confirm()`'s own `isQuoteBoundToCurrentDestination` check) can detect
 * anything is wrong. If the customer's next message is "Confirmo", the order is confirmed for
 * DELIVERY TO THE ADDRESS THE CUSTOMER EXPLICITLY CORRECTED AWAY FROM, with no error, no re-ask, no
 * evidence of the lost correction anywhere in the customer-facing conversation.
 *
 * INVARIANT VIOLATED
 * -------------------
 * "revision/staleness correctness" and "no silent loss of confirmed-or-pending evidence under any
 * writer" and "narration/memory never diverging from actual confirmed OR pending canonical state" —
 * the customer's own most recent, explicit destination correction is the one piece of evidence
 * silently erased, while the persisted state remains internally consistent enough to pass every
 * existing quote-binding guard. This is a live wrong-address delivery risk, not merely a narration
 * cosmetic bug.
 *
 * TEST METHODOLOGY
 * -----------------
 * True concurrent Postgres timing is inherently nondeterministic (which of two real, near-simultaneous
 * transactions physically commits first varies run to run) — a flaky `Promise.allSettled` race would
 * only reproduce this probabilistically. To give a reliable, deterministic proof instead, this test
 * pins exactly ONE thing: which `loadState()` result Turn B's `process()` call observes as `previous`
 * (forcing it to be the pre-correction baseline, exactly what an ACTUAL concurrent read would have
 * returned had it lost the timing race). Every write, every CAS, every recovery/retry code path
 * (`saveDraft`, `saveState`, `loadDraftVersion`, `recoverDraftConflict`) runs completely for real
 * against real Postgres via the unmodified `PrismaCommercialRepository` — nothing about the actual
 * remediation logic under test is mocked or bypassed. This is the same technique used to deterministically
 * pin lost-update races in the codebase's own A26/A31 test suites when exact interleaving matters.
 *
 * SOFIA Round 5 / A38 CLOSURE — this finding is FIXED. `recoverDraftConflict()`'s retry now rebases
 * onto a freshly reloaded authoritative conversation state (`CommercialCheckoutService
 * .rebaseTurnOntoFreshState()`) instead of blindly replaying the losing turn's own stale in-memory
 * `state`, so a coordinate-only retry now refines whatever address is CURRENTLY authoritative instead
 * of reviving a superseded one. This spec is kept as a PERMANENT regression test of the fixed
 * behavior (see the assertions after `gpsTurn` below) — the original finding narrative above is
 * retained as historical documentation of the exact mechanism that must never regress.
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

const NEAR = { latitude: 3.26, longitude: -76.54 };
const NEAR_B = { latitude: 3.2615, longitude: -76.5395 }; // a genuinely different nearby pin (>150m, per COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM), still "in coverage"

/** Deterministically pins the NEXT `loadState()` call for a given conversationId to a captured
 * snapshot, then reverts to the real repository — every other method (and every subsequent call)
 * goes straight through to the REAL `PrismaCommercialRepository` / real Postgres. */
class PinnedFirstReadRepository implements CommercialRepository {
  private pinned: Map<string, CommercialConversationState> = new Map();
  constructor(private readonly real: PrismaCommercialRepository) {}
  pinNextRead(conversationId: string, state: CommercialConversationState) {
    this.pinned.set(conversationId, state);
  }
  async loadState(conversationId: string) {
    const pin = this.pinned.get(conversationId);
    if (pin) {
      this.pinned.delete(conversationId);
      return pin;
    }
    return this.real.loadState(conversationId);
  }
  saveState(state: CommercialConversationState) { return this.real.saveState(state); }
  saveDraft(input: Parameters<CommercialRepository['saveDraft']>[0]) { return this.real.saveDraft(input); }
  confirmDraft(input: Parameters<CommercialRepository['confirmDraft']>[0]) { return this.real.confirmDraft(input); }
  loadDraftVersion(draftId: string) { return this.real.loadDraftVersion(draftId); }
  loadConfirmedDraftRecord(draftId: string) { return this.real.loadConfirmedDraftRecord(draftId); }
  loadStateForUpdate(conversationId: string) { return this.real.loadStateForUpdate(conversationId); }
}

describe('A37: concurrent address-correction vs. GPS-only turn — recoverDraftConflict() retry silently reverts a customer\'s explicit address correction', () => {
  let prisma: PrismaService;
  let realRepository: PrismaCommercialRepository;
  let repository: PinnedFirstReadRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A37 retry-address-revert test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    realRepository = new PrismaCommercialRepository(prisma);
    repository = new PinnedFirstReadRepository(realRepository);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function buildService() {
    const combo = {
      id: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', description: 'Hamburguesas', imageUrl: null,
      category: { id: 'cat', name: 'Combos', slug: 'combos' }, kind: 'PREPARED' as const, persistedPrice: 25000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const products = [combo];
    const responses = new CommercialResponseComposer(
      { compose: jest.fn(async () => null) },
      new CommercialResponseValidator(),
      new SafeCommercialResponseTemplates(),
    );
    const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
    // Only the EXTERNAL delivery-quote provider is doubled (per mission rules) — always "in coverage",
    // priced whether or not coordinates are present, so the test isolates the destination-state /
    // retry-recovery bug rather than incidental coverage/pricing edge cases. `SofiaOrderDraft.deliveryQuoteAuditId`
    // has a real FK to `delivery_pricing_audits`, so this double still creates a REAL audit row for
    // each quote (via the REAL prisma client) rather than fabricating an id string.
    const quote = jest.fn(async (input: { latitude?: number; longitude?: number; addressText?: string; orderSubtotal: number }) => {
      const hasCoords = input.latitude != null && input.longitude != null;
      const finalFee = hasCoords ? 5000 : 0;
      const audit = await prisma.deliveryPricingAudit.create({
        data: {
          requestJson: { addressText: input.addressText ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, orderSubtotal: input.orderSubtotal },
          resultJson: { status: hasCoords ? 'AUTO_PRICED' : 'LOCAL_FREE', finalFee },
          finalFee,
          calculationVersion: '2x1-delivery-pricing-v1',
        },
      });
      return {
        auditId: audit.id,
        status: hasCoords ? 'AUTO_PRICED' : 'LOCAL_FREE',
        finalFee,
        currency: 'COP' as const,
        distanceKm: hasCoords ? 3 : 0,
        estimatedMinutes: 25,
        reasonCode: hasCoords ? 'AUTO_PRICED' : 'LOCAL_FREE',
        calculationVersion: '2x1-delivery-pricing-v1',
        canCheckout: true,
      };
    });
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), new CommercialMetricsService(), responses,
      repository as unknown as never,
      { listActive: jest.fn(async () => products), getActiveById: jest.fn(async (id: string) => products.find((p) => p.id === id)!), findActive: jest.fn() } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId: null, displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote } as never,
      { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) } as never,
      orderCreation as never,
    );
    return { service };
  }

  const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };

  it('address correction lands, then a stale-baseline GPS-only retry silently reverts it in durable storage', async () => {
    const conversationId = `a37-addrrevert-${randomUUID()}`;
    await prisma.whatsappConversation.create({
      data: { id: conversationId, phone: '573001112266', provider: 'mock' },
    });

    const { service } = buildService();

    // Turn 0: baseline DELIVERY order to "Calle 50 # 10-20" with an initial GPS pin (NEAR) in the same
    // message -> a single destination edit, revision 1, PENDING draft v1.
    const baseline = await service.process({
      conversationId, phone: '573001112266',
      message: 'Mándame un combo 2x1 a la Calle 50 # 10-20 y pago cuando llegue',
      actor, location: NEAR,
    });
    expect(baseline.nextAction).toBe('READY_TO_CONFIRM');
    expect(baseline.state.address).toBe('Calle 50 # 10-20');
    expect(baseline.state.destinationSnapshot?.revision).toBe(1);
    expect(baseline.state.draftVersion).toBe(1);

    // Capture EXACTLY what a genuinely concurrent Turn B would have read as `previous` had it started
    // before Turn A's correction committed -- this IS the real, current, authoritative baseline right
    // now (real Postgres read, not fabricated).
    const staleBaselineForTurnB = await realRepository.loadState(conversationId);
    expect(staleBaselineForTurnB).not.toBeNull();
    expect(staleBaselineForTurnB!.address).toBe('Calle 50 # 10-20');

    // Turn A runs to completion (real, sequential): the customer EXPLICITLY corrects the address.
    const corrected = await service.process({
      conversationId, phone: '573001112266',
      message: 'Mejor mándalo a la Calle 80 # 20-30',
      actor,
    });
    expect(corrected.nextAction).toBe('READY_TO_CONFIRM');
    expect(corrected.state.address).toBe('Calle 80 # 20-30');
    expect(corrected.state.destinationSnapshot?.revision).toBe(2);
    expect(corrected.state.draftVersion).toBeGreaterThan(1);

    // Sanity: the correction really is durable right now, before Turn B ever runs.
    const afterCorrection = await realRepository.loadState(conversationId);
    expect(afterCorrection!.address).toBe('Calle 80 # 20-30');

    // Turn B: pin its `loadState()` read to the PRE-CORRECTION baseline (exactly what an actually
    // concurrent read would have returned), then let it run for real against the REAL repository for
    // every write and every CAS/recovery path. The customer, from their own point of view, is simply
    // sharing a fresh GPS pin along with confirming payment method -- an entirely ordinary message.
    repository.pinNextRead(conversationId, staleBaselineForTurnB!);
    const gpsTurn = await service.process({
      conversationId, phone: '573001112266',
      message: 'pago cuando llegue',
      actor, location: NEAR_B,
    });

    // A36's retry-once logic means this turn reports full, ordinary success -- no exception, no
    // "please resend", nothing that would alert anyone a correction was just silently undone.
    expect(gpsTurn.nextAction).toBe('READY_TO_CONFIRM');
    expect(gpsTurn.state.confirmationState).toBe('PENDING');

    // SOFIA Round 5 / A38 CLOSURE: reload ground truth. `recoverDraftConflict()` now rebases Turn B's
    // retry against a FRESHLY reloaded authoritative `sofiaConversationMemory` state
    // (`rebaseTurnOntoFreshState()`) instead of blindly replaying Turn B's own stale in-memory
    // `state`, so Turn B's coordinate-only edit (RULE 3 — no revision bump) now refines the CURRENT
    // ("Calle 80 # 20-30") destination instead of reviving the superseded one. The customer's explicit
    // correction MUST survive intact.
    const finalState = await realRepository.loadState(conversationId);
    const finalDraft = await realRepository.loadDraftVersion(finalState!.draftId!);

    console.log('A38 regression evidence (A37 address-revert FIXED):', JSON.stringify({
      correctedAddressAfterTurnA: corrected.state.address,
      correctedRevisionAfterTurnA: corrected.state.destinationSnapshot?.revision,
      finalAddressAfterTurnB: finalState!.address,
      finalRevisionAfterTurnB: finalState!.destinationSnapshot?.revision,
      finalDraftVersion: finalDraft,
    }));

    if (finalState!.address === 'Calle 50 # 10-20') {
      // REGRESSION: the A37 CRITICAL finding has come back. The address silently reverted to the
      // value the customer explicitly corrected AWAY FROM, with no error and no trace in the
      // conversation that anything was lost. See the A37 spec history (git log this file) and the
      // A38 CLOSURE doc on `CommercialCheckoutService.rebaseTurnOntoFreshState()` for the exact
      // mechanism this must never regress to.
      throw new Error(
        `A38 REGRESSION: the A37 address-revert finding reproduced again -- final address is the STALE `
        + `"Calle 50 # 10-20" instead of the customer's explicit correction "Calle 80 # 20-30". `
        + `recoverDraftConflict()'s retry is once again replaying a stale destination snapshot instead of `
        + `rebasing onto fresh authoritative state.`,
      );
    }

    // FIXED BEHAVIOR (permanent assertion): Turn A's explicit address correction survives Turn B's
    // stale-baseline coordinate-only retry intact.
    expect(finalState!.address).toBe('Calle 80 # 20-30');
    expect(finalState!.destinationSnapshot?.revision).toBe(2); // the corrected revision, never reverted to 1
    expect(finalState!.deliveryQuoteDestinationBinding?.destinationRevision).toBe(2);
    expect(finalState!.deliveryQuoteDestinationBinding?.destinationRevision).toBe(finalState!.destinationSnapshot?.revision);
    // Turn B's own GPS refinement was not lost either -- it was correctly applied ON TOP of the
    // corrected address (coordinate-only edit, RULE 3 -- same revision, new coordinate evidence).
    expect(finalState!.location).toEqual({ latitude: NEAR_B.latitude, longitude: NEAR_B.longitude });

    // END-TO-END PROOF: the customer, having just been told (via `gpsTurn`'s own response) that their
    // draft is READY_TO_CONFIRM, says "Confirmo" next. Prove this confirms the order to the CORRECT,
    // customer-intended address -- not merely that the intermediate state looks right.
    const confirmTurn = await service.process({
      conversationId, phone: '573001112266', message: 'Confirmo', actor,
    });
    expect(confirmTurn.state.confirmationState).toBe('CONFIRMED');
    expect(confirmTurn.state.address).toBe('Calle 80 # 20-30');
    const confirmedDraft = await prisma.sofiaOrderDraft.findUnique({ where: { id: finalState!.draftId! } });
    expect(confirmedDraft?.status).toBe('CONFIRMED');
    expect(confirmedDraft?.deliveryAddress).toBe('Calle 80 # 20-30');

    console.log('A38 end-to-end confirmation evidence (A37 FIXED):', JSON.stringify({
      confirmedAddress: confirmedDraft?.deliveryAddress,
      confirmedStatus: confirmedDraft?.status,
      customerExplicitCorrection: 'Calle 80 # 20-30',
    }));
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a37-addrrevert-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a37-addrrevert-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a37-addrrevert-' } } });
  });
});
