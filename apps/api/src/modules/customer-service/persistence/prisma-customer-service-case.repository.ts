import { Injectable } from '@nestjs/common';
import {
  type CustomerServiceCase as PrismaCaseRow,
  CustomerServiceCaseCategory as PrismaCaseCategory,
  CustomerServiceCaseStatus as PrismaCaseStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  type CreateCustomerServiceCase,
  type CustomerServiceCaseRecord,
  type CustomerServiceCaseWriteResult,
  CustomerServiceCaseRepository,
  type TransitionCustomerServiceCase,
} from './customer-service-case.repository';

export class CustomerServiceCasePersistenceError extends Error {
  constructor(readonly code: 'CASE_IDEMPOTENCY_CONFLICT' | 'CASE_NOT_FOUND' | 'STALE_CASE_VERSION') {
    super(code);
    this.name = 'CustomerServiceCasePersistenceError';
  }
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === 'P2002'
    : Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

function sameCreateIdentity(row: PrismaCaseRow, input: CreateCustomerServiceCase): boolean {
  return row.category === input.category
    && row.evidenceHash === input.evidenceHash
    && row.sanitizedSummary === input.sanitizedSummary
    && row.customerId === (input.customerId ?? null)
    && row.conversationId === (input.conversationId ?? null)
    && row.orderCheckoutId === (input.orderCheckoutId ?? null)
    && row.orderTicketId === (input.orderTicketId ?? null)
    && row.paymentIntentId === (input.paymentIntentId ?? null)
    && row.deliveryIssueId === (input.deliveryIssueId ?? null);
}

function asRecord(row: PrismaCaseRow): CustomerServiceCaseRecord {
  return row as CustomerServiceCaseRecord;
}

@Injectable()
export class PrismaCustomerServiceCaseRepository extends CustomerServiceCaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async createIdempotent(input: CreateCustomerServiceCase): Promise<CustomerServiceCaseWriteResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.customerServiceCase.findUnique({
          where: { source_sourceReference: { source: input.source, sourceReference: input.sourceReference } },
        });
        if (existing) return this.createReplay(existing, input);

