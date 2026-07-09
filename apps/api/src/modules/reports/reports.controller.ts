import { Body, Controller, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateSupplierNotificationDto } from './dto/create-supplier-notification.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('daily')
  @Roles('reports.read')
  getDaily(@Query('date') date?: string) {
    return this.reportsService.getDaily(date);
  }

  @Get('operational')
  @Roles('reports.read')
  getOperational() {
    return this.reportsService.getOperational();
  }

  @Get('operational/pdf')
  @Header('Content-Type', 'application/pdf')
  @Roles('admin', 'supervisor')
  async getOperationalPdf(@Res() response: Response) {
    const buffer = await this.reportsService.generateOperationalPdf();
    response.setHeader('Content-Disposition', 'inline; filename="jornada-actual.pdf"');
    response.send(buffer);
  }

  @Get('range')
  @Roles('reports.read')
  getRange(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getRange(from, to);
  }

  @Get('best-sellers')
  @Roles('reports.read')
  getBestSellers(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getBestSellers(from, to);
  }

  @Get('sales-by-hour')
  @Roles('reports.read')
  getSalesByHour(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getSalesByHour(from, to);
  }

  @Get('product-margins')
  @Roles('reports.read')
  getProductMargins(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getProductMargins(from, to);
  }

  @Get('ingredient-rotation')
  @Roles('reports.read')
  getIngredientRotation(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getIngredientRotation(from, to);
  }

  @Get('comparisons')
  @Roles('reports.read')
  getComparisons(@Query('date') date?: string) {
    return this.reportsService.getComparisons(date);
  }

  @Get('inventory-summary')
  @Roles('reports.read')
  getInventorySummary() {
    return this.reportsService.getInventorySummary();
  }

  @Get('supply-alerts')
  @Roles('reports.read')
  getSupplyAlerts() {
    return this.reportsService.getSupplyAlerts();
  }

  @Get('daily-closures')
  @Roles('reports.read')
  getDailyClosures(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getDailyClosures(from, to);
  }

  @Get('daily-closures/:id')
  @Roles('reports.read')
  getDailyClosure(@Param('id') id: string) {
    return this.reportsService.getDailyClosure(id);
  }

  @Get('daily-closures/:id/pdf')
  @Header('Content-Type', 'application/pdf')
  @Roles('admin', 'supervisor')
  async getDailyClosurePdf(@Param('id') id: string, @Res() response: Response) {
    const buffer = await this.reportsService.generateDailyClosurePdf(id);
    response.setHeader('Content-Disposition', `inline; filename="cierre-diario-${id}.pdf"`);
    response.send(buffer);
  }

  @Get('supplier-notifications')
  @Roles('admin', 'inventory', 'supervisor')
  listSupplierNotifications() {
    return this.reportsService.listSupplierNotifications();
  }

  @Post('supplier-notifications/manual')
  @Roles('admin', 'inventory', 'supervisor')
  createSupplierNotification(
    @Body() dto: CreateSupplierNotificationDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.reportsService.createSupplierNotification(dto, actorId);
  }

  @Get('daily/:date/pdf')
  @Header('Content-Type', 'application/pdf')
  @Roles('admin', 'supervisor')
  async getDailyPdf(@Param('date') date: string, @Res() response: Response) {
    const buffer = await this.reportsService.generateDailyPdf(date);
    response.setHeader('Content-Disposition', `inline; filename="daily-close-${date}.pdf"`);
    response.send(buffer);
  }
}
