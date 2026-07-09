import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import type { ThermalReceiptData } from '@/lib/thermal-receipt';
import {
  distributeTotalAcrossCart,
  parsePaymentAmount,
  parseReceivedAmount,
} from '../pos.helpers';
import type {
  ActiveOrder,
  CartItem,
  CompletedSale,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentRow,
  WhatsappReceiptResponse,
} from '../pos.types';

type SendReceiptByWhatsapp = {
  mutateAsync: (payload: { saleId: string; phone: string }) => Promise<WhatsappReceiptResponse>;
};

type UsePosCheckoutOrchestratorParams = {
  activeOrderId: string | null;
  orderType: OrderType;
  orderStatus: OrderStatus;
  deliveryCanCheckout: boolean;
  cart: CartItem[];
  saleTotal: number;
  deliveryFeeValue: number;
  baseSaleTotal: number;
  selectedTableId: string;
  customerName: string;
  customerPhone: string;
  deliveryReference: string;
  orderNotes: string;
  payments: PaymentRow[];
  paymentMethodMap: Map<string, PaymentMethod>;
  sendReceiptByWhatsapp: SendReceiptByWhatsapp;
  createReceiptData: (sale: CompletedSale) => ThermalReceiptData;
  onReceiptReady: (receipt: ThermalReceiptData) => void;
  resetWorkspace: () => void;
  clearWorkspaceContext: () => void;
  invalidateOperationalQueries: () => Promise<void>;
};

export function usePosCheckoutOrchestrator({
  activeOrderId,
  orderType,
  orderStatus,
  deliveryCanCheckout,
  cart,
  saleTotal,
  deliveryFeeValue,
  baseSaleTotal,
  selectedTableId,
  customerName,
  customerPhone,
  deliveryReference,
  orderNotes,
  payments,
  paymentMethodMap,
  sendReceiptByWhatsapp,
  createReceiptData,
  onReceiptReady,
  resetWorkspace,
  clearWorkspaceContext,
  invalidateOperationalQueries,
}: UsePosCheckoutOrchestratorParams) {
  return useMutation({
    mutationFn: async () => {
      if (!activeOrderId) {
        throw new Error('No hay una comanda activa para cobrar.');
      }
      if (orderType === 'DELIVERY' && !deliveryCanCheckout) {
        throw new Error('Calcula un domicilio válido antes de cobrar.');
      }

      const orderItems = distributeTotalAcrossCart(cart, Math.max(saleTotal - deliveryFeeValue, 0));

      await apiFetch(`/orders/${activeOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: orderType,
          status: orderStatus,
          tableId: orderType === 'DINE_IN' ? selectedTableId : '',
          customerName: customerName || '',
          customerPhone: customerPhone || '',
          deliveryReference: orderType === 'DELIVERY' ? deliveryReference || '' : '',
          notes: orderNotes || '',
        }),
      });

      await apiFetch(`/orders/${activeOrderId}/items`, {
        method: 'PUT',
        body: JSON.stringify({
          items: orderItems,
        }),
      });

      return apiFetch<{ order: ActiveOrder; sale: CompletedSale }>(`/orders/${activeOrderId}/checkout`, {
        method: 'POST',
        body: JSON.stringify({
          baseSubtotal: baseSaleTotal,
          payments: payments.map((payment) => ({
            paymentMethodId: payment.paymentMethodId,
            amount: parsePaymentAmount(payment.amount),
            receivedAmount:
              paymentMethodMap.get(payment.paymentMethodId)?.code === 'cash'
                ? parseReceivedAmount(payment.receivedAmount) || parsePaymentAmount(payment.amount)
                : undefined,
          })),
          notes: orderNotes || undefined,
        }),
      });
    },
    onSuccess: async (response) => {
      onReceiptReady(createReceiptData(response.sale));
      const shouldAutoSendPaidDeliveryReceipt =
        orderType === 'DELIVERY' && Boolean(customerPhone.trim());

      if (shouldAutoSendPaidDeliveryReceipt) {
        try {
          const receiptResponse = await sendReceiptByWhatsapp.mutateAsync({
            saleId: response.sale.id,
            phone: customerPhone.trim(),
          });
          toast.success(`Comanda cobrada y comprobante ${receiptResponse.receiptNumber} enviado por WhatsApp`);
        } catch (error) {
          toast.warning(
            error instanceof Error
              ? `Comanda cobrada, pero no pudimos enviar el comprobante: ${error.message}`
              : 'Comanda cobrada, pero no pudimos enviar el comprobante por WhatsApp.',
          );
        }
      } else {
        toast.success('Comanda cobrada y mesa liberada');
      }
      resetWorkspace();
      clearWorkspaceContext();
      await invalidateOperationalQueries();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos cobrar la comanda. Revisa pagos y vuelve a intentar.'),
  });
}
