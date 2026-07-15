import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  CashMovementType,
  CashSessionStatus,
  DiningTableStatus,
  InventoryMovementType,
  OrderTicketType,
  ProductKind,
  Prisma,
  SaleChannel,
  SaleStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal } from '../../common/utils/decimal.util';
import { formatReceiptNumber } from '../../common/utils/receipt-number.util';
import { ConvertSaleToOrderDto } from './dto/convert-sale-to-order.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ReopenConvertedSaleDto } from './dto/reopen-converted-sale.dto';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.sale.findMany({
      include: {
        orderTicket: {
          include: {
            table: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
        payments: {
          include: {
            paymentMethod: true,
          },
        },
        conversion: {
          include: {
            orderTicket: true,
          },
        },
        createdBy: true,
      },
      orderBy: { soldAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        orderTicket: {
          include: {
            table: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
        payments: {
          include: {
            paymentMethod: true,
          },
        },
        conversion: {
          include: {
            orderTicket: true,
          },
        },
      },
    });

    if (!sale) {
      throw new NotFoundException('No se encontró la venta.');
    }

    return sale;
  }

  async convertToOrder(id: string, dto: ConvertSaleToOrderDto, actorId: string) {
    const reason = dto.reason.trim();
    const type = dto.type as OrderTicketType;

    const result = await this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: {
          conversion: true,
          cashSession: true,
          items: {
            include: {
              product: {
                include: {
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
              },
            },
          },
          payments: {
            include: {
              paymentMethod: true,
            },
          },
        },
      });

      if (!sale) {
        throw new NotFoundException('No se encontró la venta.');
      }

      if (sale.status !== SaleStatus.PAID) {
        throw new BadRequestException('Solo una venta pagada activa se puede pasar a comanda.');
      }

      if (sale.orderTicketId || sale.conversion) {
        throw new ConflictException('Esta venta ya está asociada o convertida a una comanda.');
      }

      if (!sale.cashSession || sale.cashSession.status !== CashSessionStatus.OPEN) {
        throw new BadRequestException('Solo puedes convertir ventas de una caja que sigue abierta.');
      }

      const table = await this.resolveTableForConvertedOrder(tx, dto.tableId, type);
      const orderItems = sale.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        notes: item.notes ?? undefined,
      }));

      if (!orderItems.length) {
        throw new BadRequestException('La venta no tiene productos para pasar a comanda.');
      }

      await this.restoreSaleStockForConversion(tx, sale.items, actorId, id);

      await tx.sale.update({
        where: { id },
        data: {
          status: SaleStatus.CANCELLED,
          notes: [sale.notes, `Convertida a comanda: ${reason}`].filter(Boolean).join('\n'),
        },
      });

      await Promise.all(
        sale.payments.map((payment) =>
          tx.cashMovement.create({
            data: {
              cashSessionId: sale.cashSessionId!,
              type: CashMovementType.ADJUSTMENT,
              amount: toDecimal(payment.amount).neg(),
              paymentMethodId: payment.paymentMethodId,
              description: `Reversa por conversión de ${formatReceiptNumber(sale.number)} a comanda`,
              referenceType: 'sale_conversion',
              referenceId: sale.id,
              classification: 'Conversión venta a comanda',
              createdById: actorId,
            },
          }),
        ),
      );

      const order = await tx.orderTicket.create({
        data: {
          number: await this.generateOrderNumber(tx, type),
          type,
          status: 'OPEN',
          tableId: table?.id,
          customerName: dto.customerName?.trim() || sale.customerName || null,
          customerPhone: dto.customerPhone?.trim() || null,
          deliveryReference: dto.deliveryReference?.trim() || sale.deliveryReference || null,
          notes: [dto.notes?.trim(), `Origen: ${formatReceiptNumber(sale.number)}`].filter(Boolean).join('\n') || sale.notes,
          subtotal: sale.total,
          cashSessionId: sale.cashSessionId!,
          createdById: actorId,
          items: {
            create: orderItems,
          },
        },
        include: {
          table: true,
          items: {
            include: {
              product: {
                include: {
                  category: true,
                },
              },
            },
          },
        },
      });

      if (table) {
        await tx.diningTable.update({
          where: { id: table.id },
          data: { status: DiningTableStatus.OCCUPIED },
        });
      }

      const conversion = await tx.saleConversion.create({
        data: {
          saleId: sale.id,
          orderTicketId: order.id,
          reason,
          convertedById: actorId,
        },
      });

      await this.auditService.log(
        {
          userId: actorId,
          action: 'CONVERT_TO_ORDER',
          module: 'sales',
          entity: 'sale',
          entityId: id,
          oldValues: {
            status: sale.status,
            total: sale.total,
            cashSessionId: sale.cashSessionId,
          },
          newValues: {
            orderTicketId: order.id,
            orderNumber: order.number,
            reason,
          },
        },
        tx,
      );

      return { sale, order, conversion };
    });

    return {
      success: true,
      saleId: id,
      orderTicket: result.order,
      conversionId: result.conversion.id,
    };
  }

  async create(dto: CreateSaleDto, actorId: string) {
    const session = await this.getOpenCashSession();
    const sale = await this.prisma.$transaction(async (tx) => {
      const created = await this.createInTransaction(tx, dto, actorId, session.id);
      await this.auditService.log({
        userId: actorId,
        action: 'CREATE',
        module: 'sales',
        entity: 'sale',
        entityId: created.id,
        before: { status: null, total: 0 },
        after: { status: created.status, total: created.total, cashSessionId: created.cashSessionId },
      }, tx);
      return created;
    });

    return sale;
  }

  async generateReceiptPdf(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        orderTicket: {
          include: {
            table: true,
          },
        },
        items: {
          include: {
            product: true,
          },
        },
        payments: {
          include: {
            paymentMethod: true,
          },
        },
      },
    });

    if (!sale) {
      throw new NotFoundException('No se encontró la venta.');
    }

    const settings = await this.prisma.setting.findMany({
      where: {
        key: {
          in: ['business.profile', 'pos.defaults'],
        },
      },
    });

    const settingsMap = new Map(settings.map((item) => [item.key, item.value as Record<string, unknown>]));
    const businessProfile = settingsMap.get('business.profile') ?? {};
    const posDefaults = settingsMap.get('pos.defaults') ?? {};

    const businessName =
      typeof businessProfile.name === 'string' && businessProfile.name.trim()
        ? businessProfile.name.trim()
        : '2x1 Burger Co';
    const address = typeof businessProfile.address === 'string' ? businessProfile.address.trim() : '';
    const phone = typeof businessProfile.phone === 'string' ? businessProfile.phone.trim() : '';
    const receiptFooter =
      typeof posDefaults.receiptFooter === 'string' && posDefaults.receiptFooter.trim()
        ? posDefaults.receiptFooter.trim()
        : 'Gracias por tu compra';
    const whatsappUrl = this.buildWhatsAppUrl(phone);
    const qrBuffer = whatsappUrl
      ? await QRCode.toBuffer(whatsappUrl, {
          margin: 1,
          width: 180,
          color: {
            dark: '#111827',
            light: '#ffffff',
          },
        })
      : null;

    const pageWidth = 58 * 2.83465;
    const paymentLineCount = sale.payments.reduce((acc, payment) => {
      const receivedLine = payment.receivedAmount != null && Number(payment.receivedAmount) !== Number(payment.amount) ? 1 : 0;
      const changeLine = payment.changeAmount != null && Number(payment.changeAmount) > 0 ? 1 : 0;
      return acc + 1 + receivedLine + changeLine;
    }, 0);
    const pageHeight = Math.max(420, 250 + sale.items.length * 26 + paymentLineCount * 18 + (qrBuffer ? 92 : 0));
    const margin = 12;
    const contentWidth = pageWidth - margin * 2;

    const document = new PDFDocument({
      size: [pageWidth, pageHeight],
      margin,
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    document.on('data', (chunk) => chunks.push(chunk));

    const channelLabel = this.getSaleChannelLabel(sale.channel);
    const referenceLabel = sale.tableLabel ?? sale.deliveryReference ?? null;
    const receiptNumber = formatReceiptNumber(sale.number);

    document.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(businessName, margin, document.y, {
      width: contentWidth,
      align: 'center',
    });

    document.moveDown(0.2);
    document.fillColor('#4B5563').font('Helvetica').fontSize(7.2);

    if (address) {
      document.text(address, margin, document.y, {
        width: contentWidth,
        align: 'center',
      });
    }

    if (phone) {
      document.text(phone, margin, document.y + 1, {
        width: contentWidth,
        align: 'center',
      });
    }

    document.moveDown(0.35);
    document.roundedRect(margin + 18, document.y, contentWidth - 36, 15, 7).fillAndStroke('#FFF7ED', '#F59E0B');
    document.fillColor('#9A3412').font('Helvetica-Bold').fontSize(6.8).text(channelLabel.toUpperCase(), margin + 18, document.y + 5, {
      width: contentWidth - 36,
      align: 'center',
      lineBreak: false,
    });

    document.moveDown(1.5);
    document.fillColor('#8A5A16').font('Helvetica-Bold').fontSize(7).text('COMPROBANTE OPERATIVO POS', margin, document.y, {
      width: contentWidth,
    });
    document.moveDown(0.2);
    this.renderReceiptMetaRow(document, 'Comprobante', receiptNumber, contentWidth, margin);
    this.renderReceiptMetaRow(document, 'Fecha', this.formatReceiptDate(sale.soldAt), contentWidth, margin);

    if (referenceLabel && sale.channel !== SaleChannel.DOMICILIO) {
      this.renderReceiptMetaRow(document, 'Referencia', referenceLabel, contentWidth, margin);
    }

    if (sale.customerName) {
      this.renderReceiptMetaRow(document, 'Cliente', sale.customerName, contentWidth, margin);
    }

    if (sale.customerPhone) {
      this.renderReceiptMetaRow(document, 'Teléfono', sale.customerPhone, contentWidth, margin);
    }

    if (sale.channel === SaleChannel.DOMICILIO && (sale.deliveryReference || sale.deliveryZoneLabel)) {
      document.moveDown(0.3);
      document.fillColor('#8A5A16').font('Helvetica-Bold').fontSize(7).text('ENTREGA', margin, document.y, {
        width: contentWidth,
      });
      document.moveDown(0.2);
      if (sale.deliveryReference) {
        this.renderReceiptMetaRow(document, 'Dirección', sale.deliveryReference, contentWidth, margin);
      }
      if (sale.deliveryZoneLabel) {
        this.renderReceiptMetaRow(document, 'Zona', sale.deliveryZoneLabel, contentWidth, margin);
      }
    }

    if (sale.notes) {
      this.renderReceiptMetaRow(document, 'Notas', sale.notes, contentWidth, margin);
    }

    document.moveDown(0.45);
    this.renderReceiptDivider(document, margin, contentWidth);

    document.moveDown(0.45);
    document.fillColor('#8A5A16').font('Helvetica-Bold').fontSize(7).text('DETALLE', margin, document.y, {
      width: contentWidth,
    });

    sale.items.forEach((item) => {
      document.moveDown(0.3);
      document.fillColor('#111827').font('Helvetica-Bold').fontSize(7.2).text(item.product.name, margin, document.y, {
        width: contentWidth,
      });
      document.fillColor('#4B5563').font('Helvetica').fontSize(6.8).text(
        `${Number(item.quantity)} x ${this.formatCurrency(Number(item.unitPrice))}`,
        margin,
        document.y + 1,
        { width: contentWidth * 0.58 },
      );
      document.fillColor('#111827').font('Helvetica-Bold').fontSize(6.8).text(
        this.formatCurrency(Number(item.totalPrice)),
        margin + contentWidth * 0.58,
        document.y - 8,
        { width: contentWidth * 0.42, align: 'right' },
      );
      document.moveDown(0.2);
    });

    document.moveDown(0.35);
    this.renderReceiptDivider(document, margin, contentWidth);

    document.moveDown(0.45);
    document.fillColor('#8A5A16').font('Helvetica-Bold').fontSize(7).text('PAGOS', margin, document.y, {
      width: contentWidth,
    });

    sale.payments.forEach((payment) => {
      this.renderReceiptMetaRow(
        document,
        payment.paymentMethod.name,
        this.formatCurrency(Number(payment.amount)),
        contentWidth,
        margin,
      );

      if (payment.receivedAmount != null && Number(payment.receivedAmount) !== Number(payment.amount)) {
        this.renderReceiptMetaRow(
          document,
          'Recibido',
          this.formatCurrency(Number(payment.receivedAmount)),
          contentWidth,
          margin,
        );
      }

      if (payment.changeAmount != null && Number(payment.changeAmount) > 0) {
        this.renderReceiptMetaRow(
          document,
          'Cambio',
          this.formatCurrency(Number(payment.changeAmount)),
          contentWidth,
          margin,
        );
      }
    });

    document.moveDown(0.35);
    this.renderReceiptDivider(document, margin, contentWidth, '#111827');

    document.moveDown(0.4);
    document.fillColor('#8A5A16').font('Helvetica-Bold').fontSize(7).text('RESUMEN DE COBRO', margin, document.y, {
      width: contentWidth,
    });
    document.moveDown(0.2);
    this.renderReceiptMetaRow(
      document,
      Number(sale.discount) > 0 ? 'Subtotal base' : 'Subtotal',
      this.formatCurrency(Number(sale.subtotal)),
      contentWidth,
      margin,
      true,
    );
    if (Number(sale.discount) > 0) {
      this.renderReceiptMetaRow(
        document,
        'Ajuste aplicado',
        this.formatCurrency(Number(sale.discount)),
        contentWidth,
        margin,
        true,
      );
    }
    if (Number(sale.deliveryFee) > 0) {
      this.renderReceiptMetaRow(
        document,
        `Domicilio${sale.deliveryZoneLabel ? ` · ${sale.deliveryZoneLabel}` : ''}`,
        this.formatCurrency(Number(sale.deliveryFee)),
        contentWidth,
        margin,
        true,
      );
    }
    this.renderReceiptMetaRow(
      document,
      'Total',
      this.formatCurrency(Number(sale.total)),
      contentWidth,
      margin,
      true,
      8.6,
    );

    if (qrBuffer) {
      document.moveDown(0.65);
      document.fillColor('#4B5563').font('Helvetica').fontSize(6.7).text('Escanea para escribir al WhatsApp del negocio', margin, document.y, {
        width: contentWidth,
        align: 'center',
      });
      document.moveDown(0.2);
      const qrSize = 72;
      const qrX = margin + (contentWidth - qrSize) / 2;
      document.image(qrBuffer, qrX, document.y, {
        fit: [qrSize, qrSize],
        align: 'center',
      });
      document.y += qrSize + 6;
    } else {
      document.moveDown(0.7);
    }

    document.fillColor('#4B5563').font('Helvetica').fontSize(6.7).text(receiptFooter, margin, document.y, {
      width: contentWidth,
      align: 'center',
    });

    document.end();

    return await new Promise<Buffer>((resolve) => {
      document.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  async createInTransaction(
    tx: Prisma.TransactionClient,
    dto: CreateSaleDto,
    actorId: string,
    cashSessionId: string,
    options?: { orderTicketId?: string },
  ) {
    const paymentMethodIds = [...new Set(dto.payments.map((payment) => payment.paymentMethodId))];
    const paymentMethods = await tx.paymentMethod.findMany({
      where: {
        id: {
          in: paymentMethodIds,
        },
      },
    });

    if (paymentMethods.length !== paymentMethodIds.length) {
      throw new BadRequestException('Uno de los métodos de pago no existe.');
    }

    const paymentMethodMap = new Map(paymentMethods.map((paymentMethod) => [paymentMethod.id, paymentMethod]));
    const normalizedPayments = dto.payments.map((payment) => {
      const paymentMethod = paymentMethodMap.get(payment.paymentMethodId);
      if (!paymentMethod) {
        throw new BadRequestException('Uno de los métodos de pago no existe.');
      }

      const appliedAmount = toDecimal(payment.amount);
      const rawReceivedAmount =
        payment.receivedAmount != null ? toDecimal(payment.receivedAmount) : null;
      const rawChangeAmount =
        payment.changeAmount != null ? toDecimal(payment.changeAmount) : null;

      if (paymentMethod.code !== 'cash') {
        if (rawReceivedAmount != null || rawChangeAmount != null) {
          throw new BadRequestException(
            `Solo los pagos en efectivo permiten registrar efectivo recibido y cambio.`,
          );
        }

        return {
          paymentMethodId: payment.paymentMethodId,
          amount: appliedAmount,
          receivedAmount: null,
          changeAmount: null,
        };
      }

      const receivedAmount = rawReceivedAmount ?? appliedAmount;
      if (receivedAmount.lessThan(appliedAmount)) {
        throw new BadRequestException('El efectivo recibido no puede ser menor al monto aplicado.');
      }

      const expectedChange = receivedAmount.sub(appliedAmount);
      if (rawChangeAmount != null && !rawChangeAmount.equals(expectedChange)) {
        throw new BadRequestException('El cambio debe coincidir con el efectivo recibido menos el total aplicado.');
      }

      return {
        paymentMethodId: payment.paymentMethodId,
        amount: appliedAmount,
        receivedAmount,
        changeAmount: rawChangeAmount ?? expectedChange,
      };
    });

    const paymentTotal = normalizedPayments.reduce((acc, payment) => acc + Number(payment.amount), 0);
    const saleNumber = `SAL-${Date.now()}`;
    const itemsData: Array<{
      productId: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      totalPrice: Prisma.Decimal;
      estimatedCost: Prisma.Decimal;
      notes?: string;
    }> = [];

    let itemsSubtotal = new Prisma.Decimal(0);

    for (const item of dto.items) {
      // BLOQUEO CONCURRENCIA: Bloquear fila del producto antes de leer
      await tx.$queryRawUnsafe(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, item.productId);

      const product = await tx.product.findUnique({
        where: { id: item.productId },
        include: {
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

      if (!product || !product.isActive) {
        throw new BadRequestException('Uno de los productos no está disponible.');
      }

      const quantity = toDecimal(item.quantity);
      const unitPrice = toDecimal(item.unitPrice ?? Number(product.salePrice));
      const totalPrice = quantity.mul(unitPrice);
      let estimatedCost = new Prisma.Decimal(0);

      if (product.kind === ProductKind.DIRECT_STOCK) {
        if (!product.trackStock) {
          throw new BadRequestException(`El producto ${product.name} está mal configurado: el stock directo está deshabilitado.`);
        }

        // BLOQUEO CONCURRENCIA: Re-bloquear fila del producto antes de validar stock actualizado
        await tx.$queryRawUnsafe(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, product.id);
        const refreshedProduct = await tx.product.findUnique({ where: { id: product.id } });
        if (!refreshedProduct) {
          throw new BadRequestException(`El producto ${product.name} ya no está disponible.`);
        }

        if (refreshedProduct.currentStock.lessThan(quantity)) {
          throw new BadRequestException(`Stock insuficiente para ${product.name}.`);
        }

        const nextStock = refreshedProduct.currentStock.sub(quantity);
        await tx.product.update({
          where: { id: product.id },
          data: { currentStock: nextStock },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: product.id,
            type: InventoryMovementType.SALE,
            quantity: quantity.neg(),
            unitCost: refreshedProduct.costPrice ?? undefined,
            balanceAfter: nextStock,
            performedById: actorId,
            referenceType: 'sale',
          },
        });

        estimatedCost = (refreshedProduct.costPrice ?? new Prisma.Decimal(0)).mul(quantity);
      } else {
        const recipe = product.recipes[0];
        if (!recipe || recipe.items.length === 0) {
          throw new BadRequestException(`El producto preparado ${product.name} no tiene una receta activa.`);
        }

        for (const recipeItem of recipe.items) {
          const requiredQuantity = quantity
            .mul(recipeItem.quantity)
            .div(recipe.yieldQuantity)
            .mul(new Prisma.Decimal(1).add(recipeItem.wastePercent.div(100)));

          // BLOQUEO CONCURRENCIA: Bloquear insumo antes de leer/actualizar stock
          await tx.$queryRawUnsafe(`SELECT id FROM ingredients WHERE id = $1 FOR UPDATE`, recipeItem.ingredientId);
          const refreshedIngredient = await tx.ingredient.findUnique({ where: { id: recipeItem.ingredientId } });
          if (!refreshedIngredient) {
            throw new BadRequestException(`El insumo ${recipeItem.ingredient.name} ya no está disponible.`);
          }

          if (refreshedIngredient.currentStock.lessThan(requiredQuantity)) {
            throw new BadRequestException(
              `Stock insuficiente del insumo ${refreshedIngredient.name}.`,
            );
          }

          const nextStock = refreshedIngredient.currentStock.sub(requiredQuantity);
          await tx.ingredient.update({
            where: { id: recipeItem.ingredientId },
            data: { currentStock: nextStock },
          });

          await tx.inventoryMovement.create({
            data: {
              ingredientId: recipeItem.ingredientId,
              type: InventoryMovementType.SALE,
              quantity: requiredQuantity.neg(),
              unitCost: refreshedIngredient.costPrice ?? undefined,
              balanceAfter: nextStock,
              performedById: actorId,
              referenceType: 'sale',
            },
          });

          estimatedCost = estimatedCost.add(
            (refreshedIngredient.costPrice ?? new Prisma.Decimal(0)).mul(requiredQuantity),
          );
        }
      }

      itemsSubtotal = itemsSubtotal.add(totalPrice);
      itemsData.push({
        productId: item.productId,
        quantity,
        unitPrice,
        totalPrice,
        estimatedCost,
        notes: item.notes,
      });
    }

    const saleChannel = (dto.channel as SaleChannel | undefined) ?? SaleChannel.MOSTRADOR;

    if (saleChannel === SaleChannel.DOMICILIO && !options?.orderTicketId) {
      throw new BadRequestException(
        'Las ventas de domicilio deben cerrarse desde una comanda con tarifa automática válida.',
      );
    }

    const deliveryFee = dto.deliveryFee != null ? toDecimal(dto.deliveryFee) : new Prisma.Decimal(0);
    const adjustedSubtotal = itemsSubtotal.add(deliveryFee);
    const baseSubtotal = dto.baseSubtotal != null ? toDecimal(dto.baseSubtotal) : adjustedSubtotal;

    if (baseSubtotal.lessThan(adjustedSubtotal)) {
      throw new BadRequestException('El subtotal base no puede ser menor al total final de la venta.');
    }

    const discount = baseSubtotal.sub(adjustedSubtotal);

    if (!adjustedSubtotal.equals(toDecimal(paymentTotal))) {
      throw new BadRequestException('El total de pagos debe coincidir con el total de la venta.');
    }

    const createdSale = await tx.sale.create({
      data: {
        number: saleNumber,
        status: SaleStatus.PAID,
        channel: saleChannel,
        tableLabel: dto.tableLabel,
        deliveryReference: dto.deliveryReference,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        deliveryFee,
        deliveryFeeSuggested: dto.deliveryFeeSuggested != null ? toDecimal(dto.deliveryFeeSuggested) : null,
        deliveryFeeEdited: dto.deliveryFeeEdited ?? false,
        deliveryFeeEditReason: dto.deliveryFeeEditReason?.trim() || null,
        deliveryDistanceKm: dto.deliveryDistanceKm != null ? toDecimal(dto.deliveryDistanceKm) : null,
        deliveryZoneLabel: dto.deliveryZoneLabel,
        deliveryPricingBreakdown: dto.deliveryPricingBreakdown as Prisma.InputJsonValue,
        deliveryCalculationVersion: dto.deliveryCalculationVersion,
        subtotal: baseSubtotal,
        discount,
        total: adjustedSubtotal,
        notes: dto.notes,
        createdById: actorId,
        cashSessionId,
        orderTicketId: options?.orderTicketId,
        items: {
          create: itemsData,
        },
        payments: {
          create: normalizedPayments.map((payment) => ({
            paymentMethodId: payment.paymentMethodId,
            amount: payment.amount,
            receivedAmount: payment.receivedAmount,
            changeAmount: payment.changeAmount,
          })),
        },
      },
      include: {
        orderTicket: {
          include: {
            table: true,
          },
        },
        items: {
          include: { product: true },
        },
        payments: {
          include: { paymentMethod: true },
        },
      },
    });

    await Promise.all(
      normalizedPayments.map((payment) =>
        tx.cashMovement.create({
          data: {
            cashSessionId,
            type: CashMovementType.SALE,
            amount: payment.amount,
            paymentMethodId: payment.paymentMethodId,
            description: `Sale ${saleNumber}`,
            referenceType: 'sale',
            referenceId: createdSale.id,
            createdById: actorId,
          },
        }),
      ),
    );

    await this.auditService.log(
      {
        userId: actorId,
        action: 'INVENTORY_SALE_CONSUMPTION',
        module: 'inventory',
        entity: 'sale',
        entityId: createdSale.id,
        before: { stockImpact: 'pending_sale_consumption' },
        after: {
          stockImpact: 'applied',
          itemCount: itemsData.length,
          totalProductQuantity: itemsData.reduce((sum, item) => sum.add(item.quantity), new Prisma.Decimal(0)),
        },
        metadata: { transactional: true, source: options?.orderTicketId ? 'order_checkout' : 'pos_sale' },
      },
      tx,
    );

    return createdSale;
  }

  async reopenConvertedOrder(id: string, dto: ReopenConvertedSaleDto, actorId: string) {
    const reason = dto.reason.trim();

    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize the state transition before reading the linked order and final sale.
      await tx.$queryRaw`
        SELECT id
        FROM sales
        WHERE id = ${id}
        FOR UPDATE
      `;

      const sourceSale = await tx.sale.findUnique({
        where: { id },
        include: {
          cashSession: true,
          conversion: {
            include: {
              orderTicket: {
                include: {
                  table: true,
                  sale: {
                    include: {
                      items: {
                        include: {
                          product: {
                            include: {
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
                          },
                        },
                      },
                      payments: true,
                    },
                  },
                },
              },
            },
          },
          items: {
            include: {
              product: {
                include: {
                  category: true,
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
              },
            },
          },
        },
      });

      if (!sourceSale) {
        throw new NotFoundException('No se encontró la venta.');
      }

      if (!sourceSale.conversion) {
        throw new BadRequestException('Esta venta no fue pasada a una comanda.');
      }

      if (!sourceSale.cashSession || sourceSale.cashSession.status !== CashSessionStatus.OPEN) {
        throw new BadRequestException('Solo puedes reabrir la comanda si la caja original sigue abierta.');
      }

      const order = sourceSale.conversion.orderTicket;
      if (order.status !== 'PAID') {
        throw new BadRequestException('La comanda vinculada aún no está cerrada para reabrirse desde esta venta.');
      }

      if (!order.sale || order.sale.status !== SaleStatus.PAID) {
        throw new BadRequestException('La comanda no tiene una venta final activa para revertir.');
      }

      if (order.type === OrderTicketType.DINE_IN && order.tableId) {
        await this.resolveTableForConvertedOrder(tx, order.tableId, order.type);
      }

      await this.restoreSaleStockForConversion(tx, order.sale.items, actorId, order.sale.id);

      await Promise.all(
        order.sale.payments.map((payment) =>
          tx.cashMovement.create({
            data: {
              cashSessionId: order.cashSessionId,
              type: CashMovementType.ADJUSTMENT,
              amount: toDecimal(payment.amount).neg(),
              paymentMethodId: payment.paymentMethodId,
              description: `Reversa por reapertura desde ${formatReceiptNumber(sourceSale.number)}`,
              referenceType: 'sale_reopen',
              referenceId: sourceSale.id,
              classification: 'Reapertura desde venta convertida',
              createdById: actorId,
            },
          }),
        ),
      );

      await tx.sale.update({
        where: { id: order.sale.id },
        data: {
          status: SaleStatus.CANCELLED,
          orderTicketId: null,
          notes: [order.sale.notes, `Reapertura desde ${formatReceiptNumber(sourceSale.number)}: ${reason}`]
            .filter(Boolean)
            .join('\n'),
        },
      });

      const restoredItems = sourceSale.items.map((item) => ({
        orderTicketId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        notes: item.notes,
      }));

      await tx.orderTicketItem.deleteMany({
        where: { orderTicketId: order.id },
      });

      await tx.orderTicketItem.createMany({
        data: restoredItems,
      });

      const reopenedOrder = await tx.orderTicket.update({
        where: { id: order.id },
        data: {
          status: 'OPEN',
          paidAt: null,
          cancelledAt: null,
          customerName: sourceSale.customerName ?? order.customerName,
          deliveryReference: sourceSale.deliveryReference ?? order.deliveryReference,
          notes: [order.notes, `Restaurada desde ${formatReceiptNumber(sourceSale.number)}: ${reason}`]
            .filter(Boolean)
            .join('\n'),
          subtotal: sourceSale.total,
          revision: {
            increment: 1,
          },
        },
        include: {
          table: true,
          items: {
            include: {
              product: {
                include: {
                  category: true,
                },
              },
            },
          },
        },
      });

      if (order.tableId) {
        await tx.diningTable.update({
          where: { id: order.tableId },
          data: { status: DiningTableStatus.OCCUPIED },
        });
      }

      await this.auditService.log(
        {
          userId: actorId,
          action: 'REOPEN_CONVERTED_ORDER',
          module: 'sales',
          entity: 'sale',
          entityId: id,
          oldValues: {
            saleStatus: sourceSale.status,
            orderTicketId: sourceSale.conversion?.orderTicketId,
          },
          newValues: {
            orderTicketId: reopenedOrder.id,
            orderNumber: reopenedOrder.number,
            restoredFromSale: sourceSale.number,
            reason,
          },
        },
        tx,
      );

      return { sourceSale, order: reopenedOrder };
    });

    return {
      success: true,
      orderTicket: result.order,
    };
  }

  private async getOpenCashSession() {
    const session = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      orderBy: { openedAt: 'desc' },
    });

    if (!session) {
      throw new BadRequestException('Debes tener una caja abierta antes de registrar ventas.');
    }

    return session;
  }

  private renderReceiptMetaRow(
    document: PDFKit.PDFDocument,
    label: string,
    value: string,
    width: number,
    x: number,
    boldValue = false,
    valueSize = 7.1,
  ) {
    const y = document.y;
    const labelWidth = width * 0.38;
    const valueWidth = width * 0.62;
    const gutter = 6;
    const normalizedLabel = label.trim();
    const normalizedValue = value.trim();
    const labelHeight = document.heightOfString(normalizedLabel, {
      width: labelWidth,
      align: 'left',
    });
    const valueHeight = document.heightOfString(normalizedValue, {
      width: valueWidth - gutter,
      align: 'right',
    });

    document.fillColor('#4B5563').font('Helvetica').fontSize(6.8).text(normalizedLabel, x, y, {
      width: labelWidth,
      align: 'left',
    });
    document
      .fillColor('#111827')
      .font(boldValue ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(valueSize)
      .text(normalizedValue, x + labelWidth + gutter, y, {
        width: valueWidth - gutter,
        align: 'right',
      });
    document.y = Math.max(document.y, y + Math.max(labelHeight, valueHeight) + 4);
  }

  private renderReceiptDivider(
    document: PDFKit.PDFDocument,
    x: number,
    width: number,
    color = '#D6D3D1',
  ) {
    const y = document.y;
    document
      .strokeColor(color)
      .lineWidth(0.7)
      .moveTo(x, y)
      .lineTo(x + width, y)
      .stroke();
    document.y = y;
  }

  private formatReceiptDate(value: Date | string) {
    return new Date(value).toLocaleString('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Bogota',
    });
  }

  private formatCurrency(value: number) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  }

  private buildWhatsAppUrl(phone: string | null) {
    if (!phone) {
      return null;
    }

    const digits = phone.replace(/\D/g, '');
    if (!digits) {
      return null;
    }

    if (digits.length === 10) {
      return `https://wa.me/57${digits}`;
    }

    return `https://wa.me/${digits}`;
  }

  private getSaleChannelLabel(channel: SaleChannel) {
    switch (channel) {
      case SaleChannel.MESA:
        return 'Mesa';
      case SaleChannel.DOMICILIO:
        return 'Domicilio';
      case SaleChannel.PARA_LLEVAR:
      case SaleChannel.MOSTRADOR:
      default:
        return 'Mostrador';
    }
  }

  private async resolveTableForConvertedOrder(
    tx: Prisma.TransactionClient,
    tableId: string | null | undefined,
    type: OrderTicketType,
  ) {
    if (type !== OrderTicketType.DINE_IN) {
      if (tableId) {
        throw new BadRequestException('Solo una comanda de mesa puede tener mesa asignada.');
      }

      return null;
    }

    if (!tableId) {
      throw new BadRequestException('Selecciona una mesa para pasar la venta a comanda.');
    }

    const table = await tx.diningTable.findUnique({
      where: { id: tableId },
      include: {
        orderTickets: {
          where: {
            status: {
              in: [
                'OPEN',
                'IN_PREPARATION',
                'SERVED',
                'PAYMENT_PENDING',
              ],
            },
          },
          take: 1,
        },
      },
    });

    if (!table || !table.isActive) {
      throw new NotFoundException('La mesa seleccionada no está disponible.');
    }

    if (table.status === DiningTableStatus.OUT_OF_SERVICE) {
      throw new BadRequestException('La mesa seleccionada está fuera de servicio.');
    }

    if (table.orderTickets.length) {
      throw new BadRequestException('La mesa seleccionada ya tiene una comanda activa.');
    }

    return table;
  }

  private async restoreSaleStockForConversion(
    tx: Prisma.TransactionClient,
    items: Array<{
      quantity: Prisma.Decimal;
      product: Prisma.ProductGetPayload<{
        include: {
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
    }>,
    actorId: string,
    saleId: string,
  ) {
    for (const item of items) {
      const product = item.product;

      if (!product.isActive) {
        throw new BadRequestException(`El producto ${product.name} ya no está activo y no se puede pasar a comanda.`);
      }

      if (product.kind === ProductKind.DIRECT_STOCK) {
        // BLOQUEO CONCURRENCIA: Bloquear producto antes de restaurar stock
        await tx.$queryRawUnsafe(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, product.id);
        const refreshedProduct = await tx.product.findUnique({ where: { id: product.id } });
        if (!refreshedProduct) {
          throw new BadRequestException(`El producto ${product.name} ya no está disponible.`);
        }

        const nextStock = refreshedProduct.currentStock.add(item.quantity);
        await tx.product.update({
          where: { id: product.id },
          data: { currentStock: nextStock },
        });
        await tx.inventoryMovement.create({
          data: {
            productId: product.id,
            type: InventoryMovementType.RETURN,
            quantity: item.quantity,
            unitCost: refreshedProduct.costPrice ?? undefined,
            balanceAfter: nextStock,
            performedById: actorId,
            referenceType: 'sale_conversion',
            referenceId: saleId,
            notes: 'Reversa de stock por venta directa pasada a comanda.',
          },
        });
        continue;
      }

      const recipe = product.recipes[0];
      if (!recipe || !recipe.items.length) {
        throw new BadRequestException(`El producto preparado ${product.name} no tiene receta activa para revertir stock.`);
      }

      for (const recipeItem of recipe.items) {
        // BLOQUEO CONCURRENCIA: Bloquear insumo antes de restaurar stock
        await tx.$queryRawUnsafe(`SELECT id FROM ingredients WHERE id = $1 FOR UPDATE`, recipeItem.ingredientId);
        const refreshedIngredient = await tx.ingredient.findUnique({ where: { id: recipeItem.ingredientId } });
        if (!refreshedIngredient) {
          throw new BadRequestException(`El insumo ${recipeItem.ingredient.name} ya no está disponible.`);
        }

        const restoredQuantity = item.quantity
          .mul(recipeItem.quantity)
          .div(recipe.yieldQuantity)
          .mul(new Prisma.Decimal(1).add(recipeItem.wastePercent.div(100)));
        const nextStock = refreshedIngredient.currentStock.add(restoredQuantity);

        await tx.ingredient.update({
          where: { id: recipeItem.ingredientId },
          data: { currentStock: nextStock },
        });
        await tx.inventoryMovement.create({
          data: {
            ingredientId: recipeItem.ingredientId,
            type: InventoryMovementType.RETURN,
            quantity: restoredQuantity,
            unitCost: refreshedIngredient.costPrice ?? undefined,
            balanceAfter: nextStock,
            performedById: actorId,
            referenceType: 'sale_conversion',
            referenceId: saleId,
            notes: `Reversa de receta por ${product.name} pasado a comanda.`,
          },
        });
      }
    }

    await this.auditService.log(
      {
        userId: actorId,
        action: 'INVENTORY_RETURN_FOR_SALE_CONVERSION',
        module: 'inventory',
        entity: 'sale',
        entityId: saleId,
        before: { stockImpact: 'consumed' },
        after: {
          stockImpact: 'restored',
          itemCount: items.length,
          totalProductQuantity: items.reduce((sum, item) => sum.add(item.quantity), new Prisma.Decimal(0)),
        },
        metadata: { transactional: true, source: 'sale_conversion' },
      },
      tx,
    );
  }

  private async generateOrderNumber(
    tx: Prisma.TransactionClient,
    type: OrderTicketType,
  ): Promise<string> {
    const prefix = this.getOrderPrefix(type);
    const knownPrefixes = ['MOSTRADOR-', 'MESA-', 'DOMICILIO-', 'LLEVAR-'];

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260331)`;

    const existingNumbers = await tx.orderTicket.findMany({
      where: {
        OR: knownPrefixes.map((knownPrefix) => ({
          number: {
            startsWith: knownPrefix,
          },
        })),
      },
      select: {
        number: true,
      },
    });

    const lastSequence = existingNumbers.reduce((highest, order) => {
      const currentSequence = Number.parseInt(order.number.split('-').pop() ?? '0', 10) || 0;
      return Math.max(highest, currentSequence);
    }, 0);

    return `${prefix}-${String(lastSequence + 1).padStart(3, '0')}`;
  }

  private getOrderPrefix(type: OrderTicketType): string {
    switch (type) {
      case OrderTicketType.DINE_IN:
        return 'MESA';
      case OrderTicketType.DELIVERY:
        return 'DOMICILIO';
      case OrderTicketType.COUNTER:
      default:
        return 'MOSTRADOR';
    }
  }
}
