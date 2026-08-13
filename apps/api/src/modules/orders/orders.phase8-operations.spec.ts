import { ConflictException } from '@nestjs/common';
import { OrderTicketStatus } from '@prisma/client';
import { OrdersService } from './orders.service';

describe('OrdersService Phase 8 operational contracts', () => {
  const actor = {
    sub: 'operator-1',
    email: 'operator@example.test',
    fullName: 'Operador',
    sessionVersion: 1,
    roles: ['supervisor'],
    permissions: [],
  };

  function harness(order: { status: OrderTicketStatus; revision: number }) {
    const prisma = { orderTicket: { findUnique: jest.fn().mockResolvedValue({ id: 'order-1', ...order }) } };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'update').mockResolvedValue({ id: 'order-1' } as never);
    return { service, prisma };
  }

  it('routes START_PREPARATION through the canonical versioned order update', async () => {
    const { service } = harness({ status: OrderTicketStatus.OPEN, revision: 4 });
    await service.transitionKitchen('order-1', { action: 'START_PREPARATION', expectedRevision: 4 }, actor);

    expect(service.update).toHaveBeenCalledWith('order-1', {
      status: OrderTicketStatus.IN_PREPARATION,
      expectedRevision: 4,
    }, actor);
  });

  it('rejects stale or out-of-order kitchen transitions before mutation', async () => {
    const stale = harness({ status: OrderTicketStatus.OPEN, revision: 5 });
    await expect(stale.service.transitionKitchen(
      'order-1',
      { action: 'START_PREPARATION', expectedRevision: 4 },
      actor,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(stale.service.update).not.toHaveBeenCalled();

    const outOfOrder = harness({ status: OrderTicketStatus.OPEN, revision: 4 });
    await expect(outOfOrder.service.transitionKitchen(
      'order-1',
      { action: 'MARK_READY', expectedRevision: 4 },
      actor,
    )).rejects.toBeInstanceOf(ConflictException);
    expect(outOfOrder.service.update).not.toHaveBeenCalled();
  });
});
