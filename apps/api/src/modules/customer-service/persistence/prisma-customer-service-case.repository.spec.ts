import { CustomerServiceCasePersistenceError, PrismaCustomerServiceCaseRepository } from './prisma-customer-service-case.repository';

const now = new Date('2026-08-08T12:00:00.000Z');
const baseCase = {
  id: 'case-1', category: 'MISSING_ITEM', status: 'OPEN', source: 'WHATSAPP', sourceReference: 'event-1',
  evidenceHash: 'a'.repeat(64), sanitizedSummary: 'Falta un producto', customerId: null, conversationId: null,
  orderCheckoutId: null, orderTicketId: null, paymentIntentId: null, deliveryIssueId: null,
  assignedActorId: null, resolutionActorId: null, resolutionCode: null, version: 0,
  createdAt: now, updatedAt: now, resolvedAt: null, closedAt: null,
};

const createInput = {
  category: 'MISSING_ITEM' as const,
  source: 'WHATSAPP',
  sourceReference: 'event-1',
  idempotencyKey: 'case-open:event-1',
  evidenceHash: 'a'.repeat(64),
  sanitizedSummary: 'Falta un producto',
};

describe('PrismaCustomerServiceCaseRepository', () => {
  function harness(overrides: Record<string, unknown> = {}) {
    const tx = {
      customerServiceCase: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...baseCase, status: 'HUMAN_REQUIRED', version: 1 }),
        create: jest.fn().mockResolvedValue(baseCase),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customerServiceCaseEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
      ...overrides,
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => callback(tx)),
      customerServiceCase: tx.customerServiceCase,
      customerServiceCaseEvent: tx.customerServiceCaseEvent,
    };
    return { repository: new PrismaCustomerServiceCaseRepository(prisma as never), prisma, tx };
  }

  it('creates the case and append-only initial event in one transaction', async () => {
    const { repository, prisma, tx } = harness();
    await expect(repository.createIdempotent(createInput)).resolves.toMatchObject({ state: 'CREATED', serviceCase: baseCase });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.customerServiceCase.create).toHaveBeenCalledTimes(1);
    expect(tx.customerServiceCaseEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ caseId: 'case-1', version: 0, action: 'CASE_CREATED' }),
    });
  });

  it('replays the same source identity and rejects conflicting evidence', async () => {
    const replay = harness();
    replay.tx.customerServiceCase.findUnique.mockResolvedValue(baseCase);
    await expect(replay.repository.createIdempotent(createInput)).resolves.toMatchObject({ state: 'DETERMINISTIC_REPLAY' });
    expect(replay.tx.customerServiceCase.create).not.toHaveBeenCalled();

    const conflict = harness();
    conflict.tx.customerServiceCase.findUnique.mockResolvedValue({ ...baseCase, evidenceHash: 'b'.repeat(64) });
    await expect(conflict.repository.createIdempotent(createInput)).rejects.toThrow('CASE_IDEMPOTENCY_CONFLICT');
  });

  it('recovers the one winning case after a concurrent unique conflict', async () => {
    const { repository, prisma, tx } = harness();
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    tx.customerServiceCase.findUnique.mockResolvedValue(baseCase);
    await expect(repository.createIdempotent(createInput)).resolves.toMatchObject({
      state: 'DETERMINISTIC_REPLAY', serviceCase: { id: 'case-1' },
    });
    expect(tx.customerServiceCase.create).not.toHaveBeenCalled();
  });

  it('updates the expected version and appends its event atomically', async () => {
    const { repository, tx } = harness();
    tx.customerServiceCase.findUnique.mockResolvedValue(baseCase);
    await expect(repository.transition({
      caseId: 'case-1', expectedVersion: 0, idempotencyKey: 'transition-1', fromStatus: 'OPEN',
      toStatus: 'HUMAN_REQUIRED', action: 'HUMAN_REVIEW_REQUIRED', reasonCode: 'REMEDY_REQUIRES_HUMAN',
    })).resolves.toMatchObject({ state: 'UPDATED', serviceCase: { version: 1 } });
    expect(tx.customerServiceCase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'case-1', version: 0, status: 'OPEN' },
      data: expect.objectContaining({ version: { increment: 1 }, status: 'HUMAN_REQUIRED' }),
    }));
    expect(tx.customerServiceCaseEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ caseId: 'case-1', version: 1, fromStatus: 'OPEN', toStatus: 'HUMAN_REQUIRED' }),
    });
  });

  it('allows only one version winner and rejects a stale competitor without an event', async () => {
    const { repository, tx } = harness();
    tx.customerServiceCase.findUnique.mockResolvedValue(baseCase);
    tx.customerServiceCase.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.transition({
      caseId: 'case-1', expectedVersion: 0, idempotencyKey: 'competitor-1', fromStatus: 'OPEN',
      toStatus: 'HUMAN_REQUIRED', action: 'HUMAN_REVIEW_REQUIRED', reasonCode: 'REMEDY_REQUIRES_HUMAN',
    })).rejects.toEqual(expect.objectContaining({ code: 'STALE_CASE_VERSION' }));
    expect(tx.customerServiceCaseEvent.create).not.toHaveBeenCalled();
  });

  it('deterministically replays a transition and rejects reuse with different semantics', async () => {
    const event = {
      action: 'HUMAN_REVIEW_REQUIRED', fromStatus: 'OPEN', toStatus: 'HUMAN_REQUIRED', actorId: null,
      reasonCode: 'REMEDY_REQUIRES_HUMAN', sanitizedMetadata: null,
    };
    const replay = harness();
    replay.tx.customerServiceCaseEvent.findUnique.mockResolvedValue(event);
    replay.tx.customerServiceCase.findUnique.mockResolvedValue({ ...baseCase, status: 'HUMAN_REQUIRED', version: 1 });
    await expect(replay.repository.transition({
      caseId: 'case-1', expectedVersion: 0, idempotencyKey: 'transition-1', fromStatus: 'OPEN',
      toStatus: 'HUMAN_REQUIRED', action: 'HUMAN_REVIEW_REQUIRED', reasonCode: 'REMEDY_REQUIRES_HUMAN',
    })).resolves.toMatchObject({ state: 'DETERMINISTIC_REPLAY' });

    await expect(replay.repository.transition({
      caseId: 'case-1', expectedVersion: 0, idempotencyKey: 'transition-1', fromStatus: 'OPEN',
      toStatus: 'HUMAN_REQUIRED', action: 'HUMAN_REVIEW_REQUIRED', reasonCode: 'DIFFERENT_REASON',
    })).rejects.toBeInstanceOf(CustomerServiceCasePersistenceError);
  });
});
