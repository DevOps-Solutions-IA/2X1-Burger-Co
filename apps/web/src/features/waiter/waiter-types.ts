export type TableStatus = 'FREE' | 'OCCUPIED' | 'RESERVED' | 'PAYMENT_PENDING' | 'OUT_OF_SERVICE';
export type OrderStatus = 'OPEN' | 'IN_PREPARATION' | 'SERVED' | 'PAYMENT_PENDING';
export type ProductBrand = 'HOUSE' | 'COCA_COLA' | 'OTHER';

export type DiningTable = {
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
    _count: { items: number };
  }>;
};

export type Product = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  kind: 'PREPARED' | 'DIRECT_STOCK';
  brand: ProductBrand;
  salePrice: number | string;
  currentStock: number | string;
  stockMin: number | string;
  category: { id: string; name: string };
};

export type ActiveOrder = {
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
  createdBy: { id: string; fullName: string };
  assignedWaiter: { id: string; fullName: string } | null;
  items: Array<{
    productId: string;
    quantity: number | string;
    unitPrice: number | string;
    product: {
      name: string;
      code: string;
      kind: Product['kind'];
      currentStock: number | string;
      category: { name: string };
    };
  }>;
};

export type CartItem = {
  productId: string;
  name: string;
  code: string;
  categoryName: string;
  kind: Product['kind'];
  price: number;
  stock: number;
  quantity: number;
};
