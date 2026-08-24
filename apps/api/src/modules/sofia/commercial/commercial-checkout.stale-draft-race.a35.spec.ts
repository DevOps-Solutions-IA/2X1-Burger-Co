/**
 * A35 (Round 5, blind, FINAL VERIFICATION PASS) — RED TEAM FINDING, companion to
 * `commercial-checkout.confirm-race.a35.spec.ts`.
 *
 * Same root cause, DIFFERENT (and more common) trigger: `CommercialCheckoutService.prepareDraft()`
 * ultimately calls `repository.saveDraft()`, which performs its own optimistic-concurrency CAS
 * (`sofiaOrderDraft.updateMany({ where: { id, version: version - 1, status: { in: [...] } } })`,
 * prisma-commercial.repository.ts:206). Every call site of `prepareDraft()` in
 * `commercial-checkout.service.ts` (process()'s main path at line 237, confirm()'s expiry-refresh
 * at line 454, confirm()'s price-refresh at line 487) wraps the call in:
 *
 *   try { ... } catch (error) {
 *     if (error instanceof DraftAlreadyConfirmedError) return this.respondDraftAlreadyConfirmed(...);
 *     throw error;
 *   }
 *
 * — i.e. ONLY `DraftAlreadyConfirmedError` (thrown when the CAS fails because the tracked draft is
 * already CONFIRMED) is recovered gracefully. But `saveDraft()`'s CAS can ALSO fail for the much
 * more mundane, much more common reason of two ordinary, non-confirming, genuinely concurrent
 * messages both trying to rebuild the SAME still-PENDING draft — e.g. a customer double/triple-taps
 * "send" on an item-adding message ("También quiero una Coca Cola"), or two unrelated messages
 * about the same order land moments apart. In that case `prisma-commercial.repository.ts:206-212`
 * takes the OTHER branch:
 *
 *   if (updated.count !== 1) {
 *     const prior = await ...; // prior.status is still READY_TO_CONFIRM, NOT CONFIRMED
 *     const priorConfirmedAtExpectedVersion = prior?.status === CONFIRMED && prior.version === version - 1;
 *     if (!priorConfirmedAtExpectedVersion) throw new ConflictException({ code: 'STALE_DRAFT_VERSION' });
 *     ...
 *   }
 *
 * `ConflictException({ code: 'STALE_DRAFT_VERSION' })` is a completely different exception type
 * than `DraftAlreadyConfirmedError` (a plain `Error` subclass) — the `instanceof
 * DraftAlreadyConfirmedError` check does NOT catch it, so it propagates uncaught through
 * `prepareDraft()` -> `process()` -> the caller, exactly like the sibling `confirmDraft()` CAS
 * failure proven in the companion file, but reachable from ANY ordinary duplicate/racing message
 * pair, not only a duplicated confirmation. This is arguably the MORE realistic trigger of the two:
 * item/address/payment edits are the bulk of a real conversation's message volume, confirmations are
 * a single turn.
 *
 * BUSINESS IMPACT: same class as the companion file — no financial/evidence corruption (Postgres's
 * CAS correctly lets only one writer win and the draft's authoritative state stays internally
 * consistent), but an ordinary, foreseeable double-send from a real customer produces an UNCAUGHT
 * exception instead of a `CommercialTurnResult`, propagating all the way to
 * `SofiaWhatsappService.processInboundWebhook()`'s outer catch (which marks the inbound claim
 * FAILED and re-throws) for the losing message — violating "no uncaught exceptions on foreseeable
 * business/guard conditions".
 *
 * Proven against REAL, unmocked `CommercialCheckoutService` + `PrismaCommercialRepository` + REAL
 * Postgres.
 */

import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { DraftAlreadyConfirmedError } from './commercial.repository';
import { PrismaCommercialRepository } from './persistence/prisma-commercial.repository';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import { CommercialResponseValidator } from './response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from './response/safe-commercial-response.templates';

