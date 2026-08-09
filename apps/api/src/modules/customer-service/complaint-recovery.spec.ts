import { createImmutableComplaintFact, immutableComplaintFacts } from './complaint-facts';
import {
  NO_RECOVERY_AUTHORITY,
  assertComplaintTransition,
  complaintCategoryPolicy,
  evaluateRecoveryAction,
} from './complaint-recovery.policy';

describe('complaint and recovery domain', () => {
  it('requires immediate human escalation for safety and payment concerns', () => {
    expect(complaintCategoryPolicy('FOOD_SAFETY')).toEqual({
      priority: 'CRITICAL', humanReviewRequired: true, immediateEscalationRequired: true,
    });
    expect(complaintCategoryPolicy('PAYMENT_CONCERN')).toMatchObject({
      humanReviewRequired: true, immediateEscalationRequired: true,
    });
  });

  it('allows controlled lifecycle progress and keeps closed complaints terminal', () => {
    expect(() => assertComplaintTransition('RECEIVED', 'TRIAGED')).not.toThrow();
    expect(() => assertComplaintTransition('TRIAGED', 'HUMAN_REVIEW')).not.toThrow();
    expect(() => assertComplaintTransition('CLOSED', 'TRIAGED')).toThrow('COMPLAINT_STATUS_TRANSITION_BLOCKED');
  });

  it.each(['ISSUE_REFUND', 'APPLY_DISCOUNT', 'AUTHORIZE_REPLACEMENT', 'GRANT_COMPENSATION']) (
    'denies recovery authority for %s',
    (action) => {
      expect(evaluateRecoveryAction(action)).toEqual({
        allowed: false, requiresHuman: true, reasonCode: 'RECOVERY_REMEDY_REQUIRES_HUMAN',
      });
    },
  );

  it('exposes no monetary or fulfillment remedy authority', () => {
    expect(NO_RECOVERY_AUTHORITY).toEqual({
      canIssueRefund: false,
      canApplyDiscount: false,
      canAuthorizeReplacement: false,
      canGrantCompensation: false,
    });
    expect(Object.isFrozen(NO_RECOVERY_AUTHORITY)).toBe(true);
  });

  it('creates deterministic, sanitized, immutable facts without raw references', () => {
    const recordedAt = '2026-08-08T12:00:00.000Z';
    const first = createImmutableComplaintFact({
      kind: 'CUSTOMER_STATEMENT',
      value: 'Contactar test@example.com o +57 300 123 4567\u0000 token=super-secret',
      source: 'CUSTOMER',
      recordedAt,
    });
    const replay = createImmutableComplaintFact({
      kind: 'CUSTOMER_STATEMENT',
      value: 'Contactar test@example.com o +57 300 123 4567\u0000 token=super-secret',
      source: 'CUSTOMER',
      recordedAt,
    });
    const reference = createImmutableComplaintFact({
      kind: 'ORDER_REFERENCE_HASH', value: 'raw-order-123', source: 'SYSTEM', recordedAt,
    });
    const facts = immutableComplaintFacts([first, reference]);

    expect(first.id).toBe(replay.id);
    expect(first.value).toContain('[EMAIL_REDACTED]');
    expect(first.value).toContain('[PHONE_REDACTED]');
    expect(first.value).toContain('[SECRET_REDACTED]');
    expect(reference.value).toMatch(/^[a-f0-9]{64}$/);
    expect(reference.value).not.toContain('raw-order-123');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(facts)).toBe(true);
    expect(facts.every(Object.isFrozen)).toBe(true);
  });
});
