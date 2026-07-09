import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal } from '../../common/utils/decimal.util';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';

@Injectable()
export class IngredientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.ingredient.findMany({
      include: {
        unit: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id },
      include: {
        unit: true,
      },
    });

    if (!ingredient) {
      throw new NotFoundException('No se encontró el insumo.');
    }

    return ingredient;
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
    const existing = await this.findOne(id);
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
    const existing = await this.findOne(id);

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
}
