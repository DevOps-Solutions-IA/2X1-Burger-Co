import {
  Prisma,
  SofiaCatalogItemStatus,
  SofiaCatalogItemType,
  SofiaCatalogPriceSource,
} from '@prisma/client';
import { SofiaCommercialCatalogService } from './sofia-commercial-catalog.service';
import {
  SofiaCommercialCatalogItemSnapshot,
} from './sofia-commercial-catalog.types';

function catalogRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'catalog-item-1',
    slug: 'maxi-family',
    name: 'Maxi Family',
    type: SofiaCatalogItemType.OFFER,
    status: SofiaCatalogItemStatus.ACTIVE,
    linkedProductId: null,
    linkedProductName: null,
    priceSource: SofiaCatalogPriceSource.NONE,
    manualPrice: null,
    imageUrl: '/uploads/sofia-offers/maxi-family.webp',
    shortDescription: '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L',
    compositionJson: {
      requiredCopy: '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L',
      items: ['6 burgers', '1 porción personal de papitas', '1 Pepsi 1.5 L'],
    },
    aliasesJson: ['maxi family'],
    upsellRulesJson: [],
    prohibitedClaimsJson: ['papas familiares'],
    sortOrder: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function snapshot(overrides: Partial<SofiaCommercialCatalogItemSnapshot> = {}): SofiaCommercialCatalogItemSnapshot {
  return {
    id: 'catalog-item-1',
    slug: 'maxi-family',
    name: 'Maxi Family',
    type: SofiaCatalogItemType.OFFER,
    linkedProductId: null,
    linkedProductName: null,
    availability: 'CONFIGURATION_ONLY',
    availabilityReason: 'PRODUCT_LINK_MISSING',
    purchasable: false,
    price: null,
    priceSource: 'NONE',
    imageUrl: '/uploads/sofia-offers/maxi-family.webp',
    shortDescription: '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L',
    composition: {
      requiredCopy: '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L',
      items: ['6 burgers', '1 porción personal de papitas', '1 Pepsi 1.5 L'],
    },
    aliases: ['maxi family'],
    upsellRules: [],
    prohibitedClaims: ['papas familiares'],
    sortOrder: 1,
    ...overrides,
  };
}

