export const SOFIA_DOMAIN_ERROR_CODES = [
  'SOFIA_DOMAIN_FORBIDDEN',
  'SOFIA_DOMAIN_NOT_FOUND',
  'SOFIA_PRODUCT_UNAVAILABLE',
  'SOFIA_RECIPE_UNAVAILABLE',
  'SOFIA_DELIVERY_QUOTE_REQUIRED',
  'SOFIA_DELIVERY_QUOTE_EXPIRED',
  'SOFIA_DRAFT_VERSION_CONFLICT',
  'SOFIA_DRAFT_NOT_CONFIRMABLE',
  'SOFIA_ORDER_IDEMPOTENCY_CONFLICT',
  'SOFIA_ORDER_CREATION_BLOCKED',
  'SOFIA_PAYMENT_READ_FORBIDDEN',
  'SOFIA_DOMAIN_DEPENDENCY_UNAVAILABLE',
] as const;

export type SofiaDomainErrorCode = (typeof SOFIA_DOMAIN_ERROR_CODES)[number];
export type SofiaSource = 'SOFIA_ADMIN' | 'SOFIA_WHATSAPP' | 'SOFIA_SANDBOX' | 'SYSTEM';

export type SofiaActorContext = {
  actorId: string;
  roles: string[];
  source: SofiaSource;
  requestId?: string | null;
  correlationId?: string | null;
};

export type CatalogProductDto = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  category: { id: string; name: string; slug: string } | null;
  kind: 'DIRECT_STOCK' | 'PREPARED' | 'SERVICE';
  persistedPrice: number;
  active: boolean;
  trackStock: boolean;
  updatedAt: string;
};

export interface CatalogReadService {
  listActive(input?: { brand?: string }): Promise<CatalogProductDto[]>;
  getActiveById(productId: string): Promise<CatalogProductDto>;
  findActive(input: { code?: string; name?: string }): Promise<CatalogProductDto | null>;
}

export type AvailabilityDto = {
  productId: string;
  quantity: number;
  available: boolean;
  reasonCode: string;
  checkedAt: string;
};

export interface ProductAvailabilityService {
  check(input: { productId: string; quantity: number }): Promise<AvailabilityDto>;
}

export type RecipeAvailabilityDto = AvailabilityDto & {
  missingIngredients: Array<{ ingredientId: string; name: string; required: number; available: number }>;
  recipeIngredients?: Array<{ ingredientId: string; name: string }>;
};

export interface RecipeAvailabilityService {
  check(input: { productId: string; quantity: number }): Promise<RecipeAvailabilityDto>;
}

export type CustomerResolutionDto = {
  customerId: string;
  displayName: string | null;
  phoneMasked: string;
  created: boolean;
};

export interface CustomerResolutionService {
  resolve(input: { phone: string; displayName?: string; idempotencyKey: string; actor: SofiaActorContext }): Promise<CustomerResolutionDto>;
}

export type DeliveryQuoteDto = {
  auditId: string | null;
  status: string;
  finalFee: number | null;
  currency: 'COP';
  distanceKm: number | null;
  estimatedMinutes: number | null;
  reasonCode: string;
  calculationVersion: string;
  canCheckout: boolean;
};

export interface DeliveryQuoteService {
  quote(input: {
    addressText?: string;
    neighborhood?: string;
    latitude?: number;
    longitude?: number;
    orderSubtotal: number;
    actor: SofiaActorContext;
  }): Promise<DeliveryQuoteDto>;
}

export type OrderDraftItemInput = { productId: string; quantity: number; notes?: string };
export type OrderDraftCommand = {
  conversationId?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryNeighborhood?: string;
  deliveryNotes?: string;
  aiSummary?: string;
  items?: OrderDraftItemInput[];
};
export type OrderDraftDto = {
  id: string;
  status: string;
  version: string;
  itemsSnapshot: Array<{ productId: string; code: string; name: string; quantity: number; unitPrice: number; totalPrice: number; notes?: string | null }>;
  missingFields: string[] | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryNeighborhood: string | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export interface OrderDraftService {
  create(input: OrderDraftCommand, actor: SofiaActorContext): Promise<OrderDraftDto>;
  update(draftId: string, expectedVersion: string, input: OrderDraftCommand, actor: SofiaActorContext): Promise<OrderDraftDto>;
  confirm(draftId: string, expectedVersion: string, actor: SofiaActorContext): Promise<OrderDraftDto>;
}

export type OrderCreationResultDto = {
  checkoutId: string;
  orderTicketId: string;
  orderNumber: string;
  replayed: boolean;
};

export interface OrderCreationService {
  /**
   * Governed bridge: SofiaOrderDraft (CONFIRMED) -> SecureCommand(SOFIA_CREATE_ORDER) -> canonical
   * OrderCheckout -> canonical OrderTicket. Never creates a parallel order model. Never mutates
   * payment, kitchen, delivery or stock state. Fails closed (throws) whenever the draft is not
   * confirmable, SecureCommand is unavailable, or SecureCommand policy/governance blocks execution
   * (which remains the case in every environment until an owner-authorized activation flips the
   * SOFIA_CREATE_ORDER command policy `enabled` flag -- see command-handler.registry.ts).
   *
   * `expectedDraftVersion` is optional legacy-caller defense-in-depth (compared against the raw
   * draft's updatedAt ISO timestamp when supplied); the authoritative optimistic-concurrency check
   * is always the draft's numeric version/hash chain re-read fresh from the confirmed draft record.
   */
  createFromSofiaDraft(input: {
    draftId: string;
    expectedDraftVersion?: string;
    idempotencyKey: string;
    actor: SofiaActorContext;
  }): Promise<OrderCreationResultDto>;
}

export type PaymentReadDto = {
  orderTicketId: string;
  paymentStatus: string | null;
  paymentMethod: string | null;
  provider: string | null;
  expiresAt: string | null;
  linkAvailable: boolean;
};

export interface PaymentReadService {
  readOrderPayment(orderTicketId: string, actor: SofiaActorContext): Promise<PaymentReadDto>;
}

export type AuditCommandInput = {
  actor: SofiaActorContext;
  action: string;
  entity: string;
  entityId?: string | null;
  result?: 'SUCCESS' | 'REJECTED' | 'FAILED' | 'CONFLICT' | 'BLOCKED' | 'NO_OP' | 'ROLLED_BACK';
  reasonCode?: string | null;
  before?: unknown;
  after?: unknown;
};

export type AuditTransactionContext = { readonly auditClient: unknown };

export interface AuditCommandService {
  record(input: AuditCommandInput, transaction?: AuditTransactionContext): Promise<{ auditEventId: string; timestamp: string }>;
}

export const CATALOG_READ_SERVICE = Symbol('CatalogReadService');
export const PRODUCT_AVAILABILITY_SERVICE = Symbol('ProductAvailabilityService');
export const RECIPE_AVAILABILITY_SERVICE = Symbol('RecipeAvailabilityService');
export const CUSTOMER_RESOLUTION_SERVICE = Symbol('CustomerResolutionService');
export const DELIVERY_QUOTE_SERVICE = Symbol('DeliveryQuoteService');
export const ORDER_DRAFT_SERVICE = Symbol('OrderDraftService');
export const ORDER_CREATION_SERVICE = Symbol('OrderCreationService');
export const PAYMENT_READ_SERVICE = Symbol('PaymentReadService');
export const AUDIT_COMMAND_SERVICE = Symbol('AuditCommandService');
