import {
  DeliveryWorkflowStatus,
  OrderTicketStatus,
  OrderTicketType,
} from '@prisma/client';
import { DeliveryWorkflowService } from './delivery-workflow.service';
import {
  DeliveryWorkflowError,
  DeliveryWorkflowRepository,
  type DeliveryWorkflowDecision,
  type DeliveryWorkflowSnapshot,
  type PersistDeliveryWorkflowTransition,
} from './persistence/delivery-workflow.repository';

class RepositoryHarness extends DeliveryWorkflowRepository {
  snapshot: DeliveryWorkflowSnapshot = {
    orderTicketId: 'order-1',
    currentStatus: DeliveryWorkflowStatus.ASSIGNED,
    version: 4,
    fulfillment: OrderTicketType.DELIVERY,
    orderStatus: OrderTicketStatus.SERVED,
  hasAssignedRider: true,
  assignedRiderId: 'rider-1',
  };

  transition = jest.fn(
    async (input: PersistDeliveryWorkflowTransition, decide: DeliveryWorkflowDecision) => {
      const decision = decide(this.snapshot);
      if (!decision.allowed) throw new DeliveryWorkflowError(decision.reason);
      return {
        state: 'APPLIED' as const,
        orderTicketId: input.orderTicketId,
        fromStatus: this.snapshot.currentStatus,
        toStatus: input.toStatus,
        version: input.expectedVersion + 1,
        idempotencyKey: input.idempotencyKey,
      };
    },
  );
}

describe('DeliveryWorkflowService', () => {
  const command = {
    orderTicketId: 'order-1',
    expectedVersion: 4,
    toStatus: DeliveryWorkflowStatus.IN_TRANSIT,
    idempotencyKey: 'delivery:order-1:in-transit',
    reasonCode: 'RIDER_DEPARTED',
  };

  it('applies the existing policy to authoritative repository facts', async () => {
    const repository = new RepositoryHarness();
    const service = new DeliveryWorkflowService(repository);

    await expect(service.transition(command)).resolves.toMatchObject({
      state: 'APPLIED',
      version: 5,
      toStatus: DeliveryWorkflowStatus.IN_TRANSIT,
    });
    expect(repository.transition).toHaveBeenCalledTimes(1);
  });

  it('rejects a policy violation before the repository can persist it', async () => {
    const repository = new RepositoryHarness();
    repository.snapshot.orderStatus = OrderTicketStatus.IN_PREPARATION;
    const service = new DeliveryWorkflowService(repository);

    await expect(service.transition(command)).rejects.toMatchObject({ code: 'ORDER_NOT_READY' });
  });

  it('maps a legacy null workflow state to the canonical initial state', async () => {
    const repository = new RepositoryHarness();
    repository.snapshot.currentStatus = null;
    repository.snapshot.version = 0;
    const service = new DeliveryWorkflowService(repository);

    await expect(
      service.transition({
        ...command,
        expectedVersion: 0,
        toStatus: DeliveryWorkflowStatus.ASSIGNED,
      }),
    ).resolves.toMatchObject({ fromStatus: null, version: 1 });
  });

  it('fails closed for malformed idempotency and unbounded metadata', async () => {
    const repository = new RepositoryHarness();
    const service = new DeliveryWorkflowService(repository);

    expect(() => service.transition({ ...command, idempotencyKey: 'short' })).toThrow(
      'INVALID_DELIVERY_WORKFLOW_COMMAND',
    );
    expect(() =>
      service.transition({ ...command, sanitizedMetadata: { note: 'x'.repeat(4_097) } }),
    ).toThrow('INVALID_DELIVERY_WORKFLOW_COMMAND');
    expect(repository.transition).not.toHaveBeenCalled();
  });
});
