'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';
import { apiFetch } from '@/lib/api';
import { formatCurrency, matchesSearch } from '@/lib/format';
import { visiblePolling } from '@/lib/query-policy';
import {
  buildWhatsAppUrl,
  printThermalReceipt,
  type ThermalReceiptData,
} from '@/lib/thermal-receipt';
import { PosActiveOrdersPanel } from '@/features/pos/PosActiveOrdersPanel';
import { PosCartPanel } from '@/features/pos/PosCartPanel';
import { PosDeliveryPanel } from '@/features/pos/PosDeliveryPanel';
import { PosLastReceiptPanel } from '@/features/pos/PosLastReceiptPanel';
import { PosOrderCommitActions } from '@/features/pos/PosOrderCommitActions';
import { PosOperationalMetrics } from '@/features/pos/PosOperationalMetrics';
import { PosOrderMetadataPanel } from '@/features/pos/PosOrderMetadataPanel';
import { PosOrderReadinessBanner } from '@/features/pos/PosOrderReadinessBanner';
import { PosPageHeader } from '@/features/pos/PosPageHeader';
import { PosPaymentPanel } from '@/features/pos/PosPaymentPanel';
import { PosProductBrowser } from '@/features/pos/PosProductBrowser';
import { usePosCheckoutOrchestrator } from '@/features/pos/hooks/usePosCheckoutOrchestrator';
import {
  buildPriceInput,
  createPaymentRow,
  distributeTotalAcrossCart,
  parseCurrencyInput,
  parsePaymentAmount,
  parseReceivedAmount,
  pinnedProductCodes,
  saleChannelLabels,
  sanitizeCurrencyInput,
} from '@/features/pos/pos.helpers';
import type {
  ActiveOrder,
  CartItem,
  CompletedSale,
  DeliveryLocationSuggestion,
  DeliveryLocationSearchResponse,
  DeliveryPricingEstimate,
  DeliveryResolvedLocation,
  DiningTable,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentRow,
  Product,
  SettingRecord,
} from '@/features/pos/pos.types';

type CustomerSearchResult = {
  id: string;
  fullName: string;
  phone: string;
  defaultAddress: string | null;
};

type CurrentCashSession = {
  id: string;
};

type OperationalReport = {
  sales?: {
    bestSellers?: Array<{
      productName: string;
      quantity: number | string;
    }>;
  };
  operations?: {
    activeOrdersCount?: number;
    occupiedTablesCount?: number;
  };
};

