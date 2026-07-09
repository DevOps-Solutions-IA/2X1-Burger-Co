export type Product = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  kind: 'PREPARED' | 'DIRECT_STOCK';
  salePrice: number | string;
  currentStock: number | string;
  stockMin: number | string;
  category: {
    id: string;
    name: string;
  };
};

export type PaymentMethod = {
  id: string;
  name: string;
  code: string;
};

export type SettingRecord = {
  key: string;
  value: Record<string, unknown>;
};

export type SaleChannel = 'MOSTRADOR' | 'PARA_LLEVAR' | 'MESA' | 'DOMICILIO';

export type CompletedSale = {
  id: string;
  number: string;
  soldAt: string;
  channel: SaleChannel;
  tableLabel: string | null;
  deliveryReference: string | null;
  customerName: string | null;
  customerPhone?: string | null;
  deliveryFee?: number | string;
  deliveryDistanceKm?: number | string | null;
  deliveryZoneLabel?: string | null;
  notes: string | null;
  subtotal: number | string;
  discount: number | string;
  total: number | string;
  items: Array<{
    quantity: number | string;
    unitPrice: number | string;
    totalPrice: number | string;
    product: {
      name: string;
    };
  }>;
  payments: Array<{
    amount: number | string;
    receivedAmount?: number | string | null;
    changeAmount?: number | string | null;
    paymentMethod: {
      name: string;
      code: string;
    };
  }>;
};

export type WhatsappSessionStatus = {
  enabled: boolean;
  connectionState: 'DISABLED' | 'DISCONNECTED' | 'CONNECTING' | 'QR_REQUIRED' | 'CONNECTED' | 'ERROR';
  qrDataUrl: string | null;
  businessPhone: string | null;
  linkedAt: string | null;
  updatedAt: string;
  lastError: string | null;
};

export type DeliverySummaryResponse = {
  success: boolean;
  phone: string;
  orderNumber: string;
  sentAt: string;
};

export type WhatsappReceiptResponse = {
  success: boolean;
  phone: string;
  receiptNumber: string;
  sentAt: string;
};

export type TableStatus = 'FREE' | 'OCCUPIED' | 'RESERVED' | 'PAYMENT_PENDING' | 'OUT_OF_SERVICE';

export type DiningTable = {
  id: string;
  label: string;
  area: string | null;
  status: TableStatus;
  isActive: boolean;
};

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'COUNTER';
export type OrderStatus = 'OPEN' | 'IN_PREPARATION' | 'SERVED' | 'PAYMENT_PENDING';

export type CartItem = {
  productId: string;
  name: string;
  code: string;
  categoryName: string;
  kind: Product['kind'];
  price: number;
  priceInput: string;
  stock: number;
  quantity: number;
  usesCustomPrice: boolean;
};

export type PaymentRow = {
  paymentMethodId: string;
  amount: string;
  receivedAmount: string;
};

export type ActiveOrder = {
  id: string;
  number: string;
  status: OrderStatus | 'PAID' | 'CANCELLED';
  type: OrderType;
  tableId: string | null;
  table: { id: string; label: string } | null;
  assignedWaiterId?: string | null;
  waiterNameSnapshot?: string | null;
  waiterAccessNameSnapshot?: string | null;
  assignedWaiter?: {
    id: string;
    fullName: string;
    accessName?: string | null;
  } | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryReference: string | null;
  deliveryFee: number | string;
  deliveryFeeSuggested?: number | string | null;
  deliveryFeeEdited?: boolean;
  deliveryFeeEditReason?: string | null;
  deliveryPricingStatus?: string | null;
  deliveryPricingConfidence?: string | null;
  deliveryPricingBreakdown?: Array<{ code: string; label: string; amount: number }> | null;
  deliveryCalculationVersion?: string | null;
  deliveryRequiresManualQuote?: boolean;
  deliveryDistanceKm: number | string | null;
  deliveryZoneLabel: string | null;
  deliveryLocationSource?: string | null;
  whatsappDeliveryOrder?: {
    id: string;
    status: string;
    paymentStatus: string;
    paymentMethod: string | null;
    publicPaymentTokenExpiresAt?: string | null;
    paymentLinkCreatedAt?: string | null;
    paymentLinkLastOpenedAt?: string | null;
    paymentLinkOpenCount?: number;
    paymentMethodSelectedAt?: string | null;
    orderReference?: string | null;
    source: string;
    createdByAgentNameSnapshot: string;
    customerNameSnapshot: string | null;
    customerPhoneSnapshot: string | null;
  } | null;
  notes: string | null;
  subtotal: number | string;
  updatedAt: string;
  items: Array<{
    productId: string;
    quantity: number | string;
    unitPrice: number | string;
    notes: string | null;
    product: {
      name: string;
      code: string;
      kind: Product['kind'];
      currentStock: number | string;
      category: {
        name: string;
      };
    };
  }>;
};

export type DeliveryPricingEstimate = {
  pricingStatus: string;
  suggestedFee: number | null;
  finalFee: number | null;
  currency?: 'COP';
  canCheckout?: boolean;
  requiresAddressCorrection?: boolean;
  reasonCode?: string;
  humanMessage?: string;
  requiresManualQuote: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  zoneType: string;
  zoneLabel: string | null;
  zoneMatch?: unknown;
  distanceKm: number | null;
  durationMinutes: number | null;
  estimatedMinutes?: number | null;
  weather: { rainIntensity: string; surcharge: number; unavailable: boolean };
  weatherImpact?: { rainIntensity: string; surcharge: number; unavailable: boolean; provider?: string | null };
  schedule: { mode: string; surcharge: number };
  subtotalBenefit: number;
  manualEdited: boolean;
  manualEditReason: string | null;
  breakdown: Array<{ code: string; label: string; amount: number }>;
  warnings: string[];
  providerUsage?: {
    weatherProvider?: string | null;
    geocodingProvider?: string | null;
    routingProvider?: string | null;
    warnings?: string[];
  };
  providersUsed?: {
    weatherProvider?: string | null;
    geocodingProvider?: string | null;
    routingProvider?: string | null;
    warnings?: string[];
  };
  calculationVersion: string;
  auditId?: string | null;
};

export type DeliveryLocationSuggestion = {
  provider: 'google';
  placeId: string;
  label: string;
  mainText: string;
  secondaryText: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

export type DeliveryLocationSearchResponse = {
  suggestions: DeliveryLocationSuggestion[];
  warnings?: string[];
};

export type DeliveryResolvedLocation = {
  provider: 'google';
  placeId?: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  warnings?: string[];
  humanMessage?: string;
};
