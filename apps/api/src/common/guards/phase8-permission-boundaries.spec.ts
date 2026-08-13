import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { CustomerServiceController } from '../../modules/customer-service/customer-service.controller';
import { AdminPaymentReadController } from '../../modules/order-checkout/admin-payment-read.controller';
import { OrdersController } from '../../modules/orders/orders.controller';
import { SofiaCrmController } from '../../modules/sofia/crm/sofia-crm.controller';

function permissions(target: object): string[] {
  return Reflect.getMetadata(PERMISSIONS_KEY, target) ?? [];
}

function method(controller: object, name: string): object {
  const value = Object.getOwnPropertyDescriptor(controller, name)?.value;
  if (typeof value !== 'function') throw new Error(`Missing controller method ${name}`);
  return value;
}

describe('Phase 8 role and permission intersection', () => {
  it('requires canonical read capabilities on every new operational controller', () => {
    expect(permissions(AdminPaymentReadController)).toEqual(['reports.read']);
    expect(permissions(CustomerServiceController)).toEqual(['orders.read']);
    expect(permissions(SofiaCrmController)).toEqual(['orders.read']);
    expect(permissions(OrdersController)).toEqual(['orders.read']);
  });

  it('requires mutation capabilities for high-risk operational transitions', () => {
    expect(permissions(method(CustomerServiceController.prototype, 'transition'))).toEqual(['orders.update']);
    expect(permissions(method(OrdersController.prototype, 'transitionKitchen'))).toEqual(['orders.update']);
    expect(permissions(method(OrdersController.prototype, 'checkout'))).toEqual(['orders.checkout']);
    expect(permissions(method(OrdersController.prototype, 'assignRider'))).toEqual(['delivery.assign']);
    expect(permissions(method(OrdersController.prototype, 'updateDeliveryWorkflow'))).toEqual(['delivery.update']);
  });
});
