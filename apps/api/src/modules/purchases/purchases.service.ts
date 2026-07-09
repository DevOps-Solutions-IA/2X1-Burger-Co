import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CashMovementType, CashSessionStatus, InventoryMovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal } from '../../common/utils/decimal.util';
import { CreatePurchaseDto } from './dto/create-purchase.dto';

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.purchase.findMany({
      include: {
        supplier: true,
        paymentMethod: true,
        cashSession: true,
        createdBy: true,
        items: {
          include: {
            ingredient: true,
            product: true,
          },
        },
      },
      orderBy: {
        purchasedAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        supplier: true,
        paymentMethod: true,
        cashSession: true,
        createdBy: true,
        items: {
          include: {
            ingredient: true,
            product: true,
          },
        },
      },
    });

    if (!purchase) {
      throw new NotFoundException('No se encontró la compra.');
    }

    return purchase;
  }

  async create(dto: CreatePurchaseDto, actorId: string) {
    const number = `PUR-${Date.now()}`;
    const purchasedAt = dto.purchasedAt ? new Date(dto.purchasedAt) : new Date();
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });

    if (!supplier || !supplier.isActive) {
      throw new BadRequestException('El proveedor no existe o está inactivo.');
    }

    const [paymentMethod, currentSession] = await Promise.all([
      dto.paymentMethodId
        ? this.prisma.paymentMethod.findUnique({
            where: { id: dto.paymentMethodId },
          })
        : Promise.resolve(null),
      this.prisma.cashSession.findFirst({
        where: { status: CashSessionStatus.OPEN },
        orderBy: { openedAt: 'desc' },
      }),
    ]);

    if (dto.paymentMethodId && (!paymentMethod || !paymentMethod.isActive)) {
      throw new BadRequestException('El método de pago de la compra no existe o está inactivo.');
    }

    const purchase = await this.prisma.$transaction(async (tx) => {
      const lineItems = await Promise.all(
        dto.items.map(async (item) => {
          if ((item.ingredientId && item.productId) || (!item.ingredientId && !item.productId)) {
            throw new BadRequestException(
              'Cada línea de compra debe apuntar exactamente a un insumo o a un producto.',
            );
          }

          const quantity = toDecimal(item.quantity);
          const unitCost = toDecimal(item.unitCost);
          const totalCost = quantity.mul(unitCost);

          if (item.ingredientId) {
            // BLOQUEO CONCURRENCIA: Bloquear insumo antes de leer/actualizar stock
            await tx.$queryRawUnsafe(`SELECT id FROM ingredients WHERE id = $1 FOR UPDATE`, item.ingredientId);

            const ingredient = await tx.ingredient.findUnique({
              where: { id: item.ingredientId },
            });

            if (!ingredient) {
              throw new BadRequestException('No se encontró el insumo.');
            }

            const nextStock = ingredient.currentStock.add(quantity);
            await tx.ingredient.update({
              where: { id: item.ingredientId },
              data: {
                currentStock: nextStock,
                costPrice: unitCost,
              },
            });

            await tx.inventoryMovement.create({
              data: {
                ingredientId: item.ingredientId,
                type: InventoryMovementType.PURCHASE,
                quantity,
                unitCost,
                balanceAfter: nextStock,
                referenceType: 'purchase',
                notes: dto.notes,
                performedById: actorId,
                occurredAt: purchasedAt,
              },
            });

            return {
              ingredientId: item.ingredientId,
              quantity,
              unitCost,
              totalCost,
              expirationAt: item.expirationAt ? new Date(item.expirationAt) : undefined,
              lotNumber: item.lotNumber,
            };
          }

          // BLOQUEO CONCURRENCIA: Bloquear producto antes de leer/actualizar stock
          await tx.$queryRawUnsafe(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, item.productId);

          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });

          if (!product) {
            throw new BadRequestException('No se encontró el producto.');
          }

          const nextStock = product.currentStock.add(quantity);
          await tx.product.update({
            where: { id: item.productId },
            data: {
              currentStock: nextStock,
              costPrice: unitCost,
            },
          });

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              type: InventoryMovementType.PURCHASE,
              quantity,
              unitCost,
              balanceAfter: nextStock,
              referenceType: 'purchase',
              notes: dto.notes,
              performedById: actorId,
              occurredAt: purchasedAt,
            },
          });

          return {
            productId: item.productId,
            quantity,
            unitCost,
            totalCost,
            expirationAt: item.expirationAt ? new Date(item.expirationAt) : undefined,
            lotNumber: item.lotNumber,
          };
        }),
      );

      const subtotal = lineItems.reduce(
        (acc, item) => acc.add(item.totalCost),
        new Prisma.Decimal(0),
      );

      const createdPurchase = await tx.purchase.create({
        data: {
          number,
          supplierId: dto.supplierId,
          paymentMethodId: dto.paymentMethodId,
          cashSessionId: currentSession?.id,
          invoiceNumber: dto.invoiceNumber,
          notes: dto.notes,
          purchasedAt,
          receivedAt: purchasedAt,
          createdById: actorId,
          subtotal,
          total: subtotal,
          items: {
            create: lineItems,
          },
        },
        include: {
          supplier: true,
          paymentMethod: true,
          cashSession: true,
          items: {
            include: {
              ingredient: true,
              product: true,
            },
          },
        },
      });

      if (currentSession && dto.paymentMethodId) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: currentSession.id,
            type: CashMovementType.EXPENSE,
            amount: subtotal,
            description: `Compra ${createdPurchase.number}`,
            paymentMethodId: dto.paymentMethodId,
            referenceType: 'purchase',
            referenceId: createdPurchase.id,
            classification: 'Compra de inventario',
            createdById: actorId,
          },
        });
      }

      return createdPurchase;
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: 'purchases',
      entity: 'purchase',
      entityId: purchase.id,
      newValues: dto,
    });

    return purchase;
  }
}
