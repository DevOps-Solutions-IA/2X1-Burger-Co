import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductBrand, ProductKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../../common/types/audit-context.type';
import { toDecimal } from '../../common/utils/decimal.util';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

// A65: same privilege tier that is already allowed to CREATE/UPDATE product cost data
// (see ProductsController's `@Roles('admin', 'inventory')` on POST/PATCH /products) is the
// only tier allowed to READ costPrice / recipe cost breakdown. Any other authenticated caller
// (cashier, supervisor, waiter, delivery) can still call GET /products and GET /products/:id —
// several legitimate frontend flows (POS product browser, etc.) depend on the route staying
// reachable to those roles — but the response is shaped to omit cost/margin fields for them.
const COST_VISIBILITY_PERMISSION = 'products.update';

function canViewCost(viewerPermissions: string[] | undefined) {
  return (viewerPermissions ?? []).includes(COST_VISIBILITY_PERMISSION);
}

type ProductWithRecipeCost = Prisma.ProductGetPayload<{
  include: {
    category: true;
    unit: true;
    recipes: {
      include: {
        items: {
          include: {
            ingredient: true;
          };
        };
      };
    };
  };
}>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(viewerPermissions?: string[]) {
    const products = await this.prisma.product.findMany({
      where: {
        NOT: {
          isActive: false,
          name: {
            not: {
              startsWith: 'Coca-Cola',
            },
          },
          category: {
            is: {
              slug: {
                in: ['bebidas', 'aguas'],
              },
            },
          },
        },
      },
      include: {
        category: true,
        unit: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    if (canViewCost(viewerPermissions)) {
      return products;
    }

    return products.map((product) => this.stripProductCost(product));
  }

  findSellable(brand?: string) {
    const normalizedBrand =
      brand && Object.values(ProductBrand).includes(brand as ProductBrand)
        ? (brand as ProductBrand)
        : undefined;

    return this.prisma.product.findMany({
      where: {
        isActive: true,
        ...(normalizedBrand ? { brand: normalizedBrand } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        imageUrl: true,
        isActive: true,
        kind: true,
        brand: true,
        salePrice: true,
        currentStock: true,
        stockMin: true,
        trackStock: true,
        updatedAt: true,
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string, viewerPermissions?: string[]) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        unit: true,
        recipes: {
          include: {
            items: {
              include: {
                ingredient: true,
              },
            },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('No se encontró el producto.');
    }

    if (canViewCost(viewerPermissions)) {
      return product;
    }

    return this.stripProductAndRecipeCost(product);
  }

  async create(dto: CreateProductDto, actorId: string, auditContext?: AuditContext) {
    this.assertStockShape(dto.kind, dto.trackStock, dto.currentStock);

    const product = await this.prisma.product.create({
      data: this.toCreateInput(dto),
      include: {
        category: true,
        unit: true,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: this.resolveAuditModule(auditContext),
      entity: 'product',
      entityId: product.id,
      newValues: this.attachAuditMetadata(dto, auditContext),
    });

    return product;
  }

  async update(id: string, dto: UpdateProductDto, actorId: string, auditContext?: AuditContext) {
    // A65: internal read for audit-log oldValues / stock-shape validation must always see the
    // full record (including costPrice) regardless of who is calling update() — cost visibility
    // shaping only applies to the viewer-facing GET routes above, never to the audit trail.
    const existing = await this.findOne(id, [COST_VISIBILITY_PERMISSION]);
    this.assertStockShape(dto.kind ?? existing.kind, dto.trackStock ?? existing.trackStock, dto.currentStock);

    const product = await this.prisma.product.update({
      where: { id },
      data: this.toUpdateInput(dto),
      include: {
        category: true,
        unit: true,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE',
      module: this.resolveAuditModule(auditContext),
      entity: 'product',
      entityId: id,
      oldValues: this.attachAuditMetadata(existing, auditContext),
      newValues: this.attachAuditMetadata(dto, auditContext),
    });

    return product;
  }

  async remove(id: string, actorId: string, auditContext?: AuditContext) {
    // A65: same rationale as update() above — the audit trail must retain costPrice.
    const existing = await this.findOne(id, [COST_VISIBILITY_PERMISSION]);

    const usage = await this.prisma.product.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            recipes: true,
            purchaseItems: true,
            saleItems: true,
            orderItems: true,
            movements: true,
          },
        },
      },
    });

    if (!usage) {
      throw new NotFoundException('No se encontró el producto.');
    }

    const relatedRecords =
      usage._count.recipes +
      usage._count.purchaseItems +
      usage._count.saleItems +
      usage._count.orderItems +
      usage._count.movements;

    if (relatedRecords > 0) {
      throw new BadRequestException(
        'Este producto ya tiene historial operativo y no se puede eliminar. Desactívalo en su lugar.',
      );
    }

    await this.prisma.product.delete({
      where: { id },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'DELETE',
      module: this.resolveAuditModule(auditContext),
      entity: 'product',
      entityId: id,
      oldValues: this.attachAuditMetadata(existing, auditContext),
    });

    return {
      success: true,
      id,
    };
  }

  private assertStockShape(kind: ProductKind, trackStock: boolean | undefined, currentStock: number | undefined) {
    if (kind === ProductKind.PREPARED && currentStock && currentStock > 0) {
      throw new BadRequestException('Los productos preparados no deben manejar stock directo.');
    }

    if (kind === ProductKind.PREPARED && trackStock === true) {
      throw new BadRequestException('Los productos preparados deben descontar por receta y no por stock directo.');
    }
  }

  private toCreateInput(dto: CreateProductDto): Prisma.ProductUncheckedCreateInput {
    const isDirectStock = dto.kind === ProductKind.DIRECT_STOCK || dto.kind === undefined;
    return {
      code: dto.code,
      name: dto.name,
      description: dto.description,
      imageUrl: dto.imageUrl,
      categoryId: dto.categoryId,
      unitId: dto.unitId,
      kind: dto.kind,
      brand: dto.brand ?? this.resolveDefaultBrand(dto.kind),
      salePrice: toDecimal(dto.salePrice),
      costPrice: dto.costPrice != null ? toDecimal(dto.costPrice) : undefined,
      trackStock: dto.trackStock ?? (dto.kind ? dto.kind === ProductKind.DIRECT_STOCK : undefined),
      currentStock:
        dto.currentStock != null
          ? toDecimal(dto.currentStock)
          : dto.kind === ProductKind.PREPARED
            ? toDecimal(0)
            : undefined,
      stockMin: dto.stockMin != null ? toDecimal(dto.stockMin) : undefined,
      isActive: dto.isActive,
      ...(isDirectStock ? {} : {}),
    };
  }

  private toUpdateInput(dto: UpdateProductDto): Prisma.ProductUncheckedUpdateInput {
    return {
      code: dto.code,
      name: dto.name,
      description: dto.description,
      imageUrl: dto.imageUrl,
      categoryId: dto.categoryId,
      unitId: dto.unitId,
      kind: dto.kind,
      brand: dto.brand,
      salePrice: dto.salePrice != null ? toDecimal(dto.salePrice) : undefined,
      costPrice: dto.costPrice != null ? toDecimal(dto.costPrice) : undefined,
      trackStock: dto.trackStock,
      currentStock:
        dto.currentStock != null
          ? toDecimal(dto.currentStock)
          : dto.kind === ProductKind.PREPARED
            ? toDecimal(0)
            : undefined,
      stockMin: dto.stockMin != null ? toDecimal(dto.stockMin) : undefined,
      isActive: dto.isActive,
    };
  }

  // A65: strip costPrice from a product payload for viewers without cost visibility.
  // Generic over the exact include shape so it works for both the plain
  // (category + unit) findAll() result and the richer findOne() result below.
  private stripProductCost<T extends { costPrice: unknown }>(product: T): Omit<T, 'costPrice'> {
    const { costPrice: _costPrice, ...rest } = product;
    return rest;
  }

  // A65: strip costPrice from the product itself AND from every ingredient nested inside its
  // recipe (recipes[].items[].ingredient.costPrice) — findOne()'s full recipe cost breakdown is
  // exactly what the red-team finding flagged as leaking the product's margin structure.
  private stripProductAndRecipeCost(product: ProductWithRecipeCost) {
    const { costPrice: _costPrice, recipes, ...rest } = product;

    return {
      ...rest,
      recipes: recipes.map((recipe) => {
        const { items, ...recipeRest } = recipe;
        return {
          ...recipeRest,
          items: items.map((item) => {
            const { ingredient, ...itemRest } = item;
            const { costPrice: _ingredientCostPrice, ...ingredientRest } = ingredient;
            return {
              ...itemRest,
              ingredient: ingredientRest,
            };
          }),
        };
      }),
    };
  }

  private resolveDefaultBrand(kind: ProductKind) {
    return kind === ProductKind.PREPARED ? ProductBrand.HOUSE : ProductBrand.OTHER;
  }

  private resolveAuditModule(auditContext?: AuditContext) {
    return auditContext?.source === 'catalog_sync' ? 'catalog_sync' : 'products';
  }

  private attachAuditMetadata<T>(payload: T, auditContext?: AuditContext) {
    if (!auditContext?.source && !auditContext?.reason) {
      return payload as object | undefined;
    }

    return {
      ...(payload as Record<string, unknown>),
      _audit: {
        source: auditContext.source ?? null,
        reason: auditContext.reason ?? null,
      },
    };
  }
}
