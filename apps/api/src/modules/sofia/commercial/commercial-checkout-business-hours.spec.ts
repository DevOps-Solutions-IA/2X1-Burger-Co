import { commercialDraftHash } from './commercial-draft-hash';
import { CommercialCheckoutService } from './commercial-checkout.service';
import { CommercialIntentEngine } from './commercial-intent.engine';
import { CommercialMetricsService } from './commercial-metrics.service';
import { CommercialPolicyService } from './commercial-policy.service';
import { CommercialResponseComposer } from './response/commercial-response.composer';
import { CommercialResponseValidator } from './response/commercial-response.validator';
import { SafeCommercialResponseTemplates } from './response/safe-commercial-response.templates';
import type { CommercialConversationState } from './commercial.types';

// TEAM B (Wave 2A) - business-hours gate on CommercialCheckoutService.confirm().
//
// These tests own only the business-hours insertion point at the top of
// confirm(); they do not exercise or assert on any other CommercialCheckoutService
// behavior beyond what is needed to prove the gate is deterministic, timezone-
// correct, replay-safe and concurrency-safe, and that CLOSED never reaches any
// productive authority (repository.confirmDraft / orderCreation.createFromSofiaDraft).
describe('CommercialCheckoutService business-hours gate (confirm)', () => {
  const engine = new CommercialIntentEngine();

  // SOFIA is open 17:00-24:00 America/Bogota (UTC-5, no DST).
  const OPEN_INSTANT = '2026-08-15T22:00:00.000Z'; // 17:00:00.000 Bogota (exact opening boundary)
  const OPEN_MIDWINDOW_INSTANT = '2026-08-15T23:30:00.000Z'; // 18:30 Bogota
  const OPEN_LAST_INSTANT = '2026-08-16T04:59:59.999Z'; // 23:59:59.999 Bogota (exact closing boundary, last open instant)
  const CLOSED_BEFORE_OPEN_INSTANT = '2026-08-15T21:59:00.000Z'; // 16:59 Bogota (one minute before opening)
  const CLOSED_AT_CLOSE_INSTANT = '2026-08-16T05:00:00.000Z'; // 00:00:00.000 Bogota (exact closing boundary)
  const CLOSED_MIDDAY_INSTANT = '2026-08-15T15:00:00.000Z'; // 10:00 Bogota

  function fixture() {
    let state: CommercialConversationState | null = null;
    let draft: { id: string; version: number; draftHash: string; expiresAt: Date; status?: string } | null = null;
    const repository = {
      loadState: jest.fn(async () => state),
      saveState: jest.fn(async (next: CommercialConversationState) => { state = structuredClone(next); }),
      saveDraft: jest.fn(async (input: Record<string, unknown> & { version?: number }) => {
        draft = { id: 'draft-1', version: input.version ?? 1, draftHash: commercialDraftHash(input), expiresAt: new Date(Date.now() + 15 * 60_000) };
        return draft;
      }),
      confirmDraft: jest.fn(async () => ({ id: 'draft-1', version: draft!.version, status: 'CONFIRMED' })),
    };
    const product = { id: 'p1', code: 'COMBO-2X1', name: 'Combo 2x1', description: 'Hamburguesas con cebolla', imageUrl: null, category: { id: 'cat', name: 'Combos', slug: 'combos' }, kind: 'PREPARED', persistedPrice: 25000, active: true, trackStock: true, updatedAt: new Date().toISOString() } as const;
    const products = [product];
    const responses = new CommercialResponseComposer(
      { compose: jest.fn(async () => null) },
      new CommercialResponseValidator(),
      new SafeCommercialResponseTemplates(),
    );
    const orderCreation = { createFromSofiaDraft: jest.fn(async () => { throw new Error('SOFIA_ORDER_CREATION_BLOCKED'); }) };
    const audit = { record: jest.fn(async () => ({ auditEventId: 'a1', timestamp: new Date().toISOString() })) };
    const service = new CommercialCheckoutService(
      engine, new CommercialPolicyService(), new CommercialMetricsService(), responses, repository as never,
      { listActive: jest.fn(async () => products), getActiveById: jest.fn(async (id: string) => products.find((entry) => entry.id === id)!), findActive: jest.fn() } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString() })) } as never,
      { check: jest.fn(async () => ({ productId: 'p1', quantity: 1, available: true, reasonCode: 'AVAILABLE', checkedAt: new Date().toISOString(), missingIngredients: [], recipeIngredients: [] })) } as never,
      { resolve: jest.fn(async () => ({ customerId: 'c1', displayName: null, phoneMasked: '***', created: false })) } as never,
      { quote: jest.fn(async () => ({ auditId: 'q1', status: 'AUTO_PRICED', finalFee: 5000, currency: 'COP', distanceKm: 4, estimatedMinutes: 20, reasonCode: 'AUTO_PRICED', calculationVersion: '2x1-delivery-pricing-v1', canCheckout: true })) } as never,
      audit as never,
      orderCreation as never,
    );
    const actor = { actorId: 'operator', roles: ['admin'], source: 'SOFIA_WHATSAPP' as const };
    return { service, repository, orderCreation, audit, actor, getState: () => state };
  }

  /**
   * Drives a fixture up to (but not through) confirmation with the fake
   * system clock parked at `instantIso`, and returns it. Building and
   * confirming at the same instant (or a few seconds apart, well inside the
   * draft's 15-minute quote window) keeps the business-hours gate the only
   * variable under test -- it avoids the unrelated draft/quote-expiry branch
   * in confirm() ever firing as a side effect of jumping the clock around.
   */
  async function driveToReadyToConfirm(instantIso: string, conversationId = 'conv') {
    const built = fixture();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(instantIso));
    const draftTurn = await built.service.process({
      conversationId, phone: '573001112233',
      message: 'Dame un combo 2x1, lo recojo y pago allá', actor: built.actor,
    });
    expect(draftTurn.nextAction).toBe('READY_TO_CONFIRM');
    return { ...built, conversationId };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('OPEN: normal confirmation proceeds unchanged', async () => {
    const { service, repository, orderCreation, actor, conversationId } = await driveToReadyToConfirm(OPEN_MIDWINDOW_INSTANT);
    const confirmed = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });
    expect(confirmed.nextAction).toBe('DRAFT_CONFIRMED');
    expect(repository.confirmDraft).toHaveBeenCalledTimes(1);
    expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
  });

  it('CLOSED: deterministic rejection, no SecureCommand/OrderCheckout/PaymentIntent/Kitchen progress', async () => {
    const { service, repository, orderCreation, audit, actor, conversationId } = await driveToReadyToConfirm(CLOSED_MIDDAY_INSTANT);
    const result = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });

    expect(result.nextAction).toBe('HANDOFF');
    expect(result.factEnvelope.responsePurpose).toBe('DEPENDENCY_FAILURE');
    expect(result.factEnvelope.reasonCode).toBe('SOFIA_BUSINESS_HOURS_CLOSED');
    expect(result.factEnvelope.allowedFacts).toEqual(expect.arrayContaining(['DRAFT_ONLY', 'NO_OPERATIONAL_MUTATION']));
    // The draft stays PENDING (see below), so the fact envelope still signals
    // that a confirmation is outstanding -- it simply was not granted this turn.
    expect(result.factEnvelope.confirmationRequired).toBe(true);

    // No productive authority reached.
    expect(repository.confirmDraft).not.toHaveBeenCalled();
    expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();

    // The draft is left PENDING (not confirmed, not silently dropped) so it can
    // still be confirmed once hours reopen.
    expect(result.state.confirmationState).toBe('PENDING');
    expect(result.state.draftId).toBe('draft-1');

    // A durable audit trail still exists for the rejected attempt (fail-closed,
    // not fail-silent), but it is not a productive/financial audit action.
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'SOFIA_DOMAIN_VALIDATION_FAILED' }));
  });

  it('boundary: exact opening instant (17:00:00.000 Bogota) confirms normally', async () => {
    const { service, repository, orderCreation, actor, conversationId } = await driveToReadyToConfirm(OPEN_INSTANT);
    const result = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });
    expect(result.nextAction).toBe('DRAFT_CONFIRMED');
    expect(repository.confirmDraft).toHaveBeenCalledTimes(1);
    expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
  });

  it('boundary: one minute before opening (16:59 Bogota) is rejected', async () => {
    const { service, repository, orderCreation, actor, conversationId } = await driveToReadyToConfirm(CLOSED_BEFORE_OPEN_INSTANT);
    const result = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });
    expect(result.nextAction).toBe('HANDOFF');
    expect(result.factEnvelope.reasonCode).toBe('SOFIA_BUSINESS_HOURS_CLOSED');
    expect(repository.confirmDraft).not.toHaveBeenCalled();
    expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();
  });

  it('boundary: last instant before closing (23:59:59.999 Bogota) confirms normally', async () => {
    const { service, repository, orderCreation, actor, conversationId } = await driveToReadyToConfirm(OPEN_LAST_INSTANT);
    const result = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });
    expect(result.nextAction).toBe('DRAFT_CONFIRMED');
    expect(repository.confirmDraft).toHaveBeenCalledTimes(1);
    expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
  });

  it('boundary: exact closing instant (00:00:00.000 Bogota) is rejected', async () => {
    const { service, repository, orderCreation, actor, conversationId } = await driveToReadyToConfirm(CLOSED_AT_CLOSE_INSTANT);
    const result = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });
    expect(result.nextAction).toBe('HANDOFF');
    expect(result.factEnvelope.reasonCode).toBe('SOFIA_BUSINESS_HOURS_CLOSED');
    expect(repository.confirmDraft).not.toHaveBeenCalled();
    expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();
  });

  it('timezone: converts to America/Bogota rather than raw UTC hour (closed leg)', async () => {
    // 21:30 UTC is 16:30 Bogota (closed) even though the raw UTC hour (21) sits
    // inside the numeric 17-24 window used for the comparison.
    const { service, repository, orderCreation, actor, conversationId } = await driveToReadyToConfirm('2026-08-15T21:30:00.000Z', 'conv-tz-closed');
    const stillClosed = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });
    expect(stillClosed.nextAction).toBe('HANDOFF');
    expect(stillClosed.factEnvelope.reasonCode).toBe('SOFIA_BUSINESS_HOURS_CLOSED');
    expect(repository.confirmDraft).not.toHaveBeenCalled();
    expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();
  });

  it('timezone: converts to America/Bogota rather than raw UTC hour (open leg)', async () => {
    // 23:30 UTC is 18:30 Bogota (open).
    const { service, repository, orderCreation, actor, conversationId } = await driveToReadyToConfirm('2026-08-15T23:30:00.000Z', 'conv-tz-open');
    const nowOpen = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });
    expect(nowOpen.nextAction).toBe('DRAFT_CONFIRMED');
    expect(repository.confirmDraft).toHaveBeenCalledTimes(1);
    expect(orderCreation.createFromSofiaDraft).toHaveBeenCalledTimes(1);
  });

  it('replay: repeated confirmation attempts while closed stay deterministically rejected with zero side effects', async () => {
    const { service, repository, orderCreation, actor, conversationId } = await driveToReadyToConfirm(CLOSED_MIDDAY_INSTANT);

    const first = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });
    const second = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });
    const third = await service.process({ conversationId, phone: '573001112233', message: 'Sí', actor });

    for (const attempt of [first, second, third]) {
      expect(attempt.nextAction).toBe('HANDOFF');
      expect(attempt.factEnvelope.reasonCode).toBe('SOFIA_BUSINESS_HOURS_CLOSED');
      expect(attempt.state.confirmationState).toBe('PENDING');
    }
    expect(repository.confirmDraft).not.toHaveBeenCalled();
    expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();
  });

  it('concurrency: simultaneous confirmation attempts while closed never let a productive mutation slip through', async () => {
    const { service, repository, orderCreation, actor, conversationId } = await driveToReadyToConfirm(CLOSED_MIDDAY_INSTANT);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => service.process({ conversationId, phone: '573001112233', message: 'Sí', actor })),
    );

    for (const attempt of attempts) {
      expect(attempt.nextAction).toBe('HANDOFF');
      expect(attempt.factEnvelope.reasonCode).toBe('SOFIA_BUSINESS_HOURS_CLOSED');
    }
    expect(repository.confirmDraft).not.toHaveBeenCalled();
    expect(orderCreation.createFromSofiaDraft).not.toHaveBeenCalled();
  });
});
