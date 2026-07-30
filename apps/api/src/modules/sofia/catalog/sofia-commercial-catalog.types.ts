import { SofiaCatalogItemType } from '@prisma/client';

export type SofiaCatalogComposition = {
  requiredCopy?: string;
  items: string[];
  notes?: string[];
};

export type SofiaCommercialCatalogAvailability = 'AVAILABLE' | 'CONFIGURATION_ONLY';

export type SofiaCommercialCatalogAvailabilityReason =
  | 'ACTIVE_PRODUCT_WITH_PERSISTED_PRICE'
  | 'PRODUCT_LINK_MISSING'
  | 'LINKED_PRODUCT_NOT_FOUND'
  | 'LINKED_PRODUCT_INACTIVE'
  | 'PERSISTED_PRICE_NOT_POSITIVE';

export type SofiaCommercialCatalogItemSnapshot = {
  id: string;
  slug: string;
  name: string;
  type: SofiaCatalogItemType;
  linkedProductId: string | null;
  linkedProductName: string | null;
  availability: SofiaCommercialCatalogAvailability;
  availabilityReason: SofiaCommercialCatalogAvailabilityReason;
  purchasable: boolean;
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

export type SofiaAvailableCommercialOfferSnapshot = {
  slug: string;
  name: string;
  linkedProductId: string;
  price: number;
  description: string;
  imageUrl: string;
  salesHint: string;
};