describe('SofiaCommercialCatalogService availability truth', () => {
  const prisma = {
    sofiaCommercialCatalogItem: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  let service: SofiaCommercialCatalogService;
  const catalogRead = {
    listActive: jest.fn(async () => {
      const product = await prisma.product.findUnique();
      if (!product || !product.isActive) return [];
      return [{
        ...product,
        persistedPrice: Number(product.salePrice),
        category: product.category ?? null,
      }];
    }),
    getActiveById: jest.fn(),
    findActive: jest.fn(async ({ name }: { name?: string }) => {
      const product = await prisma.product.findFirst({ where: { name } });
      return product && product.isActive
        ? { ...product, persistedPrice: Number(product.salePrice), category: product.category ?? null }
        : null;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.sofiaCommercialCatalogItem.upsert.mockImplementation(({ create }: { create: unknown }) => create);
    prisma.product.findFirst.mockResolvedValue(null);
    service = new SofiaCommercialCatalogService(prisma as never, catalogRead as never);
  });

  it('keeps an unlinked Maxi Family as policy-only with exact copy and no price', async () => {
    prisma.sofiaCommercialCatalogItem.findUnique.mockResolvedValue(catalogRow());

    const item = await service.findBySlug('maxi-family');
    const explanation = await service.explainOffer('maxi-family');

    expect(item).toMatchObject({
      availability: 'CONFIGURATION_ONLY',
      availabilityReason: 'PRODUCT_LINK_MISSING',
      purchasable: false,
      price: null,
      priceSource: 'NONE',
    });
    expect(explanation).toContain('6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L');
    expect(explanation).toContain('todavía no está disponible para comprar');
  });

  it('marks only a linked active product with a positive persisted price as available', async () => {
    prisma.sofiaCommercialCatalogItem.findUnique.mockResolvedValue(
      catalogRow({
        slug: '2x1-hamburguesas',
        name: '2x1 Hamburguesas',
        linkedProductId: 'product-2x1',
        linkedProductName: 'Hamburguesa 2x1',
        priceSource: SofiaCatalogPriceSource.PRODUCT,
      }),
    );
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-2x1',
      name: 'Hamburguesa 2x1',
      isActive: true,
      salePrice: new Prisma.Decimal(20000),
    });

    await expect(service.findBySlug('2x1-hamburguesas')).resolves.toMatchObject({
      availability: 'AVAILABLE',
      availabilityReason: 'ACTIVE_PRODUCT_WITH_PERSISTED_PRICE',
      purchasable: true,
      linkedProductId: 'product-2x1',
      price: 20000,
      priceSource: 'PRODUCT',
    });
  });

  it.each([
    [{ id: 'product-2x1', name: 'Hamburguesa 2x1', isActive: false, salePrice: new Prisma.Decimal(20000) }, 'LINKED_PRODUCT_NOT_FOUND'],
    [{ id: 'product-2x1', name: 'Hamburguesa 2x1', isActive: true, salePrice: new Prisma.Decimal(0) }, 'PERSISTED_PRICE_NOT_POSITIVE'],
    [null, 'LINKED_PRODUCT_NOT_FOUND'],
  ])('fails closed when the linked product is not commercially valid', async (product, reason) => {
    prisma.sofiaCommercialCatalogItem.findUnique.mockResolvedValue(
      catalogRow({ linkedProductId: 'product-2x1', linkedProductName: 'Hamburguesa 2x1' }),
    );
    prisma.product.findUnique.mockResolvedValue(product);

    await expect(service.findBySlug('maxi-family')).resolves.toMatchObject({
      availability: 'CONFIGURATION_ONLY',
      availabilityReason: reason,
      purchasable: false,
      price: null,
      priceSource: 'NONE',
    });
  });

  it('does not erase an operator-established product link for policy seed entries', async () => {
    await service.ensureSeedCatalog();

    const maxiUpsert = prisma.sofiaCommercialCatalogItem.upsert.mock.calls
      .map(([call]) => call)
      .find((call) => call.where.slug === 'maxi-family');
    expect(maxiUpsert.update).not.toHaveProperty('linkedProductId');
    expect(maxiUpsert.update).not.toHaveProperty('linkedProductName');
    expect(maxiUpsert.update).not.toHaveProperty('priceSource');
  });
});

describe('SofiaCommercialCatalogService.toAvailableOfferSnapshots', () => {
  it('excludes configuration-only entries and additions from the AI offer snapshot', () => {
    const service = new SofiaCommercialCatalogService({} as never, {} as never);
    const available = snapshot({
      id: 'catalog-item-2',
      slug: '2x1-hamburguesas',
      name: '2x1 Hamburguesas',
      linkedProductId: 'product-2x1',
      linkedProductName: 'Hamburguesa 2x1',
      availability: 'AVAILABLE',
      availabilityReason: 'ACTIVE_PRODUCT_WITH_PERSISTED_PRICE',
      purchasable: true,
      price: 20000,
      priceSource: 'PRODUCT',
    });
    const addition = snapshot({
      id: 'catalog-item-3',
      slug: 'papitas-adicionales',
      name: 'Papitas adicionales',
      type: SofiaCatalogItemType.ADDITION,
      linkedProductId: 'product-fries',
      availability: 'AVAILABLE',
      availabilityReason: 'ACTIVE_PRODUCT_WITH_PERSISTED_PRICE',
      purchasable: true,
      price: 5000,
      priceSource: 'PRODUCT',
    });

    expect(service.toAvailableOfferSnapshots([snapshot(), available, addition])).toEqual([
      expect.objectContaining({
        slug: '2x1-hamburguesas',
        linkedProductId: 'product-2x1',
        price: 20000,
      }),
    ]);
  });
});
