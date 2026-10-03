import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal } from '../../common/utils/decimal.util';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';

// A67: not currently exploitable — `ingredients.read` (the permission gating findAll()/findOne()
// below) is only held by 'admin'/'inventory' per prisma/seed.ts, and both already hold
// 'products.update' too. This exists for defense-in-depth consistency with products.service.ts
// (A65), which explicitly treats ingredient `costPrice` as sensitive enough to strip when nested
// inside a product's recipe — so if `ingredients.read` is ever granted more broadly in the
// future, cost doesn't leak automatically. Same permission tier, reused rather than duplicated.
const COST_VISIBILITY_PERMISSION = 'products.update';

function canViewCost(viewerPermissions: string[] | undefined) {
  return (viewerPermissions ?? []).includes(COST_VISIBILITY_PERMISSION);
}

@Injectable()
export class IngredientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(viewerPermissions?: string[]) {
    const ingredients = await this.prisma.ingredient.findMany({
      include: {
        unit: true,
      },
      orderBy: { name: 'asc' },
    });

    if (canViewCost(viewerPermissions)) {
      return ingredients;
    }

    return ingredients.map((ingredient) => this.stripCost(ingredient));
  }

  async findOne(id: string, viewerPermissions?: string[]) {
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id },
      include: {
        unit: true,
      },
    });

    if (!ingredient) {
      throw new NotFoundException('No se encontró el insumo.');
    }

    if (canViewCost(viewerPermissions)) {
      return ingredient;
    }

    return this.stripCost(ingredient);
  }

  async create(dto: CreateIngredientDto, actorId: string) {
    const ingredient = await this.prisma.ingredient.create({
      data: {
        code: dto.code,
        name: dto.name,
        unitId: dto.unitId,
        description: dto.description,
        costPrice: dto.costPrice != null ? toDecimal(dto.costPrice) : undefined,
        currentStock: dto.currentStock != null ? toDecimal(dto.currentStock) : undefined,
        stockMin: dto.stockMin != null ? toDecimal(dto.stockMin) : undefined,
        stockMax: dto.stockMax != null ? toDecimal(dto.stockMax) : undefined,
        isActive: dto.isActive,
      },
      include: { unit: true },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: 'ingredients',
      entity: 'ingredient',
      entityId: ingredient.id,
      newValues: dto,
    });

    return ingredient;
  }

  async update(id: string, dto: UpdateIngredientDto, actorId: string) {
    // A67: internal read for audit-log oldValues must always see the full record (including
    // costPrice) regardless of who is calling update() — cost visibility shaping only applies to
    // the viewer-facing GET routes above, never to the audit trail (mirrors products.service.ts).
    const existing = await this.findOne(id, [COST_VISIBILITY_PERMISSION]);
    const ingredient = await this.prisma.ingredient.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        unitId: dto.unitId,
        description: dto.description,
        costPrice: dto.costPrice != null ? toDecimal(dto.costPrice) : undefined,
        currentStock: dto.currentStock != null ? toDecimal(dto.currentStock) : undefined,
        stockMin: dto.stockMin != null ? toDecimal(dto.stockMin) : undefined,
        stockMax: dto.stockMax != null ? toDecimal(dto.stockMax) : undefined,
        isActive: dto.isActive,
      },
      include: { unit: true },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'ingredients',
      entity: 'ingredient',
      entityId: id,
      oldValues: existing,
      newValues: dto,
    });

    return ingredient;
  }

  async remove(id: string, actorId: string) {
    // A67: same rationale as update() above — the audit trail must retain costPrice.
    const existing = await this.findOne(id, [COST_VISIBILITY_PERMISSION]);

    const usage = await this.prisma.ingredient.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            purchaseItems: true,
            recipeItems: true,
            movements: true,
            stockCounts: true,
          },
        },
      },
    });

    if (!usage) {
      throw new NotFoundException('No se encontró el insumo.');
    }

    const relatedRecords =
      usage._count.purchaseItems +
      usage._count.recipeItems +
      usage._count.movements +
      usage._count.stockCounts;

    if (relatedRecords > 0) {
      throw new BadRequestException(
        'Este insumo ya tiene historial operativo y no se puede eliminar. Desactívalo en su lugar.',
      );
    }

    await this.prisma.ingredient.delete({
      where: { id },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'DELETE',
      module: 'ingredients',
      entity: 'ingredient',
      entityId: id,
      oldValues: existing,
    });

    return {
      success: true,
      id,
    };
  }

  // A67: mirror products.service.ts's stripProductCost — strips costPrice from an ingredient
  // payload for viewers without cost visibility.
  private stripCost<T extends { costPrice: unknown }>(ingredient: T): Omit<T, 'costPrice'> {
    const { costPrice: _costPrice, ...rest } = ingredient;
    return rest;
  }
}
