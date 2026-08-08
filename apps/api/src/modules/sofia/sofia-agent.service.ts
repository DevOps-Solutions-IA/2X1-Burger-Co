import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  Prisma,
  SofiaOrderSource,
  WhatsappMessageDirection,
  WhatsappMessageType,
} from '@prisma/client';
import {
  CATALOG_READ_SERVICE,
  ORDER_CREATION_SERVICE,
  ORDER_DRAFT_SERVICE,
  PRODUCT_AVAILABILITY_SERVICE,
  RECIPE_AVAILABILITY_SERVICE,
  type CatalogProductDto,
  type CatalogReadService,
  type OrderCreationService,
  type OrderDraftDto,
  type OrderDraftService,
  type ProductAvailabilityService,
  type RecipeAvailabilityService,
  type SofiaActorContext,
} from '../../application/contracts/sofia-domain-contracts';
import { SofiaAIProviderFactory } from './ai/sofia-ai-provider.factory';
import { SofiaAutoSafeEngineService } from './auto-safe/sofia-auto-safe-engine.service';
import { SofiaCommercialCatalogService } from './catalog/sofia-commercial-catalog.service';
import { CommercialCheckoutService } from './commercial/commercial-checkout.service';
import { SOFIA_MAXI_FAMILY_REQUIRED_COPY } from './catalog/sofia-commercial-catalog.seed';
import {
  SofiaCommercialCatalogItemSnapshot,
} from './catalog/sofia-commercial-catalog.types';
import { ProcessSofiaAgentMessageDto, RecoverSofiaAbandonedDraftDto } from './dto/sofia.dto';
import { SofiaConversationMemoryService } from './memory/sofia-conversation-memory.service';
import { SofiaCustomerMemoryService } from './memory/sofia-customer-memory.service';
import { SofiaPromptService } from './prompt/sofia-prompt.service';
import { SofiaRuntimeSafetyService } from './runtime-safety/sofia-runtime-safety.service';
import { getActiveSofiaFeaturedOffers, SofiaFeaturedOffer } from './sofia-featured-offers';
import { SofiaService } from './sofia.service';
import { SofiaAgentRepository } from './repositories/sofia-agent.repository';

type SofiaIntent =
  | 'GREETING'
  | 'ASK_MENU'
  | 'ASK_COMBO'
  | 'ASK_PRICE'
  | 'ORDER_ITEM'
  | 'ADD_ITEM'
  | 'REMOVE_ITEM'
  | 'MODIFY_QUANTITY'
  | 'ASK_DELIVERY'
  | 'PROVIDE_ADDRESS'
  | 'PROVIDE_NAME'
  | 'PROVIDE_PAYMENT_METHOD'
  | 'CONFIRM_ORDER'
  | 'CANCEL_ORDER'
  | 'ASK_HUMAN'
  | 'UNKNOWN';

type AgentItem = {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string | null;
  imageUrl?: string | null;
  categoryName?: string | null;
};

type ActiveProduct = CatalogProductDto & { available: boolean };

type SofiaUpsell = {
  productId: string;
  name: string;
  price: number | null;
  message: string;
};

type SofiaMediaSuggestion = {
  type: 'IMAGE';
  productId: string;
  productName: string;
  imageUrl: string;
  altText: string;
  offerSlug: string;
  salesHint: string;
};

const DELIVERY_FEE_SANDBOX = 0;
const OPEN_HOUR = 17;
const CLOSE_HOUR = 24;
type HeaderMap = Record<string, string | string[] | undefined>;

@Injectable()
export class SofiaAgentService {
  constructor(
    private readonly sofiaService: SofiaService,
    private readonly repository: SofiaAgentRepository,
    @Inject(CATALOG_READ_SERVICE) private readonly catalogRead: CatalogReadService,
    @Inject(PRODUCT_AVAILABILITY_SERVICE) private readonly productAvailability: ProductAvailabilityService,
    @Inject(RECIPE_AVAILABILITY_SERVICE) private readonly recipeAvailability: RecipeAvailabilityService,
    @Inject(ORDER_DRAFT_SERVICE) private readonly orderDrafts: OrderDraftService,
    @Inject(ORDER_CREATION_SERVICE) private readonly orderCreation: OrderCreationService,
    private readonly aiProviderFactory: SofiaAIProviderFactory,
    private readonly autoSafeEngine: SofiaAutoSafeEngineService,
    private readonly configService: ConfigService,
    private readonly promptService: SofiaPromptService,
    private readonly catalogService: SofiaCommercialCatalogService,
    private readonly customerMemoryService: SofiaCustomerMemoryService,
    private readonly conversationMemoryService: SofiaConversationMemoryService,
    private readonly runtimeSafetyService: SofiaRuntimeSafetyService,
    private readonly commercialCheckout: CommercialCheckoutService,
  ) {}

  private actorContext(actorId: string, source: 'WHATSAPP' | 'SANDBOX'): SofiaActorContext {
    return { actorId, roles: ['sofia-supervised'], source: source === 'WHATSAPP' ? 'SOFIA_WHATSAPP' : 'SOFIA_SANDBOX' };
  }

  private normalizeText(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s#-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sandboxPhone(actorId: string) {
    const digits = [...createHash('sha256').update(actorId).digest('hex').slice(0, 9)]
      .map((value) => String(Number.parseInt(value, 16) % 10))
      .join('');
    return `0${digits}`;
  }

  private isMenuOrPhotoRequest(normalized: string) {
    return /\b(que tienen|menu|carta|combos|combo|hamburguesas|recomiendas|recomendacion|foto|fotos|imagen|imagenes|opciones|ver opciones)\b/.test(
      normalized,
    );
  }

  private hasMaxiCopyConfusion(normalized: string) {
    const riskyPhrases = [
      ['papas', 'grandes'],
      ['papas', 'familiares'],
      ['papas', 'para', 'todos'],
      ['porcion', 'familiar'],
      ['papitas', 'para', 'todos'],
      ['combo', 'familiar', 'con', 'papas', 'familiares'],
      ['papas', 'incluidas', 'para', 'todos'],
    ];
    return riskyPhrases.some((tokens) => normalized.includes(tokens.join(' ')));
  }

  private isRepeatLastOrderRequest(normalized: string) {
    return /\b(lo mismo|mismo de ayer|igual que ayer|repetir|repiteme|repíteme)\b/.test(normalized);
  }

