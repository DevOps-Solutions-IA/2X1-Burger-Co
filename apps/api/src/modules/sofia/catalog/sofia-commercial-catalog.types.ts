import { SofiaCatalogItemType } from '@prisma/client';

export type SofiaCatalogComposition = {
  requiredCopy?: string;
  items: string[];
  notes?: string[];
};

export type SofiaCommercialCatalogItemSnapshot = {
  id: string;
  slug: string;
  name: string;
  type: SofiaCatalogItemType;
  linkedProductId: string | null;
  linkedProductName: string | null;
  price: number | null;
  priceSource: 'PRODUCT' | 'MANUAL' | 'NONE';
  imageUrl: string | null;
  shortDescription: string | null;
  composition: SofiaCatalogComposition | null;
  aliases: string[];
  upsellRules: string[];
  prohibitedClaims: string[];
  sortOrder: number;
};
