import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type AggregateRow = {
  notificationActive: bigint;
  notificationPending: bigint;
  notificationClaimed: bigint;
  notificationCommandPending: bigint;
  notificationDispatched: bigint;
  notificationFailed: bigint;
  notificationUnknownResult: bigint;
  notificationExpiredLeases: bigint;
  notificationRetryReady: bigint;
  notificationOldestAgeSeconds: number;
  webhookActive: bigint;
  webhookRetryReady: bigint;
  webhookExpiredLeases: bigint;
  webhookFinancialReview: bigint;
  webhookInvalidRecent: bigint;
  webhookOldestAgeSeconds: number;
  inboundActive: bigint;
  inboundRetryReady: bigint;
  inboundExpiredLeases: bigint;
  inboundAttemptsExhausted: bigint;
  inboundMissingResult: bigint;
  inboundOldestAgeSeconds: number;
  commandActive: bigint;
  commandFailed: bigint;
  commandRetryReady: bigint;
  commandExpiredLeases: bigint;
  commandUnknownResult: bigint;
  commandOldestAgeSeconds: number;
  checkoutPaymentPending: bigint;
  checkoutFinancialReview: bigint;
  paymentPending: bigint;
  paymentUnknownResult: bigint;
  paymentFinancialReview: bigint;
};

export type OperationalBacklogSnapshot = Readonly<{
  available: boolean;
  collectedAt: string;
  notifications: Readonly<{
    active: number;
    pending: number;
    claimed: number;
    commandPending: number;
    dispatched: number;
    failed: number;
    unknownResult: number;
    expiredLeases: number;
    retryReady: number;
    oldestActiveAgeSeconds: number;
  }>;
  paymentWebhooks: Readonly<{
    active: number;
    retryReady: number;
    expiredLeases: number;
    financialReviewRequired: number;
    invalidRecent: number;
    oldestActiveAgeSeconds: number;
  }>;
  whatsappInbound: Readonly<{
    active: number;
    retryReady: number;
    expiredLeases: number;
    attemptsExhausted: number;
    missingDeterministicResult: number;
    oldestActiveAgeSeconds: number;
  }>;
  secureCommands: Readonly<{
    active: number;
    failed: number;
    retryReady: number;
    expiredLeases: number;
    unknownResult: number;
    oldestActiveAgeSeconds: number;
  }>;
  commerce: Readonly<{
    checkoutPaymentPending: number;
    checkoutFinancialReviewRequired: number;
    paymentPending: number;
    paymentUnknownResult: number;
    paymentFinancialReviewRequired: number;
  }>;
}>;

const EMPTY_SNAPSHOT = Object.freeze({
  notifications: Object.freeze({
    active: 0,
    pending: 0,
    claimed: 0,
    commandPending: 0,
    dispatched: 0,
    failed: 0,
    unknownResult: 0,
    expiredLeases: 0,
    retryReady: 0,
    oldestActiveAgeSeconds: 0,
  }),
  paymentWebhooks: Object.freeze({
    active: 0,
    retryReady: 0,
    expiredLeases: 0,
    financialReviewRequired: 0,
    invalidRecent: 0,
    oldestActiveAgeSeconds: 0,
  }),
  whatsappInbound: Object.freeze({
    active: 0,
    retryReady: 0,
    expiredLeases: 0,
    attemptsExhausted: 0,
    missingDeterministicResult: 0,
    oldestActiveAgeSeconds: 0,
  }),
  secureCommands: Object.freeze({
    active: 0,
    failed: 0,
    retryReady: 0,
    expiredLeases: 0,
    unknownResult: 0,
    oldestActiveAgeSeconds: 0,
  }),
  commerce: Object.freeze({
    checkoutPaymentPending: 0,
    checkoutFinancialReviewRequired: 0,
    paymentPending: 0,
    paymentUnknownResult: 0,
    paymentFinancialReviewRequired: 0,
  }),
});

