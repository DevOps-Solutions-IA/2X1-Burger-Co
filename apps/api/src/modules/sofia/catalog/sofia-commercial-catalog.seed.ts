import { Prisma, SofiaCatalogItemStatus, SofiaCatalogItemType, SofiaCatalogPriceSource } from '@prisma/client';

export const SOFIA_MAXI_FAMILY_REQUIRED_COPY = '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L';

export const SOFIA_MAXI_FAMILY_FORBIDDEN_CLAIMS = [
  'papas grandes',
  'papas familiares',
  'papas para todos',
  'porción familiar de papas',
  'papitas para todos',
  'combo familiar con papas familiares',
  'papas incluidas para todos',
];

export type SofiaCatalogSeedItem = {
  slug: string;
  name: string;
  type: SofiaCatalogItemType;
  status: SofiaCatalogItemStatus;
  linkedProductName?: string | null;
  priceSource: SofiaCatalogPriceSource;
  imageUrl?: string | null;
  shortDescription: string;
  compositionJson: Prisma.InputJsonValue;
  aliasesJson: Prisma.InputJsonValue;
  upsellRulesJson: Prisma.InputJsonValue;
  prohibitedClaimsJson: Prisma.InputJsonValue;
  sortOrder: number;
};

export const SOFIA_COMMERCIAL_CATALOG_SEED: SofiaCatalogSeedItem[] = [
  {
    slug: 'maxi-family',
    name: 'Maxi Family',
    type: SofiaCatalogItemType.OFFER,
    status: SofiaCatalogItemStatus.ACTIVE,
    linkedProductName: null,
    priceSource: SofiaCatalogPriceSource.NONE,
    imageUrl: '/uploads/sofia-offers/maxi-family.webp',
    shortDescription: SOFIA_MAXI_FAMILY_REQUIRED_COPY,
    compositionJson: {
      requiredCopy: SOFIA_MAXI_FAMILY_REQUIRED_COPY,
      items: ['6 burgers', '1 porción personal de papitas', '1 Pepsi 1.5 L'],
      notes: ['Si quieren más acompañamiento, se pueden agregar porciones adicionales de papitas.'],
    },
    aliasesJson: ['maxi family', 'maxifamily', 'family', 'combo familiar', 'maxi'],
    upsellRulesJson: ['sugerir papitas adicionales', 'no sugerir Pepsi porque ya incluye Pepsi 1.5 L'],
    prohibitedClaimsJson: SOFIA_MAXI_FAMILY_FORBIDDEN_CLAIMS,
    sortOrder: 1,
  },
  {
    slug: '2x1-hamburguesas',
    name: '2x1 Hamburguesas',
    type: SofiaCatalogItemType.OFFER,
    status: SofiaCatalogItemStatus.ACTIVE,
    linkedProductName: 'Hamburguesa 2x1',
    priceSource: SofiaCatalogPriceSource.PRODUCT,
    imageUrl: '/uploads/sofia-offers/2x1-hamburguesas.webp',
    shortDescription: '2 hamburguesas',
    compositionJson: {
      requiredCopy: '2 hamburguesas',
      items: ['2 hamburguesas'],
      notes: ['Se puede completar con papitas o bebida.'],
    },
    aliasesJson: ['2x1', 'dos por uno', 'promo 2x1', 'dos hamburguesas', '2 x 1'],
    upsellRulesJson: ['sugerir papitas', 'sugerir bebida', 'sugerir queso o tocineta si aplica'],
    prohibitedClaimsJson: [],
    sortOrder: 2,
  },
  {
    slug: 'doble-todo',
    name: 'Doble Todo',
    type: SofiaCatalogItemType.OFFER,
    status: SofiaCatalogItemStatus.ACTIVE,
    linkedProductName: null,
    priceSource: SofiaCatalogPriceSource.NONE,
    imageUrl: '/uploads/sofia-offers/doble-todo.webp',
    shortDescription: 'doble carne + doble tocineta + doble queso cheddar en lonjas',
    compositionJson: {
      requiredCopy: 'doble carne + doble tocineta + doble queso cheddar en lonjas',
      items: ['doble carne', 'doble tocineta', 'doble queso cheddar en lonjas'],
      notes: ['No sugerir doble carne, doble tocineta o doble queso como si faltaran.'],
    },
    aliasesJson: ['doble todo', 'dobletodo', 'doble', 'hamburguesa doble', 'burger doble'],
    upsellRulesJson: ['sugerir papitas o bebida'],
    prohibitedClaimsJson: [],
    sortOrder: 3,
  },
  {
    slug: 'hamburguesa-sencilla',
    name: 'Hamburguesa Sencilla',
    type: SofiaCatalogItemType.OFFER,
    status: SofiaCatalogItemStatus.ACTIVE,
    linkedProductName: null,
    priceSource: SofiaCatalogPriceSource.NONE,
    imageUrl: '/uploads/sofia-offers/hamburguesa-sencilla.webp',
    shortDescription: '1 hamburguesa sencilla',
    compositionJson: {
      requiredCopy: '1 hamburguesa sencilla',
      items: ['1 hamburguesa sencilla'],
      notes: ['Si falta composición real, pedir confirmación operativa antes de detallar ingredientes.'],
    },
    aliasesJson: ['sencilla', 'hamburguesa sencilla', 'burger sencilla', 'simple', 'clasica', 'clásica'],
    upsellRulesJson: ['sugerir queso', 'sugerir tocineta', 'sugerir carne extra', 'sugerir papitas', 'sugerir bebida'],
    prohibitedClaimsJson: [],
    sortOrder: 4,
  },
  {
    slug: 'carne-extra',
    name: 'Carne extra',
    type: SofiaCatalogItemType.ADDITION,
    status: SofiaCatalogItemStatus.ACTIVE,
    linkedProductName: null,
    priceSource: SofiaCatalogPriceSource.NONE,
    shortDescription: 'Adición de carne extra si existe disponibilidad operativa.',
    compositionJson: { items: ['carne extra'] },
    aliasesJson: ['carne extra', 'extra carne', 'mas carne', 'más carne'],
    upsellRulesJson: [],
    prohibitedClaimsJson: [],
    sortOrder: 20,
  },
  {
    slug: 'tocineta',
    name: 'Tocineta',
    type: SofiaCatalogItemType.ADDITION,
    status: SofiaCatalogItemStatus.ACTIVE,
    linkedProductName: null,
    priceSource: SofiaCatalogPriceSource.NONE,
    shortDescription: 'Adición de tocineta si existe disponibilidad operativa.',
    compositionJson: { items: ['tocineta'] },
    aliasesJson: ['tocineta', 'bacon'],
    upsellRulesJson: [],
    prohibitedClaimsJson: [],
    sortOrder: 21,
  },
  {
    slug: 'queso',
    name: 'Queso',
    type: SofiaCatalogItemType.ADDITION,
    status: SofiaCatalogItemStatus.ACTIVE,
    linkedProductName: null,
    priceSource: SofiaCatalogPriceSource.NONE,
    shortDescription: 'Adición de queso si existe disponibilidad operativa.',
    compositionJson: { items: ['queso'] },
    aliasesJson: ['queso', 'cheddar', 'queso cheddar'],
    upsellRulesJson: [],
    prohibitedClaimsJson: [],
    sortOrder: 22,
  },
  {
    slug: 'papitas-adicionales',
    name: 'Papitas adicionales',
    type: SofiaCatalogItemType.ADDITION,
    status: SofiaCatalogItemStatus.ACTIVE,
    linkedProductName: null,
    priceSource: SofiaCatalogPriceSource.NONE,
    shortDescription: 'Porciones adicionales de papitas.',
    compositionJson: { items: ['papitas adicionales'] },
    aliasesJson: ['papitas adicionales', 'papas adicionales', 'papitas', 'papas'],
    upsellRulesJson: [],
    prohibitedClaimsJson: [],
    sortOrder: 23,
  },
];
