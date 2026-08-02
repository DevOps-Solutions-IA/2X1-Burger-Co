import { Injectable, NotFoundException } from '@nestjs/common';
import type { CatalogProductDto, CatalogReadService } from '../../application/contracts/sofia-domain-contracts';
import { CategoriesService } from '../categories/categories.service';
import { ProductsService } from './products.service';

type SellableProduct = Awaited<ReturnType<ProductsService['findSellable']>>[number];

@Injectable()
export class ProductsCatalogReadAdapter implements CatalogReadService {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  async listActive(input?: { brand?: string }) {
    const [categories, products] = await Promise.all([
      this.categories.findAll(),
      this.products.findSellable(input?.brand),
    ]);
    const activeCategoryIds = new Set(categories.filter((category) => category.isActive).map((category) => category.id));
    return products
      .filter((product) => product.category && activeCategoryIds.has(product.category.id))
      .map((product) => this.serialize(product));
  }

  async getActiveById(productId: string) {
    const product = await this.products.findOne(productId);
    if (!product.isActive) throw new NotFoundException({ code: 'SOFIA_PRODUCT_UNAVAILABLE' });
    return this.serialize(product);
  }

  async findActive(input: { code?: string; name?: string }) {
    const code = input.code?.trim().toLocaleLowerCase('es-CO');
    const name = input.name?.trim().toLocaleLowerCase('es-CO');
    const products = await this.listActive();
    return products.find((product) => (code && product.code.toLocaleLowerCase('es-CO') === code) || (name && product.name.toLocaleLowerCase('es-CO') === name)) ?? null;
  }

  private serialize(product: SellableProduct): CatalogProductDto {
    return {
      id: product.id,
      code: product.code,
      name: product.name,
      description: product.description ?? null,
      imageUrl: product.imageUrl ?? null,
      category: product.category ? { id: product.category.id, name: product.category.name, slug: product.category.slug ?? '' } : null,
      kind: product.kind,
      persistedPrice: Number(product.salePrice),
      active: product.isActive,
      trackStock: product.trackStock,
      updatedAt: product.updatedAt?.toISOString?.() ?? new Date(0).toISOString(),
    };
  }
}
