import { Body, Controller, Get, Header, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ConvertSaleToOrderDto } from './dto/convert-sale-to-order.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ReopenConvertedSaleDto } from './dto/reopen-converted-sale.dto';
import { SalesService } from './sales.service';

@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  @Roles('sales.read')
  findAll() {
    return this.salesService.findAll();
  }

  @Get(':id')
  @Roles('sales.read')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }

  @Get(':id/receipt-pdf')
  @Roles('sales.read')
  @Header('Content-Type', 'application/pdf')
  async getReceiptPdf(@Param('id') id: string, @Res() response: Response) {
    const pdf = await this.salesService.generateReceiptPdf(id);
    response.setHeader('Content-Disposition', `inline; filename="comprobante-${id}.pdf"`);
    response.send(pdf);
  }

  @Post()
  @Roles('admin', 'cashier', 'supervisor')
  create(@Body() dto: CreateSaleDto, @CurrentUser('sub') actorId: string) {
    return this.salesService.create(dto, actorId);
  }

  @Post(':id/convert-to-order')
  @Roles('admin', 'cashier', 'supervisor')
  convertToOrder(
    @Param('id') id: string,
    @Body() dto: ConvertSaleToOrderDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.salesService.convertToOrder(id, dto, actorId);
  }

  @Post(':id/reopen-converted-order')
  @Roles('admin', 'cashier', 'supervisor')
  reopenConvertedOrder(
    @Param('id') id: string,
    @Body() dto: ReopenConvertedSaleDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.salesService.reopenConvertedOrder(id, dto, actorId);
  }
}
