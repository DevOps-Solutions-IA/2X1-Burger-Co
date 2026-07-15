import { BadRequestException, Injectable } from '@nestjs/common';
import { InventoryMovementType, Prisma, ProductKind, StockCountScope, StockCountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal, toNumber } from '../../common/utils/decimal.util';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { FindInventoryMovementsDto } from './dto/find-inventory-movements.dto';
import { PreviewStockCountDto } from './dto/preview-stock-count.dto';

type StockStatus = 'NORMAL' | 'LOW' | 'CRITICAL' | 'OUT_OF_STOCK';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findStock() {
    const [products, ingredients, adjustmentsToday] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          isActive: true,
          trackStock: true,
        },
        include: {
          category: true,
          unit: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.ingredient.findMany({
        where: {
          isActive: true,
        },
        include: {
          unit: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.inventoryMovement.count({
        where: {
          type: InventoryMovementType.ADJUSTMENT,
          occurredAt: {
            gte: new Date(new Date().toDateString()),
          },
        },
      }),
    ]);

    const items = [
      ...products.map((product) => {
        const currentStock = Number(product.currentStock);
        const stockMin = product.stockMin != null ? Number(product.stockMin) : null;

        return {
          id: product.id,
          itemType: 'PRODUCT' as const,
          code: product.code,
          name: product.name,
          categoryName: product.category.name,
          unitName: product.unit.name,
          unitCode: product.unit.code,
          kind: product.kind,
          currentStock,
          stockMin,
          stockMax: null,
          status: this.resolveStockStatus(currentStock, stockMin),
          updatedAt: product.updatedAt.toISOString(),
        };
      }),
      ...ingredients.map((ingredient) => {
        const currentStock = Number(ingredient.currentStock);
        const stockMin = ingredient.stockMin != null ? Number(ingredient.stockMin) : null;
        const stockMax = ingredient.stockMax != null ? Number(ingredient.stockMax) : null;

        return {
          id: ingredient.id,
          itemType: 'INGREDIENT' as const,
          code: ingredient.code,
          name: ingredient.name,
          categoryName: 'Insumos',
          unitName: ingredient.unit.name,
          unitCode: ingredient.unit.code,
          kind: ProductKind.DIRECT_STOCK,
          currentStock,
          stockMin,
          stockMax,
          status: this.resolveStockStatus(currentStock, stockMin),
          updatedAt: ingredient.updatedAt.toISOString(),
        };
      }),
    ].sort((left, right) => {
      const severityRank = this.getStatusRank(left.status) - this.getStatusRank(right.status);
      if (severityRank !== 0) {
        return severityRank;
      }

      if (left.itemType !== right.itemType) {
        return left.itemType === 'PRODUCT' ? -1 : 1;
      }

      return left.name.localeCompare(right.name, 'es-CO');
    });

    return {
      metrics: {
        totalItems: items.length,
        productsCount: products.length,
        ingredientsCount: ingredients.length,
        lowStockCount: items.filter((item) => item.status === 'LOW').length,
        criticalStockCount: items.filter((item) => item.status === 'CRITICAL').length,
        outOfStockCount: items.filter((item) => item.status === 'OUT_OF_STOCK').length,
        adjustmentsToday,
      },
      items,
    };
  }

  findMovements(query: FindInventoryMovementsDto) {
    const where: Prisma.InventoryMovementWhereInput = {};

    if (query.itemType === 'PRODUCT') {
      where.productId = { not: null };
    }

    if (query.itemType === 'INGREDIENT') {
      where.ingredientId = { not: null };
    }

    if (query.type) {
      where.type = query.type as InventoryMovementType;
    }

    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      };
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { notes: { contains: term, mode: 'insensitive' } },
        { product: { is: { name: { contains: term, mode: 'insensitive' } } } },
        { product: { is: { code: { contains: term, mode: 'insensitive' } } } },
        { ingredient: { is: { name: { contains: term, mode: 'insensitive' } } } },
        { ingredient: { is: { code: { contains: term, mode: 'insensitive' } } } },
      ];
    }

    return this.prisma.inventoryMovement.findMany({
      where,
      include: {
        ingredient: {
          include: {
            unit: true,
          },
        },
        product: {
          include: {
            category: true,
            unit: true,
          },
        },
        performedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(query.limit ?? 200, 500),
    });
  }

  async createAdjustment(dto: CreateAdjustmentDto, actorId: string) {
    if (!dto.productId && !dto.ingredientId) {
      throw new BadRequestException('Debes indicar un productId o un ingredientId.');
    }

    if (dto.productId && dto.ingredientId) {
      throw new BadRequestException('El ajuste debe apuntar a un producto o a un insumo, no a ambos.');
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      if (dto.productId) {
        // BLOQUEO CONCURRENCIA: Bloquear producto antes de leer/ajustar stock
        await tx.$queryRawUnsafe(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, dto.productId);
        const product = await tx.product.findUnique({ where: { id: dto.productId } });
        if (!product) {
          throw new BadRequestException('No se encontró el producto.');
        }

        const nextStock = product.currentStock.add(dto.quantity);
        if (nextStock.isNegative()) {
          throw new BadRequestException('El ajuste dejaría el stock del producto en negativo.');
        }

        await tx.product.update({
          where: { id: dto.productId },
          data: { currentStock: nextStock },
        });

        const movement = await tx.inventoryMovement.create({
          data: {
            productId: dto.productId,
            type: (dto.movementType as InventoryMovementType | undefined) ?? InventoryMovementType.ADJUSTMENT,
            quantity: toDecimal(dto.quantity),
            balanceAfter: nextStock,
            referenceType: dto.reason ?? 'AJUSTE_MANUAL',
            notes: this.composeNotes(dto),
            performedById: actorId,
          },
        });
        await this.auditService.log({
          userId: actorId,
          action: 'ADJUST',
          module: 'inventory',
          entity: 'inventory_movement',
          entityId: movement.id,
          before: { productId: product.id, stock: product.currentStock },
          after: { productId: product.id, stock: nextStock, delta: dto.quantity },
          reasonCode: 'INVENTORY_MANUAL_ADJUSTMENT',
        }, tx);
        return movement;
      }

      // BLOQUEO CONCURRENCIA: Bloquear insumo antes de leer/ajustar stock
      await tx.$queryRawUnsafe(`SELECT id FROM ingredients WHERE id = $1 FOR UPDATE`, dto.ingredientId);
      const ingredient = await tx.ingredient.findUnique({ where: { id: dto.ingredientId } });
      if (!ingredient) {
        throw new BadRequestException('No se encontró el insumo.');
      }

      const nextStock = ingredient.currentStock.add(dto.quantity);
      if (nextStock.isNegative()) {
        throw new BadRequestException('El ajuste dejaría el stock del insumo en negativo.');
      }

      await tx.ingredient.update({
        where: { id: dto.ingredientId },
        data: { currentStock: nextStock },
      });

      const movement = await tx.inventoryMovement.create({
        data: {
          ingredientId: dto.ingredientId,
          type: (dto.movementType as InventoryMovementType | undefined) ?? InventoryMovementType.ADJUSTMENT,
          quantity: toDecimal(dto.quantity),
          balanceAfter: nextStock,
          referenceType: dto.reason ?? 'AJUSTE_MANUAL',
          notes: this.composeNotes(dto),
          performedById: actorId,
        },
      });
      await this.auditService.log({
        userId: actorId,
        action: 'ADJUST',
        module: 'inventory',
        entity: 'inventory_movement',
        entityId: movement.id,
        before: { ingredientId: ingredient.id, stock: ingredient.currentStock },
        after: { ingredientId: ingredient.id, stock: nextStock, delta: dto.quantity },
        reasonCode: 'INVENTORY_MANUAL_ADJUSTMENT',
      }, tx);
      return movement;
    });

    return movement;
  }

  async previewStockCount(query: PreviewStockCountDto) {
    const items = await this.getStockCandidates(query.scope ?? 'CRITICAL', query.search);
    return {
      scope: query.scope ?? 'CRITICAL',
      items,
    };
  }

  async createStockCount(dto: CreateStockCountDto, actorId: string) {
    if (!dto.items.length) {
      throw new BadRequestException('Debes incluir al menos un ítem para el conteo físico.');
    }

    const session = await this.prisma.$transaction(async (tx) => {
      const createdSession = await tx.stockCountSession.create({
        data: {
          scope: dto.scope as StockCountScope,
          notes: dto.notes,
          createdById: actorId,
          approvedById: actorId,
          completedAt: new Date(),
          status: StockCountStatus.COMPLETED,
        },
      });

      for (const item of dto.items) {
        if (item.itemType === 'PRODUCT') {
          // BLOQUEO CONCURRENCIA: Bloquear producto antes de leer/ajustar stock
          await tx.$queryRawUnsafe(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, item.itemId);
          const product = await tx.product.findUnique({ where: { id: item.itemId } });
          if (!product) {
            throw new BadRequestException('Producto no encontrado para conteo.');
          }

          const countedStock = toDecimal(item.countedStock);
          const difference = countedStock.sub(product.currentStock);

          await tx.stockCountItem.create({
            data: {
              sessionId: createdSession.id,
              productId: product.id,
              expectedStock: product.currentStock,
              countedStock,
              difference,
              reason: item.reason,
              notes: item.notes,
            },
          });

          if (!difference.isZero()) {
            await tx.product.update({
              where: { id: product.id },
              data: { currentStock: countedStock },
            });

            await tx.inventoryMovement.create({
              data: {
                productId: product.id,
                type: InventoryMovementType.ADJUSTMENT,
                quantity: difference,
                balanceAfter: countedStock,
                referenceType: 'CONTEO_FISICO',
                notes: [item.reason, item.notes].filter(Boolean).join(' · ') || 'Conteo físico guiado',
                performedById: actorId,
              },
            });
          }
        } else {
          // BLOQUEO CONCURRENCIA: Bloquear insumo antes de leer/ajustar stock
          await tx.$queryRawUnsafe(`SELECT id FROM ingredients WHERE id = $1 FOR UPDATE`, item.itemId);
          const ingredient = await tx.ingredient.findUnique({ where: { id: item.itemId } });
          if (!ingredient) {
            throw new BadRequestException('Insumo no encontrado para conteo.');
          }

          const countedStock = toDecimal(item.countedStock);
          const difference = countedStock.sub(ingredient.currentStock);

          await tx.stockCountItem.create({
            data: {
              sessionId: createdSession.id,
              ingredientId: ingredient.id,
              expectedStock: ingredient.currentStock,
              countedStock,
              difference,
              reason: item.reason,
              notes: item.notes,
            },
          });

          if (!difference.isZero()) {
            await tx.ingredient.update({
              where: { id: ingredient.id },
              data: { currentStock: countedStock },
            });

            await tx.inventoryMovement.create({
              data: {
                ingredientId: ingredient.id,
                type: InventoryMovementType.ADJUSTMENT,
                quantity: difference,
                balanceAfter: countedStock,
                referenceType: 'CONTEO_FISICO',
                notes: [item.reason, item.notes].filter(Boolean).join(' · ') || 'Conteo físico guiado',
                performedById: actorId,
              },
            });
          }
        }
      }

      const completed = await tx.stockCountSession.findUniqueOrThrow({
        where: { id: createdSession.id },
        include: {
          createdBy: true,
          approvedBy: true,
          items: {
            include: {
              product: true,
              ingredient: true,
            },
          },
        },
      });
      await this.auditService.log({
        userId: actorId,
        action: 'STOCK_COUNT',
        module: 'inventory',
        entity: 'stock_count_session',
        entityId: completed.id,
        before: { status: null },
        after: { status: completed.status, itemCount: completed.items.length, scope: completed.scope },
      }, tx);
      return completed;
    });

    return session;
  }

  findStockCounts() {
    return this.prisma.stockCountSession.findMany({
      include: {
        createdBy: true,
        approvedBy: true,
        items: {
          include: {
            product: true,
            ingredient: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async getReorderSuggestions() {
    const { alerts, groupedBySupplier } = await this.buildReorderSuggestions();
    return {
      alerts,
      groupedBySupplier,
    };
  }

  private composeNotes(dto: CreateAdjustmentDto) {
    const parts = [dto.reason?.trim(), dto.notes?.trim()].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
  }

  private async getStockCandidates(scope: PreviewStockCountDto['scope'], search?: string) {
    const stock = await this.findStock();
    const normalizedSearch = search?.trim().toLowerCase();

    return stock.items
      .filter((item) => {
        const matchesScope =
          scope === 'ALL'
            ? true
            : scope === 'CRITICAL'
              ? item.status === 'CRITICAL' || item.status === 'OUT_OF_STOCK' || item.status === 'LOW'
              : scope === 'PRODUCTS'
                ? item.itemType === 'PRODUCT'
                : item.itemType === 'INGREDIENT';

        const matchesTerm = normalizedSearch
          ? [item.name, item.code, item.categoryName].some((value) =>
              value.toLowerCase().includes(normalizedSearch),
            )
          : true;

        return matchesScope && matchesTerm;
      })
      .map((item) => ({
        id: item.id,
        itemType: item.itemType,
        code: item.code,
        name: item.name,
        unitCode: item.unitCode,
        expectedStock: item.currentStock,
        stockMin: item.stockMin,
        status: item.status,
      }));
  }

  private async buildReorderSuggestions() {
    const [productItems, ingredientItems, purchaseItems, productPurchaseItems, movements] = await Promise.all([
      this.prisma.product.findMany({
        where: { isActive: true, trackStock: true },
        include: { category: true, unit: true },
      }),
      this.prisma.ingredient.findMany({
        where: { isActive: true },
        include: { unit: true },
      }),
      this.prisma.purchaseItem.findMany({
        where: { ingredientId: { not: null } },
        include: {
          ingredient: true,
          purchase: { include: { supplier: true } },
        },
        orderBy: { purchase: { purchasedAt: 'desc' } },
      }),
      this.prisma.purchaseItem.findMany({
        where: { productId: { not: null } },
        include: {
          product: true,
          purchase: { include: { supplier: true } },
        },
        orderBy: { purchase: { purchasedAt: 'desc' } },
      }),
      this.prisma.inventoryMovement.findMany({
        where: {
          occurredAt: {
            gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const latestIngredientSupplier = new Map<string, { id: string; name: string; phone: string | null }>();
    for (const item of purchaseItems) {
      if (item.ingredientId && !latestIngredientSupplier.has(item.ingredientId)) {
        latestIngredientSupplier.set(item.ingredientId, {
          id: item.purchase.supplier.id,
          name: item.purchase.supplier.name,
          phone: item.purchase.supplier.phone,
        });
      }
    }

    const latestProductSupplier = new Map<string, { id: string; name: string; phone: string | null }>();
    for (const item of productPurchaseItems) {
      if (item.productId && !latestProductSupplier.has(item.productId)) {
        latestProductSupplier.set(item.productId, {
          id: item.purchase.supplier.id,
          name: item.purchase.supplier.name,
          phone: item.purchase.supplier.phone,
        });
      }
    }

    const outboundByKey = new Map<string, number>();
    for (const movement of movements) {
      const key = movement.productId ? `PRODUCT:${movement.productId}` : movement.ingredientId ? `INGREDIENT:${movement.ingredientId}` : null;
      if (!key) continue;
      if (
        movement.type !== InventoryMovementType.SALE &&
        movement.type !== InventoryMovementType.WASTE &&
        movement.type !== InventoryMovementType.DAMAGE &&
        movement.type !== InventoryMovementType.INTERNAL_USE
      ) {
        continue;
      }
      outboundByKey.set(key, (outboundByKey.get(key) ?? 0) + Math.abs(toNumber(movement.quantity)));
    }

    const alerts = [
      ...productItems.map((product) => {
        const currentStock = toNumber(product.currentStock);
        const stockMin = toNumber(product.stockMin);
        const avgDailyConsumption = (outboundByKey.get(`PRODUCT:${product.id}`) ?? 0) / 14;
        const daysOfCoverage = avgDailyConsumption > 0 ? currentStock / avgDailyConsumption : null;
        const suggestedQuantity = Math.max(
          Math.ceil((stockMin > 0 ? stockMin * 3 : avgDailyConsumption * 7 || 1) - currentStock),
          0,
        );
        const severity = this.resolveStockStatus(currentStock, product.stockMin != null ? Number(product.stockMin) : null);

        return {
          id: product.id,
          itemType: 'PRODUCT' as const,
          name: product.name,
          code: product.code,
          unitCode: product.unit.code,
          currentStock,
          stockMin,
          avgDailyConsumption,
          daysOfCoverage,
          suggestedQuantity,
          severity,
          supplier: latestProductSupplier.get(product.id) ?? null,
        };
      }),
      ...ingredientItems.map((ingredient) => {
        const currentStock = toNumber(ingredient.currentStock);
        const stockMin = toNumber(ingredient.stockMin);
        const stockMax = toNumber(ingredient.stockMax);
        const avgDailyConsumption = (outboundByKey.get(`INGREDIENT:${ingredient.id}`) ?? 0) / 14;
        const daysOfCoverage = avgDailyConsumption > 0 ? currentStock / avgDailyConsumption : null;
        const suggestedQuantity = Math.max(
          Math.ceil((stockMax > 0 ? stockMax : stockMin > 0 ? stockMin * 3 : avgDailyConsumption * 7 || 1) - currentStock),
          0,
        );
        const severity = this.resolveStockStatus(currentStock, ingredient.stockMin != null ? Number(ingredient.stockMin) : null);

        return {
          id: ingredient.id,
          itemType: 'INGREDIENT' as const,
          name: ingredient.name,
          code: ingredient.code,
          unitCode: ingredient.unit.code,
          currentStock,
          stockMin,
          avgDailyConsumption,
          daysOfCoverage,
          suggestedQuantity,
          severity,
          supplier: latestIngredientSupplier.get(ingredient.id) ?? null,
        };
      }),
    ]
      .filter((item) => item.severity !== 'NORMAL' || item.suggestedQuantity > 0)
      .sort((left, right) => this.getStatusRank(left.severity) - this.getStatusRank(right.severity));

    const groupedBySupplier = Object.values(
      alerts.reduce<Record<string, { supplierId: string | null; supplierName: string; supplierPhone: string | null; items: typeof alerts }>>((acc, alert) => {
        const key = alert.supplier?.id ?? `${alert.itemType}-${alert.id}`;
        acc[key] ??= {
          supplierId: alert.supplier?.id ?? null,
          supplierName: alert.supplier?.name ?? 'Proveedor pendiente',
          supplierPhone: alert.supplier?.phone ?? null,
          items: [],
        };
        acc[key].items.push(alert);
        return acc;
      }, {}),
    );

    return { alerts, groupedBySupplier };
  }

  private resolveStockStatus(currentStock: number, stockMin: number | null): StockStatus {
    if (currentStock <= 0) {
      return 'OUT_OF_STOCK';
    }

    if (stockMin != null && stockMin > 0) {
      if (currentStock <= stockMin / 2) {
        return 'CRITICAL';
      }

      if (currentStock <= stockMin) {
        return 'LOW';
      }
    }

    return 'NORMAL';
  }

  private getStatusRank(status: StockStatus) {
    const rank: Record<StockStatus, number> = {
      OUT_OF_STOCK: 0,
      CRITICAL: 1,
      LOW: 2,
      NORMAL: 3,
    };

    return rank[status];
  }
}