  private paymentMethodFromText(normalized: string) {
    if (/\b(nequi|transferencia)\b/.test(normalized)) return 'NEQUI_MANUAL';
    if (/\b(efectivo|cash)\b/.test(normalized)) return 'CASH';
    if (/\b(online|linea|link|tarjeta)\b/.test(normalized)) return 'ONLINE';
    return null;
  }

  private isComplaint(normalized: string) {
    return /\b(queja|reclamo|me llego mal|me llego frio|frio|demorado|malo|molesto|enojado|devolucion)\b/.test(normalized);
  }

  private findFeaturedOffer(normalized: string): SofiaFeaturedOffer | null {
    const offers = getActiveSofiaFeaturedOffers();
    if (/\b(maxi|family|familiar)\b/.test(normalized)) return offers.find((offer) => offer.slug === 'maxi-family') ?? null;
    if (/\b(2x1|dos por uno)\b/.test(normalized)) return offers.find((offer) => offer.slug === '2x1-hamburguesas') ?? null;
    if (/\b(doble todo|dobletodo)\b/.test(normalized)) return offers.find((offer) => offer.slug === 'doble-todo') ?? null;
    if (/\b(sencilla|simple|clasica|clasico)\b/.test(normalized)) return offers.find((offer) => offer.slug === 'hamburguesa-sencilla') ?? null;
    return null;
  }

  private activeFeaturedOfferFromDraft(draft: { aiSummary?: string | null } | null) {
    const match = draft?.aiSummary?.match(/FeaturedOffer:([a-z0-9-]+)/);
    if (!match?.[1]) return null;
    return getActiveSofiaFeaturedOffers().find((offer) => offer.slug === match[1]) ?? null;
  }

  private quantityFromText(normalized: string) {
    const numeric = normalized.match(/\b(\d{1,2})\b/);
    if (numeric) return Math.max(Number(numeric[1]) || 1, 1);
    if (/\bdos\b/.test(normalized)) return 2;
    if (/\btres\b/.test(normalized)) return 3;
    if (/\bcuatro\b/.test(normalized)) return 4;
    return 1;
  }

