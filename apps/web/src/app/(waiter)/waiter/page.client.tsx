/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogOut, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { ApiError, apiFetch, subscribeOperationalStream } from '@/lib/api';
import { formatCurrency, formatNumber, matchesSearch } from '@/lib/format';
import { getOperationalOrderDisplayCode as _g } from '@/lib/order-display';
import { expireCurrentSession, useAuth } from '@/features/auth/auth-provider';
import { CacheStorage, TTL } from '@/lib/cache-storage';

type TableStatus = 'FREE' | 'OCCUPIED' | 'RESERVED' | 'PAYMENT_PENDING' | 'OUT_OF_SERVICE';
type OrderStatus = 'OPEN' | 'IN_PREPARATION' | 'SERVED' | 'PAYMENT_PENDING';
type ProductBrand = 'HOUSE' | 'COCA_COLA' | 'OTHER';

type DiningTable = {
  id: string;
  label: string;
  area: string | null;
  groupId?: string | null;
  group?: {
    id: string;
    name: string;
    area: string | null;
    color: string | null;
    isActive: boolean;
  } | null;
  capacity: number;
  status: TableStatus;
  isActive: boolean;
  orderTickets?: Array<{
    id: string;
    number: string;
    status: OrderStatus | 'PAID' | 'CANCELLED';
    subtotal: number | string;
    updatedAt: string;
    _count: {
      items: number;
    };
  }>;
};

type Product = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  kind: 'PREPARED' | 'DIRECT_STOCK';
  brand: ProductBrand;
  salePrice: number | string;
  currentStock: number | string;
  stockMin: number | string;
  category: {
    id: string;
    name: string;
  };
};

