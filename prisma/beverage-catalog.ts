import { ProductBrand, ProductKind } from '@prisma/client';

export type BeverageSeedProduct = {
  code: string;
  name: string;
  categorySlug: 'bebidas' | 'aguas';
  kind: ProductKind;
  brand: ProductBrand;
  salePrice: number;
  costPrice: number;
  currentStock: number;
  stockMin: number;
  description: string;
};

function beverage(
  code: string,
  name: string,
  categorySlug: 'bebidas' | 'aguas',
  brand: ProductBrand,
  salePrice: number,
  costPrice: number,
  currentStock: number,
  stockMin: number,
  description: string,
): BeverageSeedProduct {
  return {
    code,
    name,
    categorySlug,
    kind: ProductKind.DIRECT_STOCK,
    brand,
    salePrice,
    costPrice,
    currentStock,
    stockMin,
    description,
  };
}

export const beverageCatalog: BeverageSeedProduct[] = [
  beverage('CC-ORG-1500', 'Coca-Cola Original 1.5 L', 'bebidas', ProductBrand.COCA_COLA, 9000, 0, 10, 4, 'COCA-COLA · 1500 ml'),
  beverage('CC-ORG-400', 'Coca-Cola Original 400 ml', 'bebidas', ProductBrand.COCA_COLA, 4000, 0, 18, 6, 'COCA-COLA · 400 ml'),
  beverage('AIN-LIM-600', 'Agua INN Limón 600 ml', 'aguas', ProductBrand.OTHER, 3500, 0, 12, 4, 'AGUA INN · 600 ml'),
  beverage('ABLU-600', 'Agua Blu 600 ml', 'aguas', ProductBrand.OTHER, 3500, 0, 12, 4, 'AGUA BLU · 600 ml'),
  beverage('EGO-FRU-355', 'Ego Frutas 355 ml', 'bebidas', ProductBrand.OTHER, 17000, 0, 8, 2, 'EGO FRUTAS · 355 ml'),
  beverage('OMNI-FXNAR-355', 'OMNILIFE FX Naranja 355 ml', 'bebidas', ProductBrand.OTHER, 7000, 0, 10, 3, 'OMNILIFE FX · NARANJA · 355 ml'),
  beverage('OMNI-FXMAN-355', 'OMNILIFE FX Manzana 355 ml', 'bebidas', ProductBrand.OTHER, 7000, 0, 10, 3, 'OMNILIFE FX · MANZANA · 355 ml'),
  beverage('POKER-330', 'Cerveza Poker 330 ml', 'bebidas', ProductBrand.OTHER, 4000, 0, 16, 6, 'CERVEZA POKER · 330 ml'),
  beverage('COLAPOLA-330', 'Cola & Pola 330 ml', 'bebidas', ProductBrand.OTHER, 4000, 0, 16, 6, 'COLA & POLA · 330 ml'),
  beverage('CLUBCOL-269', 'Cerveza Club Colombia 269 ml', 'bebidas', ProductBrand.OTHER, 5000, 0, 12, 4, 'CLUB COLOMBIA · 269 ml'),
];
