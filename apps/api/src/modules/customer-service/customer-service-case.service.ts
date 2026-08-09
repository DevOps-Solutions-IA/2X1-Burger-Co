import { Inject, Injectable } from '@nestjs/common';
import {
  NO_RECOVERY_AUTHORITY,
  complaintCategoryPolicy,
  evaluateRecoveryAction,
} from './complaint-recovery.policy';
import type { ComplaintCategory, RecoveryActionDecision } from './complaint-recovery.types';
import {
  CUSTOMER_SERVICE_CASE_CATEGORIES,
  CUSTOMER_SERVICE_CASE_REPOSITORY,
  CUSTOMER_SERVICE_CASE_STATUSES,
  type CreateCustomerServiceCase,
  type CustomerServiceCaseCategory,
  type CustomerServiceCaseStatus,
  type CustomerServiceCaseWriteResult,
  CustomerServiceCaseRepository,
} from './persistence/customer-service-case.repository';

const HASH = /^[a-f0-9]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/;
const MAX_SUMMARY = 1_000;
const MAX_METADATA_KEYS = 20;

const CATEGORY_POLICY: Readonly<Record<CustomerServiceCaseCategory, ComplaintCategory>> = Object.freeze({
  LATE_ORDER: 'DELIVERY_EXPERIENCE',
  WRONG_ITEM: 'ORDER_ACCURACY',
  MISSING_ITEM: 'ORDER_ACCURACY',
  COLD_FOOD: 'PRODUCT_QUALITY',
  QUALITY: 'PRODUCT_QUALITY',
  PAYMENT_PROBLEM: 'PAYMENT_CONCERN',
  DELIVERY_PROBLEM: 'DELIVERY_EXPERIENCE',
  OTHER: 'OTHER',
});

const STATUS_TRANSITIONS: Readonly<Record<CustomerServiceCaseStatus, readonly CustomerServiceCaseStatus[]>> = Object.freeze({
  OPEN: ['HUMAN_REQUIRED'],
  HUMAN_REQUIRED: ['HUMAN_TAKEN'],
  HUMAN_TAKEN: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
});

const ACTION_BY_STATUS: Readonly<Record<CustomerServiceCaseStatus, string>> = Object.freeze({
  OPEN: 'CASE_OPENED',
  HUMAN_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
  HUMAN_TAKEN: 'HUMAN_TAKEOVER',
  RESOLVED: 'CASE_RESOLVED',
  CLOSED: 'CASE_CLOSED',
});

export class CustomerServiceCaseError extends Error {
  constructor(readonly code: 'CUSTOMER_SERVICE_CASE_INPUT_INVALID' | 'CUSTOMER_SERVICE_CASE_TRANSITION_BLOCKED' | 'CUSTOMER_SERVICE_CASE_ACTOR_REQUIRED') {
    super(code);
    this.name = 'CustomerServiceCaseError';
  }
}

export type OpenCustomerServiceCase = Omit<CreateCustomerServiceCase, 'sanitizedSummary' | 'sanitizedMetadata'> & Readonly<{
  summary: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>> | null;
}>;

export type ChangeCustomerServiceCaseStatus = Readonly<{
  caseId: string;
  expectedVersion: number;
  idempotencyKey: string;
  fromStatus: CustomerServiceCaseStatus;
  toStatus: CustomerServiceCaseStatus;
  reasonCode: string;
  actorId?: string | null;
  resolutionCode?: string | null;
  metadata?: Readonly<Record<string, string | number | boolean | null>> | null;
}>;

export type GovernedRecoveryDecision = Readonly<{
  decision: RecoveryActionDecision;
  authority: typeof NO_RECOVERY_AUTHORITY;
}>;

@Injectable()
export class CustomerServiceCaseService {
  constructor(
    @Inject(CUSTOMER_SERVICE_CASE_REPOSITORY)
    private readonly repository: CustomerServiceCaseRepository,
  ) {}

  open(input: OpenCustomerServiceCase): Promise<CustomerServiceCaseWriteResult> {
    this.assertIdentifier(input.source);
    this.assertIdentifier(input.sourceReference);
    this.assertIdentifier(input.idempotencyKey);
    if (!CUSTOMER_SERVICE_CASE_CATEGORIES.includes(input.category) || !HASH.test(input.evidenceHash)) {
      throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
    }
    complaintCategoryPolicy(CATEGORY_POLICY[input.category]);
    const {
      summary,
      metadata,
      ...caseIdentity
    } = input;
    return this.repository.createIdempotent({
      ...caseIdentity,
      sanitizedSummary: this.sanitize(summary, MAX_SUMMARY),
      sanitizedMetadata: this.sanitizeMetadata(metadata),
    });
  }

  transition(input: ChangeCustomerServiceCaseStatus): Promise<CustomerServiceCaseWriteResult> {
    this.assertIdentifier(input.caseId);
    this.assertIdentifier(input.idempotencyKey);
    this.assertIdentifier(input.reasonCode);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
    }
    if (
      !CUSTOMER_SERVICE_CASE_STATUSES.includes(input.fromStatus)
      || !CUSTOMER_SERVICE_CASE_STATUSES.includes(input.toStatus)
      || !STATUS_TRANSITIONS[input.fromStatus].includes(input.toStatus)
    ) {
      throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_TRANSITION_BLOCKED');
    }
    if (['HUMAN_TAKEN', 'RESOLVED', 'CLOSED'].includes(input.toStatus) && !input.actorId) {
      throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_ACTOR_REQUIRED');
    }
    if (input.actorId) this.assertIdentifier(input.actorId);
    if (input.resolutionCode) this.assertIdentifier(input.resolutionCode);
    if (input.toStatus === 'RESOLVED' && !input.resolutionCode) {
      throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
    }
    const {
      metadata,
      ...transition
    } = input;
    return this.repository.transition({
      ...transition,
      action: ACTION_BY_STATUS[input.toStatus],
      sanitizedMetadata: this.sanitizeMetadata(metadata),
    });
  }

  evaluateRecovery(action: string): GovernedRecoveryDecision {
    return Object.freeze({
      decision: evaluateRecoveryAction(action),
      authority: NO_RECOVERY_AUTHORITY,
    });
  }

  private assertIdentifier(value: string): void {
    if (!SAFE_IDENTIFIER.test(value)) throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
  }

  private sanitize(value: string, maxLength: number): string {
    if (typeof value !== 'string') throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
    const sanitized = Array.from(value.normalize('NFKC'), (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : character;
    }).join('')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[TOKEN_REDACTED]')
      .replace(/\b(?:password|passwd|secret|token)\s*[:=]\s*\S+/gi, '[SECRET_REDACTED]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[PAYMENT_DATA_REDACTED]')
      .replace(/(?:\+?\d[\s().-]*){8,15}/g, '[PHONE_REDACTED]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
    if (!sanitized) throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
    return sanitized;
  }

  private sanitizeMetadata(
    metadata: Readonly<Record<string, string | number | boolean | null>> | null | undefined,
  ): Readonly<Record<string, string | number | boolean | null>> | null {
    if (!metadata) return null;
    const entries = Object.entries(metadata);
    if (entries.length > MAX_METADATA_KEYS) throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
    return Object.freeze(Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => {
      if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key)) {
        throw new CustomerServiceCaseError('CUSTOMER_SERVICE_CASE_INPUT_INVALID');
      }
      return [key, typeof value === 'string' ? this.sanitize(value, 256) : value];
    })));
  }
}
