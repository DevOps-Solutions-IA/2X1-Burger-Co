import {
  NOTIFICATION_HASH_NAMESPACE,
  NOTIFICATION_IDEMPOTENCY_NAMESPACE,
  createNotificationIdempotencyKey,
  deterministicNotificationHash,
  notificationRecipientIdentityHash,
} from './notification-identity';
import {
  UNKNOWN_NOTIFICATION_RESULT_POLICY,
  assertNotificationTransition,
  evaluateNotificationClaim,
} from './notification.policy';

describe('notification domain policy', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');

  it('claims pending work and reclaims only an expired pre-dispatch lease', () => {
    expect(evaluateNotificationClaim({
      status: 'PENDING', now, leaseExpiresAt: null, dispatchStartedAt: null, retryable: false, resultCertainty: 'NOT_ATTEMPTED',
    })).toMatchObject({ allowed: true, reasonCode: 'NOTIFICATION_CLAIM_ALLOWED' });
    expect(evaluateNotificationClaim({
      status: 'CLAIMED', now, leaseExpiresAt: new Date('2026-08-08T11:59:00.000Z'), dispatchStartedAt: null,
      retryable: false, resultCertainty: 'NOT_ATTEMPTED',
    })).toEqual({
      allowed: true, reasonCode: 'NOTIFICATION_PRE_DISPATCH_LEASE_RECLAIM_ALLOWED', requiresHumanReconciliation: false,
    });
  });

  it('does not reclaim or resend after dispatch may have started', () => {
    expect(evaluateNotificationClaim({
      status: 'CLAIMED', now, leaseExpiresAt: new Date('2026-08-08T11:59:00.000Z'),
      dispatchStartedAt: new Date('2026-08-08T11:58:00.000Z'), retryable: true, resultCertainty: 'UNKNOWN',
    })).toEqual({
      allowed: false,
      reasonCode: 'NOTIFICATION_UNKNOWN_RESULT_RECONCILIATION_REQUIRED',
      requiresHumanReconciliation: true,
    });
    expect(evaluateNotificationClaim({
      status: 'UNKNOWN_RESULT', now, leaseExpiresAt: null, dispatchStartedAt: now, retryable: true, resultCertainty: 'UNKNOWN',
    }).allowed).toBe(false);
  });

  it('makes unknown result fail closed until explicit human reconciliation', () => {
    expect(UNKNOWN_NOTIFICATION_RESULT_POLICY).toEqual({
      automaticRetryAllowed: false,
      automaticResendAllowed: false,
      claimAllowed: false,
      assumeDelivered: false,
      assumeNotDelivered: false,
      requiresHumanReconciliation: true,
    });
    expect(() => assertNotificationTransition('UNKNOWN_RESULT', 'ACCEPTED')).toThrow('NOTIFICATION_STATUS_TRANSITION_BLOCKED');
    expect(() => assertNotificationTransition('UNKNOWN_RESULT', 'ACCEPTED', {
      manualReconciliation: true, resultCertainty: 'ACCEPTED',
    })).not.toThrow();
  });

  it('retries a known failure only when the provider definitely did not accept it', () => {
    expect(() => assertNotificationTransition('FAILED', 'CLAIMED', {
      retryable: true, resultCertainty: 'NOT_ACCEPTED',
    })).not.toThrow();
    expect(() => assertNotificationTransition('FAILED', 'CLAIMED', {
      retryable: true, resultCertainty: 'UNKNOWN',
    })).toThrow('NOTIFICATION_STATUS_TRANSITION_BLOCKED');
  });

  it('binds dispatch transitions to explicit result certainty', () => {
    expect(() => assertNotificationTransition('DISPATCHING', 'ACCEPTED')).toThrow('NOTIFICATION_STATUS_TRANSITION_BLOCKED');
    expect(() => assertNotificationTransition('DISPATCHING', 'ACCEPTED', {
      resultCertainty: 'ACCEPTED',
    })).not.toThrow();
    expect(() => assertNotificationTransition('DISPATCHING', 'UNKNOWN_RESULT', {
      resultCertainty: 'UNKNOWN',
    })).not.toThrow();
  });

  it('generates deterministic canonical hashes in separate namespaces', () => {
    const first = deterministicNotificationHash({ status: 'TRIAGED', facts: ['a'], version: 1 });
    const reordered = deterministicNotificationHash({ version: 1, facts: ['a'], status: 'TRIAGED' });
    const recipientIdentityHash = notificationRecipientIdentityHash(' Customer@example.com ');
    const factsHash = deterministicNotificationHash([{ id: 'fact-1' }]);
    const binding = {
      scope: 'store-1',
      complaintId: 'complaint-1',
      eventId: 'event-1',
      channel: 'EMAIL' as const,
      purpose: 'CUSTOMER_SERVICE_CASE_UPDATE' as const,
      recipientIdentityHash,
      templateVersion: 'case-update.v1',
      factsHash,
    };
    const key = createNotificationIdempotencyKey(binding);

    expect(first).toBe(reordered);
    expect(key).toBe(createNotificationIdempotencyKey(binding));
    expect(key).toMatch(new RegExp(`^${NOTIFICATION_IDEMPOTENCY_NAMESPACE}:[a-f0-9]{64}$`));
    expect(key).not.toContain(binding.complaintId);
    expect(NOTIFICATION_HASH_NAMESPACE).not.toBe(NOTIFICATION_IDEMPOTENCY_NAMESPACE);
  });

  it('changes the idempotency key when any bound delivery identity changes', () => {
    const base = {
      scope: 'store-1', complaintId: 'complaint-1', eventId: 'event-1', channel: 'EMAIL' as const,
      purpose: 'CUSTOMER_SERVICE_CASE_UPDATE' as const,
      recipientIdentityHash: notificationRecipientIdentityHash('customer@example.com'),
      templateVersion: 'case-update.v1', factsHash: deterministicNotificationHash(['fact-1']),
    };
    expect(createNotificationIdempotencyKey(base)).not.toBe(createNotificationIdempotencyKey({ ...base, eventId: 'event-2' }));
  });

  it('rejects cyclic values instead of producing an unstable hash', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => deterministicNotificationHash(cyclic)).toThrow('NOTIFICATION_HASH_VALUE_UNSUPPORTED');
  });
});