  private isInsideBusinessHours(nowInput?: string) {
    const now = nowInput ? new Date(nowInput) : new Date();
    const bogota = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      hour12: false,
    }).format(now);
    const hour = Number(bogota);
    return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
  }

  private classifyIntent(normalized: string, confidence = 1): { intent: SofiaIntent; confidence: number } {
    if (confidence < 0.55) return { intent: 'UNKNOWN', confidence };
    if (/\b(humano|persona|asesor|alguien|equipo)\b/.test(normalized)) return { intent: 'ASK_HUMAN', confidence: 0.95 };
    if (this.isComplaint(normalized)) return { intent: 'ASK_HUMAN', confidence: 0.9 };
    if (/\b(cancel|cancela|no quiero|ya no)\b/.test(normalized)) return { intent: 'CANCEL_ORDER', confidence: 0.9 };
    if (/\b(confirmo|confirmar|listo|dale|de una|si confirmo|si)\b/.test(normalized)) return { intent: 'CONFIRM_ORDER', confidence: 0.86 };
    if (this.isRepeatLastOrderRequest(normalized)) return { intent: 'ORDER_ITEM', confidence: 0.84 };
    if (this.isMenuOrPhotoRequest(normalized)) return { intent: normalized.includes('combo') ? 'ASK_COMBO' : 'ASK_MENU', confidence: 0.9 };
    if (/\b(quiero|kiero|deme|dame|me das|pedido|hamburguesa|hamburgesa|burger|burguer|burguers|gaseosa|bebida|papas)\b/.test(normalized)) {
      return { intent: 'ORDER_ITEM', confidence: 0.88 };
    }
    if (this.findFeaturedOffer(normalized)) return { intent: 'ASK_COMBO', confidence: 0.88 };
    if (/\b(2x1|promocion|promo)\b/.test(normalized)) return { intent: 'ASK_COMBO', confidence: 0.82 };
    if (/\b(cuanto|precio|vale|bale|cuesta)\b/.test(normalized)) return { intent: 'ASK_PRICE', confidence: 0.86 };
    if (/\b(domicilio|domisilio|domicilio|direccion|dir|barrio|envio)\b/.test(normalized)) return { intent: 'PROVIDE_ADDRESS', confidence: 0.82 };
    if (/\b(efectivo|nequi|online|pagar|pago|transferencia)\b/.test(normalized)) return { intent: 'PROVIDE_PAYMENT_METHOD', confidence: 0.82 };
    if (/\b(agrega|anade|añade|sumale|tambien)\b/.test(normalized)) return { intent: 'ADD_ITEM', confidence: 0.82 };
    if (/\b(quita|remueve|sin)\b/.test(normalized)) return { intent: 'REMOVE_ITEM', confidence: 0.74 };
    if (/\b(nombre|soy|me llamo)\b/.test(normalized)) return { intent: 'PROVIDE_NAME', confidence: 0.75 };
    if (/\b(hola|buenas|buenos|hey)\b/.test(normalized)) return { intent: 'GREETING', confidence: 0.8 };
    return { intent: 'UNKNOWN', confidence: 0.35 };
  }

  private async activeProducts() {
    const products = await this.catalogRead.listActive();
    return Promise.all(products.map(async (product) => {
      const availability = product.kind === 'PREPARED'
        ? await this.recipeAvailability.check({ productId: product.id, quantity: 1 })
        : await this.productAvailability.check({ productId: product.id, quantity: 1 });
      return { ...product, available: availability.available };
    }));
  }

  private isDrink(product: Pick<ActiveProduct, 'name' | 'category'>) {
    const text = this.normalizeText(`${product.name} ${product.category?.name ?? ''} ${product.category?.slug ?? ''}`);
    return /\b(gaseosa|bebida|coca|postobon|hit|agua|jugo)\b/.test(text);
  }

  private isAvailable(product: ActiveProduct, quantity = 1) {
    return quantity > 0 && product.available;
  }

  private matchProducts(normalized: string, products: ActiveProduct[]) {
    const wantedDrink = /\b(gaseosa|bebida|coca|postobon|hit|agua|jugo)\b/.test(normalized);
    const wantedBurger = /\b(hamburguesa|hamburgesa|burger|burguer|burguers|2x1)\b/.test(normalized);
    const wantedFries = /\b(papas|papitas|fries)\b/.test(normalized);

    const scored = products
      .map((product) => {
        const haystack = this.normalizeText(`${product.name} ${product.description ?? ''} ${product.category?.name ?? ''}`);
        let score = 0;
        if (normalized.includes(haystack) || haystack.includes(normalized)) score += 5;
        for (const token of normalized.split(' ')) {
          if (token.length >= 4 && haystack.includes(token)) score += 1;
        }
        if (wantedDrink && this.isDrink(product)) score += 4;
        if (wantedBurger && /\b(hamburguesa|burger|2x1)\b/.test(haystack)) score += 4;
        if (wantedFries && /\b(papa|papas|papita)\b/.test(haystack)) score += 4;
        return { product, score };
      })
      .filter(({ product, score }) => score > 0 && this.isAvailable(product))
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 2).map(({ product }) => product);
  }

  private toAgentItem(product: ActiveProduct, quantity: number): AgentItem {
    const unitPrice = product.persistedPrice;
    return {
      productId: product.id,
      code: product.code,
      name: product.name,
      quantity,
      unitPrice,
      totalPrice: quantity * unitPrice,
      imageUrl: product.imageUrl,
      categoryName: product.category?.name ?? null,
    };
  }

  private parseExistingItems(draft: { itemsSnapshot: Prisma.JsonValue } | null): AgentItem[] {
    if (!draft || !Array.isArray(draft.itemsSnapshot)) return [];
    return draft.itemsSnapshot
      .map((item): AgentItem | null => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        const productId = String(record.productId ?? '');
        const quantity = Number(record.quantity ?? 0);
        if (!productId || quantity <= 0) return null;
        return {
          productId,
          code: String(record.code ?? ''),
          name: String(record.name ?? ''),
          quantity,
          unitPrice: Number(record.unitPrice ?? 0),
          totalPrice: Number(record.totalPrice ?? 0),
          notes: typeof record.notes === 'string' ? record.notes : null,
        };
      })
      .filter((item): item is AgentItem => Boolean(item));
  }

  private mergeItems(existing: AgentItem[], incoming: AgentItem[]) {
    const byId = new Map<string, AgentItem>();
    for (const item of existing) byId.set(item.productId, { ...item });
    for (const item of incoming) {
      const current = byId.get(item.productId);
      if (current) {
        current.quantity += item.quantity;
        current.totalPrice = current.quantity * current.unitPrice;
      } else {
        byId.set(item.productId, { ...item });
      }
    }
    return [...byId.values()];
  }

  private calculateTotals(items: AgentItem[]) {
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    return { subtotal, deliveryFee: DELIVERY_FEE_SANDBOX, total: subtotal + DELIVERY_FEE_SANDBOX };
  }

  private extractAddress(original: string, normalized: string) {
    if (!/\b(direccion|dir|domicilio|domisilio|barrio|calle|cra|carrera|avenida|av)\b/.test(normalized)) return null;
    if (!/(#|\bcalle\b|\bcra\b|\bcarrera\b|\bavenida\b|\bav\b|\bbarrio\b)/.test(normalized)) return null;
    return original.trim();
  }

  private extractName(original: string, normalized: string) {
    const match = normalized.match(/\b(?:soy|me llamo)\s+([a-z\s]{2,40})/);
    if (!match) return null;
    const name = match[1];
    if (!name) return null;
    return original.slice(normalized.indexOf(name)).trim() || null;
  }

  private missingFields(input: {
    customerName?: string | null;
    customerPhone?: string | null;
    deliveryAddress?: string | null;
    items: AgentItem[];
  }) {
    const missing: string[] = [];
    if (!input.items.length) missing.push('items');
    if (!input.customerName?.trim()) missing.push('customerName');
    if (!input.customerPhone?.trim()) missing.push('customerPhone');
    if (!input.deliveryAddress?.trim()) missing.push('deliveryAddress');
    return missing;
  }

  private buildUpsell(items: AgentItem[], products: ActiveProduct[], featuredOffer: SofiaFeaturedOffer | null): SofiaUpsell | null {
    if (featuredOffer?.slug === 'maxi-family') {
      return {
        productId: 'sofia-upsell-papitas-adicionales',
        name: 'Papitas adicionales',
        price: null,
        message: 'Si quieres que todos acompañen con papitas, te puedo agregar porciones adicionales.',
      };
    }
    if (featuredOffer?.slug === 'hamburguesa-sencilla') {
      return {
        productId: 'sofia-upsell-sencilla-mejoras',
        name: 'Mejoras para Hamburguesa Sencilla',
        price: null,
        message: 'La puedes mejorar con queso, tocineta, carne extra, papitas o bebida. ¿Quieres agregar algo?',
      };
    }

    const hasDrink = items.some((item) => /\b(gaseosa|bebida|coca|postobon|hit|agua|jugo)\b/.test(this.normalizeText(item.name)));
    if (hasDrink) return null;
    const drink = products.find((product) => this.isDrink(product) && this.isAvailable(product));
    if (!drink) return null;
    return {
      productId: drink.id,
      name: drink.name,
      price: drink.persistedPrice,
      message: `Te puedo recomendar agregar ${drink.name} para completar el pedido. ¿La agrego?`,
    };
  }

  private buildMedia(featuredOffer: SofiaFeaturedOffer | null): SofiaMediaSuggestion | null {
    if (!featuredOffer) return null;
    return {
      type: 'IMAGE',
      productId: featuredOffer.slug,
      productName: featuredOffer.name,
      imageUrl: featuredOffer.imageUrl,
      altText: `Imagen comercial de ${featuredOffer.name}`,
      offerSlug: featuredOffer.slug,
      salesHint: featuredOffer.salesHint,
    };
  }

  private buildResponse(input: {
    intent: SofiaIntent;
    missingFields: string[];
    items: AgentItem[];
    upsell: ReturnType<SofiaAgentService['buildUpsell']>;
    outsideHours: boolean;
    handoff: boolean;
    confirmed: boolean;
    paymentLinkUrl?: string | null;
    audioNeedsConfirmation?: boolean;
    menuRequest: boolean;
    featuredOffer: SofiaFeaturedOffer | null;
    matchedCatalogItem: SofiaCommercialCatalogItemSnapshot | null;
    availableOfferNames: string[];
    maxiCopyConfusion: boolean;
    aiSuggestedReply?: string | null;
    repeatLastOrderResponse?: string | null;
  }) {
    if (input.handoff) return 'Déjame confirmarlo con el equipo para no darte información incorrecta.';
    if (input.repeatLastOrderResponse) return input.repeatLastOrderResponse;
    if (input.audioNeedsConfirmation) {
      const items = input.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
      return items
        ? `Creo que me pediste ${items}. ¿Es correcto?`
        : 'No alcancé a entender bien la nota de voz. ¿Me confirmas tu pedido por favor?';
    }
    if (input.outsideHours && input.intent === 'CONFIRM_ORDER') {
      return 'Ahora estamos fuera de horario. Atendemos de 5:00 p.m. a 12:00 a.m. Puedo dejar tu pedido listo para revisión si el negocio lo permite.';
    }
    if (input.confirmed) {
      return 'Perfecto. Dejé un borrador supervisado para revisión del equipo. Aún no se creó un pedido ni un pago.';
    }
    if (input.maxiCopyConfusion) {
      return `Te confirmo para que no haya confusión: el Maxi Family incluye ${SOFIA_MAXI_FAMILY_REQUIRED_COPY}. Esta referencia conserva la política comercial, pero todavía no está disponible para comprar porque no tiene un producto activo con precio persistido.`;
    }
    if (input.matchedCatalogItem?.availability === 'CONFIGURATION_ONLY') {
      const configuredCopy =
        input.matchedCatalogItem.composition?.requiredCopy ??
        input.matchedCatalogItem.shortDescription ??
        'la referencia comercial configurada';
      return `${input.matchedCatalogItem.name}: ${configuredCopy}. Esta referencia conserva la política comercial, pero todavía no está disponible para comprar porque no tiene un producto activo con precio persistido.`;
    }
    if (input.featuredOffer?.slug === 'maxi-family') {
      return `Perfecto. El Maxi Family trae ${SOFIA_MAXI_FAMILY_REQUIRED_COPY}. Es ideal para compartir. Si quieres que todos acompañen con papitas, te puedo agregar porciones adicionales.`;
    }
    if (input.featuredOffer?.slug === '2x1-hamburguesas') {
      if (input.missingFields.includes('deliveryAddress') && input.items.length) {
        return 'Perfecto. El 2x1 Hamburguesas trae 2 burgers. Lo puedes completar con papitas o bebida. Solo me falta la dirección para enviarlo.';
      }
      return 'Perfecto. El 2x1 Hamburguesas trae 2 burgers. Lo puedes completar con papitas, bebida, queso o tocineta si quieres.';
    }
    if (input.featuredOffer?.slug === 'doble-todo') {
      return 'La Doble Todo trae doble carne, doble tocineta y doble queso cheddar en lonjas. Es más cargada y la puedes acompañar con papitas o bebida.';
    }
    if (input.featuredOffer?.slug === 'hamburguesa-sencilla') {
      return 'La Hamburguesa Sencilla es 1 burger sencilla. La puedes mejorar con queso, tocineta, carne extra, papitas o bebida.';
    }
    if (input.aiSuggestedReply && !input.missingFields.includes('items')) return input.aiSuggestedReply;
    if (input.menuRequest) {
      return input.availableOfferNames.length
        ? `Estas son las ofertas disponibles con producto y precio vigentes: ${input.availableOfferNames.join(', ')}. ¿Cuál te gustaría pedir?`
        : 'No tengo ofertas comprables validadas en este momento. Puedo consultar los productos activos o pedir al equipo que confirme disponibilidad.';
    }
    if (input.intent === 'GREETING') return '¡Claro! Te ayudo con tu pedido. Puedes decirme qué quieres y para dónde va el domicilio.';
    if (input.intent === 'ASK_MENU') {
      const names = input.items.map((item) => item.name).slice(0, 3).join(', ');
      return names ? `Tenemos opciones activas como ${names}. ¿Cuál te gustaría pedir?` : 'Te muestro productos activos, pero primero debo confirmar el menú disponible.';
    }
    if (input.intent === 'ASK_HUMAN') return 'Listo, te paso con el equipo para que te ayuden directamente.';
    if (input.missingFields.includes('items')) return 'Déjame confirmarlo con el equipo para no darte información incorrecta.';
    if (input.missingFields.includes('deliveryAddress')) return 'Perfecto. Ya tengo tu pedido. Solo me falta la dirección para enviarlo.';
    if (input.missingFields.includes('customerName')) return 'Ya tengo el pedido. Dime por favor tu nombre para dejarlo marcado.';
    if (input.missingFields.includes('customerPhone')) return 'Ya tengo el pedido. Dime por favor tu WhatsApp para dejarlo asociado.';
    if (input.upsell) return input.upsell.message;
    if (input.items.length) {
      return 'Va quedando listo. Si confirmas, lo dejo como borrador supervisado para revisión del equipo.';
    }
    return 'Déjame confirmarlo con el equipo para no darte información incorrecta.';
  }

  async processSandboxMessage(
    dto: ProcessSofiaAgentMessageDto,
    actorId: string,
    options: { recordInbound?: boolean; recordOutbound?: boolean; headers?: HeaderMap } = {},
  ) {
    if (process.env.NODE_ENV !== 'test') {
      throw new NotFoundException({ code: 'SOFIA_TEST_ONLY_ROUTE_UNAVAILABLE' });
    }
    return this.processMessage(dto, actorId, { ...options, source: 'SANDBOX' });
  }

  async processInboundMessage(
    dto: ProcessSofiaAgentMessageDto,
    actorId: string,
    options: { recordInbound?: boolean; recordOutbound?: boolean; headers?: HeaderMap } = {},
  ) {
    return this.processMessage(dto, actorId, { ...options, source: 'WHATSAPP' });
  }

  private async processMessage(
    dto: ProcessSofiaAgentMessageDto,
    actorId: string,
    options: { recordInbound?: boolean; recordOutbound?: boolean; source: 'SANDBOX' | 'WHATSAPP'; headers?: HeaderMap },
  ) {
    const recordInbound = options.recordInbound ?? true;
    const recordOutbound = options.recordOutbound ?? true;
    const message = dto.message.trim();
    if (!message) throw new BadRequestException('El mensaje es obligatorio.');
    if (options.source === 'WHATSAPP' && !dto.conversationId) {
      throw new BadRequestException('El inbound WhatsApp requiere una conversación persistida por el transporte.');
    }

    const normalized = this.normalizeText(message);
    const transcriptConfidence = dto.messageType === 'AUDIO_TRANSCRIPT' ? dto.transcriptConfidence ?? 0.7 : 1;
    const classified = this.classifyIntent(normalized, transcriptConfidence);
    const audioNeedsConfirmation = dto.messageType === 'AUDIO_TRANSCRIPT' && transcriptConfidence < 0.65;
    const outsideHours = !this.isInsideBusinessHours(dto.sandboxNow);
    const handoff = classified.intent === 'ASK_HUMAN' || classified.confidence < 0.45;

    const conversation = dto.conversationId
      ? await this.sofiaService.findConversation(dto.conversationId)
      : await this.sofiaService.getOrCreateConversation({
          phone: dto.phone ?? this.sandboxPhone(actorId),
          customerName: dto.customerName,
        }, SofiaOrderSource.MOCK_ADMIN);
    const initialPhone = dto.phone ?? conversation.phone;
    const [activePrompt, commercialCatalog, customerMemoryRecord] = await Promise.all([
      this.promptService.getActivePrompt(),
      this.catalogService.listActiveItems(),
      this.customerMemoryService.resolveOrCreateMemory(initialPhone, dto.customerName ?? conversation.customerName),
    ]);
    if (conversation.customerId && customerMemoryRecord.customerId !== conversation.customerId) {
      await this.repository.linkCustomerMemory(customerMemoryRecord.id, conversation.customerId);
    }
    const customerMemory = this.customerMemoryService.toSnapshot(customerMemoryRecord);
    const repeatLastOrder = this.isRepeatLastOrderRequest(normalized)
      ? await this.customerMemoryService.repeatLastOrderSuggestion(initialPhone)
      : null;

    if (recordInbound) {
      await this.repository.createMessage({
          conversationId: conversation.id,
          direction: WhatsappMessageDirection.INBOUND,
          type: dto.messageType === 'AUDIO_TRANSCRIPT' ? WhatsappMessageType.AUDIO : WhatsappMessageType.TEXT,
          body: dto.messageType === 'AUDIO_TRANSCRIPT' ? null : message,
          transcript: dto.messageType === 'AUDIO_TRANSCRIPT' ? message : null,
          aiIntent: classified.intent,
          confidence: classified.confidence,
          rawPayload: {
            sandbox: options.source !== 'WHATSAPP',
            whatsappAdapter: options.source === 'WHATSAPP',
            noWhatsappReal: true,
            transcriptConfidence,
          },
      });
    }

    if (await this.commercialCheckout.shouldHandle(conversation.id, message)) {
      const commercial = await this.commercialCheckout.process({
        conversationId: conversation.id,
        phone: initialPhone,
        displayName: dto.customerName ?? conversation.customerName ?? undefined,
        message,
        actor: this.actorContext(actorId, options.source),
      });
      const confidence = commercial.state.confidence === 'HIGH' ? 0.95 : commercial.state.confidence === 'MEDIUM' ? 0.65 : 0.25;
      const shouldHandoff = commercial.nextAction === 'HANDOFF';
      if (shouldHandoff) await this.repository.requireHuman(conversation.id);
      if (recordOutbound) {
        await this.repository.createMessage({
          conversationId: conversation.id,
          direction: WhatsappMessageDirection.OUTBOUND,
          type: WhatsappMessageType.SYSTEM,
          body: commercial.responseText,
          aiIntent: commercial.state.intent,
          confidence,
          rawPayload: {
            commercialFactEnvelope: commercial.factEnvelope as Prisma.InputJsonValue,
            nextAction: commercial.nextAction,
            noWhatsappReal: true,
            noOperationalMutation: true,
          },
        });
      }
      await this.repository.touchConversation(conversation.id);
      return {
        conversationId: conversation.id,
        detectedIntent: commercial.state.intent,
        confidence,
        extractedItems: commercial.state.items.map((item) => ({ ...item, totalPrice: item.quantity * item.unitPrice })),
        currentItems: commercial.state.items.map((item) => ({ ...item, totalPrice: item.quantity * item.unitPrice })),
        missingFields: commercial.state.missingFields,
        suggestedUpsell: null,
        mediaSuggestion: null,
        featuredOffers: [],
        commercialCatalog,
        matchedCatalogItem: null,
        matchedFeaturedOffer: null,
        promptVersion: activePrompt.version,
        memory: { customer: customerMemory, conversation: commercial.state, repeatLastOrder: null },
        autoSafeDecision: {
          status: shouldHandoff ? 'HUMAN_REQUIRED' : 'DRAFT_ONLY',
          riskLevel: shouldHandoff ? 'HIGH' : 'LOW',
          approved: false,
          shouldSend: false,
          shouldCreateOutbox: false,
          shouldRequireHuman: shouldHandoff,
          reasonCodes: shouldHandoff ? commercial.state.domainErrors : ['PHASE_4_SUPERVISED_DRAFT_ONLY'],
          blockingReasons: shouldHandoff ? commercial.state.domainErrors : [],
          warnings: ['No se creó pedido, pago, venta, movimiento de inventario ni envío real.'],
          correctedReply: null,
          finalReply: commercial.responseText,
          requiredHumanAction: shouldHandoff ? 'Revisar la conversación.' : null,
          auditJson: { phase: 'PHASE_4', noWhatsappRealSent: true, noOperationalMutation: true },
          createdAt: new Date().toISOString(),
        },
        nextAction: commercial.nextAction,
        responseText: commercial.responseText,
        shouldCreateDraft: commercial.nextAction === 'READY_TO_CONFIRM',
        shouldConfirmOrder: commercial.nextAction === 'DRAFT_CONFIRMED',
        shouldHandoff,
        paymentLinkUrl: null,
        draft: commercial.state.draftId ? { id: commercial.state.draftId, version: commercial.state.draftVersion, status: commercial.state.confirmationState } : null,
        deliveryOrder: null,
        businessStatus: { isOpen: !outsideHours, timezone: 'America/Bogota', schedule: '5:00 p.m. a 12:00 a.m.' },
        safeguards: {
          noWhatsappReal: true,
          noHermesReal: true,
          deepSeekBackendOnly: true,
          aiCannotOperateHermes: true,
          aiCannotMarkPaid: true,
          noRealPayments: true,
          sandboxOperationalIsolation: options.source !== 'WHATSAPP',
          productiveActionBlocked: 'PHASE_4_DRAFT_ONLY',
        },
        aiProvider: { provider: 'rules', mode: 'disabled', fallbackUsed: false, confidence, safetyFlags: [], forbiddenClaimsDetected: [], diagnostics: ['PHASE_4_DOMAIN_FACT_ENVELOPE'] },
      };
    }

    const products = await this.activeProducts();
    const matchedCatalogItem = await this.catalogService.findByText(message);
    const matchedProducts =
      matchedCatalogItem?.availability === 'CONFIGURATION_ONLY' ? [] : this.matchProducts(normalized, products);
    const quantity = this.quantityFromText(normalized);
    const extractedItems = matchedProducts.map((product) => this.toAgentItem(product, quantity));

    const activeDraft = await this.repository.findActiveDraft(conversation.id);

    const explicitFeaturedOffer = this.findFeaturedOffer(normalized);
    const availableOfferSnapshots = this.catalogService.toAvailableOfferSnapshots(commercialCatalog);
    const availableOfferSlugs = new Set(availableOfferSnapshots.map((offer) => offer.slug));
    const isCatalogRequest = this.isMenuOrPhotoRequest(normalized);
    const activeFeaturedOffer = isCatalogRequest && !explicitFeaturedOffer ? null : this.activeFeaturedOfferFromDraft(activeDraft);
    const configuredFeaturedOffer = explicitFeaturedOffer ?? activeFeaturedOffer;
    const matchedFeaturedOffer =
      configuredFeaturedOffer && availableOfferSlugs.has(configuredFeaturedOffer.slug) ? configuredFeaturedOffer : null;
    const menuRequest = isCatalogRequest && !explicitFeaturedOffer;
    const maxiCopyConfusion = this.hasMaxiCopyConfusion(normalized);
    const existingItems = this.parseExistingItems(activeDraft);
    const nextItems = this.mergeItems(existingItems, extractedItems);
    const deliveryAddress = this.extractAddress(message, normalized) ?? activeDraft?.deliveryAddress ?? null;
    const customerName = this.extractName(message, normalized) ?? dto.customerName ?? activeDraft?.customerName ?? conversation.customerName ?? null;
    const customerPhone = dto.phone ?? activeDraft?.customerPhone ?? conversation.phone;
    const missingFields = this.missingFields({ customerName, customerPhone, deliveryAddress, items: nextItems });
    const totals = this.calculateTotals(nextItems);
    const upsell =
      matchedCatalogItem?.availability === 'CONFIGURATION_ONLY'
        ? null
        : this.buildUpsell(nextItems, products, matchedFeaturedOffer);
    const mediaSuggestion = this.buildMedia(matchedFeaturedOffer);
    const memoryBefore = await this.customerMemoryService.updateFromInteraction({
      phone: customerPhone,
      displayName: customerName,
      address: deliveryAddress,
      preferredPaymentMethod: this.paymentMethodFromText(normalized),
      lastProductDiscussed: matchedCatalogItem?.name ?? matchedFeaturedOffer?.name ?? matchedProducts[0]?.name ?? null,
    });
    const aiAnalysis = await this.aiProviderFactory.analyze(
      {
        conversationId: conversation.id,
        customerMessage: message,
        normalizedMessage: normalized,
        currentDraftSnapshot: activeDraft
          ? {
              id: activeDraft.id,
              status: activeDraft.status,
              items: this.parseExistingItems(activeDraft).map((item) => ({ name: item.name, quantity: item.quantity })),
              hasDeliveryAddress: Boolean(activeDraft.deliveryAddress),
              hasCustomerName: Boolean(activeDraft.customerName),
              hasCustomerPhone: Boolean(activeDraft.customerPhone),
            }
          : null,
        availableOffersSnapshot: availableOfferSnapshots,
        availableProductsSnapshot: products.filter((product) => this.isAvailable(product)).map((product) => ({
          id: product.id,
          code: product.code,
          name: product.name,
          price: product.persistedPrice,
          available: this.isAvailable(product),
          categoryName: product.category?.name ?? null,
        })),
        paymentOptionsSnapshot: {
          paymentLink: 'unavailable_from_sofia',
          manualPayment: 'operator_validated',
          aiCannotMarkPaid: true,
        },
        businessRulesSnapshot: {
          maxiFamilyCopy: this.catalogService.maxiFamilyRequiredCopy(),
          forbiddenMaxiFamilyClaims: this.catalogService.forbiddenMaxiClaims(),
          noPaidFromAi: true,
          noInventedProducts: true,
          noInventedPrices: true,
        },
        recentMessagesSummary: activeDraft?.aiSummary ?? null,
        ruleIntent: classified.intent,
        ruleConfidence: classified.confidence,
        ruleSuggestedReply: null,
      },
      options.headers,
    );
    const safeAi = aiAnalysis.safe;
    const aiWantsHandoff = safeAi.shouldHandoff || safeAi.confidence < 0.45;
    const effectiveIntent = safeAi.mode !== 'disabled' && !safeAi.fallbackUsed ? (safeAi.intent as SofiaIntent) : classified.intent;
    const effectiveConfidence = safeAi.mode !== 'disabled' && !safeAi.fallbackUsed ? safeAi.confidence : classified.confidence;
    const aiSuggestedReply = safeAi.mode !== 'disabled' ? safeAi.suggestedReply : null;

    let draft: Awaited<ReturnType<SofiaAgentRepository['findActiveDraft']>> | OrderDraftDto = activeDraft;
    if (nextItems.length || activeDraft) {
      const draftPayload = {
        customerName: customerName ?? undefined,
        customerPhone: customerPhone ?? undefined,
        deliveryAddress: deliveryAddress ?? undefined,
        deliveryNeighborhood: activeDraft?.deliveryNeighborhood ?? undefined,
        deliveryNotes: 'Borrador supervisado por Sofía. Sin pedido operativo, pago ni envío automático.',
        aiSummary: `Intent: ${effectiveIntent}. ${matchedFeaturedOffer ? `FeaturedOffer:${matchedFeaturedOffer.slug}. ` : ''}AI:${safeAi.provider}/${safeAi.mode}.`,
        items: nextItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      };
      draft = activeDraft
        ? await this.orderDrafts.update(activeDraft.id, activeDraft.updatedAt.toISOString(), draftPayload, this.actorContext(actorId, options.source))
        : await this.orderDrafts.create({ ...draftPayload, conversationId: conversation.id }, this.actorContext(actorId, options.source));
    }

    const deliveryOrder: unknown = null;
    const paymentLinkUrl: string | null = null;
    let confirmed = false;
    let productiveActionBlocked: string | null = null;
    const canConfirm = Boolean(classified.intent === 'CONFIRM_ORDER' && draft && !missingFields.length && !outsideHours);
    if (canConfirm && draft) {
      const productiveGate =
        options.source === 'WHATSAPP'
          ? await this.runtimeSafetyService.evaluate('PRODUCTIVE_ACTION')
          : null;
      if (productiveGate && !productiveGate.allowed) {
        productiveActionBlocked = productiveGate.reason;
        await this.runtimeSafetyService.recordBlocked('PRODUCTIVE_ACTION', {
          actorId,
          phone: customerPhone,
          reason: productiveGate.reason,
          blockers: productiveGate.blockers,
          idempotencyKey: `sofia-draft-confirm:${draft.id}`,
        });
      } else {
        try {
          const expectedVersion = String(draft.version);
          const confirmedDraft = await this.orderDrafts.confirm(draft.id, expectedVersion, this.actorContext(actorId, options.source));
          await this.orderCreation.createFromSofiaDraft({
            draftId: confirmedDraft.id,
            expectedDraftVersion: confirmedDraft.version,
            idempotencyKey: `sofia-draft:${confirmedDraft.id}`,
            actor: this.actorContext(actorId, options.source),
          });
        } catch {
          productiveActionBlocked = 'SOFIA_ORDER_CREATION_BLOCKED';
        }
        await this.customerMemoryService.saveLastOrder({
          phone: customerPhone,
          displayName: customerName,
          address: deliveryAddress,
          preferredPaymentMethod: this.paymentMethodFromText(normalized),
          orderSummary: {
            source: options.source === 'WHATSAPP' ? 'SOFIA_WHATSAPP' : 'SOFIA_SANDBOX',
            confirmedAt: new Date().toISOString(),
            operationalOrderCreated: false,
            items: nextItems.map((item) => ({
              productId: item.productId,
              name: item.name,
              quantity: item.quantity,
            })),
            total: totals.total,
            currency: 'COP',
          },
        });
        confirmed = false;
      }
    }

    if (handoff || aiWantsHandoff) {
      await this.repository.requireHuman(conversation.id);
    }

    const responseText = this.buildResponse({
      intent: effectiveIntent,
      missingFields,
      items: nextItems,
      upsell,
      outsideHours,
      handoff: handoff || aiWantsHandoff || Boolean(productiveActionBlocked),
      confirmed,
      paymentLinkUrl,
      audioNeedsConfirmation,
      menuRequest,
      featuredOffer: matchedFeaturedOffer,
      matchedCatalogItem,
      availableOfferNames: availableOfferSnapshots.map((offer) => offer.name),
      maxiCopyConfusion,
      aiSuggestedReply,
      repeatLastOrderResponse: repeatLastOrder?.responseText ?? null,
    });

    const conversationMemory = await this.conversationMemoryService.updateContext({
      conversationId: conversation.id,
      customerMemoryId: memoryBefore?.id ?? customerMemory.id,
      currentIntent: effectiveIntent,
      currentOrderIntent: {
        items: nextItems.map((item) => ({ name: item.name, quantity: item.quantity })),
        matchedCatalogItem: matchedCatalogItem?.slug ?? null,
        matchedFeaturedOffer: matchedFeaturedOffer?.slug ?? null,
      },
      missingFields,
      lastProductDiscussed: matchedCatalogItem?.name ?? matchedFeaturedOffer?.name ?? nextItems[0]?.name ?? null,
      memorySummary: memoryBefore?.memorySummary ?? customerMemory.memorySummary,
    });

    await this.recordCommercialSafetyEvents({
      conversationId: conversation.id,
      customerMemoryId: memoryBefore?.id ?? customerMemory.id,
      safetyFlags: safeAi.safetyFlags,
      forbiddenClaimsDetected: safeAi.forbiddenClaimsDetected,
      maxiCopyConfusion,
      matchedCatalogItemSlug: matchedCatalogItem?.slug ?? null,
    });

    const autoSafeDecision = await this.autoSafeEngine.evaluate({
      conversationId: conversation.id,
      customerMemoryId: memoryBefore?.id ?? customerMemory.id,
      promptVersionId: activePrompt.id,
      phoneNormalized: customerMemoryRecord.phoneNormalized,
      messageText: message,
      candidateReply: responseText,
      intent: effectiveIntent,
      confidence: effectiveConfidence,
      minConfidence: this.configService.get<number>('SOFIA_AI_MIN_CONFIDENCE') ?? 0.82,
      productsMentioned: nextItems.map((item) => ({
        name: item.name,
        productId: item.productId,
        price: item.unitPrice,
        known: true,
      })),
      catalogItems: matchedCatalogItem?.availability === 'AVAILABLE' ? [matchedCatalogItem] : [],
      memorySnapshot: memoryBefore ?? customerMemory,
      conversationState: handoff || aiWantsHandoff ? 'HUMAN_REQUIRED' : 'SOFIA_ACTIVE',
      promptVersion: activePrompt.version,
      paymentIntent: this.paymentMethodFromText(normalized),
      orderIntent: {
        matchedCatalogItem: matchedCatalogItem?.slug ?? null,
        matchedFeaturedOffer: matchedFeaturedOffer?.slug ?? null,
        hasDraft: Boolean(draft),
        confirmed,
      },
      missingFields,
      safetyGuardResult: {
        blocked: safeAi.safetyFlags.some((flag) => flag.startsWith('AI_SAFETY_BLOCKED')),
        safetyFlags: safeAi.safetyFlags,
        forbiddenClaimsDetected: safeAi.forbiddenClaimsDetected,
        diagnostics: safeAi.diagnostics,
      },
      channelMode: options.source === 'WHATSAPP' ? 'whatsapp_adapter' : 'sandbox',
      isSandbox: options.source !== 'WHATSAPP',
      isHumanTaken: false,
      isSofiaPaused: false,
      autoSafeEnabled: options.source !== 'WHATSAPP' ? true : this.configService.get<boolean>('SOFIA_AUTO_SAFE_ENABLED') === true,
      secretRotationPending: false,
      qrReady: false,
      deepSeekReady: Boolean(this.configService.get<string>('DEEPSEEK_API_KEY') && this.configService.get<boolean>('DEEPSEEK_ENABLED') === true),
      businessStatus: {
        isOpen: !outsideHours,
        timezone: 'America/Bogota',
        schedule: '5:00 p.m. a 12:00 a.m.',
      },
      metadata: {
        noWhatsappReal: true,
        source: options.source ?? 'SANDBOX',
      },
    });

    const result = {
      conversationId: conversation.id,
      detectedIntent: effectiveIntent,
      confidence: effectiveConfidence,
      extractedItems,
      currentItems: nextItems,
      missingFields,
      suggestedUpsell: upsell,
      mediaSuggestion,
      featuredOffers: getActiveSofiaFeaturedOffers().filter((offer) => availableOfferSlugs.has(offer.slug)),
      commercialCatalog,
      matchedCatalogItem,
      matchedFeaturedOffer,
      promptVersion: activePrompt.version,
      memory: {
        customer: memoryBefore ?? customerMemory,
        conversation: this.conversationMemoryService.sanitize(conversationMemory),
        repeatLastOrder,
      },
      autoSafeDecision,
      nextAction:
        productiveActionBlocked || handoff || aiWantsHandoff
          ? 'HANDOFF'
          : confirmed
            ? options.source === 'WHATSAPP'
              ? 'SUPERVISED_DRAFT_CONFIRMED'
              : 'SANDBOX_DRAFT_CONFIRMED'
            : missingFields.length
              ? 'ASK_MISSING_FIELDS'
              : 'READY_TO_CONFIRM',
      responseText,
      shouldCreateDraft: Boolean(nextItems.length),
      shouldConfirmOrder: canConfirm,
      shouldHandoff: handoff || aiWantsHandoff,
      paymentLinkUrl,
      draft,
      deliveryOrder,
      businessStatus: {
        isOpen: !outsideHours,
        timezone: 'America/Bogota',
        schedule: '5:00 p.m. a 12:00 a.m.',
      },
      safeguards: {
        noWhatsappReal: true,
        noHermesReal: true,
        deepSeekBackendOnly: true,
        aiCannotOperateHermes: true,
        aiCannotMarkPaid: true,
        noRealPayments: true,
        sandboxOperationalIsolation: options.source !== 'WHATSAPP',
        productiveActionBlocked,
      },
      aiProvider: {
        provider: safeAi.provider,
        mode: safeAi.mode,
        fallbackUsed: safeAi.fallbackUsed,
        confidence: safeAi.confidence,
        safetyFlags: safeAi.safetyFlags,
        forbiddenClaimsDetected: safeAi.forbiddenClaimsDetected,
        diagnostics: safeAi.diagnostics,
      },
    };

    const outboundPayload: Prisma.InputJsonValue = {
      sandbox: options.source !== 'WHATSAPP',
      whatsappAdapter: options.source === 'WHATSAPP',
      detectedIntent: result.detectedIntent,
      confidence: result.confidence,
      missingFields: result.missingFields,
      currentItems: result.currentItems.map((item) => ({
        productId: item.productId,
        code: item.code,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
      suggestedUpsell: result.suggestedUpsell,
      mediaSuggestion: result.mediaSuggestion,
      featuredOffers: result.featuredOffers,
      commercialCatalog: result.commercialCatalog,
      matchedCatalogItem: result.matchedCatalogItem,
      matchedFeaturedOffer: result.matchedFeaturedOffer,
      promptVersion: result.promptVersion,
      memory: result.memory,
      nextAction: result.nextAction,
      shouldCreateDraft: result.shouldCreateDraft,
      shouldConfirmOrder: result.shouldConfirmOrder,
      shouldHandoff: result.shouldHandoff,
      paymentLinkUrl: result.paymentLinkUrl,
      businessStatus: result.businessStatus,
      safeguards: result.safeguards,
      aiProvider: result.aiProvider,
      autoSafeDecision: result.autoSafeDecision,
    };

    if (recordOutbound) {
      await this.repository.createMessage({
          conversationId: conversation.id,
          direction: WhatsappMessageDirection.OUTBOUND,
          type: WhatsappMessageType.SYSTEM,
          body: responseText,
          aiIntent: effectiveIntent,
          confidence: effectiveConfidence,
          rawPayload: outboundPayload,
      });
    }

    await this.repository.touchConversation(conversation.id);

    return result;
  }

  private async recordCommercialSafetyEvents(input: {
    conversationId: string;
    customerMemoryId: string;
    safetyFlags: string[];
    forbiddenClaimsDetected: string[];
    maxiCopyConfusion: boolean;
    matchedCatalogItemSlug: string | null;
  }) {
    const events: Array<{ ruleCode: string; severity: string; actionTaken: string; details: Prisma.InputJsonValue }> = [];
    if (input.maxiCopyConfusion || input.forbiddenClaimsDetected.length || input.safetyFlags.includes('MAXI_FAMILY_COPY_CORRECTED')) {
      events.push({
        ruleCode: 'MAXI_FAMILY_COPY',
        severity: 'P0_COMMERCIAL',
        actionTaken: 'CORRECTED_RESPONSE',
        details: {
          forbiddenClaimsDetected: input.forbiddenClaimsDetected,
          matchedCatalogItemSlug: input.matchedCatalogItemSlug,
        },
      });
    }
    for (const flag of input.safetyFlags.filter((flag) => flag.startsWith('AI_SAFETY_BLOCKED'))) {
      events.push({
        ruleCode: flag,
        severity: 'P0_SAFETY',
        actionTaken: 'BLOCKED_OR_ESCALATED',
        details: { safetyFlag: flag },
      });
    }
    await Promise.all(
      events.map((event) =>
        this.customerMemoryService.recordCommercialRuleEvent({
          conversationId: input.conversationId,
          customerMemoryId: input.customerMemoryId,
          ...event,
        }),
      ),
    );
  }

  async recoverAbandonedDraft(dto: RecoverSofiaAbandonedDraftDto) {
    const draft = await this.repository.findDraftForRecovery(dto);

    if (!draft) {
      return {
        detectedIntent: 'UNKNOWN',
        nextAction: 'NO_ABANDONED_DRAFT',
        responseText: 'No encontré un pedido pendiente para recuperar.',
      };
    }

    const items = this.parseExistingItems(draft);
    const responseText = items.length
      ? `Te quedó pendiente este pedido: ${items.map((item) => `${item.quantity} x ${item.name}`).join(', ')}. ¿Quieres que lo dejemos listo o prefieres cambiar algo?`
      : 'Te quedó un pedido pendiente. ¿Quieres que lo retomemos?';

    return {
      conversationId: draft.conversationId,
      draftId: draft.id,
      detectedIntent: 'RECOVER_ABANDONED_ORDER',
      currentItems: items,
      nextAction: 'SEND_RECOVERY_SUGGESTION_SANDBOX',
      responseText,
      safeguards: {
        noWhatsappReal: true,
      },
    };
  }
}
