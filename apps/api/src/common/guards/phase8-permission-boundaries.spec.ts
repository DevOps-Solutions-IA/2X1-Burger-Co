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

const sofiaHandlerPermissions: Record<string, string[]> = {
  getActivePrompt: ['settings.read'],
  listPromptVersions: ['settings.read'],
  listCatalog: ['orders.read'],
  findCatalogItem: ['orders.read'],
  processCommercialSandbox: ['orders.update'],
  evaluateAutoSafe: ['orders.update'],
  getAiStatus: ['settings.read'],
  healthCheckAi: ['settings.update'],
  testAiProvider: ['settings.update'],
  getWhatsappStatus: ['settings.read'],
  processAgentMessage: ['orders.update'],
  recoverAbandonedDraft: ['orders.update'],
  listConversations: ['orders.read'],
  getConversationsInbox: ['orders.read'],
  getConversationInbox: ['orders.read'],
  findConversation: ['orders.read'],
  mockInbound: ['orders.update'],
  mockOutbound: ['orders.update'],
  handoff: ['orders.update'],
  resolve: ['orders.update'],
  pauseConversation: ['orders.update'],
  resumeConversation: ['orders.update'],
  takeOverConversation: ['orders.update'],
  releaseConversation: ['orders.update'],
  approveOutbound: ['orders.update'],
  cancelOutbound: ['orders.update'],
  retryOutbound: ['orders.update'],
  createDraft: ['orders.create'],
  listDrafts: ['orders.read'],
  findDraft: ['orders.read'],
  updateDraft: ['orders.update'],
  confirmDraft: ['orders.update'],
  cancelDraft: ['orders.update'],
  createDeliveryOrderFromDraft: ['orders.create', 'delivery.update'],
  listDeliveryOrders: ['delivery.read'],
  findDeliveryOrder: ['delivery.read'],
  updateDeliveryOrderStatus: ['delivery.update'],
  getMetricsSummary: ['reports.read'],
  getAutoSafeMetrics: ['reports.read'],
  getConversationMetrics: ['reports.read'],
  getQrMetrics: ['reports.read'],
  getSafetyMetrics: ['reports.read'],
  exportMetricsSanitized: ['reports.read'],
  createLearningFeedback: ['orders.update'],
  listLearningFeedback: ['orders.read'],
  getLearningInsights: ['orders.read'],
  getPrivacyStatus: ['settings.read'],
  redactPreview: ['settings.read'],
  getRetentionStatus: ['settings.read'],
  retentionDryRun: ['settings.read'],
  retentionRun: ['settings.update'],
  listSofiaAlerts: ['settings.read'],
  checkSofiaAlerts: ['settings.update'],
  ackSofiaAlert: ['settings.update'],
  getSofiaBackupsStatus: ['settings.read'],
  runSofiaBackupDryRun: ['settings.update'],
  getSofiaHardeningStatus: ['settings.read'],
  getEnterpriseStatus: ['settings.read'],
  getDashboardSummary: ['orders.read'],
  pauseGlobal: ['settings.update'],
  resumeGlobal: ['settings.update'],
  getControlStatus: ['settings.read'],
  getReadiness: ['settings.read'],
  getGovernanceMetrics: ['settings.read'],
  getSecurityStatus: ['settings.read'],
  getRuntimeSafety: ['settings.read'],
  activateKillSwitch: ['settings.update'],
  deactivateKillSwitch: ['settings.update'],
  getGovernanceEvents: ['settings.read'],
  getGovernanceStatus: ['settings.read'],
  pauseGovernance: ['settings.update'],
  resumeGovernance: ['settings.update'],
  updateGovernanceSettings: ['settings.update'],
};

describe('Phase 8 role and permission intersection', () => {
  it('requires canonical read capabilities on every new operational controller', () => {
    expect(permissions(AdminPaymentReadController)).toEqual(['reports.read']);
    expect(permissions(CustomerServiceController)).toEqual(['orders.read']);
    expect(permissions(SofiaCrmController)).toEqual(['orders.read']);
    expect(permissions(OrdersController)).toEqual(['orders.read']);
    expect(permissions(GlobalSearchController)).toEqual(['orders.read']);
    expect(permissions(SofiaController)).toEqual([]);
    expect(permissions(SofiaWhatsappQrGatewayController)).toEqual(['settings.read']);
  });

  it('assigns an explicit capability to every Sofia route handler', () => {
    const handlers = Object.getOwnPropertyNames(SofiaController.prototype)
      .filter((name) => name !== 'constructor' && typeof SofiaController.prototype[name as keyof SofiaController] === 'function')
      .sort();

    expect(handlers).toEqual(Object.keys(sofiaHandlerPermissions).sort());
    for (const [handler, expected] of Object.entries(sofiaHandlerPermissions)) {
      expect(permissions(method(SofiaController.prototype, handler))).toEqual(expected);
    }
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
