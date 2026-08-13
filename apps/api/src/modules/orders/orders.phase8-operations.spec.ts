import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OrderTicketStatus, OrderTicketType } from '@prisma/client';
import { OrdersService } from './orders.service';

describe('OrdersService Phase 8 kitchen authority', () => {
  const supervisor = {
    sub: 'operator-1',
    email: 'operator@example.test',
    fullName: 'Operador',
    sessionVersion: 1,
    roles: ['supervisor'],
    permissions: [],
  };
  const waiter = { ...supervisor, sub: 'waiter-1', roles: ['waiter'] };

  function harness(order: { status: OrderTicketStatus; revision: number }, updateCount = 1) {
    const updated = {
      id: 'order-1',
      type: OrderTicketType.TAKEAWAY,
      status:
        order.status === OrderTicketStatus.OPEN
          ? OrderTicketStatus.IN_PREPARATION
          : OrderTicketStatus.SERVED,
      revision: order.revision + 1,
    };
    const tx = {
      orderTicket: {
        updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updated),
      },
    };
    const prisma = {
      orderTicket: {
        findUnique: jest.fn().mockResolvedValue({ id: 'order-1', ...order }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const realtime = {
      publishOrderUpdated: jest.fn(),
      publishOperationalRefresh: jest.fn(),
    };
    const service = new OrdersService(
      prisma as never,
      audit as never,
      {} as never,
      realtime as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { audit, prisma, realtime, service, tx, updated };
  }

  it('applies START_PREPARATION through one atomic status-and-revision authority', async () => {
    const { audit, realtime, service, tx, updated } = harness({
      status: OrderTicketStatus.OPEN,
      revision: 4,
    });

    await expect(service.transitionKitchen(
      'order-1',
      { action: 'START_PREPARATION', expectedRevision: 4 },
      supervisor,
    )).resolves.toEqual(updated);

    expect(tx.orderTicket.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        revision: 4,
        status: OrderTicketStatus.OPEN,
      },
      data: {
        status: OrderTicketStatus.IN_PREPARATION,
        servedAt: undefined,
        revision: { increment: 1 },
      },
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'KITCHEN_TRANSITION',
      entityId: 'order-1',
      oldValues: { status: OrderTicketStatus.OPEN, revision: 4 },
      newValues: {
        status: OrderTicketStatus.IN_PREPARATION,
        revision: 5,
        action: 'START_PREPARATION',
      },
    }), tx);
    expect(realtime.publishOrderUpdated).toHaveBeenCalledTimes(1);
  });

  it('does not publish realtime when transactional audit creation fails', async () => {
    const { audit, realtime, service, tx } = harness({
      status: OrderTicketStatus.OPEN,
      revision: 4,
    });
    audit.log.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.transitionKitchen(
      'order-1',
      { action: 'START_PREPARATION', expectedRevision: 4 },
      supervisor,
    )).rejects.toThrow('audit unavailable');

    expect(audit.log).toHaveBeenCalledWith(expect.any(Object), tx);
    expect(realtime.publishOrderUpdated).not.toHaveBeenCalled();
    expect(realtime.publishOperationalRefresh).not.toHaveBeenCalled();
  });

  it('rejects stale, out-of-order and lost-race transitions', async () => {
    const stale = harness({ status: OrderTicketStatus.OPEN, revision: 5 });
    await expect(stale.service.transitionKitchen(
      'order-1',
      { action: 'START_PREPARATION', expectedRevision: 4 },
      supervisor,
    )).rejects.toMatchObject({ response: { code: 'STALE_ORDER_REVISION' } });
    expect(stale.prisma.$transaction).not.toHaveBeenCalled();

    const outOfOrder = harness({ status: OrderTicketStatus.OPEN, revision: 4 });
    await expect(outOfOrder.service.transitionKitchen(
      'order-1',
      { action: 'MARK_READY', expectedRevision: 4 },
      supervisor,
    )).rejects.toMatchObject({ response: { code: 'KITCHEN_TRANSITION_BLOCKED' } });
    expect(outOfOrder.prisma.$transaction).not.toHaveBeenCalled();

    const race = harness({ status: OrderTicketStatus.OPEN, revision: 4 }, 0);
    await expect(race.service.transitionKitchen(
      'order-1',
      { action: 'START_PREPARATION', expectedRevision: 4 },
      supervisor,
    )).rejects.toMatchObject({ response: { code: 'STALE_ORDER_REVISION' } });
    expect(race.tx.orderTicket.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('rejects waiter kitchen transitions before reading or mutating an order', async () => {
    const { prisma, service, tx } = harness({ status: OrderTicketStatus.OPEN, revision: 4 });

    await expect(service.transitionKitchen(
      'order-1',
      { action: 'START_PREPARATION', expectedRevision: 4 },
      waiter,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.orderTicket.findUnique).not.toHaveBeenCalled();
    expect(tx.orderTicket.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [OrderTicketStatus.OPEN, OrderTicketStatus.SERVED],
    [OrderTicketStatus.OPEN, OrderTicketStatus.IN_PREPARATION],
    [OrderTicketStatus.IN_PREPARATION, OrderTicketStatus.OPEN],
    [OrderTicketStatus.IN_PREPARATION, OrderTicketStatus.SERVED],
  ])('rejects generic %s -> %s changes before transaction mutation', async (current, requested) => {
    const { prisma, service } = harness({ status: current, revision: 4 });

    await expect(service.update(
      'order-1',
      { status: requested, expectedRevision: 4 },
      supervisor,
    )).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('loads bounded canonical checkout payment truth in order detail', async () => {
    const canonicalOrder = {
      id: 'order-1',
      orderCheckout: {
        id: 'checkout-1',
        status: 'FINANCIAL_REVIEW_REQUIRED',
        paymentPreference: 'ONLINE',
        total: 30_000,
        currency: 'COP',
        paymentIntents: [{
          id: 'intent-2',
          attemptNumber: 2,
          provider: 'BOLD',
          amount: 30_000,
          currency: 'COP',
          status: 'UNKNOWN_RESULT',
          failureCode: 'PROVIDER_TIMEOUT',
          completedAt: null,
          updatedAt: new Date('2026-08-13T00:00:00.000Z'),
        }],
      },
    };
    const prisma = {
      orderTicket: { findUnique: jest.fn().mockResolvedValue(canonicalOrder) },
    };
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

    await expect(service.findOne('order-1')).resolves.toEqual(canonicalOrder);
    expect(prisma.orderTicket.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1' },
      include: expect.objectContaining({
        orderCheckout: {
          select: expect.objectContaining({
            id: true,
            status: true,
            paymentPreference: true,
            total: true,
            currency: true,
            paymentIntents: {
              select: expect.objectContaining({
                id: true,
                attemptNumber: true,
                provider: true,
                amount: true,
                currency: true,
                status: true,
              }),
              orderBy: { attemptNumber: 'desc' },
              take: 10,
            },
          }),
        },
      }),
    }));
  });
});
