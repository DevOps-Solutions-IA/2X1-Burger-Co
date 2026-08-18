import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryWorkflowStatus, OrderTicketStatus, OrderTicketType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import type { CommandHandlerResult, CommandRecord } from '../../secure-command/secure-command.types';
import { DeliveryWorkflowService } from '../delivery-workflow.service';
import { DeliveryWorkflowError } from '../persistence/delivery-workflow.repository';

/**
 * SOFIA_ASSIGN_DELIVERY command handler.
 *
 * PREPRODUCTION_TEMPORARY_GATE: this handler is fully production-capable and is
 * exercised by tests, but it is only ever reachable through SecureCommand's
 * `CommandHandlerRegistry`. That registry currently keeps `SOFIA_ASSIGN_DELIVERY`
 * inside `BLOCKED_TYPES` with `enabled: false`, so `CommandPolicyService` rejects
 * every command of this type at the RECEIVE stage — this handler can never
 * execute until an owner-authorized activation phase enables the command type
 * and wires a real caller. No production env flag was added for this gate
 * (apps/api/src/config/env.ts was intentionally left untouched).
 *
 * Domain authority is fully reused, not duplicated:
 * - The state machine, optimistic concurrency and idempotent replay live in
 *   `DeliveryWorkflowService` / `PrismaDeliveryWorkflowRepository` (unchanged).
 * - Audit log entries, operational alerts and customer notifications for the
 *   resulting `DeliveryWorkflowEvent` are produced asynchronously by the
 *   existing `DeliveryWorkflowConsequenceWorker` (owned by Orders, unchanged),
 *   which polls `delivery_workflow_events` for any event — regardless of who
 *   created it — that has no matching audit/notification yet. This handler
 *   does not need to (and must not) duplicate that reconciliation logic.
 *
 * Payload binding: SecureCommand never persists a command's plaintext payload,
 * only its hash (see `CommandRedactionService.payloadHash`). Because there is
 * no pre-existing "pending delivery assignment" domain row to bind against
 * (unlike WhatsApp's pre-created outbound message), the assignment target is
 * carried directly in the command's own tamper-evident fields instead of a
 * new table:
 *   - target.type            = 'DELIVERY_WORKFLOW'
 *   - target.id               = `${orderTicketId}:${riderId}`
 *   - target.expectedVersion  = current `deliveryWorkflowVersion` (string)
 * The caller must submit `receive()` with a payload whose canonical JSON is
 * exactly `{ commandType, orderTicketId, riderId, expectedVersion }` (all
 * plain strings). This handler independently recomputes that same canonical
 * hash from the trusted, persisted command fields and rejects any mismatch —
 * mirroring `WhatsappOutboundCommandHandler`'s binding-verification pattern.
 */
