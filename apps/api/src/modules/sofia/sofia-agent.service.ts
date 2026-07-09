import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ProductKind,
  SofiaOrderDraftStatus,
  WhatsappConversationStatus,
  WhatsappMessageDirection,
  WhatsappMessageType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SofiaAIProviderFactory } from './ai/sofia-ai-provider.factory';
import { SofiaAutoSafeEngineService } from './auto-safe/sofia-auto-safe-engine.service';
import { SofiaCommercialCatalogService } from './catalog/sofia-commercial-catalog.service';
import { ProcessSofiaAgentMessageDto, RecoverSofiaAbandonedDraftDto } from './dto/sofia.dto';
import { SofiaConversationMemoryService } from './memory/sofia-conversation-memory.service';
import { SofiaCustomerMemoryService } from './memory/sofia-customer-memory.service';
import { SofiaPromptService } from './prompt/sofia-prompt.service';
import { getActiveSofiaFeaturedOffers, SofiaFeaturedOffer } from './sofia-featured-offers';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';
import { SofiaService } from './sofia.service';

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

type ActiveProduct = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  kind: ProductKind;
  salePrice: Prisma.Decimal;
  trackStock: boolean;
  currentStock: Prisma.Decimal;
  category: { name: string; slug: string } | null;
};

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
const MAXI_FAMILY_COPY = '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L';
type HeaderMap = Record<string, string | string[] | undefined>;

