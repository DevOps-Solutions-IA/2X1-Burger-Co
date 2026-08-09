import { CustomerServiceCaseService } from './customer-service-case.service';
import type {
  CustomerServiceCaseRecord,
  CustomerServiceCaseRepository,
} from './persistence/customer-service-case.repository';

const HASH = 'a'.repeat(64);
const now = new Date('2026-08-08T12:00:00.000Z');

function record(overrides: Partial<CustomerServiceCaseRecord> = {}): CustomerServiceCaseRecord {
  return {
    id: 'case-1', category: 'MISSING_ITEM', status: 'OPEN', source: 'WHATSAPP', sourceReference: 'event-1',
    evidenceHash: HASH, sanitizedSummary: 'Falta un producto', customerId: null, conversationId: null,
    orderCheckoutId: null, orderTicketId: null, paymentIntentId: null, deliveryIssueId: null,
    assignedActorId: null, resolutionActorId: null, resolutionCode: null, version: 0,
    createdAt: now, updatedAt: now, resolvedAt: null, closedAt: null, ...overrides,
  };
}

describe('CustomerServiceCaseService', () => {
  function harness() {
    const repository: jest.Mocked<CustomerServiceCaseRepository> = {
      createIdempotent: jest.fn().mockResolvedValue({ state: 'CREATED', serviceCase: record() }),
      transition: jest.fn().mockResolvedValue({ state: 'UPDATED', serviceCase: record({ status: 'HUMAN_REQUIRED', version: 1 }) }),
    };
    return { service: new CustomerServiceCaseService(repository), repository };
  }

  it('opens a sanitized case through the canonical repository', async () => {
    const { service, repository } = harness();
    await service.open({
      category: 'MISSING_ITEM', source: 'WHATSAPP', sourceReference: 'event-1', idempotencyKey: 'case-open:event-1',
      evidenceHash: HASH, summary: 'Escribir a test@example.com token=secret-value',
    });
    expect(repository.createIdempotent).toHaveBeenCalledWith(expect.objectContaining({
      sanitizedSummary: 'Escribir a [EMAIL_REDACTED] [SECRET_REDACTED]',
    }));
    expect(repository.createIdempotent.mock.calls[0]?.[0]).not.toHaveProperty('summary');
    expect(repository.createIdempotent.mock.calls[0]?.[0]).not.toHaveProperty('metadata');
  });

  it('allows only the governed status sequence and requires actors for human actions', async () => {
    const { service, repository } = harness();
    await service.transition({
      caseId: 'case-1', expectedVersion: 0, idempotencyKey: 'transition-1', fromStatus: 'OPEN',
      toStatus: 'HUMAN_REQUIRED', reasonCode: 'CUSTOMER_REMEDY_REQUIRES_HUMAN',
    });
    expect(repository.transition).toHaveBeenCalledWith(expect.objectContaining({ action: 'HUMAN_REVIEW_REQUIRED' }));
    expect(() => service.transition({
      caseId: 'case-1', expectedVersion: 1, idempotencyKey: 'transition-2', fromStatus: 'HUMAN_REQUIRED',
      toStatus: 'HUMAN_TAKEN', reasonCode: 'OPERATOR_ACCEPTED_CASE',
    })).toThrow('CUSTOMER_SERVICE_CASE_ACTOR_REQUIRED');
    expect(() => service.transition({
      caseId: 'case-1', expectedVersion: 0, idempotencyKey: 'transition-3', fromStatus: 'OPEN',
      toStatus: 'RESOLVED', reasonCode: 'INVALID_SKIP', actorId: 'operator-1',
    })).toThrow('CUSTOMER_SERVICE_CASE_TRANSITION_BLOCKED');
  });

  it.each(['ISSUE_REFUND', 'APPLY_DISCOUNT', 'AUTHORIZE_REPLACEMENT', 'GRANT_COMPENSATION'])(
    'retains no authority for %s',
    (action) => {
      const { service } = harness();
      expect(service.evaluateRecovery(action)).toEqual({
        decision: { allowed: false, requiresHuman: true, reasonCode: 'RECOVERY_REMEDY_REQUIRES_HUMAN' },
        authority: {
          canIssueRefund: false,
          canApplyDiscount: false,
          canAuthorizeReplacement: false,
          canGrantCompensation: false,
        },
      });
    },
  );

  it('rejects raw evidence identifiers and unbounded metadata', () => {
    const { service } = harness();
    expect(() => service.open({
      category: 'OTHER', source: 'WHATSAPP', sourceReference: 'event-1', idempotencyKey: 'case-open:event-1',
      evidenceHash: 'raw evidence', summary: 'Ayuda',
    })).toThrow('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
    expect(() => service.open({
      category: 'OTHER', source: 'WHATSAPP', sourceReference: 'event-1', idempotencyKey: 'case-open:event-1',
      evidenceHash: HASH, summary: 'Ayuda', metadata: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key${index}`, index])),
    })).toThrow('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
  });
});