@Injectable()
export class DeliveryAssignmentCommandHandler {
  // Order/rider ids are Prisma cuid()s, not UUIDs; accept the same charset
  // SecureCommand itself allows for target identifiers.
  private static readonly TARGET_ID_PATTERN =
    /^([A-Za-z0-9._-]{1,64}):([A-Za-z0-9._-]{1,64})$/;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveryWorkflow: DeliveryWorkflowService,
  ) {}

  async execute(command: CommandRecord): Promise<CommandHandlerResult> {
    if (command.commandType !== 'SOFIA_ASSIGN_DELIVERY') {
      throw new ForbiddenException({ code: 'SOFIA_COMMAND_POLICY_BLOCKED' });
    }

    const match = command.targetId
      ? DeliveryAssignmentCommandHandler.TARGET_ID_PATTERN.exec(command.targetId)
      : null;
    if (!match || !command.expectedVersion) {
      throw new NotFoundException({ code: 'DELIVERY_ASSIGNMENT_TARGET_INVALID' });
    }
    const [, orderTicketId, riderId] = match;
    if (!orderTicketId || !riderId) {
      throw new NotFoundException({ code: 'DELIVERY_ASSIGNMENT_TARGET_INVALID' });
    }

    const expectedPayloadHash = this.hashCanonical({
      commandType: command.commandType,
      orderTicketId,
      riderId,
      expectedVersion: command.expectedVersion,
    });
    if (command.payloadHash !== expectedPayloadHash) {
      throw new ForbiddenException({ code: 'DELIVERY_ASSIGNMENT_PAYLOAD_BINDING_INVALID' });
    }

    const order = await this.prisma.orderTicket.findUnique({
      where: { id: orderTicketId },
      select: {
        id: true,
        type: true,
        status: true,
        deliveryWorkflowVersion: true,
        assignedRiderId: true,
      },
    });
    if (!order) {
      throw new NotFoundException({ code: 'DELIVERY_ASSIGNMENT_ORDER_NOT_FOUND' });
    }
    if (order.type !== OrderTicketType.DELIVERY) {
      throw new ForbiddenException({ code: 'DELIVERY_ASSIGNMENT_NOT_DELIVERY_FULFILLMENT' });
    }
    if (order.status === OrderTicketStatus.PAID || order.status === OrderTicketStatus.CANCELLED) {
      throw new ForbiddenException({ code: 'DELIVERY_ASSIGNMENT_ORDER_CLOSED' });
    }
    if (String(order.deliveryWorkflowVersion) !== command.expectedVersion) {
      throw new ConflictException({ code: 'DELIVERY_ASSIGNMENT_VERSION_CONFLICT' });
    }

    const rider = await this.prisma.user.findUnique({
      where: { id: riderId },
      include: { roles: { include: { role: true } } },
    });
    if (!rider || !rider.isActive || !rider.roles.some(({ role }) => role.name === 'delivery')) {
      throw new ForbiddenException({ code: 'DELIVERY_ASSIGNMENT_RIDER_INVALID' });
    }

    let transition;
    try {
      transition = await this.deliveryWorkflow.transition({
        orderTicketId,
        expectedVersion: order.deliveryWorkflowVersion,
        toStatus: DeliveryWorkflowStatus.ASSIGNED,
        assignedRiderId: riderId,
        actorId: command.actorId,
        reasonCode: 'SOFIA_DELIVERY_RIDER_ASSIGNED',
        idempotencyKey: `delivery:sofia-assign:${orderTicketId}:${order.deliveryWorkflowVersion}:${riderId}`,
        sanitizedMetadata: {
          previousAssignedRiderId: order.assignedRiderId,
          assignedRiderId: riderId,
          source: 'SOFIA_SECURE_COMMAND',
          commandId: command.id,
        },
      });
    } catch (error) {
      if (error instanceof DeliveryWorkflowError) {
        if (
          error.code === 'STALE_DELIVERY_WORKFLOW_VERSION' ||
          error.code === 'DELIVERY_WORKFLOW_IDEMPOTENCY_CONFLICT'
        ) {
          throw new ConflictException({ code: error.code });
        }
        throw new ForbiddenException({ code: error.code });
      }
      throw error;
    }

    return {
      resultCode:
        transition.state === 'NO_OP' ? 'SOFIA_DELIVERY_ASSIGNMENT_NO_OP' : 'SOFIA_DELIVERY_ASSIGNED',
      payload: {
        orderTicketId,
        riderId,
        workflowVersion: transition.version,
        toStatus: transition.toStatus,
        state: transition.state,
      },
      domainReferenceIds: [orderTicketId],
    };
  }

  /**
   * Local, dependency-free reimplementation of
   * `CommandRedactionService`'s canonicalization for flat string-only
   * payloads (no PII/secret-flagged keys involved here), matching the
   * pattern already used by `WhatsappOutboundCommandHandler`. This avoids
   * importing SecureCommandModule into DeliveryOperationsModule, which would
   * create a module cycle (SecureCommandModule already needs to import
   * DeliveryOperationsModule to obtain this handler).
   */
  private hashCanonical(value: Record<string, string>): string {
    const canonical = Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
    );
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
}
