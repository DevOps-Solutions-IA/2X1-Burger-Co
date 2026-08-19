import { Injectable } from '@nestjs/common';
import { DeliveryWorkflowStatus, OrderTicketStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DeliveryWorkflowError,
  DeliveryWorkflowRepository,
  type DeliveryWorkflowDecision,
  type DeliveryWorkflowTransitionResult,
  type PersistDeliveryWorkflowTransition,
} from './delivery-workflow.repository';

@Injectable()
export class PrismaDeliveryWorkflowRepository extends DeliveryWorkflowRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async transition(
    input: PersistDeliveryWorkflowTransition,
    decide: DeliveryWorkflowDecision,
  ): Promise<DeliveryWorkflowTransitionResult> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const replay = await tx.deliveryWorkflowEvent.findUnique({
            where: {
              orderTicketId_idempotencyKey: {
                orderTicketId: input.orderTicketId,
                idempotencyKey: input.idempotencyKey,
              },
            },
          });
          if (replay) return this.replayResult(input, replay);

          const order = await tx.orderTicket.findUnique({
            where: { id: input.orderTicketId },
            select: {
              id: true,
              type: true,
              status: true,
              assignedRiderId: true,
              deliveryWorkflowStatus: true,
              deliveryWorkflowVersion: true,
              deliveryDispatchedAt: true,
              deliveryDeliveredAt: true,
            },
          });
          if (!order) throw new DeliveryWorkflowError('DELIVERY_WORKFLOW_NOT_FOUND');
          if (order.deliveryWorkflowVersion !== input.expectedVersion) {
            throw new DeliveryWorkflowError('STALE_DELIVERY_WORKFLOW_VERSION');
          }

          const decision = decide({
            orderTicketId: order.id,
            currentStatus: order.deliveryWorkflowStatus,
            version: order.deliveryWorkflowVersion,
            fulfillment: order.type,
            orderStatus: order.status,
            hasAssignedRider: order.assignedRiderId !== null,
            assignedRiderId: order.assignedRiderId,
          });
          if (!decision.allowed) throw new DeliveryWorkflowError(decision.reason);

          // A persisted null state is initialized as PENDING_ASSIGNMENT, not treated as a no-op.
          if (decision.noOp && order.deliveryWorkflowStatus !== null) {
            const riderUnchanged =
              input.assignedRiderId === undefined || input.assignedRiderId === order.assignedRiderId;
            if (riderUnchanged) {
              return {
                state: 'NO_OP',
                orderTicketId: order.id,
                fromStatus: order.deliveryWorkflowStatus,
                toStatus: input.toStatus,
                version: order.deliveryWorkflowVersion,
                idempotencyKey: input.idempotencyKey,
              };
            }
            // Same-status resubmission (current === next) that targets a
            // *different* rider than the one already on the order is not an
            // idempotent replay: it is a conflicting/duplicate assignment
            // attempt (e.g. a second rider or a stale caller trying to take
            // over an order that is already ASSIGNED/IN_TRANSIT). The policy
            // layer only compares status enums and cannot see rider
            // identity, so this must fail closed here instead of silently
            // falling through to the mutation below and overwriting the
            // existing rider.
            throw new DeliveryWorkflowError('RIDER_ALREADY_ASSIGNED');
          }

          const nextVersion = order.deliveryWorkflowVersion + 1;
          const transitionedAt = new Date();
          const changed = await tx.orderTicket.updateMany({
            where: {
              id: order.id,
              deliveryWorkflowVersion: input.expectedVersion,
              deliveryWorkflowStatus: order.deliveryWorkflowStatus,
            },
            data: {
              deliveryWorkflowStatus: input.toStatus,
              deliveryWorkflowVersion: { increment: 1 },
              deliveryStatusUpdatedAt: transitionedAt,
              deliveryDispatchedAt:
                input.toStatus === DeliveryWorkflowStatus.IN_TRANSIT
                  ? order.deliveryDispatchedAt ?? transitionedAt
                  : input.toStatus === DeliveryWorkflowStatus.PENDING_ASSIGNMENT || input.toStatus === DeliveryWorkflowStatus.ASSIGNED
                    ? null
                    : undefined,
              deliveryDeliveredAt:
                input.toStatus === DeliveryWorkflowStatus.DELIVERED
                  ? order.deliveryDeliveredAt ?? transitionedAt
                  : input.toStatus !== DeliveryWorkflowStatus.ISSUE
                    ? null
                    : undefined,
              deliveryIssueAt: input.toStatus === DeliveryWorkflowStatus.ISSUE ? transitionedAt : null,
              assignedRiderId: input.assignedRiderId,
              assignedRiderAt:
                input.assignedRiderId === undefined
                  ? undefined
                  : input.assignedRiderId === null
                    ? null
                    : transitionedAt,
              status:
                input.toStatus === DeliveryWorkflowStatus.DELIVERED
                && order.status !== OrderTicketStatus.PAID
                && order.status !== OrderTicketStatus.CANCELLED
                  ? OrderTicketStatus.PAYMENT_PENDING
                  : undefined,
              revision: { increment: 1 },
            },
          });

          if (changed.count !== 1) {
            const concurrentReplay = await tx.deliveryWorkflowEvent.findUnique({
              where: {
                orderTicketId_idempotencyKey: {
                  orderTicketId: input.orderTicketId,
                  idempotencyKey: input.idempotencyKey,
                },
              },
            });
            if (concurrentReplay) return this.replayResult(input, concurrentReplay);
            throw new DeliveryWorkflowError('STALE_DELIVERY_WORKFLOW_VERSION');
          }

          const event = await tx.deliveryWorkflowEvent.create({
            data: {
              orderTicketId: order.id,
              version: nextVersion,
              idempotencyKey: input.idempotencyKey,
              fromStatus: order.deliveryWorkflowStatus,
              toStatus: input.toStatus,
              actorId: input.actorId ?? null,
              reasonCode: input.reasonCode,
              ...(input.sanitizedMetadata
                ? {
                    sanitizedMetadata:
                      input.sanitizedMetadata as unknown as Prisma.InputJsonObject,
                  }
                : {}),
            },
          });

          return {
            state: 'APPLIED',
            orderTicketId: order.id,
            fromStatus: event.fromStatus,
            toStatus: event.toStatus,
            version: event.version,
            idempotencyKey: event.idempotencyKey,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof DeliveryWorkflowError) throw error;
      if (this.isConcurrentWrite(error)) {
        const replay = await this.prisma.deliveryWorkflowEvent.findUnique({
          where: {
            orderTicketId_idempotencyKey: {
              orderTicketId: input.orderTicketId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (replay) return this.replayResult(input, replay);
        throw new DeliveryWorkflowError('STALE_DELIVERY_WORKFLOW_VERSION');
      }
      throw error;
    }
  }

  private replayResult(
    input: PersistDeliveryWorkflowTransition,
    event: {
      orderTicketId: string;
      version: number;
      idempotencyKey: string;
      fromStatus: DeliveryWorkflowStatus | null;
      toStatus: DeliveryWorkflowStatus;
    },
  ): DeliveryWorkflowTransitionResult {
    if (
      event.toStatus !== input.toStatus ||
      event.version !== input.expectedVersion + 1
    ) {
      throw new DeliveryWorkflowError('DELIVERY_WORKFLOW_IDEMPOTENCY_CONFLICT');
    }
    return {
      state: 'DETERMINISTIC_REPLAY',
      orderTicketId: event.orderTicketId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      version: event.version,
      idempotencyKey: event.idempotencyKey,
    };
  }

  private isConcurrentWrite(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    );
  }
}
