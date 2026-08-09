import { WhatsappService } from './whatsapp.service';

describe('WhatsappService legacy outbound safety gate', () => {
  const service = new WhatsappService();

  it.each([
    ['sale receipt', () => service.sendSaleReceipt('sale-1', '573000000001', 'actor-1')],
    ['delivery summary', () => service.sendDeliveryOrderSummary('order-1', 'actor-1')],
    ['daily close', () => service.sendClosingSummary('close-1', 'actor-1')],
    ['group link', () => service.linkDailyCloseGroup('invite', 'actor-1')],
  ])('permanently blocks the legacy %s path', async (_label, operation) => {
    await expect(operation()).rejects.toThrow('WHATSAPP_LEGACY_TRANSPORT_RETIRED');
  });
});