@Injectable()
export class OperationalBacklogService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(now = new Date()): Promise<OperationalBacklogSnapshot> {
    try {
      const rows = await this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
        WITH notification AS (
          SELECT
            COUNT(*) FILTER (WHERE status IN ('PENDING', 'CLAIMED', 'COMMAND_PENDING', 'DISPATCHED'))::bigint AS "notificationActive",
            COUNT(*) FILTER (WHERE status = 'PENDING')::bigint AS "notificationPending",
            COUNT(*) FILTER (WHERE status = 'CLAIMED')::bigint AS "notificationClaimed",
            COUNT(*) FILTER (WHERE status = 'COMMAND_PENDING')::bigint AS "notificationCommandPending",
            COUNT(*) FILTER (WHERE status = 'DISPATCHED')::bigint AS "notificationDispatched",
            COUNT(*) FILTER (WHERE status = 'FAILED' AND updated_at >= ${now} - INTERVAL '15 minutes')::bigint AS "notificationFailed",
            COUNT(*) FILTER (WHERE status = 'UNKNOWN_RESULT')::bigint AS "notificationUnknownResult",
            COUNT(*) FILTER (
              WHERE status = 'CLAIMED' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ${now}
            )::bigint AS "notificationExpiredLeases",
            COUNT(*) FILTER (
              WHERE status = 'PENDING'
                AND (next_retry_at IS NULL OR next_retry_at <= ${now})
                AND (expires_at IS NULL OR expires_at > ${now})
            )::bigint AS "notificationRetryReady",
            COALESCE(EXTRACT(EPOCH FROM (${now} - MIN(created_at) FILTER (
              WHERE status IN ('PENDING', 'CLAIMED', 'COMMAND_PENDING', 'DISPATCHED')
            ))), 0)::double precision AS "notificationOldestAgeSeconds"
          FROM notification_intents
        ), webhook AS (
          SELECT
            COUNT(*) FILTER (
              WHERE processed_at IS NULL
                AND processed_status IN ('RECEIVED', 'PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED')
            )::bigint AS "webhookActive",
            -- payment_webhook_events.{next_retry_at,processing_lease_expires_at} are naive
            -- TIMESTAMP(3); the repository writes them exclusively via the typed Prisma Client
            -- (UTC-normalized, session-timezone-independent — see .engineering/sofia-production/
            -- remediation/payment-lease-timezone/00-design.md). A raw bind-param compare against
            -- ${now} without this AT TIME ZONE cast is session-timezone-sensitive and gives WRONG
            -- results against typed-written values (empirically verified: undercounts expired
            -- leases / retry-ready webhooks under a non-UTC Postgres session). Do not remove.
            COUNT(*) FILTER (
              WHERE processed_at IS NULL AND processed_status = 'FAILED' AND retryable = TRUE
                AND (next_retry_at IS NULL OR (next_retry_at AT TIME ZONE 'UTC') <= ${now})
            )::bigint AS "webhookRetryReady",
            COUNT(*) FILTER (
              WHERE processed_at IS NULL
                AND processed_status IN ('PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED')
                AND processing_lease_expires_at IS NOT NULL
                AND (processing_lease_expires_at AT TIME ZONE 'UTC') <= ${now}
            )::bigint AS "webhookExpiredLeases",
            COUNT(*) FILTER (WHERE processed_status = 'FINANCIAL_REVIEW_REQUIRED')::bigint AS "webhookFinancialReview",
            COUNT(*) FILTER (
              WHERE received_at >= ${now} - INTERVAL '15 minutes'
                AND processed_status IN ('SIGNATURE_INVALID', 'ACCOUNT_MISMATCH', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'REFERENCE_UNKNOWN')
            )::bigint AS "webhookInvalidRecent",
            COALESCE(EXTRACT(EPOCH FROM (${now} - MIN(received_at) FILTER (
              WHERE processed_at IS NULL
                AND processed_status IN ('RECEIVED', 'PROCESSING', 'VALIDATED', 'TRANSITION_APPLIED', 'DOWNSTREAM_APPLIED', 'FAILED')
            ))), 0)::double precision AS "webhookOldestAgeSeconds"
          FROM payment_webhook_events
        ), inbound AS (
          SELECT
            COUNT(*) FILTER (WHERE processing_status IN ('RECEIVED', 'CLAIMED') OR (processing_status = 'FAILED' AND retryable = TRUE))::bigint AS "inboundActive",
            COUNT(*) FILTER (
              WHERE processing_status = 'FAILED' AND retryable = TRUE
                AND (next_retry_at IS NULL OR next_retry_at <= ${now})
            )::bigint AS "inboundRetryReady",
            COUNT(*) FILTER (
              WHERE processing_status = 'CLAIMED'
                AND processing_lease_expires_at IS NOT NULL
                AND processing_lease_expires_at <= ${now}
            )::bigint AS "inboundExpiredLeases",
            COUNT(*) FILTER (
              WHERE processing_status = 'ATTEMPTS_EXHAUSTED'
                AND received_at >= ${now} - INTERVAL '15 minutes'
            )::bigint AS "inboundAttemptsExhausted",
            COUNT(*) FILTER (
              WHERE processed_at IS NOT NULL AND deterministic_result IS NULL
                AND processing_status NOT IN ('DUPLICATE_IGNORED', 'ALLOWLIST_REQUIRED')
            )::bigint AS "inboundMissingResult",
            COALESCE(EXTRACT(EPOCH FROM (${now} - MIN(received_at) FILTER (
              WHERE processing_status IN ('RECEIVED', 'CLAIMED') OR (processing_status = 'FAILED' AND retryable = TRUE)
            ))), 0)::double precision AS "inboundOldestAgeSeconds"
          FROM whatsapp_inbound_events
        ), command AS (
          SELECT
            COUNT(*) FILTER (WHERE status IN ('RECEIVED', 'VALIDATED', 'APPROVAL_REQUIRED', 'APPROVED', 'CLAIMED', 'EXECUTING'))::bigint AS "commandActive",
            COUNT(*) FILTER (
              WHERE status = 'FAILED' AND updated_at >= ${now} - INTERVAL '15 minutes'
            )::bigint AS "commandFailed",
            COUNT(*) FILTER (
              WHERE status = 'FAILED' AND retryable = TRUE AND updated_at >= ${now} - INTERVAL '15 minutes'
            )::bigint AS "commandRetryReady",
            COUNT(*) FILTER (
              WHERE status IN ('CLAIMED', 'EXECUTING')
                AND lease_expires_at IS NOT NULL
                AND lease_expires_at <= ${now}
            )::bigint AS "commandExpiredLeases",
            COUNT(*) FILTER (WHERE failure_class = 'UNKNOWN_RESULT')::bigint AS "commandUnknownResult",
            COALESCE(EXTRACT(EPOCH FROM (${now} - MIN(created_at) FILTER (
              WHERE status IN ('RECEIVED', 'VALIDATED', 'APPROVAL_REQUIRED', 'APPROVED', 'CLAIMED', 'EXECUTING')
            ))), 0)::double precision AS "commandOldestAgeSeconds"
          FROM sofia_commands
        ), commerce AS (
          SELECT
            (SELECT COUNT(*)::bigint FROM order_checkouts WHERE status = 'PAYMENT_PENDING') AS "checkoutPaymentPending",
            (SELECT COUNT(*)::bigint FROM order_checkouts WHERE status = 'FINANCIAL_REVIEW_REQUIRED') AS "checkoutFinancialReview",
            (SELECT COUNT(*)::bigint FROM payment_intents WHERE status IN ('CREATED', 'LINK_READY', 'PENDING')) AS "paymentPending",
            (SELECT COUNT(*)::bigint FROM payment_intents WHERE status = 'UNKNOWN_RESULT') AS "paymentUnknownResult",
            (SELECT COUNT(*)::bigint FROM payment_intents WHERE status = 'FINANCIAL_REVIEW_REQUIRED') AS "paymentFinancialReview"
        )
        SELECT * FROM notification CROSS JOIN webhook CROSS JOIN inbound CROSS JOIN command CROSS JOIN commerce
      `);
      const row = rows[0];
      if (!row) return this.unavailable(now);
      return {
        available: true,
        collectedAt: now.toISOString(),
        notifications: {
          active: this.count(row.notificationActive),
          pending: this.count(row.notificationPending),
          claimed: this.count(row.notificationClaimed),
          commandPending: this.count(row.notificationCommandPending),
          dispatched: this.count(row.notificationDispatched),
          failed: this.count(row.notificationFailed),
          unknownResult: this.count(row.notificationUnknownResult),
          expiredLeases: this.count(row.notificationExpiredLeases),
          retryReady: this.count(row.notificationRetryReady),
          oldestActiveAgeSeconds: this.age(row.notificationOldestAgeSeconds),
        },
        paymentWebhooks: {
          active: this.count(row.webhookActive),
          retryReady: this.count(row.webhookRetryReady),
          expiredLeases: this.count(row.webhookExpiredLeases),
          financialReviewRequired: this.count(row.webhookFinancialReview),
          invalidRecent: this.count(row.webhookInvalidRecent),
          oldestActiveAgeSeconds: this.age(row.webhookOldestAgeSeconds),
        },
        whatsappInbound: {
          active: this.count(row.inboundActive),
          retryReady: this.count(row.inboundRetryReady),
          expiredLeases: this.count(row.inboundExpiredLeases),
          attemptsExhausted: this.count(row.inboundAttemptsExhausted),
          missingDeterministicResult: this.count(row.inboundMissingResult),
          oldestActiveAgeSeconds: this.age(row.inboundOldestAgeSeconds),
        },
        secureCommands: {
          active: this.count(row.commandActive),
          failed: this.count(row.commandFailed),
          retryReady: this.count(row.commandRetryReady),
          expiredLeases: this.count(row.commandExpiredLeases),
          unknownResult: this.count(row.commandUnknownResult),
          oldestActiveAgeSeconds: this.age(row.commandOldestAgeSeconds),
        },
        commerce: {
          checkoutPaymentPending: this.count(row.checkoutPaymentPending),
          checkoutFinancialReviewRequired: this.count(row.checkoutFinancialReview),
          paymentPending: this.count(row.paymentPending),
          paymentUnknownResult: this.count(row.paymentUnknownResult),
          paymentFinancialReviewRequired: this.count(row.paymentFinancialReview),
        },
      };
    } catch {
      return this.unavailable(now);
    }
  }

  private unavailable(now: Date): OperationalBacklogSnapshot {
    return {
      available: false,
      collectedAt: now.toISOString(),
      ...EMPTY_SNAPSHOT,
    };
  }

  private count(value: bigint): number {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  }

  private age(value: number): number {
    const age = Number(value);
    return Number.isFinite(age) && age > 0 ? Math.round(age * 100) / 100 : 0;
  }
}