        const serviceCase = await tx.customerServiceCase.create({
          data: {
            category: input.category as PrismaCaseCategory,
            source: input.source,
            sourceReference: input.sourceReference,
            evidenceHash: input.evidenceHash,
            sanitizedSummary: input.sanitizedSummary,
            customerId: input.customerId ?? null,
            conversationId: input.conversationId ?? null,
            orderCheckoutId: input.orderCheckoutId ?? null,
            orderTicketId: input.orderTicketId ?? null,
            paymentIntentId: input.paymentIntentId ?? null,
            deliveryIssueId: input.deliveryIssueId ?? null,
          },
        });
        await tx.customerServiceCaseEvent.create({
          data: {
            caseId: serviceCase.id,
            version: 0,
            idempotencyKey: input.idempotencyKey,
            action: 'CASE_CREATED',
            fromStatus: null,
            toStatus: PrismaCaseStatus.OPEN,
            reasonCode: 'CUSTOMER_SERVICE_CASE_OPENED',
            sanitizedMetadata: input.sanitizedMetadata ?? Prisma.JsonNull,
          },
        });
        return { state: 'CREATED', serviceCase: asRecord(serviceCase) };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const existing = await this.prisma.customerServiceCase.findUnique({
        where: { source_sourceReference: { source: input.source, sourceReference: input.sourceReference } },
      });
      if (!existing) throw error;
      return this.createReplay(existing, input);
    }
  }

  async transition(input: TransitionCustomerServiceCase): Promise<CustomerServiceCaseWriteResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replayEvent = await tx.customerServiceCaseEvent.findUnique({
          where: { caseId_idempotencyKey: { caseId: input.caseId, idempotencyKey: input.idempotencyKey } },
        });
        if (replayEvent) return this.transitionReplay(tx, replayEvent, input);

        const current = await tx.customerServiceCase.findUnique({ where: { id: input.caseId } });
        if (!current) throw new CustomerServiceCasePersistenceError('CASE_NOT_FOUND');
        if (current.version !== input.expectedVersion || current.status !== input.fromStatus) {
          throw new CustomerServiceCasePersistenceError('STALE_CASE_VERSION');
        }

        const now = new Date();
        const changed = await tx.customerServiceCase.updateMany({
          where: {
            id: input.caseId,
            version: input.expectedVersion,
            status: input.fromStatus as PrismaCaseStatus,
          },
          data: {
            status: input.toStatus as PrismaCaseStatus,
            version: { increment: 1 },
            assignedActorId: input.toStatus === 'HUMAN_TAKEN' ? (input.actorId ?? null) : undefined,
            resolutionActorId: input.toStatus === 'RESOLVED' ? (input.actorId ?? null) : undefined,
            resolutionCode: input.toStatus === 'RESOLVED' ? (input.resolutionCode ?? null) : undefined,
            resolvedAt: input.toStatus === 'RESOLVED' ? now : undefined,
            closedAt: input.toStatus === 'CLOSED' ? now : undefined,
          },
        });
        if (changed.count !== 1) throw new CustomerServiceCasePersistenceError('STALE_CASE_VERSION');

        await tx.customerServiceCaseEvent.create({
          data: {
            caseId: input.caseId,
            version: input.expectedVersion + 1,
            idempotencyKey: input.idempotencyKey,
            action: input.action,
            fromStatus: input.fromStatus as PrismaCaseStatus,
            toStatus: input.toStatus as PrismaCaseStatus,
            actorId: input.actorId ?? null,
            reasonCode: input.reasonCode,
            sanitizedMetadata: input.sanitizedMetadata ?? Prisma.JsonNull,
          },
        });
        const serviceCase = await tx.customerServiceCase.findUniqueOrThrow({ where: { id: input.caseId } });
        return { state: 'UPDATED', serviceCase: asRecord(serviceCase) };
      });
    } catch (error) {
      if (!isUniqueConflict(error) && !(error instanceof CustomerServiceCasePersistenceError && error.code === 'STALE_CASE_VERSION')) {
        throw error;
      }
      const replayEvent = await this.prisma.customerServiceCaseEvent.findUnique({
        where: { caseId_idempotencyKey: { caseId: input.caseId, idempotencyKey: input.idempotencyKey } },
      });
      if (!replayEvent) throw error;
      return this.transitionReplay(this.prisma, replayEvent, input);
    }
  }

  private createReplay(row: PrismaCaseRow, input: CreateCustomerServiceCase): CustomerServiceCaseWriteResult {
    if (!sameCreateIdentity(row, input)) {
      throw new CustomerServiceCasePersistenceError('CASE_IDEMPOTENCY_CONFLICT');
    }
    return { state: 'DETERMINISTIC_REPLAY', serviceCase: asRecord(row) };
  }

  private async transitionReplay(
    client: Pick<Prisma.TransactionClient, 'customerServiceCase'>,
    event: {
      action: string;
      fromStatus: PrismaCaseStatus | null;
      toStatus: PrismaCaseStatus;
      actorId: string | null;
      reasonCode: string;
      sanitizedMetadata: Prisma.JsonValue | null;
    },
    input: TransitionCustomerServiceCase,
  ): Promise<CustomerServiceCaseWriteResult> {
    if (
      event.action !== input.action
      || event.fromStatus !== input.fromStatus
      || event.toStatus !== input.toStatus
      || event.actorId !== (input.actorId ?? null)
      || event.reasonCode !== input.reasonCode
      || JSON.stringify(event.sanitizedMetadata) !== JSON.stringify(input.sanitizedMetadata ?? null)
    ) {
      throw new CustomerServiceCasePersistenceError('CASE_IDEMPOTENCY_CONFLICT');
    }
    const serviceCase = await client.customerServiceCase.findUnique({ where: { id: input.caseId } });
    if (!serviceCase) throw new CustomerServiceCasePersistenceError('CASE_NOT_FOUND');
    if (input.toStatus === 'RESOLVED' && serviceCase.resolutionCode !== (input.resolutionCode ?? null)) {
      throw new CustomerServiceCasePersistenceError('CASE_IDEMPOTENCY_CONFLICT');
    }
    return { state: 'DETERMINISTIC_REPLAY', serviceCase: asRecord(serviceCase) };
  }
}
