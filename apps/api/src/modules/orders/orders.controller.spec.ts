import { BadRequestException } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import type { OrdersService } from './orders.service';

describe('OrdersController operational search transport', () => {
  function harness() {
    const orders = {
      listOperational: jest.fn().mockResolvedValue({ items: [], page: 1, limit: 25, total: 0 }),
      listKitchenQueue: jest.fn().mockResolvedValue({ items: [], page: 1, limit: 25, total: 0 }),
    };
    return {
      controller: new OrdersController(orders as unknown as OrdersService),
      orders,
    };
  }

  it('rejects a text search in a GET URL before querying operational records', () => {
    const { controller, orders } = harness();

    expect(() => controller.listOperational({ page: 1, limit: 25, q: '+573001234567' }))
      .toThrow(BadRequestException);
    expect(orders.listOperational).not.toHaveBeenCalled();
  });

  it('accepts the same authorized search through the POST request body', async () => {
    const { controller, orders } = harness();
    const query = { page: 1, limit: 25, q: '+573001234567' };

    await expect(controller.searchOperational(query)).resolves.toEqual({
      items: [], page: 1, limit: 25, total: 0,
    });
    expect(orders.listOperational).toHaveBeenCalledWith(query);
  });

  it('keeps kitchen text search out of URL transport too', () => {
    const { controller, orders } = harness();

    expect(() => controller.listKitchenQueue({ page: 1, limit: 25, q: '+573001234567' }))
      .toThrow(BadRequestException);
    expect(orders.listKitchenQueue).not.toHaveBeenCalled();
  });
});