type ActiveOrder = {
  id: string;
  number: string;
  revision: number;
  status: OrderStatus | 'PAID' | 'CANCELLED';
  type?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'COUNTER';
  tableId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  subtotal: number | string;
  updatedAt: string;
  createdById: string;
  assignedWaiterId: string | null;
  waiterNameSnapshot?: string | null;
  waiterAccessNameSnapshot?: string | null;
  assignedAt: string | null;
  createdBy: {
    id: string;
    fullName: string;
  };
  assignedWaiter: {
    id: string;
    fullName: string;
  } | null;
  items: Array<{
    productId: string;
    quantity: number | string;
    unitPrice: number | string;
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

type CartItem = {
  productId: string;
  name: string;
  code: string;
  categoryName: string;
  kind: Product['kind'];
  price: number;
  stock: number;
  quantity: number;
};

type WaiterView = 'home' | 'compose';
type WaiterOrderScope = 'MINE' | 'ALL';
type WaiterTableScope = 'ALL' | 'MINE' | 'FREE';
type WaiterAlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
type WaiterAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

const _orderStatuses: Array<{ value: OrderStatus; label: string }> = [
  { value: 'OPEN', label: 'Abierta' },
  { value: 'IN_PREPARATION', label: 'En preparación' },
  { value: 'SERVED', label: 'Servida' },
  { value: 'PAYMENT_PENDING', label: 'Lista para cobro' },
];

const _quickServiceNotes = ['Para llevar', 'Sin cebolla', 'Primero bebidas', 'Entrega rápida'];
const WAITER_DRAFT_KEY_PREFIX = 'inventory_fastfood_waiter_draft:';
const WAITER_OUTBOX_KEY_PREFIX = 'inventory_fastfood_waiter_outbox:';
const WAITER_TABLES_CACHE_KEY_PREFIX = 'inventory_fastfood_waiter_tables:';
const WAITER_ACTIVE_ORDERS_CACHE_KEY_PREFIX = 'inventory_fastfood_waiter_orders:';
const WAITER_ALERTS_CACHE_KEY_PREFIX = 'inventory_fastfood_waiter_alerts:';
const WAITER_VIEW_PREFS_KEY_PREFIX = 'inventory_fastfood_waiter_view:';

type WaiterDraft = {
  cart: CartItem[];
  customerName: string;
  customerPhone: string;
  notes: string;
  orderStatus: OrderStatus;
  updatedAt: string;
};

type WaiterOutboxOperation = {
  id: string;
  orderId: string | null;
  tableId: string;
  customerName: string;
  customerPhone: string;
  notes: string;
  orderStatus: OrderStatus;
  expectedRevision?: number;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
  }>;
  takeOwnership?: boolean;
  queuedAt: string;
  attemptCount: number;
  lastError?: string | null;
};

type WaiterOperationalAlert = {
  id: string;
  type: string;
  module: string;
  severity: WaiterAlertSeverity;
  status: WaiterAlertStatus;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
};

function getWaiterDraftKey(waiterId: string, tableId: string) {
  return `${WAITER_DRAFT_KEY_PREFIX}${waiterId}:${tableId}`;
}

function getWaiterOutboxKey(waiterId: string) {
  return `${WAITER_OUTBOX_KEY_PREFIX}${waiterId}`;
}

function getWaiterTablesCacheKey(waiterId: string) {
  return `${WAITER_TABLES_CACHE_KEY_PREFIX}${waiterId}`;
}

function getWaiterActiveOrdersCacheKey(waiterId: string) {
  return `${WAITER_ACTIVE_ORDERS_CACHE_KEY_PREFIX}${waiterId}`;
}

function getWaiterAlertsCacheKey(waiterId: string) {
  return `${WAITER_ALERTS_CACHE_KEY_PREFIX}${waiterId}`;
}

function getWaiterViewPrefsKey(waiterId: string) {
  return `${WAITER_VIEW_PREFS_KEY_PREFIX}${waiterId}`;
}

function readStoredJson<T>(key: string, fallback: T, ttlMs?: number) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    if (ttlMs !== undefined) {
      // Intentar leer con CacheStorage (nuevo formato con version y expiracion)
      const cached = CacheStorage.read<T>(key);
      if (cached !== null) return cached;
    }

    // Fallback: leer directo de localStorage (formato anterior)
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return fallback;
    }

    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function writeStoredJson<T>(key: string, value: T, ttlMs?: number) {
  if (typeof window === 'undefined') {
    return;
  }

  if (ttlMs !== undefined) {
    CacheStorage.write(key, value, ttlMs);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function readWaiterDraft(waiterId: string, tableId: string) {
  return CacheStorage.readSession<WaiterDraft | null>(getWaiterDraftKey(waiterId, tableId))
    ?? readStoredJson<WaiterDraft | null>(getWaiterDraftKey(waiterId, tableId), null);
}

function writeWaiterDraft(waiterId: string, tableId: string, draft: WaiterDraft) {
  CacheStorage.writeSession(getWaiterDraftKey(waiterId, tableId), draft);
  writeStoredJson(getWaiterDraftKey(waiterId, tableId), draft, TTL.DRAFT);
}

function clearWaiterDraft(waiterId: string, tableId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  CacheStorage.removeSession(getWaiterDraftKey(waiterId, tableId));
  window.localStorage.removeItem(getWaiterDraftKey(waiterId, tableId));
}

function readWaiterOutbox(waiterId: string) {
  return readStoredJson<WaiterOutboxOperation[]>(getWaiterOutboxKey(waiterId), [], TTL.DRAFT);
}

function writeWaiterOutbox(waiterId: string, operations: WaiterOutboxOperation[]) {
  writeStoredJson(getWaiterOutboxKey(waiterId), operations, TTL.DRAFT);
}

function getOrderOwnerId(order: Pick<ActiveOrder, 'assignedWaiterId' | 'createdById'>) {
  return order.assignedWaiterId ?? order.createdById;
}

function getOrderOwnerName(order: Pick<ActiveOrder, 'assignedWaiter' | 'createdBy' | 'waiterNameSnapshot'>) {
  return order.waiterNameSnapshot ?? order.assignedWaiter?.fullName ?? order.createdBy.fullName;
}

function getOrderStatusMeta(status: OrderStatus | 'PAID' | 'CANCELLED') {
  switch (status) {
    case 'OPEN':
      return { label: 'Abierta', tone: 'warning' as const };
    case 'IN_PREPARATION':
      return { label: 'En preparación', tone: 'info' as const };
    case 'SERVED':
      return { label: 'Servida', tone: 'success' as const };
    case 'PAYMENT_PENDING':
      return { label: 'Lista para cobro', tone: 'default' as const };
    case 'PAID':
      return { label: 'Pagada', tone: 'success' as const };
    default:
      return { label: 'Cancelada', tone: 'danger' as const };
  }
}

function getTableStatusMeta(activeOrder: ActiveOrder | null) {
  if (activeOrder) {
    return { label: 'Con servicio', tone: 'info' as const };
  }

  return { label: 'Libre', tone: 'success' as const };
}

function toEditableOrderStatus(status: ActiveOrder['status']): OrderStatus {
  if (status === 'PAID' || status === 'CANCELLED') {
    return 'PAYMENT_PENDING';
  }

  return status;
}

function toggleNoteSnippet(currentNotes: string, snippet: string) {
  const lines = currentNotes
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const alreadyIncluded = lines.includes(snippet);
  const nextLines = alreadyIncluded
    ? lines.filter((line) => line !== snippet)
    : [...lines, snippet];

  return nextLines.join('\n');
}


function getMinutesSince(isoDate: string) {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.round((Date.now() - timestamp) / 60000));
}

function getWaiterAlertTone(severity: WaiterAlertSeverity) {
  switch (severity) {
    case 'CRITICAL':
      return 'danger' as const;
    case 'WARNING':
      return 'warning' as const;
    default:
      return 'info' as const;
  }
}

export default function WaiterClientPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tableIdFromUrl = searchParams?.get('tableId') ?? null;
  const initialViewPrefs = useMemo(() => {
    if (!user?.sub) {
      return { orderScope: 'MINE' as WaiterOrderScope, tableScope: 'ALL' as WaiterTableScope };
    }

    return readStoredJson<{ orderScope?: WaiterOrderScope; tableScope?: WaiterTableScope }>(
      getWaiterViewPrefsKey(user.sub),
      {},
    );
  }, [user?.sub]);

  const [viewMode, setViewMode] = useState<WaiterView>('home');
  const [urlSelectionEnabled, setUrlSelectionEnabled] = useState(true);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [hydratedOrderId, setHydratedOrderId] = useState<string | null>(null);
  const [drinkBrandFilter, setDrinkBrandFilter] = useState<ProductBrand | 'ALL'>('ALL');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [orderStatus, setOrderStatus] = useState<OrderStatus>('OPEN');

  const [activeOrderModalId, setActiveOrderModalId] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<'saved' | 'error' | null>(null);
  const [composeCategory, setComposeCategory] = useState('Todos');
  const [modalOrderStatus, setModalOrderStatus] = useState<OrderStatus>('OPEN');
  const [modalNotes, setModalNotes] = useState('');
  const [modalExtraItems, setModalExtraItems] = useState<CartItem[]>([]);
  const [modalDrinkBrandFilter, setModalDrinkBrandFilter] = useState<ProductBrand | 'ALL'>('ALL');
  const [orderScope, setOrderScope] = useState<WaiterOrderScope>(initialViewPrefs.orderScope ?? 'MINE');
  const [tableScope, setTableScope] = useState<WaiterTableScope>(initialViewPrefs.tableScope ?? 'ALL');
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [isOnline, setIsOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [draftHydratedTableId, setDraftHydratedTableId] = useState<string | null>(null);
  const [saveRetryPending, setSaveRetryPending] = useState(false);
  const [modalRetryPending, setModalRetryPending] = useState(false);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [isFlushingQueue, setIsFlushingQueue] = useState(false);
  const hadOpenCashRef = useRef(false);

  const tables = useQuery({
    queryKey: ['tables', 'waiter'],
    queryFn: () => apiFetch<DiningTable[]>('/tables/waiter'),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    initialData: () =>
      user?.sub ? readStoredJson<DiningTable[] | undefined>(getWaiterTablesCacheKey(user.sub), undefined) : undefined,
  });
  const activeOrders = useQuery({
    queryKey: ['orders-active', 'waiter'],
    queryFn: () => apiFetch<ActiveOrder[]>('/orders/waiter-active'),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    initialData: () =>
      user?.sub
        ? readStoredJson<ActiveOrder[] | undefined>(getWaiterActiveOrdersCacheKey(user.sub), undefined)
        : undefined,
  });
  const waiterAlerts = useQuery({
    queryKey: ['operational-alerts', 'waiter'],
    queryFn: () => apiFetch<WaiterOperationalAlert[]>('/orders/operational-alerts?module=waiters'),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    initialData: () =>
      user?.sub
        ? readStoredJson<WaiterOperationalAlert[] | undefined>(getWaiterAlertsCacheKey(user.sub), undefined)
        : undefined,
  });
  const products = useQuery({
    queryKey: ['products', 'sellable'],
    queryFn: () => apiFetch<Product[]>('/products/sellable'),
  });
  const currentCash = useQuery({
    queryKey: ['cash-current'],
    queryFn: () => apiFetch<any | null>('/cash-register/current'),
    refetchInterval: 4000,
  });

  const availableTables = useMemo(
    () => (tables.data ?? []).filter((table) => table.isActive && table.status !== 'OUT_OF_SERVICE'),
    [tables.data],
  );

  const activeProducts = useMemo(() => (products.data ?? []).filter((product) => product.isActive), [products.data]);

  const composeCategories = useMemo(() => {
    const order = ['Todos', 'Combos', 'Bebidas', 'Adiciones', 'Empaques', 'Insumos'];
    const cats = new Set(activeProducts.map((p) => {
      const cn = p.category.name;
      if (cn === 'Hamburguesas') return 'Combos';
      if (cn === 'Aguas') return 'Bebidas';
      return cn;
    }));
    return order.filter((c) => c === 'Todos' || cats.has(c));
  }, [activeProducts]);

  const composeFilteredProducts = useMemo(() => {
    if (composeCategory === 'Todos') return activeProducts;
    return activeProducts.filter((p) => {
      const cn = p.category.name;
      const mapped = cn === 'Hamburguesas' ? 'Combos' : cn === 'Aguas' ? 'Bebidas' : cn;
      return mapped === composeCategory;
    });
  }, [activeProducts, composeCategory]);

  const burgerProducts = useMemo(
    () =>
      activeProducts
        .filter((product) => product.kind === 'PREPARED')
        .sort((left, right) => {
          const leftPriority = left.name.toLowerCase().includes('2x1') ? 0 : 1;
          const rightPriority = right.name.toLowerCase().includes('2x1') ? 0 : 1;
          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
          }
          return left.name.localeCompare(right.name, 'es-CO');
        }),
    [activeProducts],
  );

  const beverageProducts = useMemo(
    () => activeProducts.filter((product) => product.kind === 'DIRECT_STOCK'),
    [activeProducts],
  );

  const drinkBrandTabs = useMemo(() => {
    const tabs: Array<{ value: ProductBrand | 'ALL'; label: string }> = [{ value: 'ALL', label: 'Todas' }];

    if (beverageProducts.some((product) => product.brand === 'COCA_COLA')) {
      tabs.push({ value: 'COCA_COLA', label: 'Coca-Cola' });
    }

    if (beverageProducts.some((product) => product.brand === 'OTHER')) {
      tabs.push({ value: 'OTHER', label: 'Otras' });
    }

    return tabs;
  }, [beverageProducts]);

  const filteredDrinks = useMemo(
    () => (products.data ?? []).filter((product) => product.isActive),
    [products.data],
  );

  const selectedTable = useMemo(
    () => availableTables.find((table) => table.id === selectedTableId) ?? null,
    [availableTables, selectedTableId],
  );

  const selectedOrder = useMemo(
    () => activeOrders.data?.find((order) => order.tableId === selectedTableId) ?? null,
    [activeOrders.data, selectedTableId],
  );

  const modalOrder = useMemo(
    () => activeOrders.data?.find((order) => order.id === activeOrderModalId) ?? null,
    [activeOrders.data, activeOrderModalId],
  );

  const modalTable = useMemo(
    () => availableTables.find((table) => table.id === modalOrder?.tableId) ?? null,
    [availableTables, modalOrder?.tableId],
  );

  const modalFilteredDrinks = useMemo(
    () =>
      beverageProducts
        .filter((product) => (modalDrinkBrandFilter === 'ALL' ? true : product.brand === modalDrinkBrandFilter))
        .sort((left, right) => left.name.localeCompare(right.name, 'es-CO')),
    [beverageProducts, modalDrinkBrandFilter],
  );

  const tableOrderMap = useMemo(
    () =>
      new Map(
        (activeOrders.data ?? [])
          .filter((order) => order.tableId)
          .map((order) => [order.tableId as string, order]),
      ),
    [activeOrders.data],
  );

  const visibleTables = useMemo(() => {
    const scoped = availableTables.filter((table) => {
      const activeOrder = tableOrderMap.get(table.id) ?? null;
      if (tableScope === 'MINE') {
        return activeOrder ? getOrderOwnerId(activeOrder) === user?.sub : false;
      }

      if (tableScope === 'FREE') {
        return !activeOrder;
      }

      return true;
    });

    return [...scoped].sort((left, right) => {
      const leftOrder = tableOrderMap.get(left.id) ?? null;
      const rightOrder = tableOrderMap.get(right.id) ?? null;
      const leftMine = leftOrder ? (getOrderOwnerId(leftOrder) === user?.sub ? 0 : 2) : 1;
      const rightMine = rightOrder ? (getOrderOwnerId(rightOrder) === user?.sub ? 0 : 2) : 1;
      if (leftMine !== rightMine) {
        return leftMine - rightMine;
      }

      return left.label.localeCompare(right.label, 'es-CO');
    });
  }, [availableTables, tableOrderMap, tableScope, user?.sub]);

  const agedOrders = useMemo(
    () =>
      (activeOrders.data ?? [])
        .map((order) => ({
          order,
          ageMinutes: getMinutesSince(order.updatedAt),
        }))
        .filter(({ ageMinutes }) => ageMinutes >= 10)
        .sort((left, right) => right.ageMinutes - left.ageMinutes),
    [activeOrders.data],
  );

  const serviceMetrics = useMemo(() => {
    const configured = availableTables.length;
    const inService = activeOrders.data?.filter((order) => order.tableId != null).length ?? 0;
    const free = Math.max(configured - inService, 0);
    const mine = activeOrders.data?.filter((order) => getOrderOwnerId(order) === user?.sub).length ?? 0;
    const myTables = availableTables.filter((table) => {
      const activeOrder = tableOrderMap.get(table.id) ?? null;
      return activeOrder ? getOrderOwnerId(activeOrder) === user?.sub : false;
    }).length;
    const oldestOrderMinutes = agedOrders[0]?.ageMinutes ?? 0;

    return {
      configured,
      inService,
      free,
      activeOrders: activeOrders.data?.length ?? 0,
      mine,
      myTables,
      agedOrders: agedOrders.length,
      oldestOrderMinutes,
    };
  }, [availableTables, activeOrders.data, agedOrders, tableOrderMap, user?.sub]);

  const visibleWaiterAlerts = useMemo(
    () =>
      (waiterAlerts.data ?? []).filter((alert) =>
        !alert.entityId ? true : (activeOrders.data ?? []).some((order) => order.id === alert.entityId),
      ),
    [activeOrders.data, waiterAlerts.data],
  );

  const visibleActiveOrders = useMemo(
    () =>
      (activeOrders.data ?? []).filter((order) =>
        orderScope === 'ALL' ? true : getOrderOwnerId(order) === user?.sub,
      ),
    [activeOrders.data, orderScope, user?.sub],
  );

  const selectedOrderClaimable =
    Boolean(selectedOrder) && !selectedOrder?.assignedWaiterId && selectedOrder?.createdById !== user?.sub;
  const modalOrderClaimable =
    Boolean(modalOrder) && !modalOrder?.assignedWaiterId && modalOrder?.createdById !== user?.sub;
  const selectedOrderOwnedByAnotherWaiter =
    Boolean(selectedOrder) && !selectedOrderClaimable && getOrderOwnerId(selectedOrder!) !== user?.sub;
  const modalOrderOwnedByAnotherWaiter =
    Boolean(modalOrder) && !modalOrderClaimable && getOrderOwnerId(modalOrder!) !== user?.sub;

  const shiftStartedLabel = useMemo(() => {
    if (!user?.lastLoginAt) {
      return 'Turno activo';
    }

    return new Date(user.lastLoginAt).toLocaleTimeString('es-CO', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [user?.lastLoginAt]);

  const orderTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const modalExtraTotal = modalExtraItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const modalProjectedTotal = Number(modalOrder?.subtotal ?? 0) + modalExtraTotal;
  const modalHasChanges =
    modalExtraItems.length > 0 ||
    modalNotes.trim() !== (modalOrder?.notes ?? '').trim() ||
    modalOrderStatus !== toEditableOrderStatus(modalOrder?.status ?? 'OPEN');

  const resetComposer = () => {
    if (selectedTableId && user?.sub) {
      clearWaiterDraft(user.sub, selectedTableId);
    }
    setUrlSelectionEnabled(false);
    setSelectedTableId('');
    setHydratedOrderId(null);
    setDraftHydratedTableId(null);
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setNotes('');
    setOrderStatus('OPEN');
    
    setDrinkBrandFilter('ALL');
    setSaveRetryPending(false);
    setViewMode('home');
    router.replace('/waiter', { scroll: false });
  };

  useEffect(() => {
    if (!availableTables.length) {
      setSelectedTableId('');
      return;
    }

    if (!tableIdFromUrl) {
      setUrlSelectionEnabled(true);
      setSelectedTableId((current) =>
        current && availableTables.some((table) => table.id === current) ? current : '',
      );
      return;
    }

    if (tableIdFromUrl && urlSelectionEnabled) {
      const target = availableTables.find((table) => table.id === tableIdFromUrl);
      if (target) {
        setSelectedTableId(target.id);
        setViewMode('compose');
        return;
      }
    }

    setSelectedTableId((current) =>
      current && availableTables.some((table) => table.id === current) ? current : '',
    );
  }, [availableTables, tableIdFromUrl, urlSelectionEnabled]);

  useEffect(() => {
    if (!selectedTableId) {
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setNotes('');
      setOrderStatus('OPEN');
      setHydratedOrderId(null);
      return;
    }

    if (selectedOrder && hydratedOrderId !== selectedOrder.id) {
      if (user?.sub) {
        clearWaiterDraft(user.sub, selectedTableId);
      }
      setCart(
        selectedOrder.items.map((item) => ({
          productId: item.productId,
          name: item.product.name,
          code: item.product.code,
          categoryName: item.product.category.name,
          kind: item.product.kind,
          price: Number(item.unitPrice),
          stock: Number(item.product.currentStock),
          quantity: Number(item.quantity),
        })),
      );
      setCustomerName(selectedOrder.customerName ?? '');
      setCustomerPhone(selectedOrder.customerPhone ?? '');
      setNotes(selectedOrder.notes ?? '');
      setOrderStatus(toEditableOrderStatus(selectedOrder.status));
      setHydratedOrderId(selectedOrder.id);
      setDraftHydratedTableId(selectedTableId);
      return;
    }

    if (!selectedOrder && hydratedOrderId !== null) {
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setNotes('');
      setOrderStatus('OPEN');
      setHydratedOrderId(null);
    }
  }, [selectedOrder, selectedTableId, hydratedOrderId]);

  useEffect(() => {
    if (!modalOrder) {
      return;
    }

    setModalOrderStatus(toEditableOrderStatus(modalOrder.status));
    setModalNotes(modalOrder.notes ?? '');
    setModalExtraItems([]);
    setModalDrinkBrandFilter('ALL');
    setModalRetryPending(false);
  }, [modalOrder?.id]);

  useEffect(
    () =>
      subscribeOperationalStream(
        async (event) => {
          const shouldRefreshOrders =
            event.type === 'operational.refresh' ||
            (event.type === 'order.updated' && event.orderType !== 'DELIVERY') ||
            (event.type === 'order.updated' && !event.orderType) ||
            event.type === 'delivery.workflow.updated';
          const shouldRefreshTables =
            event.type === 'operational.refresh' ||
            (event.type === 'order.updated' && event.orderType !== 'DELIVERY');
          const shouldRefreshAlerts =
            event.type === 'operational.refresh' ||
            event.type === 'operational.alert.updated' ||
            (event.type === 'order.updated' && event.orderType !== 'DELIVERY');

          await Promise.all([
            shouldRefreshTables
              ? queryClient.refetchQueries({ queryKey: ['tables', 'waiter'], type: 'active' })
              : Promise.resolve(),
            shouldRefreshOrders
              ? queryClient.refetchQueries({ queryKey: ['orders-active', 'waiter'], type: 'active' })
              : Promise.resolve(),
            shouldRefreshAlerts
              ? queryClient.refetchQueries({ queryKey: ['operational-alerts', 'waiter'], type: 'active' })
              : Promise.resolve(),
          ]);
        },
        setStreamStatus,
      ),
    [queryClient],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!user?.sub) {
      return;
    }

    const prefs = readStoredJson<{ orderScope?: WaiterOrderScope; tableScope?: WaiterTableScope }>(
      getWaiterViewPrefsKey(user.sub),
      {},
    );

    if (prefs.orderScope) {
      setOrderScope(prefs.orderScope);
    }

    if (prefs.tableScope) {
      setTableScope(prefs.tableScope);
    }
  }, [user?.sub]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const refreshWaiterData = () => {
      void queryClient.refetchQueries({ queryKey: ['tables', 'waiter'], type: 'active' });
      void queryClient.refetchQueries({ queryKey: ['orders-active', 'waiter'], type: 'active' });
      void queryClient.refetchQueries({ queryKey: ['operational-alerts', 'waiter'], type: 'active' });
      void queryClient.refetchQueries({ queryKey: ['cash-current'], type: 'active' });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshWaiterData();
      }
    };

    const handleReconnect = () => {
      refreshWaiterData();
    };

    window.addEventListener('focus', refreshWaiterData);
    window.addEventListener('online', handleReconnect);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', refreshWaiterData);
      window.removeEventListener('online', handleReconnect);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [queryClient]);

  useEffect(() => {
    if (currentCash.data) {
      hadOpenCashRef.current = true;
      return;
    }

    if (!currentCash.isFetched || !hadOpenCashRef.current || !isOnline) {
      return;
    }

    hadOpenCashRef.current = false;
    expireCurrentSession('cash_closed');
    router.replace('/waiter/login');
  }, [currentCash.data, currentCash.isFetched, isOnline, router]);

  useEffect(() => {
    if (!selectedTableId || selectedOrder || draftHydratedTableId === selectedTableId) {
      return;
    }

    if (!user?.sub) {
      return;
    }

    const draft = readWaiterDraft(user.sub, selectedTableId);
    if (!draft) {
      setDraftHydratedTableId(selectedTableId);
      return;
    }

    setCart(draft.cart ?? []);
    setCustomerName(draft.customerName ?? '');
    setCustomerPhone(draft.customerPhone ?? '');
    setNotes(draft.notes ?? '');
    setOrderStatus(draft.orderStatus ?? 'OPEN');
    setDraftHydratedTableId(selectedTableId);
  }, [draftHydratedTableId, selectedOrder, selectedTableId, user?.sub]);

  useEffect(() => {
    if (!selectedTableId || viewMode !== 'compose') {
      return;
    }

    if (!user?.sub) {
      return;
    }

    writeWaiterDraft(user.sub, selectedTableId, {
      cart,
      customerName,
      customerPhone,
      notes,
      orderStatus,
      updatedAt: new Date().toISOString(),
    });
  }, [cart, customerName, customerPhone, notes, orderStatus, selectedTableId, user?.sub, viewMode]);

  useEffect(() => {
    if (!activeOrderModalId) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveOrderModalId(null);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeOrderModalId]);

  const openComposer = (tableId: string) => {
    const activeOrder = tableOrderMap.get(tableId) ?? null;
    if (activeOrder && getOrderOwnerId(activeOrder) !== user?.sub) {
      toast.warning(`Esta mesa ya la atiende ${getOrderOwnerName(activeOrder)}. La verás en modo protegido.`);
    }

    setUrlSelectionEnabled(true);
    setSelectedTableId(tableId);
    setDraftHydratedTableId(null);
    setSaveRetryPending(false);
    setViewMode('compose');
    router.replace(`/waiter?tableId=${tableId}`, { scroll: false });
  };

  const addCartItem = (
    current: CartItem[],
    product: Product,
    onErrorMessage: string,
  ) => {
    const existing = current.find((item) => item.productId === product.id);

    if (existing) {
      if (existing.kind === 'DIRECT_STOCK' && existing.quantity >= existing.stock) {
        toast.error(onErrorMessage);
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
        stock: Number(product.currentStock),
        quantity: 1,
      },
    ];
  };

  const addToCart = (product: Product) => {
    if (!selectedTableId) {
      toast.error('Selecciona una mesa antes de cargar productos.');
      return;
    }

    setCart((current) => addCartItem(current, product, `Stock insuficiente para ${product.name}`));
  };

  const addToModalOrder = (product: Product) => {
    if (!modalOrder) {
      toast.error('Abre una comanda para adicionar productos.');
      return;
    }

    setModalExtraItems((current) => addCartItem(current, product, `Stock insuficiente para ${product.name}`));
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

  const updateModalQuantity = (productId: string, nextQuantity: number) => {
    setModalExtraItems((current) =>
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

  const invalidateOperationalQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
      queryClient.invalidateQueries({ queryKey: ['tables', 'waiter'] }),
      queryClient.invalidateQueries({ queryKey: ['orders-active'] }),
      queryClient.invalidateQueries({ queryKey: ['orders-active', 'waiter'] }),
      queryClient.invalidateQueries({ queryKey: ['operational-alerts', 'waiter'] }),
      queryClient.invalidateQueries({ queryKey: ['reports-operational'] }),
      queryClient.invalidateQueries({ queryKey: ['cash-current'] }),
      queryClient.invalidateQueries({ queryKey: ['current-cash'] }),
      queryClient.invalidateQueries({ queryKey: ['daily-report'] }),
    ]);
  }, [queryClient]);

  const refreshOutboxCount = useCallback(() => {
    if (!user?.sub) {
      setPendingQueueCount(0);
      return;
    }

    setPendingQueueCount(readWaiterOutbox(user.sub).length);
  }, [user?.sub]);

  const queueWaiterOperation = useCallback(
    (operation: WaiterOutboxOperation) => {
      if (!user?.sub) {
        return;
      }

      const current = readWaiterOutbox(user.sub);
      writeWaiterOutbox(user.sub, [...current, operation]);
      refreshOutboxCount();
    },
    [refreshOutboxCount, user?.sub],
  );

  const updateQueuedOperation = useCallback(
    (operationId: string, updater: (operation: WaiterOutboxOperation) => WaiterOutboxOperation) => {
      if (!user?.sub) {
        return;
      }

      const current = readWaiterOutbox(user.sub);
      writeWaiterOutbox(
        user.sub,
        current.map((operation) => (operation.id === operationId ? updater(operation) : operation)),
      );
      refreshOutboxCount();
    },
    [refreshOutboxCount, user?.sub],
  );

  const removeQueuedOperation = useCallback(
    (operationId: string) => {
      if (!user?.sub) {
        return;
      }

      const current = readWaiterOutbox(user.sub);
      writeWaiterOutbox(
        user.sub,
        current.filter((operation) => operation.id !== operationId),
      );
      refreshOutboxCount();
    },
    [refreshOutboxCount, user?.sub],
  );

  useEffect(() => {
    if (!user?.sub) {
      return;
    }

    writeStoredJson(getWaiterViewPrefsKey(user.sub), { orderScope, tableScope });
  }, [orderScope, tableScope, user?.sub]);

  useEffect(() => {
    if (!user?.sub || !tables.data) {
      return;
    }

    writeStoredJson(getWaiterTablesCacheKey(user.sub), tables.data);
  }, [tables.data, user?.sub]);

  useEffect(() => {
    if (!user?.sub || !activeOrders.data) {
      return;
    }

    writeStoredJson(getWaiterActiveOrdersCacheKey(user.sub), activeOrders.data);
  }, [activeOrders.data, user?.sub]);

  useEffect(() => {
    if (!user?.sub || !waiterAlerts.data) {
      return;
    }

    writeStoredJson(getWaiterAlertsCacheKey(user.sub), waiterAlerts.data);
  }, [user?.sub, waiterAlerts.data]);

  const sendQueuedOperation = useCallback(
    (operation: WaiterOutboxOperation) =>
      apiFetch<ActiveOrder>('/orders/waiter-sync', {
        method: 'POST',
        body: JSON.stringify({
          tableId: operation.tableId,
          orderId: operation.orderId ?? undefined,
          customerName: operation.customerName || undefined,
          customerPhone: operation.customerPhone || undefined,
          notes: operation.notes || undefined,
          status: operation.orderStatus,
          expectedRevision: operation.expectedRevision,
          items: operation.items,
          clientMutationId: operation.id,
          takeOwnership: operation.takeOwnership === true,
        }),
      }),
    [],
  );

  const flushQueuedOperations = useCallback(async () => {
    if (!user?.sub || !isOnline || isFlushingQueue) {
      return;
    }

    const queue = readWaiterOutbox(user.sub);
    if (!queue.length) {
      refreshOutboxCount();
      return;
    }

    setIsFlushingQueue(true);

    try {
      for (const operation of queue) {
        try {
          await sendQueuedOperation(operation);
          removeQueuedOperation(operation.id);
          if (operation.tableId && user.sub) {
            clearWaiterDraft(user.sub, operation.tableId);
          }
          setSaveRetryPending(false);
          setModalRetryPending(false);
          await invalidateOperationalQueries();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'No pudimos enviar la cola pendiente.';
          updateQueuedOperation(operation.id, (current) => ({
            ...current,
            attemptCount: current.attemptCount + 1,
            lastError: message,
          }));

          if (error instanceof ApiError && error.status === 0) {
            break;
          }

          toast.error(message);
          break;
        }
      }
    } finally {
      setIsFlushingQueue(false);
      refreshOutboxCount();
    }
  }, [invalidateOperationalQueries, isFlushingQueue, isOnline, refreshOutboxCount, removeQueuedOperation, sendQueuedOperation, updateQueuedOperation, user?.sub]);

  useEffect(() => {
    refreshOutboxCount();
  }, [refreshOutboxCount]);

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    void flushQueuedOperations();
  }, [flushQueuedOperations, isOnline]);

  const issues = [
    !currentCash.isLoading && !currentCash.data ? 'Abre caja antes de registrar pedidos.' : null,
    !selectedTableId ? 'Selecciona una mesa.' : null,
    !cart.length ? 'Agrega al menos un producto.' : null,
  ].filter(Boolean) as string[];

  const saveOrder = useMutation({
    mutationFn: async () => {
      if (!selectedTableId) {
        throw new Error('Selecciona una mesa antes de enviar el pedido.');
      }

      if (!currentCash.data) {
        throw new Error('La caja debe estar abierta antes de tomar pedidos.');
      }

      const items = cart.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.price,
      }));

      const operation: WaiterOutboxOperation = {
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `waiter-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        orderId: selectedOrder?.id ?? null,
        tableId: selectedTableId,
        customerName,
        customerPhone,
        notes,
        orderStatus,
        expectedRevision: selectedOrder?.revision,
        items,
        queuedAt: new Date().toISOString(),
        attemptCount: 0,
      };

      if (!isOnline) {
        queueWaiterOperation(operation);
        return { queued: true as const };
      }

      try {
        const order = await sendQueuedOperation(operation);
        return { queued: false as const, order };
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) {
          queueWaiterOperation(operation);
          return { queued: true as const };
        }

        throw error;
      }
    },
    onSuccess: async (result) => {
      if (result.queued) {
        setSaveRetryPending(true);
        toast.warning('Pedido guardado en cola. Se enviará cuando la red vuelva.');
        refreshOutboxCount();
        return;
      }

      if (selectedTableId && user?.sub) {
        clearWaiterDraft(user.sub, selectedTableId);
      }
      setSaveRetryPending(false);
      setSaveFeedback('saved');
      setTimeout(() => setSaveFeedback(null), 4000);
      toast.success(selectedOrder ? 'Comanda actualizada' : 'Pedido enviado a la comanda');
      resetComposer();
      await invalidateOperationalQueries();
    },
    onError: (error) => {
      setSaveRetryPending(true);
      setSaveFeedback('error');
      setTimeout(() => setSaveFeedback(null), 5000);
      toast.error(
        error instanceof Error
          ? error.message
          : 'No pudimos guardar el pedido. Conservamos el borrador para reintentar.',
      );
    },
  });

  const updateExistingOrder = useMutation({
    mutationFn: async () => {
      if (!modalOrder) {
        throw new Error('No encontramos la comanda activa.');
      }

      if (!currentCash.data) {
        throw new Error('La caja debe estar abierta antes de actualizar pedidos.');
      }

      const merged = new Map<string, { productId: string; quantity: number; unitPrice: number }>();

      modalOrder.items.forEach((item) => {
        merged.set(item.productId, {
          productId: item.productId,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
        });
      });

      modalExtraItems.forEach((item) => {
        const existing = merged.get(item.productId);
        if (existing) {
          existing.quantity += item.quantity;
          return;
        }

        merged.set(item.productId, {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.price,
        });
      });

      const operation: WaiterOutboxOperation = {
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `waiter-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        orderId: modalOrder.id,
        tableId: modalOrder.tableId ?? '',
        customerName: modalOrder.customerName ?? '',
        customerPhone: modalOrder.customerPhone ?? '',
        notes: modalNotes,
        orderStatus: modalOrderStatus,
        expectedRevision: modalOrder.revision,
        items: Array.from(merged.values()),
        queuedAt: new Date().toISOString(),
        attemptCount: 0,
      };

      if (!isOnline) {
        queueWaiterOperation(operation);
        return { queued: true as const };
      }

      try {
        const order = await sendQueuedOperation(operation);
        return { queued: false as const, order };
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) {
          queueWaiterOperation(operation);
          return { queued: true as const };
        }

        throw error;
      }
    },
    onSuccess: async (result) => {
      if (result.queued) {
        setModalRetryPending(true);
        toast.warning('Actualización guardada en cola. Se enviará cuando la red vuelva.');
        refreshOutboxCount();
        return;
      }

      if (modalOrder?.tableId) {
        if (user?.sub) {
          clearWaiterDraft(user.sub, modalOrder.tableId);
        }
      }
      setModalRetryPending(false);
      toast.success('Comanda actualizada desde seguimiento');
      setActiveOrderModalId(null);
      setModalExtraItems([]);
      await invalidateOperationalQueries();
    },
    onError: (error) => {
      setModalRetryPending(true);
      toast.error(
        error instanceof Error
          ? error.message
          : 'No pudimos actualizar la comanda. Intenta de nuevo.',
      );
    },
  });

  const claimSelectedOrder = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) {
        throw new Error('No encontramos la comanda a reclamar.');
      }

      return apiFetch<ActiveOrder>(`/orders/${selectedOrder.id}/claim`, {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Asignación directa desde panel de meseros.',
        }),
      });
    },
    onSuccess: async () => {
      toast.success('Comanda tomada a tu cargo');
      await invalidateOperationalQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No pudimos tomar la comanda.');
    },
  });

  const claimModalOrder = useMutation({
    mutationFn: async () => {
      if (!modalOrder) {
        throw new Error('No encontramos la comanda a reclamar.');
      }

      return apiFetch<ActiveOrder>(`/orders/${modalOrder.id}/claim`, {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Asignación directa desde seguimiento de meseros.',
        }),
      });
    },
    onSuccess: async () => {
      toast.success('Comanda tomada a tu cargo');
      await invalidateOperationalQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No pudimos tomar la comanda.');
    },
  });

  const updateWaiterAlert = useMutation({
    mutationFn: ({ alertId, status }: { alertId: string; status: Exclude<WaiterAlertStatus, 'OPEN'> }) =>
      apiFetch<WaiterOperationalAlert>(`/orders/operational-alerts/${alertId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['operational-alerts', 'waiter'], type: 'active' });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No pudimos actualizar la alerta.');
    },
  });

  const pageStatus = currentCash.data ? (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="success">{serviceMetrics.activeOrders} comandas activas</Badge>
      <Badge tone="neutral">Turno {shiftStartedLabel}</Badge>
      {!isOnline ? <Badge tone="warning">Sin conexión</Badge> : null}
      {pendingQueueCount ? (
        <Badge tone={isFlushingQueue ? 'info' : 'warning'}>
          {isFlushingQueue ? `Sincronizando ${pendingQueueCount}` : `${pendingQueueCount} en cola`}
        </Badge>
      ) : null}
      <Badge tone={streamStatus === 'open' ? 'info' : streamStatus === 'connecting' ? 'warning' : 'neutral'}>
        {streamStatus === 'open' ? 'En vivo' : streamStatus === 'connecting' ? 'Reconectando' : 'Sin canal'}
      </Badge>
    </div>
  ) : (
    <Badge tone="warning">Caja pendiente</Badge>
  );

  return (
    <div
      className="space-y-4 p-3.5 sm:space-y-5 sm:p-5 lg:p-6"
      style={{ paddingBottom: viewMode === 'compose' ? 'max(5.75rem, calc(env(safe-area-inset-bottom) + 5rem))' : 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      {viewMode === 'home' ? (
        <>
          <div className="-mx-3.5 -mt-3.5 sm:-mx-5 sm:-mt-5 lg:-mx-6 lg:-mt-6 mb-4 rounded-b-2xl bg-black px-4 py-4 sm:px-5 lg:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <img src="/brand/sidebar-logo.png" alt="2X1" className="h-8 w-8 rounded-lg object-contain opacity-90" />
                <div className="min-w-0">
                  <h1 className="text-[1.1rem] font-extrabold text-white leading-tight truncate">{user?.fullName ?? 'Mesero'}</h1>
                  <p className="text-[10px] text-stone-400">Turno {shiftStartedLabel} · {serviceMetrics.free} mesas libres</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!isOnline ? <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[9px] font-bold text-red-400">Sin red</span> : null}
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${currentCash.data ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {currentCash.data ? 'Abierta' : 'Cerrada'}
                </span>
                <button type="button" onClick={async () => { await logout(); window.location.href = '/waiter/login'; }}
                  className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 hover:bg-white/10 hover:text-stone-300 transition"
                  title="Cerrar sesion">
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {!currentCash.data ? (
            <StatusBanner tone="warning" title="La caja esta cerrada" description="Abre caja para registrar pedidos." />
          ) : null}

          <div className="flex items-center gap-3 mb-3 text-[11px] font-bold text-stone-500">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{serviceMetrics.free} libres</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{serviceMetrics.inService} en servicio</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-brand-500" />{serviceMetrics.myTables} mias</span>
          </div>

<div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {!tables.isLoading && !visibleTables.length ? (
              <div className="col-span-2 rounded-2xl border border-dashed border-stone-200 bg-white p-5 text-center sm:col-span-3 lg:col-span-4">
                <p className="text-[14px] font-extrabold text-ink">No tienes mesas asignadas</p>
                <p className="mt-1 text-[12px] text-stone-500">Consulta con el administrador.</p>
              </div>
            ) : null}

            {visibleTables.map((table) => {
              const activeOrder = tableOrderMap.get(table.id) ?? null;
              const tableStatus = getTableStatusMeta(activeOrder);
              const isMine = activeOrder ? getOrderOwnerId(activeOrder) === user?.sub : false;
              return (
                <button key={table.id} type="button" onClick={() => openComposer(table.id)}
                  data-testid={`waiter-table-${table.label.toLowerCase().replace(/\s+/g, '-')}`}
                  className={`group relative flex min-h-[6.5rem] flex-col overflow-hidden rounded-2xl border text-left transition-all ${table.id === selectedTableId ? 'border-brand-300 bg-brand-50/40 ring-1 ring-brand-200 shadow-sm' : 'border-stone-200 bg-white hover:border-stone-300 hover:shadow-sm'}`}>
                  <div className="h-1 w-full shrink-0" style={{ backgroundColor: activeOrder ? (table.group?.color ?? '#e7e5e4') : 'transparent' }} />
                  <div className="flex flex-1 flex-col items-center justify-center px-3 py-3 text-center">
                    <p className="text-[1.5rem] font-black leading-none text-ink">{table.label}</p>
                    <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${activeOrder ? ((tableStatus.tone as string) === 'danger' ? 'bg-red-100 text-red-700' : (tableStatus.tone as string) === 'info' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700') : 'bg-emerald-100 text-emerald-700'}`}>
                      {activeOrder ? 'Con servicio' : 'Libre'}
                    </span>
                    {activeOrder ? (
                      <p className="mt-2 text-[17px] font-extrabold text-ink tabular-nums">{formatCurrency(activeOrder.subtotal)}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* Header premium */}
          <div className="-mx-3.5 -mt-3.5 sm:-mx-5 sm:-mt-5 mb-4 rounded-t-2xl bg-black px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => { setViewMode('home'); setSelectedTableId(''); setCart([]); }}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-stone-300 hover:bg-white/20">
                  <X className="h-4 w-4" />
                </button>
                <div>
                  <h1 className="text-[1.2rem] font-extrabold text-white">{selectedTable?.label ?? 'Mesa'}</h1>
                  <p className="text-[11px] text-stone-400">
                    {selectedOrder ? `Comanda ${selectedOrder.number} · ${formatCurrency(selectedOrder.subtotal)}` : 'Nueva comanda'}
                  </p>
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${currentCash.data ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                {currentCash.data ? 'Caja abierta' : 'Cerrada'}
              </span>
            </div>
          </div>

          {/* Status banner si caja cerrada */}
          {!currentCash.data ? (
            <StatusBanner tone="warning" title="Caja cerrada" description="Abre caja para guardar pedidos." />
          ) : null}

          {/* Category tabs */}
          <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 no-scrollbar">
            {composeCategories.map((cat) => (
              <button key={cat} type="button" onClick={() => { setComposeCategory(cat); }}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                  composeCategory === cat ? 'bg-brand-500 text-ink shadow-sm' : 'border border-stone-200 bg-white text-stone-500 hover:bg-stone-50'
                }`}>
                {cat}
              </button>
            ))}
          </div>

          {/* Product grid — limit 10 visible, premium scroll */}
          {composeFilteredProducts.length > 0 ? (
            <div className={`${composeFilteredProducts.length > 10 ? 'max-h-[26rem] overflow-y-auto no-scrollbar rounded-xl' : ''}`}>
              <div className="grid gap-2 grid-cols-2 pr-0.5">
                {composeFilteredProducts.map((product) => (
              <button key={product.id} type="button"
                onClick={() => setCart((c) => addCartItem(c, product, `Sin stock para ${product.name}`))}
                disabled={!product.isActive || (product.kind === 'DIRECT_STOCK' && Number(product.currentStock) <= 0)}
                className="rounded-xl border border-stone-200 bg-white p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/30 hover:shadow-sm disabled:opacity-40">
                <p className="truncate text-[13px] font-extrabold leading-tight text-ink">{product.name}</p>
                <div className="mt-1.5 flex items-center justify-between">
                  <p className="text-[13px] font-black text-brand-600 tabular-nums">{formatCurrency(product.salePrice)}</p>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-[12px] font-black text-ink">+</span>
                </div>
              </button>
            ))}
            {composeFilteredProducts.length === 0 ? (
              <p className="col-span-2 py-8 text-center text-[12px] text-stone-400">Sin productos en esta categoria</p>
            ) : null}
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-[12px] text-stone-400">Cargando productos...</p>
          )}

          {/* Carrito premium */}
          {cart.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50/30 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[13px] font-extrabold text-ink">Comanda</p>
                  <p className="text-[10px] text-stone-500">{cart.length} items · Mesa {selectedTable?.label}</p>
                </div>
                <button type="button" onClick={() => setCart([])} className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-red-500 hover:bg-red-50">Limpiar</button>
              </div>
              <div className="space-y-1.5">
                {cart.map((item, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-sm">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setCart((c: any[]) => { const n = [...c]; (n[i] as any).quantity = Math.max(0, (n[i] as any).quantity - 1); return n.filter((x: any) => x.quantity > 0); })}
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-stone-200 bg-white text-[12px] font-bold text-stone-500 hover:border-stone-300">-</button>
                      <span className="text-[13px] font-bold tabular-nums w-5 text-center">{item.quantity}</span>
                      <button type="button" onClick={() => setCart((c: any[]) => { const n = [...c]; (n[i] as any).quantity = (n[i] as any).quantity + 1; return n; })}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-[12px] font-bold text-ink hover:bg-brand-600">+</button>
                    </div>
                    <span className="text-[12px] font-bold text-ink truncate flex-1 mx-3">{item.name}</span>
                    <span className="text-[13px] font-extrabold text-ink tabular-nums">{formatCurrency(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-brand-100 pt-3">
                <span className="text-[12px] font-extrabold uppercase tracking-[0.1em] text-stone-500">Total</span>
                <span className="text-[1.2rem] font-black text-ink tabular-nums">
                  {formatCurrency(cart.reduce((sum, item) => sum + item.price * item.quantity, 0))}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 p-6 text-center">
              <p className="text-[13px] font-bold text-stone-400">Carrito vacio</p>
              <p className="mt-1 text-[11px] text-stone-400">Agrega productos desde el menu</p>
            </div>
          )}

          {/* Notas */}
          <div className="mt-4">
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {['Sin cebolla', 'Sin salsas', 'Bien asada', 'Para llevar'].map((n) => (
                <button key={n} type="button" onClick={() => setNotes((prev) => prev.includes(n) ? prev.replace(n, '').trim() : `${prev} ${n}`.trim())}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${notes.includes(n) ? 'bg-brand-500 text-ink' : 'border border-stone-200 bg-white text-stone-500 hover:bg-stone-50'}`}>
                  {n}
                </button>
              ))}
            </div>
            <div className="relative">
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Instrucciones especiales..."
                className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-[12px] font-medium text-ink placeholder:text-stone-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200" />
              {notes ? (
                <button type="button" onClick={() => setNotes('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>

          {/* Guardar */}
          <Button type="button" disabled={!cart.length || saveOrder.isPending || !currentCash.data} data-testid="waiter-save-order"
            onClick={() => {
              if (!selectedTableId) { toast.error('Selecciona una mesa'); return; }
              saveOrder.mutate();
            }}
            className="mt-4 w-full rounded-2xl py-6 text-[14px] font-extrabold shadow-md">
            {saveOrder.isPending ? 'Guardando...' : selectedOrder ? 'Actualizar comanda' : 'Guardar comanda'}
          </Button>

          {/* Feedback */}
          {saveFeedback === 'saved' ? (
            <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-bold text-emerald-800 text-center" data-testid="waiter-save-success-banner">
              Comanda guardada. POS ya puede verla.
            </div>
          ) : saveFeedback === 'error' ? (
            <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-800 text-center" data-testid="waiter-save-error-banner">
              No pudimos guardar. Intenta nuevamente.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