describe('A35 RED TEAM: saveDraft() STALE_DRAFT_VERSION CAS failure is an uncaught exception for ordinary concurrent non-confirming messages', () => {
  let prisma: PrismaService;
  let repository: PrismaCommercialRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('A35 stale-draft-race test requires an isolated _test database.');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaCommercialRepository(prisma);
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
    const soda = {
      id: 'p2', code: 'COCA-400', name: 'Coca Cola', description: 'Gaseosa', imageUrl: null,
      category: { id: 'cat', name: 'Bebidas', slug: 'bebidas' }, kind: 'DIRECT' as const, persistedPrice: 5000,
      active: true, trackStock: true, updatedAt: new Date().toISOString(),
    };
    const products = [combo, soda];
    const responses = new CommercialResponseComposer(
      { compose: jest.fn(async () => null) },
      new CommercialResponseValidator(),
      new SafeCommercialResponseTemplates(),
    );
    const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
    const service = new CommercialCheckoutService(
      new CommercialIntentEngine(), new CommercialPolicyService(), new CommercialMetricsService(), responses, repository,
      { listActive: jest.fn(async () => products), getActiveById: jest.fn(async (id: string) => products.find((p) => p.id === id)!), findActive: jest.fn() } as never,
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

  it('two genuinely concurrent item-adding turns on the SAME already-PENDING draft: one rebuilds successfully, the other REJECTS with an uncaught ConflictException(STALE_DRAFT_VERSION), not a DraftAlreadyConfirmedError-style graceful recovery', async () => {
    const conversationId = `a35b-race-${randomUUID()}`;
    await prisma.whatsappConversation.create({
      data: { id: conversationId, phone: '573001112244', provider: 'mock' },
    });

    const { service } = buildService();

    // Turn 1: an already fully-specified, PENDING-to-confirm TAKEAWAY draft (draftVersion 1) --
    // ordinary state for a conversation that already knows product/fulfillment/payment.
    const built = await service.process({
      conversationId,
      phone: '573001112244',
      message: 'Dame un combo 2x1, lo recojo y pago allá',
      actor,
    });
    expect(built.nextAction).toBe('READY_TO_CONFIRM');
    expect(built.state.draftVersion).toBe(1);
    expect(built.state.confirmationState).toBe('PENDING');

    // Turn 2 and Turn 3: TWO real, distinct WhatsApp messages (a genuine double-tap of the SAME
    // follow-up "add a Coke" message, or simply two ordinary messages landing moments apart)
    // racing each other to rebuild the SAME draft at version 2. Neither has observed the other's
    // result -- both independently read draftVersion=1 from `repository.loadState()`.
    const settled = await Promise.allSettled([
      service.process({ conversationId, phone: '573001112244', message: 'También quiero una Coca Cola', actor }),
      service.process({ conversationId, phone: '573001112244', message: 'También quiero una Coca Cola', actor }),
    ]);

    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof service.process>>>[];
    const rejected = settled.filter((entry) => entry.status === 'rejected') as PromiseRejectedResult[];

    // Underlying data stays correct: at most one of the two racing rebuilds actually lands (the
    // other's write is correctly rejected at the DB level, not silently double-applied).
    expect(fulfilled.length).toBeLessThanOrEqual(1);

    // THE FINDING: whenever one of the two turns loses the CAS race, it does NOT get the same
    // graceful-recovery treatment `DraftAlreadyConfirmedError` gets one branch over -- it rejects
    // with a raw, uncaught `ConflictException({ code: 'STALE_DRAFT_VERSION' })` that is never an
    // `instanceof DraftAlreadyConfirmedError`, so the existing catch clause in `process()` and
    // `confirm()` does not (and structurally cannot) catch it.
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    for (const loss of rejected) {
      expect(loss.reason).not.toBeInstanceOf(DraftAlreadyConfirmedError);
      expect(loss.reason).toBeInstanceOf(ConflictException);
      expect((loss.reason as ConflictException).getResponse()).toMatchObject({ code: 'STALE_DRAFT_VERSION' });
    }
  });

  afterEach(async () => {
    await prisma.sofiaConversationMemory.deleteMany({ where: { conversationId: { startsWith: 'a35b-' } } });
    await prisma.sofiaOrderDraft.deleteMany({ where: { conversationId: { startsWith: 'a35b-' } } });
    await prisma.whatsappConversation.deleteMany({ where: { id: { startsWith: 'a35b-' } } });
  });
});
