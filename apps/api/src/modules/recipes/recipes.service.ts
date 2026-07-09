import { BadRequestException, Injectable } from '@nestjs/common';
import { ProductKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal } from '../../common/utils/decimal.util';
import { UpsertRecipeDto } from './dto/upsert-recipe.dto';

@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findByProduct(productId: string) {
    return this.prisma.recipe.findUnique({
      where: { productId },
      include: {
        items: {
          include: {
            ingredient: {
              include: {
                unit: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  }

  async upsert(productId: string, dto: UpsertRecipeDto, actorId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });

    if (!product) {
      throw new BadRequestException('No se encontró el producto.');
    }

    if (product.kind !== ProductKind.PREPARED) {
      throw new BadRequestException('Solo los productos preparados pueden tener receta.');
    }

    const ingredientIds = dto.items.map((item) => item.ingredientId);
    if (new Set(ingredientIds).size !== ingredientIds.length) {
      throw new BadRequestException('La receta no puede tener insumos duplicados.');
    }

    const ingredientsCount = await this.prisma.ingredient.count({
      where: {
        id: {
          in: ingredientIds,
        },
      },
    });

    if (ingredientsCount !== ingredientIds.length) {
      throw new BadRequestException('No se encontraron uno o más insumos de la receta.');
    }

    const recipe = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.recipe.findUnique({ where: { productId } });

      if (existing) {
        await tx.recipeItem.deleteMany({ where: { recipeId: existing.id } });
      }

      return tx.recipe.upsert({
        where: { productId },
        update: {
          name: dto.name ?? product.name,
          instructions: dto.instructions,
          yieldQuantity: dto.yieldQuantity != null ? toDecimal(dto.yieldQuantity) : undefined,
          items: {
            create: dto.items.map((item) => ({
              ingredientId: item.ingredientId,
              quantity: toDecimal(item.quantity),
              wastePercent: toDecimal(item.wastePercent ?? 0),
              notes: item.notes,
            })),
          },
        },
        create: {
          productId,
          name: dto.name ?? product.name,
          instructions: dto.instructions,
          yieldQuantity: toDecimal(dto.yieldQuantity ?? 1),
          items: {
            create: dto.items.map((item) => ({
              ingredientId: item.ingredientId,
              quantity: toDecimal(item.quantity),
              wastePercent: toDecimal(item.wastePercent ?? 0),
              notes: item.notes,
            })),
          },
        },
        include: {
          items: {
            include: {
              ingredient: true,
            },
          },
        },
      });
    });

    await this.auditService.log({
      userId: actorId,
      action: 'UPSERT',
      module: 'recipes',
      entity: 'recipe',
      entityId: recipe.id,
      newValues: dto,
    });

    return recipe;
  }
}