@Injectable()
export class SofiaAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sofiaService: SofiaService,
    private readonly paymentLinkService: SofiaPaymentLinkService,
    private readonly aiProviderFactory: SofiaAIProviderFactory,
    private readonly autoSafeEngine: SofiaAutoSafeEngineService,
    private readonly configService: ConfigService,
    private readonly promptService: SofiaPromptService,
    private readonly catalogService: SofiaCommercialCatalogService,
    private readonly customerMemoryService: SofiaCustomerMemoryService,
    private readonly conversationMemoryService: SofiaConversationMemoryService,
  ) {}

  private normalizeText(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s#-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    return this.prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        imageUrl: true,
        kind: true,
        salePrice: true,
        trackStock: true,
        currentStock: true,
        category: { select: { name: true, slug: true } },
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  private isDrink(product: Pick<ActiveProduct, 'name' | 'category'>) {
    const text = this.normalizeText(`${product.name} ${product.category?.name ?? ''} ${product.category?.slug ?? ''}`);
    return /\b(gaseosa|bebida|coca|postobon|hit|agua|jugo)\b/.test(text);
  }

  private isAvailable(product: ActiveProduct, quantity = 1) {
    if (product.kind === ProductKind.DIRECT_STOCK && product.trackStock) {
      return Number(product.currentStock) >= quantity;
    }
    return true;
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
    const unitPrice = Number(product.salePrice);
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
      price: Number(drink.salePrice),
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
      return input.paymentLinkUrl
        ? `Perfecto. Tu pedido quedó listo en Domicilios. Te dejo el link para finalizar el pago: ${input.paymentLinkUrl}`
        : 'Perfecto. Tu pedido quedó listo y ya lo puede ver el equipo en Domicilios.';
    }
    if (input.maxiCopyConfusion) {
      return 'Te confirmo para que no haya confusión: el Maxi Family incluye una porción personal de papitas. Si deseas más papitas, te puedo agregar porciones adicionales.';
    }
    if (input.featuredOffer?.slug === 'maxi-family') {
      return `Perfecto. El Maxi Family trae ${MAXI_FAMILY_COPY}. Es ideal para compartir. Si quieres que todos acompañen con papitas, te puedo agregar porciones adicionales.`;
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
      return `Tenemos estas opciones principales: Maxi Family, 2x1 Hamburguesas, Doble Todo y Hamburguesa Sencilla. El Maxi Family trae ${MAXI_FAMILY_COPY}. Si quieres, también te puedo mostrar imágenes.`;
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
    if (input.items.length) return 'Va quedando listo. Si quieres, lo confirmo y te genero el link de pago.';
    return 'Déjame confirmarlo con el equipo para no darte información incorrecta.';
  }

  async processSandboxMessage(
    dto: ProcessSofiaAgentMessageDto,
    actorId: string,
    options: { recordInbound?: boolean; recordOutbound?: boolean; source?: 'SANDBOX' | 'WHATSAPP'; headers?: HeaderMap } = {},
  ) {
    const recordInbound = options.recordInbound ?? true;
    const recordOutbound = options.recordOutbound ?? true;
    const message = dto.message.trim();
    if (!message) throw new BadRequestException('El mensaje es obligatorio.');

    const normalized = this.normalizeText(message);
    const transcriptConfidence = dto.messageType === 'AUDIO_TRANSCRIPT' ? dto.transcriptConfidence ?? 0.7 : 1;
    const classified = this.classifyIntent(normalized, transcriptConfidence);
    const audioNeedsConfirmation = dto.messageType === 'AUDIO_TRANSCRIPT' && transcriptConfidence < 0.65;
    const outsideHours = !this.isInsideBusinessHours(dto.sandboxNow);
    const handoff = classified.intent === 'ASK_HUMAN' || classified.confidence < 0.45;

    const conversation = dto.conversationId
      ? await this.sofiaService.findConversation(dto.conversationId)
      : await this.sofiaService.getOrCreateConversation({
          phone: dto.phone ?? '573000000000',
          customerName: dto.customerName,
        });
    const initialPhone = dto.phone ?? conversation.phone;
    const [activePrompt, commercialCatalog, customerMemoryRecord] = await Promise.all([
      this.promptService.getActivePrompt(),
      this.catalogService.listActiveItems(),
      this.customerMemoryService.resolveOrCreateMemory(initialPhone, dto.customerName ?? conversation.customerName),
    ]);
    const customerMemory = this.customerMemoryService.toSnapshot(customerMemoryRecord);
    const repeatLastOrder = this.isRepeatLastOrderRequest(normalized)
      ? await this.customerMemoryService.repeatLastOrderSuggestion(initialPhone)
      : null;

    if (recordInbound) {
      await this.prisma.whatsappMessage.create({
        data: {
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
        },
      });
    }

    const products = await this.activeProducts();
    const matchedProducts = this.matchProducts(normalized, products);
    const quantity = this.quantityFromText(normalized);
    const extractedItems = matchedProducts.map((product) => this.toAgentItem(product, quantity));

    const activeDraft = await this.prisma.sofiaOrderDraft.findFirst({
      where: {
        conversationId: conversation.id,
        status: { in: [SofiaOrderDraftStatus.DRAFT, SofiaOrderDraftStatus.NEEDS_INFO, SofiaOrderDraftStatus.READY_TO_CONFIRM] },
      },
      orderBy: { updatedAt: 'desc' },
      include: { deliveryOrder: true },
    });

    const explicitFeaturedOffer = this.findFeaturedOffer(normalized);
    const matchedCatalogItem = await this.catalogService.findByText(message);
    const isCatalogRequest = this.isMenuOrPhotoRequest(normalized);
    const activeFeaturedOffer = isCatalogRequest && !explicitFeaturedOffer ? null : this.activeFeaturedOfferFromDraft(activeDraft);
    const matchedFeaturedOffer = explicitFeaturedOffer ?? activeFeaturedOffer;
    const menuRequest = isCatalogRequest && !explicitFeaturedOffer;
    const maxiCopyConfusion = this.hasMaxiCopyConfusion(normalized);
    const existingItems = this.parseExistingItems(activeDraft);
    const nextItems = this.mergeItems(existingItems, extractedItems);
    const deliveryAddress = this.extractAddress(message, normalized) ?? activeDraft?.deliveryAddress ?? null;
    const customerName = this.extractName(message, normalized) ?? dto.customerName ?? activeDraft?.customerName ?? conversation.customerName ?? null;
    const customerPhone = dto.phone ?? activeDraft?.customerPhone ?? conversation.phone;
    const missingFields = this.missingFields({ customerName, customerPhone, deliveryAddress, items: nextItems });
    const totals = this.calculateTotals(nextItems);
    const upsell = this.buildUpsell(nextItems, products, matchedFeaturedOffer);
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
        availableOffersSnapshot: commercialCatalog
          .filter((item) => item.type === 'OFFER')
          .map((offer) => ({
            slug: offer.slug,
            name: offer.name,
            description: offer.composition?.requiredCopy ?? offer.shortDescription ?? '',
            imageUrl: offer.imageUrl ?? '',
            salesHint: offer.upsellRules.join(' · '),
        })),
        availableProductsSnapshot: products.map((product) => ({
          id: product.id,
          code: product.code,
          name: product.name,
          price: Number(product.salePrice),
          available: this.isAvailable(product),
          categoryName: product.category?.name ?? null,
        })),
        paymentOptionsSnapshot: {
          paymentLink: 'available_when_operational_order_exists',
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

    let draft = activeDraft;
    if (nextItems.length || activeDraft) {
      const draftPayload = {
        customerName: customerName ?? undefined,
        customerPhone: customerPhone ?? undefined,
        deliveryAddress: deliveryAddress ?? undefined,
        deliveryNeighborhood: activeDraft?.deliveryNeighborhood ?? undefined,
        deliveryNotes: 'Pedido armado por Sofía sandbox. Sin WhatsApp real.',
        deliveryFee: totals.deliveryFee,
        aiSummary: `Intent: ${effectiveIntent}. ${matchedFeaturedOffer ? `FeaturedOffer:${matchedFeaturedOffer.slug}. ` : ''}AI:${safeAi.provider}/${safeAi.mode}.`,
        items: nextItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      };
      draft = activeDraft
        ? await this.sofiaService.updateDraft(activeDraft.id, draftPayload, actorId)
        : await this.sofiaService.createDraft({ ...draftPayload, conversationId: conversation.id }, actorId);
    }

    let deliveryOrder: unknown = null;
    let paymentLinkUrl: string | null = null;
    let confirmed = false;
    const canConfirm = Boolean(classified.intent === 'CONFIRM_ORDER' && draft && !missingFields.length && !outsideHours);
    if (canConfirm && draft) {
      const confirmedDraft = await this.sofiaService.confirmDraft(draft.id, actorId);
      const createdDeliveryOrder = await this.sofiaService.createDeliveryOrderFromDraft(confirmedDraft.id, actorId, true);
      deliveryOrder = createdDeliveryOrder;
      const orderTicketId = createdDeliveryOrder.orderTicketId;
      if (orderTicketId) {
        const link = await this.paymentLinkService.generateOperationalLink(orderTicketId, actorId);
        paymentLinkUrl = link.publicPaymentUrl;
      }
      await this.customerMemoryService.saveLastOrder({
        phone: customerPhone,
        displayName: customerName,
        address: deliveryAddress,
        preferredPaymentMethod: this.paymentMethodFromText(normalized),
        orderSummary: {
          source: 'SOFIA_SANDBOX',
          confirmedAt: new Date().toISOString(),
          items: nextItems.map((item) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
          })),
          total: totals.total,
          currency: 'COP',
        },
      });
      confirmed = true;
    }

    if (handoff || aiWantsHandoff) {
      await this.prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: { status: WhatsappConversationStatus.HUMAN_REQUIRED, sofiaEnabled: false },
      });
    }

    const responseText = this.buildResponse({
      intent: effectiveIntent,
      missingFields,
      items: nextItems,
      upsell,
      outsideHours,
      handoff: handoff || aiWantsHandoff,
      confirmed,
      paymentLinkUrl,
      audioNeedsConfirmation,
      menuRequest,
      featuredOffer: matchedFeaturedOffer,
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
      phoneNormalized: memoryBefore?.phoneNormalized ?? customerMemory.phoneNormalized,
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
      catalogItems: [
        ...(matchedCatalogItem ? [matchedCatalogItem] : []),
        ...(matchedFeaturedOffer && !matchedCatalogItem
          ? [
              {
                slug: matchedFeaturedOffer.slug,
                name: matchedFeaturedOffer.name,
                price: null,
                priceSource: 'NONE',
                prohibitedClaims: matchedFeaturedOffer.slug === 'maxi-family' ? this.catalogService.forbiddenMaxiClaims() : [],
              },
            ]
          : []),
      ],
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
      featuredOffers: getActiveSofiaFeaturedOffers(),
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
      nextAction: handoff || aiWantsHandoff ? 'HANDOFF' : confirmed ? 'ORDER_CREATED' : missingFields.length ? 'ASK_MISSING_FIELDS' : 'READY_TO_CONFIRM',
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
      await this.prisma.whatsappMessage.create({
        data: {
          conversationId: conversation.id,
          direction: WhatsappMessageDirection.OUTBOUND,
          type: WhatsappMessageType.SYSTEM,
          body: responseText,
          aiIntent: effectiveIntent,
          confidence: effectiveConfidence,
          rawPayload: outboundPayload,
        },
      });
    }

    await this.prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

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
    const draft = dto.draftId
      ? await this.prisma.sofiaOrderDraft.findUnique({ where: { id: dto.draftId }, include: { conversation: true, deliveryOrder: true } })
      : await this.prisma.sofiaOrderDraft.findFirst({
          where: {
            conversationId: dto.conversationId,
            status: { in: [SofiaOrderDraftStatus.DRAFT, SofiaOrderDraftStatus.NEEDS_INFO, SofiaOrderDraftStatus.READY_TO_CONFIRM] },
            deliveryOrder: null,
          },
          orderBy: { updatedAt: 'desc' },
          include: { conversation: true, deliveryOrder: true },
        });

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
