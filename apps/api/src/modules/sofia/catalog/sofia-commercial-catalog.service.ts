import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ProductKind,
  SofiaCatalogItemStatus,
  SofiaCatalogItemType,
  SofiaCatalogPriceSource,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SOFIA_COMMERCIAL_CATALOG_SEED,
  SOFIA_MAXI_FAMILY_FORBIDDEN_CLAIMS,
  SOFIA_MAXI_FAMILY_REQUIRED_COPY,
} from './sofia-commercial-catalog.seed';
import {
  SofiaCommercialCatalogAvailabilityReason,
  SofiaCommercialCatalogItemSnapshot,
  SofiaAvailableCommercialOfferSnapshot,
  SofiaCatalogComposition,
} from './sofia-commercial-catalog.types';

@Injectable()
export class SofiaCommercialCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSeedCatalog() {
    const results = [];
    for (const item of SOFIA_COMMERCIAL_CATALOG_SEED) {
      const linkedProduct = item.linkedProductName ? await this.findLinkedProduct(item.linkedProductName) : null;
      const linkedProductUpdate = item.linkedProductName
        ? {
            linkedProductId: linkedProduct?.id ?? null,
            linkedProductName: item.linkedProductName,
            priceSource: linkedProduct ? SofiaCatalogPriceSource.PRODUCT : item.priceSource,
          }
        : {};
      results.push(
        await this.prisma.sofiaCommercialCatalogItem.upsert({
          where: { slug: item.slug },
          create: {
            ...item,
            linkedProductId: linkedProduct?.id ?? null,
            linkedProductName: item.linkedProductName ?? null,
            priceSource: linkedProduct ? SofiaCatalogPriceSource.PRODUCT : item.priceSource,
          },
          update: {
            name: item.name,
            type: item.type,
            status: item.status,
            ...linkedProductUpdate,
            imageUrl: item.imageUrl ?? null,
            shortDescription: item.shortDescription,
            compositionJson: item.compositionJson,
            aliasesJson: item.aliasesJson,
            upsellRulesJson: item.upsellRulesJson,
            prohibitedClaimsJson: item.prohibitedClaimsJson,
            sortOrder: item.sortOrder,
          },
        }),
      );
    }
    return results;
  }

  async listActiveItems() {
    await this.ensureSeedCatalog();
    const items = await this.prisma.sofiaCommercialCatalogItem.findMany({
      where: { status: SofiaCatalogItemStatus.ACTIVE },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return Promise.all(items.map((item) => this.toSnapshot(item)));
  }

  async listActiveOffers() {
    await this.ensureSeedCatalog();
    const items = await this.prisma.sofiaCommercialCatalogItem.findMany({
      where: { status: SofiaCatalogItemStatus.ACTIVE, type: SofiaCatalogItemType.OFFER },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return Promise.all(items.map((item) => this.toSnapshot(item)));
  }

  toAvailableOfferSnapshots(
    items: SofiaCommercialCatalogItemSnapshot[],
  ): SofiaAvailableCommercialOfferSnapshot[] {
    return items.flatMap((item) => {
      if (
        item.type !== SofiaCatalogItemType.OFFER ||
        item.availability !== 'AVAILABLE' ||
        !item.purchasable ||
        item.linkedProductId === null ||
        item.price === null
      ) {
        return [];
      }
      return [
        {
          slug: item.slug,
          name: item.name,
          linkedProductId: item.linkedProductId,
          price: item.price,
          description: item.composition?.requiredCopy ?? item.shortDescription ?? '',
          imageUrl: item.imageUrl ?? '',
          salesHint: item.upsellRules.join(' · '),
        },
      ];
    });
  }

  async findBySlug(slug: string) {
    await this.ensureSeedCatalog();
    const item = await this.prisma.sofiaCommercialCatalogItem.findUnique({ where: { slug } });
    if (!item) throw new NotFoundException('Ítem de catálogo Sofía no encontrado.');
    return this.toSnapshot(item);
  }

  async findByText(rawText: string) {
    const normalized = this.normalize(rawText);
    const items = await this.listActiveItems();
    return (
      items.find((item) => normalized.includes(this.normalize(item.name))) ??
      items.find((item) => item.aliases.some((alias) => normalized.includes(this.normalize(alias)))) ??
      null
    );
  }

  async explainOffer(slug: string) {
    const item = await this.findBySlug(slug);
    if (item.availability === 'CONFIGURATION_ONLY') {
      const composition = item.composition?.requiredCopy ?? item.shortDescription ?? 'sin detalle comercial configurado';
      return `${item.name}: ${composition}. Esta referencia conserva la política comercial, pero todavía no está disponible para comprar porque no tiene un producto activo con precio persistido.`;
    }
    if (item.slug === 'maxi-family') {
      return `El Maxi Family trae ${SOFIA_MAXI_FAMILY_REQUIRED_COPY}.`;
    }
    if (item.slug === '2x1-hamburguesas') {
      return 'El 2x1 Hamburguesas trae 2 hamburguesas.';
    }
    if (item.slug === 'doble-todo') {
      return 'La Doble Todo trae doble carne, doble tocineta y doble queso cheddar en lonjas.';
    }
    if (item.slug === 'hamburguesa-sencilla') {
      return 'La Hamburguesa Sencilla es 1 hamburguesa sencilla. Si falta detalle de ingredientes, lo confirmo con el equipo.';
    }
    return item.composition?.requiredCopy ? `${item.name} trae ${item.composition.requiredCopy}.` : `${item.name}: ${item.shortDescription ?? 'sin detalle comercial configurado.'}`;
  }

  async listAvailableBeverages() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        salePrice: true,
        kind: true,
        trackStock: true,
        currentStock: true,
        category: { select: { name: true, slug: true } },
      },
      orderBy: { name: 'asc' },
    });

    return products
      .filter((product) => this.isDrink(product))
      .filter((product) => product.kind !== ProductKind.DIRECT_STOCK || !product.trackStock || Number(product.currentStock) > 0)
      .map((product) => ({
        id: product.id,
        name: product.name,
        price: Number(product.salePrice),
      }));
  }

  maxiFamilyRequiredCopy() {
    return SOFIA_MAXI_FAMILY_REQUIRED_COPY;
  }

  forbiddenMaxiClaims() {
    return [...SOFIA_MAXI_FAMILY_FORBIDDEN_CLAIMS];
  }

  private async findLinkedProduct(linkedProductName: string) {
    return this.prisma.product.findFirst({
      where: {
        isActive: true,
        name: { equals: linkedProductName, mode: 'insensitive' },
      },
      select: { id: true },
    });
  }

  private async toSnapshot(item: {
    id: string;
    slug: string;
    name: string;
    type: SofiaCatalogItemType;
    linkedProductId: string | null;
    linkedProductName: string | null;
    priceSource: SofiaCatalogPriceSource;
    manualPrice: Prisma.Decimal | null;
    imageUrl: string | null;
    shortDescription: string | null;
    compositionJson: Prisma.JsonValue | null;
    aliasesJson: Prisma.JsonValue | null;
    upsellRulesJson: Prisma.JsonValue | null;
    prohibitedClaimsJson: Prisma.JsonValue | null;
    sortOrder: number;
  }): Promise<SofiaCommercialCatalogItemSnapshot> {
    const product = item.linkedProductId
      ? await this.prisma.product.findUnique({
          where: { id: item.linkedProductId },
          select: { id: true, name: true, salePrice: true, isActive: true },
        })
      : null;
    const persistedPrice = product ? Number(product.salePrice) : null;
    const availabilityReason: SofiaCommercialCatalogAvailabilityReason = !item.linkedProductId
      ? 'PRODUCT_LINK_MISSING'
      : !product
        ? 'LINKED_PRODUCT_NOT_FOUND'
        : !product.isActive
          ? 'LINKED_PRODUCT_INACTIVE'
          : persistedPrice === null || !Number.isFinite(persistedPrice) || persistedPrice <= 0
            ? 'PERSISTED_PRICE_NOT_POSITIVE'
            : 'ACTIVE_PRODUCT_WITH_PERSISTED_PRICE';
    const available = availabilityReason === 'ACTIVE_PRODUCT_WITH_PERSISTED_PRICE';

    return {
      id: item.id,
      slug: item.slug,
      name: item.name,
      type: item.type,
      linkedProductId: item.linkedProductId,
      linkedProductName: product?.name ?? item.linkedProductName,
      availability: available ? 'AVAILABLE' : 'CONFIGURATION_ONLY',
      availabilityReason,
      purchasable: available,
      price: available ? persistedPrice : null,
      priceSource: available ? 'PRODUCT' : 'NONE',
      imageUrl: item.imageUrl,
      shortDescription: item.shortDescription,
      composition: this.compositionFromJson(item.compositionJson),
      aliases: this.stringArrayFromJson(item.aliasesJson),
      upsellRules: this.stringArrayFromJson(item.upsellRulesJson),
      prohibitedClaims: this.stringArrayFromJson(item.prohibitedClaimsJson),
      sortOrder: item.sortOrder,
    };
  }

  private compositionFromJson(value: Prisma.JsonValue | null): SofiaCatalogComposition | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return {
      requiredCopy: typeof record.requiredCopy === 'string' ? record.requiredCopy : undefined,
      items: Array.isArray(record.items) ? record.items.filter((item): item is string => typeof item === 'string') : [],
      notes: Array.isArray(record.notes) ? record.notes.filter((item): item is string => typeof item === 'string') : undefined,
    };
  }

  private stringArrayFromJson(value: Prisma.JsonValue | null) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private isDrink(product: { name: string; category: { name: string; slug: string } | null }) {
    const text = this.normalize(`${product.name} ${product.category?.name ?? ''} ${product.category?.slug ?? ''}`);
    return /\b(gaseosa|bebida|pepsi|coca|postobon|hit|agua|jugo)\b/.test(text);
  }

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
