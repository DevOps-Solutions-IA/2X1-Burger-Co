import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { CustomerServiceController } from '../../modules/customer-service/customer-service.controller';
import { AdminPaymentReadController } from '../../modules/order-checkout/admin-payment-read.controller';
import { OrdersController } from '../../modules/orders/orders.controller';
import { ReportsController } from '../../modules/reports/reports.controller';
import { GlobalSearchController } from '../../modules/search/global-search.controller';
import { SofiaCrmController } from '../../modules/sofia/crm/sofia-crm.controller';
import { SofiaController } from '../../modules/sofia/sofia.controller';
import { SofiaWhatsappQrGatewayController } from '../../modules/sofia/whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.controller';

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
    expect(permissions(GlobalSearchController)).toEqual(['orders.read']);
    expect(permissions(SofiaController)).toEqual(['orders.read']);
    expect(permissions(SofiaWhatsappQrGatewayController)).toEqual(['settings.read']);
  });

  it('requires mutation capabilities for high-risk operational transitions', () => {
    expect(permissions(method(CustomerServiceController.prototype, 'get'))).toEqual(['reports.read']);
    expect(permissions(method(CustomerServiceController.prototype, 'transition'))).toEqual(['orders.update']);
    expect(permissions(method(OrdersController.prototype, 'transitionKitchen'))).toEqual(['orders.update']);
    expect(permissions(method(OrdersController.prototype, 'checkout'))).toEqual(['orders.checkout']);
    expect(permissions(method(OrdersController.prototype, 'assignRider'))).toEqual(['delivery.assign']);
    expect(permissions(method(OrdersController.prototype, 'updateDeliveryWorkflow'))).toEqual(['delivery.update']);
    expect(permissions(method(OrdersController.prototype, 'updateOperationalAlert'))).toEqual(['orders.update']);
    expect(permissions(method(OrdersController.prototype, 'findOrCreateCustomer'))).toEqual(['orders.create']);
    expect(permissions(method(SofiaCrmController.prototype, 'grantOptIn'))).toEqual(['orders.update']);
    expect(permissions(method(SofiaCrmController.prototype, 'createLead'))).toEqual(['orders.update']);
    expect(permissions(method(SofiaCrmController.prototype, 'updateTask'))).toEqual(['orders.update']);
    expect(permissions(method(SofiaController.prototype, 'pauseGlobal'))).toEqual(['settings.update']);
    expect(permissions(method(SofiaController.prototype, 'activateKillSwitch'))).toEqual(['settings.update']);
    expect(permissions(method(SofiaController.prototype, 'pauseGovernance'))).toEqual(['settings.update']);
    expect(permissions(method(SofiaController.prototype, 'resumeGovernance'))).toEqual(['settings.update']);
    expect(permissions(method(SofiaController.prototype, 'updateGovernanceSettings'))).toEqual(['settings.update']);
    expect(permissions(method(SofiaController.prototype, 'handoff'))).toEqual(['orders.update']);
    expect(permissions(method(SofiaController.prototype, 'confirmDraft'))).toEqual(['orders.update']);
    expect(permissions(method(SofiaController.prototype, 'updateDeliveryOrderStatus'))).toEqual(['delivery.update']);
    expect(permissions(method(ReportsController.prototype, 'createSupplierNotification'))).toEqual(['suppliers.update']);
    expect(permissions(method(ReportsController.prototype, 'getOperationalPdf'))).toEqual(['reports.pdf']);
    expect(permissions(method(SofiaWhatsappQrGatewayController.prototype, 'connect'))).toEqual(['settings.update']);
    expect(permissions(method(SofiaWhatsappQrGatewayController.prototype, 'logout'))).toEqual(['settings.update']);
  });
});