export default function PosPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const safePathname = pathname ?? '/pos';
  const searchParams = useSearchParams();
  const tableIdFromUrl = searchParams?.get('tableId') ?? null;
  const orderIdFromUrl = searchParams?.get('orderId') ?? null;
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([createPaymentRow()]);
  const [deliveryReference, setDeliveryReference] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerLookupEnabled, setCustomerLookupEnabled] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('TAKEAWAY');
  const [orderStatus, setOrderStatus] = useState<OrderStatus>('OPEN');

  // Buscar clientes por texto libre (teléfono o nombre)
  const customerSearch = useQuery({
    queryKey: ['customers-search', customerPhone, customerName],
    queryFn: () => {
      const q = customerPhone.length >= 7 ? customerPhone : customerName.length >= 2 ? customerName : '';
      if (!q) return [];
      return apiFetch<CustomerSearchResult[]>(`/orders/customers/search?q=${encodeURIComponent(q)}`);
    },
    enabled: customerLookupEnabled && (customerPhone.length >= 7 || customerName.length >= 2),
    staleTime: 5000,
  });

  // Auto-llenar nombre/dirección cuando hay match único por teléfono
  useEffect(() => {
    const results = customerSearch.data ?? [];
    if (results.length === 1 && customerPhone.length >= 10) {
      const c = results[0];
      if (c) {
        if (!customerName && c.fullName) setCustomerName(c.fullName);
        if (!deliveryReference && c.defaultAddress) setDeliveryReference(c.defaultAddress);
      }
    }
  }, [customerName, customerPhone, customerSearch.data, deliveryReference]);

  // Compatibilidad con el código anterior que usa customerLookup
  const customerLookup = { data: (customerSearch.data ?? [])[0] ?? null, isFetched: customerSearch.isFetched };
  const [orderNotes, setOrderNotes] = useState('');
  const [lastReceipt, setLastReceipt] = useState<ThermalReceiptData | null>(null);
  const [manualSaleTotal, setManualSaleTotal] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryPricingEstimate, setDeliveryPricingEstimate] = useState<DeliveryPricingEstimate | null>(null);
  const deliveryPricingEstimateRef = useRef<DeliveryPricingEstimate | null>(null);
  const [deliveryZoneLabel, setDeliveryZoneLabel] = useState('');
  const [deliveryNeighborhood, setDeliveryNeighborhood] = useState('');
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState<number | null>(null);
  const [deliveryCalculationStatus, setDeliveryCalculationStatus] = useState<'PENDING' | 'CALCULATING' | 'READY' | 'ERROR'>('PENDING');
  const [deliverySearchQuery, setDeliverySearchQuery] = useState('');
  const [selectedDeliveryLocation, setSelectedDeliveryLocation] = useState<DeliveryResolvedLocation | null>(null);
  const latestDeliveryEstimateKey = useRef('');
  const lastSubmittedDeliveryEstimateKey = useRef('');

  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiFetch<Product[]>('/products'),
  });
  const paymentMethods = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => apiFetch<PaymentMethod[]>('/payment-methods'),
  });
  const currentCash = useQuery({
    queryKey: ['cash-current'],
    queryFn: () => apiFetch<CurrentCashSession | null>('/cash-register/current'),
  });
  const tables = useQuery({
    queryKey: ['tables'],
    queryFn: () => apiFetch<DiningTable[]>('/tables'),
    refetchInterval: visiblePolling(4_000),
    refetchIntervalInBackground: false,
  });
  const activeOrders = useQuery({
    queryKey: ['orders-active'],
    queryFn: () => apiFetch<ActiveOrder[]>('/orders?activeOnly=true'),
    refetchInterval: visiblePolling(4_000),
    refetchIntervalInBackground: false,
  });
  const orderFromUrl = useQuery({
    queryKey: ['orders', orderIdFromUrl],
    queryFn: () => apiFetch<ActiveOrder>(`/orders/${orderIdFromUrl}`),
    enabled: Boolean(orderIdFromUrl),
  });
  const operational = useQuery({
    queryKey: ['reports-operational'],
    queryFn: () => apiFetch<OperationalReport>('/reports/operational'),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<SettingRecord[]>('/settings'),
  });
  const deliveryLocationSearch = useQuery({
    queryKey: ['delivery-location-search', deliverySearchQuery],
    queryFn: () =>
      apiFetch<DeliveryLocationSearchResponse>('/delivery-location/search', {
        method: 'POST',
        body: JSON.stringify({
          query: deliverySearchQuery,
          city: 'Jamundí',
          state: 'Valle del Cauca',
          country: 'Colombia',
        }),
      }),
    enabled: orderType === 'DELIVERY' && deliverySearchQuery.trim().length >= 3,
    staleTime: 5 * 60 * 1000,
  });
  const resolveDeliveryLocation = useMutation({
    mutationFn: (suggestion: DeliveryLocationSuggestion) =>
      apiFetch<DeliveryResolvedLocation>('/delivery-location/resolve', {
        method: 'POST',
        body: JSON.stringify({
          provider: suggestion.provider,
          placeId: suggestion.placeId,
          fallbackText: suggestion.label,
        }),
      }),
    onSuccess: (location) => {
      if (location.latitude == null || location.longitude == null || location.confidence === 'LOW') {
        toast.warning(location.humanMessage ?? 'Selecciona una dirección sugerida o agrega más detalle.');
        setSelectedDeliveryLocation(null);
        return;
      }

      setSelectedDeliveryLocation(location);
      setDeliveryReference(location.formattedAddress ?? deliveryReference);
      setDeliveryPricingEstimate(null);
      setDeliveryCalculationStatus('PENDING');
      setDeliveryFee(0);
      setDeliveryZoneLabel('');
      setDeliveryDistanceKm(null);
      toast.success('Dirección seleccionada');
    },
    onError: () => {
      setSelectedDeliveryLocation(null);
      toast.warning('No se pudo resolver la dirección. Agrega más detalle.');
    },
  });

  const categories = useMemo(() => {
    const entries = new Map<string, string>();
    (products.data ?? []).forEach((product) => {
      entries.set(product.category.id, product.category.name);
    });
    return Array.from(entries, ([id, name]) => ({ id, name }));
  }, [products.data]);

  const receiptSettings = useMemo(() => {
    const settingsMap = new Map((settings.data ?? []).map((item) => [item.key, item.value]));
    const profile = settingsMap.get('business.profile') ?? {};
    const posDefaults = settingsMap.get('pos.defaults') ?? {};

    const businessName =
      typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : '2x1 Burger Co';
    const address = typeof profile.address === 'string' ? profile.address.trim() : '';
    const phone = typeof profile.phone === 'string' ? profile.phone.trim() : '';
    const receiptFooter = typeof posDefaults.receiptFooter === 'string' ? posDefaults.receiptFooter.trim() : '';

    return {
      businessName,
      address,
      phone,
      receiptFooter,
      whatsappUrl: buildWhatsAppUrl(phone),
    };
  }, [settings.data]);

  useEffect(() => {
    if (orderType !== 'DELIVERY') {
      setDeliverySearchQuery('');
      return;
    }

    const query = deliveryReference.trim();
    if (query.length < 3) {
      setDeliverySearchQuery('');
      return;
    }

    const timeout = window.setTimeout(() => {
      setDeliverySearchQuery(query);
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [orderType, deliveryReference]);

  const bestSellerScores = useMemo(() => {
    const scores = new Map<string, number>();

    (operational.data?.sales?.bestSellers ?? []).forEach((item, index) => {
      const score = Number(item.quantity ?? 0) * 1000 - index;
      if (item.productName) {
        scores.set(item.productName, score);
      }
    });

    return scores;
  }, [operational.data]);

  const filteredProducts = useMemo(
    () =>
      Array.from(
        new Map(
          (products.data ?? [])
            .filter((product) => {
              if (!product.isActive) {
                return false;
              }
              const matchesCategory =
                categoryFilter === 'ALL' ? true : product.category.id === categoryFilter;
              return (
                matchesCategory &&
                matchesSearch([product.name, product.code, product.category.name], search)
              );
            })
            .map((product) => [product.code, product] as const),
        ).values(),
      )
        .sort((left, right) => {
          const leftPinnedIndex = pinnedProductCodes.indexOf(left.code as (typeof pinnedProductCodes)[number]);
          const rightPinnedIndex = pinnedProductCodes.indexOf(right.code as (typeof pinnedProductCodes)[number]);
          const leftIsPinned = leftPinnedIndex !== -1;
          const rightIsPinned = rightPinnedIndex !== -1;

          if (leftIsPinned || rightIsPinned) {
            if (leftIsPinned && rightIsPinned) {
              return leftPinnedIndex - rightPinnedIndex;
            }

            return leftIsPinned ? -1 : 1;
          }

          const leftBestSellerScore = bestSellerScores.get(left.name) ?? -1;
          const rightBestSellerScore = bestSellerScores.get(right.name) ?? -1;

          if (leftBestSellerScore !== rightBestSellerScore) {
            return rightBestSellerScore - leftBestSellerScore;
          }

          return left.name.localeCompare(right.name, 'es-CO');
        }),
    [products.data, categoryFilter, search, bestSellerScores],
  );

  const productSaleSubtotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const deliveryFeeValue =
    orderType === 'DELIVERY'
      ? Number(deliveryFee || 0) > 0
        ? Number(deliveryFee)
        : 0
      : 0;
  const deliveryZoneValue = orderType === 'DELIVERY' ? deliveryZoneLabel || 'Pendiente de cálculo' : '';
  const deliveryStatus = deliveryPricingEstimate?.pricingStatus ?? 'PENDING';
  const deliveryCanCheckout = orderType !== 'DELIVERY' || deliveryPricingEstimate?.canCheckout === true;
  const deliveryIsCalculating = deliveryCalculationStatus === 'CALCULATING';
  const deliveryWarnings = deliveryPricingEstimate?.warnings ?? [];
  const CODE_PATTERN =
    /\b(?:EXTERNAL_PROVIDERS_DISABLED|DESTINATION_MISSING|DESTINATION_COORDINATES_MISSING|GEOCODING_UNAVAILABLE|GEOCODING_NOT_FOUND|GEOCODING_AMBIGUOUS|ORIGIN_COORDINATES_MISSING|LOCAL_ZONE_AMBIGUOUS|PROVIDER_UNAVAILABLE|PROVIDER_API_KEY_MISSING|NEEDS_ADDRESS_CORRECTION|ERROR_RETRYABLE|OUT_OF_COVERAGE|ROUTING_UNAVAILABLE|LOW_CONFIDENCE_ROUTE|[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/g;
  const deliveryCodeMessage = (message: string | null | undefined) => {
    const value = (message ?? '').trim();
    const upperValue = value.toUpperCase();
    const lowerValue = value.toLowerCase();
    if (
      upperValue.includes('DESTINATION_MISSING') ||
      upperValue.includes('DESTINATION_COORDINATES_MISSING') ||
      upperValue.includes('GEOCODING_NOT_FOUND') ||
      lowerValue.includes('coordenadas') ||
      lowerValue.includes('geocoding')
    ) {
      return 'No se pudo ubicar la dirección. Agrega más detalle.';
    }
    if (upperValue.includes('LOCAL_ZONE_AMBIGUOUS') || upperValue.includes('NEEDS_ADDRESS_CORRECTION')) {
      return 'Agrega ciudad, barrio o punto de referencia.';
    }
    if (upperValue.includes('PROVIDER') || upperValue.includes('UNAVAILABLE')) {
      return 'No se pudo calcular en este momento. Intenta de nuevo.';
    }
    if (upperValue.includes('OUT_OF_COVERAGE')) {
      return 'La dirección está fuera de cobertura.';
    }
    return null;
  };
  const cleanDeliveryMessage = (message: string | null | undefined, fallback: string, maxLength = 90) => {
    const mappedMessage = deliveryCodeMessage(message);
    if (mappedMessage) {
      return mappedMessage.slice(0, maxLength);
    }
    const firstSentence = (message ?? '')
      .replace(CODE_PATTERN, '')
      .replace(/^[:\s]+/, '')
      .split('.')[0] ?? '';
    const cleanMessage = firstSentence.trim().slice(0, maxLength);
    return cleanMessage || fallback;
  };
  const deliveryPrimaryWarning = (() => {
    if (
      deliveryStatus === 'AUTO_PRICED' &&
      deliveryCanCheckout &&
      (deliveryPricingEstimate?.weatherImpact?.surcharge ?? deliveryPricingEstimate?.weather?.surcharge ?? 0) > 0
    ) {
      return 'Incluye recargo por lluvia';
    }
    const warning =
      deliveryWarnings.find((value) => value === 'LOCAL_ZONE_AMBIGUOUS') ??
      deliveryWarnings.find((value) => value.includes('DESTINATION') || value.includes('GEOCODING')) ??
      deliveryWarnings.find((value) => value.includes('PROVIDER') || value.includes('UNAVAILABLE')) ??
      deliveryWarnings[0] ??
      null;
    return warning ? cleanDeliveryMessage(warning, 'Revisa la dirección.', 70) : null;
  })();

  const deliveryVisualState = (() => {
    if (deliveryIsCalculating) {
      return {
        label: 'Calculando',
        title: 'Calculando domicilio desde backend.',
        description: 'Estamos validando dirección, zona, ruta y reglas del negocio.',
        toneClass: 'border-sky-300 bg-sky-50/80',
        badgeClass: 'bg-sky-600 text-white',
        statusLabel: 'CALCULANDO',
      };
    }

    if (!deliveryPricingEstimate) {
      return {
        label: 'Pendiente',
        message: 'Completa la direccion y estima.',
        toneClass: 'border-stone-200 bg-white',
        badgeClass: 'bg-stone-600 text-white',
        statusLabel: 'PENDIENTE',
      };
    }

    if (deliveryStatus === 'LOCAL_FREE') {
      return {
        label: 'Gratis',
        message: 'Zona local sin costo.',
        toneClass: 'border-emerald-300 bg-emerald-50/80',
        badgeClass: 'bg-emerald-600 text-white',
        statusLabel: 'GRATIS',
      };
    }

    if (deliveryStatus === 'AUTO_PRICED' && deliveryPricingEstimate.canCheckout !== false) {
      return {
        label: 'Calculada',
        message: 'Tarifa calculada.',
        toneClass: 'border-sky-300 bg-sky-50/80',
        badgeClass: 'bg-sky-600 text-white',
        statusLabel: 'CALCULADA',
      };
    }

    if (deliveryStatus === 'OUT_OF_COVERAGE') {
      return {
        label: 'Sin cobertura',
        message: 'Fuera de cobertura automatica.',
        toneClass: 'border-red-300 bg-red-50/80',
        badgeClass: 'bg-red-600 text-white',
        statusLabel: 'SIN COBERTURA',
      };
    }

    if (deliveryStatus === 'NEEDS_ADDRESS_CORRECTION' || deliveryWarnings.includes('LOCAL_ZONE_AMBIGUOUS')) {
      return {
        label: 'Corregir',
        message: 'Corrige la direccion con mas detalle.',
        toneClass: 'border-orange-300 bg-orange-50/80',
        badgeClass: 'bg-orange-600 text-white',
        statusLabel: 'CORREGIR',
      };
    }

    if (deliveryStatus === 'PROVIDER_UNAVAILABLE' || deliveryWarnings.some((warning) => warning.includes('PROVIDER') || warning.includes('UNAVAILABLE'))) {
      return {
        label: 'No disponible',
        message: 'No se pudo estimar ahora. Reintenta.',
        toneClass: 'border-red-200 bg-red-50/80',
        badgeClass: 'bg-red-500 text-white',
        statusLabel: 'NO DISPONIBLE',
      };
    }

    return {
      label: 'Reintentar',
      message: 'Intenta calcular nuevamente.',
      toneClass: 'border-amber-200 bg-amber-50/80',
      badgeClass: 'bg-amber-600 text-white',
      statusLabel: 'REINTENTAR',
    };
  })();
  const deliveryShouldShowFee =
    orderType === 'DELIVERY' &&
    (deliveryStatus === 'LOCAL_FREE' || (deliveryStatus === 'AUTO_PRICED' && deliveryPricingEstimate?.canCheckout !== false));
  const deliveryFinalFeeLabel = deliveryShouldShowFee
    ? formatCurrency(deliveryStatus === 'LOCAL_FREE' ? 0 : deliveryFeeValue)
    : '—';
  const deliveryMetricsAllowed = deliveryStatus === 'LOCAL_FREE' || (deliveryStatus === 'AUTO_PRICED' && deliveryCanCheckout);
  const deliveryDistanceLabel = deliveryMetricsAllowed && deliveryDistanceKm != null ? deliveryDistanceKm.toFixed(1) : '—';
  const deliveryEtaLabel =
    deliveryMetricsAllowed && deliveryPricingEstimate?.durationMinutes != null
      ? String(Math.round(deliveryPricingEstimate.durationMinutes))
      : '—';
  const deliveryZoneDisplay = deliveryMetricsAllowed ? deliveryZoneValue || '—' : 'Revisar';
  const baseSaleTotal = productSaleSubtotal + deliveryFeeValue;
  const manualSaleTotalValue = parseCurrencyInput(manualSaleTotal);
  const hasManualSaleTotal = cart.length > 0 && manualSaleTotalValue > 0;
  const saleTotal = hasManualSaleTotal ? manualSaleTotalValue : baseSaleTotal;
  const paymentTotal = payments.reduce((acc, payment) => acc + parsePaymentAmount(payment.amount), 0);
  const difference = paymentTotal - saleTotal;
  const cashPaymentMethodId = useMemo(() => {
    const methods = paymentMethods.data ?? [];
    return methods.find((method) => method.code === 'cash')?.id ?? methods[0]?.id ?? '';
  }, [paymentMethods.data]);
  const nequiPaymentMethodId = useMemo(() => {
    const methods = paymentMethods.data ?? [];
    return methods.find((method) => method.code === 'nequi')?.id ?? '';
  }, [paymentMethods.data]);
  const preferredPaymentMethodId = orderType === 'DELIVERY'
    ? nequiPaymentMethodId || cashPaymentMethodId
    : cashPaymentMethodId;
  const paymentMethodMap = useMemo(
    () => new Map((paymentMethods.data ?? []).map((method) => [method.id, method])),
    [paymentMethods.data],
  );

  const sortedPaymentMethods = useMemo(() => {
    const methods = paymentMethods.data ?? [];
    const priority: Record<string, number> = { cash: 0, nequi: 1, bold: 2 };
    return methods
      .filter((m) => m.code !== 'tarjeta' && m.code !== 'card')
      .sort((a, b) => {
        const pa = priority[a.code] ?? 99;
        const pb = priority[b.code] ?? 99;
        return pa - pb;
      });
  }, [paymentMethods.data]);

  useEffect(() => {
    if (!products.data?.length) {
      return;
    }

    setCart((current) =>
      current.map((item) => {
        const latestProduct = products.data.find((product) => product.id === item.productId);

        if (!latestProduct) {
          return item;
        }

        return {
          ...item,
          name: latestProduct.name,
          code: latestProduct.code,
          categoryName: latestProduct.category.name,
          kind: latestProduct.kind,
          price: item.usesCustomPrice ? item.price : Number(latestProduct.salePrice),
          priceInput: item.usesCustomPrice ? item.priceInput : buildPriceInput(latestProduct.salePrice),
          stock: Number(latestProduct.currentStock),
        };
      }),
    );
  }, [products.data]);

  useEffect(() => {
    setPayments((current): PaymentRow[] => {
      if (current.length !== 1) {
        return current;
      }

      const onlyPayment: PaymentRow = current[0] ?? createPaymentRow();
      const nextAmount = buildPriceInput(saleTotal);

      if (onlyPayment.amount === nextAmount || parsePaymentAmount(onlyPayment.amount) === saleTotal) {
        return current;
      }

      return [{ ...onlyPayment, amount: nextAmount }];
    });
  }, [saleTotal]);

  useEffect(() => {
    if (!preferredPaymentMethodId) {
      return;
    }

    setPayments((current): PaymentRow[] => {
      if (current.length !== 1) {
        return current;
      }

      const onlyPayment: PaymentRow = current[0] ?? createPaymentRow();
      if (onlyPayment.paymentMethodId) {
        return current;
      }

      return [{ ...onlyPayment, paymentMethodId: preferredPaymentMethodId }];
    });
  }, [preferredPaymentMethodId]);

  const availableTables = useMemo(() => {
    const isCurrentTable = (tableId: string) =>
      tableId === selectedTableId ||
      activeOrders.data?.some((order) => order.id === activeOrderId && order.tableId === tableId);

    return (tables.data ?? [])
      .filter((table) => {
        if (!table.isActive || table.status === 'OUT_OF_SERVICE') return false;
        // Solo mostrar mesas libres o la mesa actual que se está editando
        return table.status === 'FREE' || table.status === 'RESERVED' || isCurrentTable(table.id);
      })
      .sort((a, b) => {
        // Ordenar numéricamente por label: Mesa 1, Mesa 2, ..., Mesa 10
        const na = parseInt(a.label.replace(/\D/g, ''), 10) || 0;
        const nb = parseInt(b.label.replace(/\D/g, ''), 10) || 0;
        return na - nb;
      });
  }, [tables.data, selectedTableId, activeOrderId, activeOrders.data]);

  const orderIssues = [
    !currentCash.data ? 'Abre una sesión de caja antes de trabajar con comandas.' : null,
    !cart.length ? 'Agrega al menos un producto a la comanda.' : null,
    orderType === 'DINE_IN' && !selectedTableId ? 'Selecciona una mesa para la comanda.' : null,
    orderType === 'DELIVERY' && !deliveryReference.trim() ? 'Agrega una referencia para el domicilio.' : null,
    orderType === 'DELIVERY' && !customerPhone.trim() ? 'Agrega el teléfono del cliente para el domicilio.' : null,
    orderType === 'DELIVERY' && deliveryIsCalculating ? 'Espera a que termine el cálculo automático del domicilio.' : null,
    orderType === 'DELIVERY' && deliveryReference.trim() && !deliveryIsCalculating && !deliveryCanCheckout
      ? 'Calcula un domicilio valido antes de guardar o cobrar.'
      : null,
  ].filter(Boolean) as string[];

  const paymentIssues = payments.some((payment) => {
    if (!payment.paymentMethodId || parsePaymentAmount(payment.amount) <= 0) {
      return true;
    }

    const paymentMethod = paymentMethodMap.get(payment.paymentMethodId);
    if (paymentMethod?.code !== 'cash') {
      return false;
    }

    const receivedAmount = parseReceivedAmount(payment.receivedAmount);
    return receivedAmount > 0 && receivedAmount < parsePaymentAmount(payment.amount);
  });

  const checkoutIssues = [
    ...orderIssues,
    cart.length && paymentIssues ? 'Completa método y monto para cada pago.' : null,
    cart.length && !paymentIssues && difference !== 0
      ? `Ajusta el pago para cuadrar la cuenta (${formatCurrency(difference)}).`
      : null,
  ].filter(Boolean) as string[];

  const clearWorkspaceContext = useCallback(() => {
    router.replace(safePathname, { scroll: false });
  }, [router, safePathname]);

  const hydrateWorkspaceFromOrder = useCallback((order: ActiveOrder) => {
    const orderItemsSubtotal = order.items.reduce(
      (acc, item) => acc + Number(item.unitPrice) * Number(item.quantity),
      0,
    );
    const expectedOrderSubtotal =
      orderItemsSubtotal + (order.type === 'DELIVERY' ? Number(order.deliveryFee ?? 0) : 0);
    const storedOrderSubtotal = Number(order.subtotal);
    const hasPersistedManualTotal = Math.abs(storedOrderSubtotal - expectedOrderSubtotal) >= 1;

    setActiveOrderId(order.id);
    setOrderType(order.type);
    setOrderStatus(
      order.status === 'PAID' || order.status === 'CANCELLED' ? 'PAYMENT_PENDING' : order.status,
    );
    setSelectedTableId(order.tableId ?? '');
    setCustomerName(order.customerName ?? '');
    setCustomerPhone(order.customerPhone ?? '');
    setDeliveryReference(order.deliveryReference ?? '');
    setDeliveryNeighborhood(order.deliveryZoneLabel ?? '');
    setDeliveryFee(Number(order.deliveryFee ?? 0));
    setDeliveryPricingEstimate(
      order.deliveryPricingStatus
        ? {
            pricingStatus: order.deliveryPricingStatus,
            suggestedFee: order.deliveryFeeSuggested != null ? Number(order.deliveryFeeSuggested) : null,
            finalFee: Number(order.deliveryFee ?? 0),
            canCheckout: order.deliveryPricingStatus === 'LOCAL_FREE' || order.deliveryPricingStatus === 'AUTO_PRICED',
            requiresAddressCorrection: order.deliveryPricingStatus === 'NEEDS_ADDRESS_CORRECTION',
            reasonCode: order.deliveryPricingStatus,
            humanMessage:
              order.deliveryPricingStatus === 'LOCAL_FREE'
                ? 'Domicilio gratis - Condados / Alborada.'
                : order.deliveryPricingStatus === 'AUTO_PRICED'
                  ? 'Tarifa de domicilio calculada automáticamente.'
                  : 'Corrige la dirección para calcular el domicilio.',
            requiresManualQuote: Boolean(order.deliveryRequiresManualQuote),
            confidence: (order.deliveryPricingConfidence as DeliveryPricingEstimate['confidence']) ?? 'LOW',
            zoneType: '',
            zoneLabel: order.deliveryZoneLabel,
            distanceKm: order.deliveryDistanceKm != null ? Number(order.deliveryDistanceKm) : null,
            durationMinutes: null,
            weather: { rainIntensity: 'UNKNOWN', surcharge: 0, unavailable: false },
            schedule: { mode: 'NORMAL', surcharge: 0 },
            subtotalBenefit: 0,
            manualEdited: Boolean(order.deliveryFeeEdited),
            manualEditReason: order.deliveryFeeEditReason ?? null,
            breakdown: order.deliveryPricingBreakdown ?? [],
            warnings: [],
            calculationVersion: order.deliveryCalculationVersion ?? '',
          }
        : null,
    );
    setDeliveryCalculationStatus(order.deliveryPricingStatus ? 'READY' : 'PENDING');
    setDeliveryZoneLabel(order.deliveryZoneLabel ?? '');
    setDeliveryDistanceKm(order.deliveryDistanceKm != null ? Number(order.deliveryDistanceKm) : null);
    setOrderNotes(order.notes ?? '');
    setManualSaleTotal('');
    setCart(
      order.items.map((item) => {
        const currentProduct = (products.data ?? []).find((product) => product.id === item.productId);

        return {
          productId: item.productId,
          name: item.product.name,
          code: item.product.code,
          categoryName: item.product.category.name,
          kind: item.product.kind,
          price: Number(item.unitPrice),
          priceInput: buildPriceInput(item.unitPrice),
          stock: Number(item.product.currentStock),
          quantity: Number(item.quantity),
          usesCustomPrice: currentProduct
            ? Number(item.unitPrice) !== Number(currentProduct.salePrice)
            : false,
        };
      }),
    );
    setPayments([createPaymentRow(order.type === 'DELIVERY' ? nequiPaymentMethodId || cashPaymentMethodId : cashPaymentMethodId, buildPriceInput(order.subtotal))]);
    setManualSaleTotal(hasPersistedManualTotal ? buildPriceInput(order.subtotal) : '');
  }, [cashPaymentMethodId, nequiPaymentMethodId, products.data]);

  useEffect(() => {
    if (!tableIdFromUrl || !tables.data || !activeOrders.data) {
      return;
    }

    const existingOrder = activeOrders.data.find((order) => order.tableId === tableIdFromUrl);
    if (existingOrder) {
      hydrateWorkspaceFromOrder(existingOrder);
      return;
    }

    const selectedTable = tables.data.find((table) => table.id === tableIdFromUrl);
    if (selectedTable) {
      setActiveOrderId(null);
      setOrderType('DINE_IN');
      setOrderStatus('OPEN');
      setSelectedTableId(selectedTable.id);
      setCustomerName('');
      setCustomerPhone('');
      setDeliveryReference('');
      setDeliveryNeighborhood('');
      setDeliveryFee(0);
      setDeliveryPricingEstimate(null);
      setDeliveryCalculationStatus('PENDING');
      setDeliveryZoneLabel('');
      setDeliveryDistanceKm(null);
      setOrderNotes('');
      setManualSaleTotal('');
      setCart([]);
      setPayments([createPaymentRow(preferredPaymentMethodId, buildPriceInput(0))]);
    }
  }, [tableIdFromUrl, tables.data, activeOrders.data, preferredPaymentMethodId, hydrateWorkspaceFromOrder]);

  useEffect(() => {
    if (!orderIdFromUrl || !orderFromUrl.data) {
      return;
    }

    hydrateWorkspaceFromOrder(orderFromUrl.data);
    clearWorkspaceContext();
  }, [clearWorkspaceContext, hydrateWorkspaceFromOrder, orderIdFromUrl, orderFromUrl.data]);

  const addToCart = (product: Product) => {
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);

      if (existing) {
        if (existing.kind === 'DIRECT_STOCK' && existing.quantity >= existing.stock) {
          toast.error(`Stock insuficiente para ${product.name}`);
          return current;
        }

        return current.map((item) =>
          item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }

      if (product.kind === 'DIRECT_STOCK' && Number(product.currentStock) <= 0) {
        toast.error(`No hay stock disponible para ${product.name}`);
        return current;
      }

      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          code: product.code,
          categoryName: product.category.name,
          kind: product.kind,
          price: Number(product.salePrice),
          priceInput: buildPriceInput(product.salePrice),
          stock: Number(product.currentStock),
          quantity: 1,
          usesCustomPrice: false,
        },
      ];
    });
  };

  const updateItemPrice = (productId: string, rawValue: string) => {
    const parsedValue = parseCurrencyInput(rawValue);
    const nextPriceInput = sanitizeCurrencyInput(rawValue);

    setCart((current) =>
      current.map((item) =>
        item.productId === productId
          ? (() => {
              const latestProduct = (products.data ?? []).find((product) => product.id === productId);
              const latestSalePrice = latestProduct ? Number(latestProduct.salePrice) : item.price;

              if (!nextPriceInput) {
                return {
                  ...item,
                  priceInput: '',
                };
              }

              return {
                ...item,
                price: parsedValue > 0 ? parsedValue : item.price,
                priceInput: nextPriceInput,
                usesCustomPrice: parsedValue > 0 ? parsedValue !== latestSalePrice : item.usesCustomPrice,
              };
            })()
          : item,
      ),
    );
  };

  const normalizeItemPriceInput = (productId: string) => {
    setCart((current) =>
      current.map((item) =>
        item.productId === productId
          ? {
              ...item,
              priceInput: item.priceInput || buildPriceInput(item.price),
            }
          : item,
      ),
    );
  };

  const updateQuantity = (productId: string, nextQuantity: number) => {
    setCart((current) =>
      current
        .map((item) => {
          if (item.productId !== productId) {
            return item;
          }

          if (nextQuantity <= 0) {
            return null;
          }

          if (item.kind === 'DIRECT_STOCK' && nextQuantity > item.stock) {
            toast.error(`Stock insuficiente para ${item.name}`);
            return item;
          }

          return { ...item, quantity: nextQuantity };
        })
        .filter((item): item is CartItem => item !== null),
    );
  };

  const resetWorkspace = () => {
    setActiveOrderId(null);
    setCart([]);
    setPayments([createPaymentRow(cashPaymentMethodId, buildPriceInput(0))]);
    setDeliveryReference('');
    setDeliveryNeighborhood('');
    setCustomerName('');
    setCustomerPhone('');
    setSelectedTableId('');
    setOrderType('TAKEAWAY');
    setDeliveryFee(0);
    setDeliveryPricingEstimate(null);
    setDeliveryCalculationStatus('PENDING');
    setDeliveryZoneLabel('');
    setDeliveryDistanceKm(null);
    setOrderStatus('OPEN');
    setOrderNotes('');
    setManualSaleTotal('');
  };

  const invalidateOperationalQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['orders-active'] }),
      queryClient.invalidateQueries({ queryKey: ['cash-current'] }),
      queryClient.invalidateQueries({ queryKey: ['current-cash'] }),
      queryClient.invalidateQueries({ queryKey: ['daily-report'] }),
      queryClient.invalidateQueries({ queryKey: ['reports-operational'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] }),
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['reports-range'] }),
      queryClient.invalidateQueries({ queryKey: ['best-sellers'] }),
      queryClient.invalidateQueries({ queryKey: ['daily-closures'] }),
    ]);
  };

  const createReceiptData = (sale: CompletedSale): ThermalReceiptData => ({
    saleId: sale.id,
    businessName: receiptSettings.businessName,
    address: receiptSettings.address,
    phone: receiptSettings.phone,
    whatsappUrl: receiptSettings.whatsappUrl,
    receiptFooter: receiptSettings.receiptFooter,
    saleNumber: sale.number,
    issuedAt: sale.soldAt,
    channelLabel: saleChannelLabels[sale.channel],
    referenceLabel: sale.tableLabel ?? sale.deliveryReference ?? null,
    customerLabel: sale.customerName,
    notes: sale.notes,
    items: sale.items.map((item) => ({
      name: item.product.name,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      total: Number(item.totalPrice),
    })),
    payments: sale.payments.map((payment) => ({
      name: payment.paymentMethod.name,
      amount: Number(payment.amount),
      receivedAmount: payment.receivedAmount != null ? Number(payment.receivedAmount) : null,
      changeAmount: payment.changeAmount != null ? Number(payment.changeAmount) : null,
    })),
    subtotal: Number(sale.subtotal),
    discount: Number(sale.discount ?? 0),
    total: Number(sale.total),
  });

  const { mutate: estimateDeliveryPricingMutate } = useMutation({
    mutationFn: (payload: {
      requestKey: string;
      orderSubtotal: number;
      addressText: string;
      neighborhood?: string;
      reference: string;
      location?: DeliveryResolvedLocation | null;
    }) =>
      apiFetch<DeliveryPricingEstimate>('/delivery-pricing/estimate', {
        method: 'POST',
        body: JSON.stringify({
          orderSubtotal: payload.orderSubtotal,
          addressText: payload.addressText || undefined,
          neighborhood: payload.neighborhood || undefined,
          reference: payload.reference || undefined,
          city: 'Jamundí',
          state: 'Valle del Cauca',
          country: 'Colombia',
          location: payload.location
            ? {
                provider: payload.location.provider,
                placeId: payload.location.placeId,
                formattedAddress: payload.location.formattedAddress,
                latitude: payload.location.latitude,
                longitude: payload.location.longitude,
                confidence: payload.location.confidence,
              }
            : undefined,
          customerId: undefined,
        }),
      }).then((result) => ({ result, requestKey: payload.requestKey })),
    onMutate: () => {
      setDeliveryCalculationStatus('CALCULATING');
    },
    onSuccess: ({ result, requestKey }) => {
      if (requestKey !== latestDeliveryEstimateKey.current) {
        return;
      }

      setDeliveryPricingEstimate(result);
      setDeliveryZoneLabel(result.zoneLabel ?? '');
      setDeliveryDistanceKm(result.distanceKm);
      setDeliveryCalculationStatus('READY');

      if (result.pricingStatus === 'LOCAL_FREE') {
        setDeliveryFee(0);
        toast.success('Domicilio gratis');
        return;
      }

      if (result.canCheckout === false) {
        setDeliveryFee(0);
        const shortMsg = cleanDeliveryMessage(result.humanMessage ?? result.reasonCode, 'No se pudo ubicar la dirección. Agrega más detalle.', 80);
        toast.warning(shortMsg);
        return;
      }

      setDeliveryFee(result.finalFee ?? result.suggestedFee ?? 0);
      toast.success('Domicilio estimado');
    },
    onError: () => {
      setDeliveryCalculationStatus('ERROR');
      toast.error('No se pudo estimar. Reintenta.');
    },
  });

  const buildDeliveryEstimatePayload = useCallback(() => {
    const addressText = deliveryReference.trim();
    const neighborhood = deliveryNeighborhood.trim();
    const requestKey = JSON.stringify({
      orderSubtotal: productSaleSubtotal,
      addressText,
      neighborhood,
      reference: addressText,
      locationProvider: selectedDeliveryLocation?.provider ?? null,
      placeId: selectedDeliveryLocation?.placeId ?? null,
      latitude: selectedDeliveryLocation?.latitude ?? null,
      longitude: selectedDeliveryLocation?.longitude ?? null,
    });

    return {
      requestKey,
      orderSubtotal: productSaleSubtotal,
      addressText,
      neighborhood,
      reference: addressText,
      location: selectedDeliveryLocation,
    };
  }, [deliveryNeighborhood, deliveryReference, productSaleSubtotal, selectedDeliveryLocation]);

  useEffect(() => {
    deliveryPricingEstimateRef.current = deliveryPricingEstimate;
  }, [deliveryPricingEstimate]);

  const requestDeliveryEstimate = useCallback((force = false) => {
    if (orderType !== 'DELIVERY' || !deliveryReference.trim()) {
      return;
    }

    const payload = buildDeliveryEstimatePayload();
    latestDeliveryEstimateKey.current = payload.requestKey;
    if (!force && lastSubmittedDeliveryEstimateKey.current === payload.requestKey) {
      setDeliveryCalculationStatus(deliveryPricingEstimateRef.current ? 'READY' : 'PENDING');
      return;
    }

    lastSubmittedDeliveryEstimateKey.current = payload.requestKey;
    estimateDeliveryPricingMutate(payload);
  }, [buildDeliveryEstimatePayload, deliveryReference, estimateDeliveryPricingMutate, orderType]);

  useEffect(() => {
    if (orderType !== 'DELIVERY') {
      latestDeliveryEstimateKey.current = '';
      lastSubmittedDeliveryEstimateKey.current = '';
      setDeliveryPricingEstimate(null);
      setDeliveryCalculationStatus('PENDING');
      setDeliveryFee(0);
      setDeliveryZoneLabel('');
      setDeliveryDistanceKm(null);
      setSelectedDeliveryLocation(null);
      return;
    }

    if (!deliveryReference.trim()) {
      latestDeliveryEstimateKey.current = '';
      lastSubmittedDeliveryEstimateKey.current = '';
      setDeliveryPricingEstimate(null);
      setDeliveryCalculationStatus('PENDING');
      setDeliveryFee(0);
      setDeliveryZoneLabel('');
      setDeliveryDistanceKm(null);
      setSelectedDeliveryLocation(null);
      return;
    }

    setDeliveryCalculationStatus('CALCULATING');
    const timeout = window.setTimeout(() => requestDeliveryEstimate(false), 950);
    return () => window.clearTimeout(timeout);
  }, [deliveryReference, orderType, requestDeliveryEstimate]);

  const saveOrder = useMutation({
    mutationFn: async () => {
      if (orderType === 'DELIVERY' && !deliveryCanCheckout) {
        throw new Error('Calcula un domicilio válido antes de guardar.');
      }

      const orderPayload = {
        type: orderType,
        tableId: orderType === 'DINE_IN' ? selectedTableId : undefined,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        deliveryReference: orderType === 'DELIVERY' ? deliveryReference || undefined : undefined,
        deliveryLatitude: orderType === 'DELIVERY' ? selectedDeliveryLocation?.latitude ?? undefined : undefined,
        deliveryLongitude: orderType === 'DELIVERY' ? selectedDeliveryLocation?.longitude ?? undefined : undefined,
        deliveryLocationProvider: orderType === 'DELIVERY' ? selectedDeliveryLocation?.provider ?? undefined : undefined,
        deliveryLocationPlaceId: orderType === 'DELIVERY' ? selectedDeliveryLocation?.placeId ?? undefined : undefined,
        deliveryLocationFormattedAddress: orderType === 'DELIVERY' ? selectedDeliveryLocation?.formattedAddress ?? undefined : undefined,
        deliveryLocationConfidence: orderType === 'DELIVERY' ? selectedDeliveryLocation?.confidence ?? undefined : undefined,
        notes: orderNotes || undefined,
        items: distributeTotalAcrossCart(cart, Math.max(saleTotal - deliveryFeeValue, 0)),
      };

      // Guardar cliente con find-or-create (anti-duplicados)
      if (orderType === 'DELIVERY' && customerPhone && customerPhone.length >= 10) {
        apiFetch('/orders/customers/find-or-create', {
          method: 'POST',
          body: JSON.stringify({
            phone: customerPhone,
            fullName: customerName || undefined,
            defaultAddress: deliveryReference || undefined,
          }),
        }).catch(() => { /* no bloquear si falla */ });
      }

      if (activeOrderId) {
        await apiFetch(`/orders/${activeOrderId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            type: orderType,
            status: orderStatus,
            tableId: orderType === 'DINE_IN' ? selectedTableId : '',
            customerName: customerName || '',
            customerPhone: customerPhone || '',
            deliveryReference: orderType === 'DELIVERY' ? deliveryReference || '' : '',
            deliveryLatitude: orderType === 'DELIVERY' ? selectedDeliveryLocation?.latitude ?? undefined : undefined,
            deliveryLongitude: orderType === 'DELIVERY' ? selectedDeliveryLocation?.longitude ?? undefined : undefined,
            deliveryLocationProvider: orderType === 'DELIVERY' ? selectedDeliveryLocation?.provider ?? undefined : undefined,
            deliveryLocationPlaceId: orderType === 'DELIVERY' ? selectedDeliveryLocation?.placeId ?? undefined : undefined,
            deliveryLocationFormattedAddress: orderType === 'DELIVERY' ? selectedDeliveryLocation?.formattedAddress ?? undefined : undefined,
            deliveryLocationConfidence: orderType === 'DELIVERY' ? selectedDeliveryLocation?.confidence ?? undefined : undefined,
            notes: orderNotes || '',
          }),
        });

        const order = await apiFetch<ActiveOrder>(`/orders/${activeOrderId}/items`, {
          method: 'PUT',
          body: JSON.stringify({
            items: orderPayload.items,
          }),
        });
        return order;
      }

      const order = await apiFetch<ActiveOrder>('/orders', {
        method: 'POST',
        body: JSON.stringify(orderPayload),
      });
      return order;
    },
    onSuccess: async () => {
      toast.success(activeOrderId ? 'Pedido guardado' : 'Pedido abierto — listo para el siguiente');
      // Limpiar workspace para agilidad: nuevo pedido sin clicks extra
      resetWorkspace();
      clearWorkspaceContext();
      await invalidateOperationalQueries();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos guardar la comanda. Intenta de nuevo.'),
  });

  const cancelOrder = useMutation({
    mutationFn: () =>
      activeOrderId
        ? apiFetch(`/orders/${activeOrderId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'CANCELLED' }),
          })
        : Promise.reject(new Error('No hay comanda activa')),
    onSuccess: async () => {
      toast.success('Comanda cancelada');
      resetWorkspace();
      clearWorkspaceContext();
      await invalidateOperationalQueries();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos cancelar la comanda. Intenta de nuevo.'),
  });

  const checkoutOrder = usePosCheckoutOrchestrator({
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
    createReceiptData,
    onReceiptReady: setLastReceipt,
    resetWorkspace,
    clearWorkspaceContext,
    invalidateOperationalQueries,
  });

  return (
    <div className="space-y-6 p-6 lg:p-8" data-testid="pos-page">
      <PosPageHeader
        hasActiveOrder={Boolean(activeOrderId)}
        hasDraft={Boolean(cart.length)}
        onNewOrder={() => {
          resetWorkspace();
          clearWorkspaceContext();
        }}
      />

      <PosOperationalMetrics
        isCashOpen={Boolean(currentCash.data)}
        activeOrdersCount={operational.data?.operations?.activeOrdersCount ?? activeOrders.data?.length ?? 0}
        occupiedTablesCount={operational.data?.operations?.occupiedTablesCount ?? 0}
        saleTotal={saleTotal}
        hasActiveOrder={Boolean(activeOrderId)}
        activeOrdersUnavailable={(activeOrders.isLoading && !activeOrders.data) || activeOrders.isError}
        occupiedTablesUnavailable={(operational.isLoading && !operational.data) || operational.isError}
        cashUnavailable={(currentCash.isLoading && !currentCash.data) || currentCash.isError}
      />

      {currentCash.isSuccess && !currentCash.data ? (
        <StatusBanner
          tone="warning"
          title="La caja está cerrada — No se puede vender"
          description="Abre caja antes de registrar ventas o comandas."
        />
      ) : null}

      {currentCash.isError ? (
        <StatusBanner
          tone="danger"
          title="No pudimos verificar el estado de caja"
          description="El cobro permanece bloqueado hasta recuperar la sesión real de caja."
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)]">
        <div className="space-y-6">
          <PosProductBrowser
            search={search}
            categoryFilter={categoryFilter}
            categories={categories}
            filteredProducts={filteredProducts}
            isLoading={products.isLoading}
            isError={products.isError}
            onSearchChange={setSearch}
            onCategoryFilterChange={setCategoryFilter}
            onAddToCart={addToCart}
            onRetry={() => void products.refetch()}
          />

          <PosActiveOrdersPanel
            orders={activeOrders.data}
            isLoading={activeOrders.isLoading}
            isError={activeOrders.isError}
            activeOrderId={activeOrderId}
            onSelectOrder={hydrateWorkspaceFromOrder}
            onRetry={() => void activeOrders.refetch()}
          />
        </div>

        <Card className="flex min-w-0 flex-col xl:sticky xl:top-24 xl:self-start">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-heading text-lg font-semibold text-ink lg:text-[1.12rem]">
                {activeOrderId ? 'Editar pedido' : 'Nuevo pedido'}
              </h2>
            </div>
            <Badge tone={activeOrderId ? 'info' : 'success'}>{activeOrderId ? 'Pedido en curso' : 'Borrador'}</Badge>
          </div>

          <PosCartPanel
            cart={cart}
            baseSaleTotal={baseSaleTotal}
            paymentTotal={paymentTotal}
            difference={difference}
            orderType={orderType}
            deliveryFeeValue={deliveryFeeValue}
            deliveryZoneValue={deliveryZoneValue}
            manualSaleTotal={manualSaleTotal}
            onManualSaleTotalChange={setManualSaleTotal}
            onResetManualSaleTotal={() => setManualSaleTotal('')}
            onUpdateQuantity={updateQuantity}
            onUpdateItemPrice={updateItemPrice}
            onNormalizeItemPriceInput={normalizeItemPriceInput}
          />

          <PosLastReceiptPanel
            receipt={lastReceipt}
            onPrint={async (receipt) => {
              try {
                await printThermalReceipt(receipt);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'No fue posible abrir la impresión del ticket.');
              }
            }}
            onClose={() => setLastReceipt(null)}
          />

          <PosOrderMetadataPanel
            orderType={orderType}
            orderStatus={orderStatus}
            selectedTableId={selectedTableId}
            availableTables={availableTables}
            orderNotes={orderNotes}
            onOrderTypeChange={setOrderType}
            onOrderStatusChange={setOrderStatus}
            onSelectedTableChange={setSelectedTableId}
            onOrderNotesChange={setOrderNotes}
            deliverySlot={(
              <PosDeliveryPanel
                showDeliveryDetails={orderType === 'DELIVERY'}
                deliveryVisualState={deliveryVisualState}
                deliveryPrimaryWarning={deliveryPrimaryWarning}
                deliveryShouldShowFee={deliveryShouldShowFee}
                deliveryPricingEstimate={deliveryPricingEstimate}
                deliveryFeeValue={deliveryFeeValue}
                deliveryFinalFeeLabel={deliveryFinalFeeLabel}
                deliveryDistanceLabel={deliveryDistanceLabel}
                deliveryEtaLabel={deliveryEtaLabel}
                deliveryZoneDisplay={deliveryZoneDisplay}
                deliveryStatus={deliveryStatus}
                deliveryCanCheckout={deliveryCanCheckout}
                deliveryIsCalculating={deliveryIsCalculating}
                deliveryReference={deliveryReference}
                deliveryNeighborhood={deliveryNeighborhood}
                deliverySearchQuery={deliverySearchQuery}
                selectedDeliveryLocation={selectedDeliveryLocation}
                deliveryLocationSuggestions={deliveryLocationSearch.data?.suggestions ?? []}
                deliveryLocationSearchIsFetching={deliveryLocationSearch.isFetching}
                resolveDeliveryLocationPending={resolveDeliveryLocation.isPending}
                customerName={customerName}
                customerPhone={customerPhone}
                customerLookupFullName={customerLookup.data?.fullName ?? null}
                customerLookupFetched={customerLookup.isFetched}
                onRequestDeliveryEstimate={() => requestDeliveryEstimate(true)}
                onCustomerNameChange={setCustomerName}
                onCustomerPhoneChange={(value) => {
                  setCustomerPhone(value);
                  setCustomerLookupEnabled(false);
                }}
                onCustomerPhoneBlur={() => {
                  if (customerPhone.length >= 10) setCustomerLookupEnabled(true);
                }}
                onDeliveryReferenceChange={(value) => {
                  setDeliveryReference(value);
                  setSelectedDeliveryLocation(null);
                  setDeliveryPricingEstimate(null);
                  setDeliveryCalculationStatus('PENDING');
                  setDeliveryFee(0);
                  setDeliveryZoneLabel('');
                  setDeliveryDistanceKm(null);
                }}
                onDeliveryNeighborhoodChange={(value) => {
                  setDeliveryNeighborhood(value);
                  setSelectedDeliveryLocation(null);
                  setDeliveryPricingEstimate(null);
                  setDeliveryCalculationStatus('PENDING');
                  setDeliveryFee(0);
                  setDeliveryZoneLabel('');
                  setDeliveryDistanceKm(null);
                }}
                onSelectDeliverySuggestion={(suggestion) => resolveDeliveryLocation.mutate(suggestion)}
              />
            )}
          />

          <PosOrderReadinessBanner
            orderIssues={orderIssues}
            hasActiveOrder={Boolean(activeOrderId)}
          />

          <PosPaymentPanel
            activeOrderId={activeOrderId}
            payments={payments}
            sortedPaymentMethods={sortedPaymentMethods}
            paymentMethodMap={paymentMethodMap}
            checkoutIssues={checkoutIssues}
            onPaymentMethodChange={(index, paymentMethodId) =>
              setPayments((current) =>
                current.map((entry, entryIndex) =>
                  entryIndex === index
                    ? { ...entry, paymentMethodId, receivedAmount: '' }
                    : entry,
                ),
              )
            }
            onPaymentAmountChange={(index, amount) =>
              setPayments((current) =>
                current.map((entry, entryIndex) =>
                  entryIndex === index ? { ...entry, amount } : entry,
                ),
              )
            }
            onReceivedAmountChange={(index, receivedAmount) =>
              setPayments((current) =>
                current.map((entry, entryIndex) =>
                  entryIndex === index ? { ...entry, receivedAmount } : entry,
                ),
              )
            }
            onRemovePayment={(index) => setPayments((current) => current.filter((_, entryIndex) => entryIndex !== index))}
          />

          <PosOrderCommitActions
            hasCartItems={Boolean(cart.length)}
            hasActiveOrder={Boolean(activeOrderId)}
            orderIssues={orderIssues}
            checkoutIssues={checkoutIssues}
            savePending={saveOrder.isPending}
            cancelPending={cancelOrder.isPending}
            checkoutPending={checkoutOrder.isPending}
            orderTotal={baseSaleTotal}
            onResetWorkspace={() => resetWorkspace()}
            onSaveOrder={() => saveOrder.mutate()}
            onCancelOrder={() => cancelOrder.mutate()}
            onCheckoutOrder={() => checkoutOrder.mutate()}
          />
        </Card>
      </div>

    </div>
  );
}
