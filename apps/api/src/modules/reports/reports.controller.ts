import { Body, Controller, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
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
  getDaily(@Query('date') date?: string, @CurrentUser('permissions') permissions?: string[]) {
    // A67: route stays reachable to every role holding 'reports.read' (cashier/supervisor rely
    // on it for the daily summary), but ReportsService now redacts cost/margin/profit fields
    // unless the caller holds 'products.update' (admin/inventory) — same tier as A65's
    // ProductsService cost-visibility gate.
    return this.reportsService.getDaily(date, permissions);
  }

  @Get('operational')
  @Roles('reports.read')
  getOperational(@CurrentUser('permissions') permissions?: string[]) {
    return this.reportsService.getOperational(permissions);
  }

  @Get('operational/pdf')
  @Header('Content-Type', 'application/pdf')
  @Roles('admin', 'supervisor')
  @Permissions('reports.pdf')
  async getOperationalPdf(@Res() response: Response, @CurrentUser('permissions') permissions?: string[]) {
    const buffer = await this.reportsService.generateOperationalPdf(permissions);
    response.setHeader('Content-Disposition', 'inline; filename="jornada-actual.pdf"');
    response.send(buffer);
  }

  @Get('range')
  @Roles('reports.read')
  getRange(@Query('from') from?: string, @Query('to') to?: string, @CurrentUser('permissions') permissions?: string[]) {
    return this.reportsService.getRange(from, to, permissions);
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
  getProductMargins(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.reportsService.getProductMargins(from, to, permissions);
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
  getInventorySummary(@CurrentUser('permissions') permissions?: string[]) {
    return this.reportsService.getInventorySummary(permissions);
  }

  @Get('supply-alerts')
  @Roles('reports.read')
  getSupplyAlerts(@CurrentUser('permissions') permissions?: string[]) {
    return this.reportsService.getSupplyAlerts(permissions);
  }

  @Get('daily-closures')
  @Roles('reports.read')
  getDailyClosures(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser('permissions') permissions?: string[],
  ) {
    return this.reportsService.getDailyClosures(from, to, permissions);
  }

  @Get('daily-closures/:id')
  @Roles('reports.read')
  getDailyClosure(@Param('id') id: string, @CurrentUser('permissions') permissions?: string[]) {
    return this.reportsService.getDailyClosure(id, permissions);
  }

  @Get('daily-closures/:id/pdf')
  @Header('Content-Type', 'application/pdf')
  @Roles('admin', 'supervisor')
  @Permissions('reports.pdf')
  async getDailyClosurePdf(
    @Param('id') id: string,
    @Res() response: Response,
    @CurrentUser('permissions') permissions?: string[],
  ) {
    const buffer = await this.reportsService.generateDailyClosurePdf(id, permissions);
    response.setHeader('Content-Disposition', `inline; filename="cierre-diario-${id}.pdf"`);
    response.send(buffer);
  }

  @Get('supplier-notifications')
  @Roles('admin', 'inventory', 'supervisor')
  @Permissions('reports.read')
  listSupplierNotifications() {
    return this.reportsService.listSupplierNotifications();
  }

  @Post('supplier-notifications/manual')
  @Roles('admin', 'inventory')
  @Permissions('suppliers.update')
  createSupplierNotification(
    @Body() dto: CreateSupplierNotificationDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.reportsService.createSupplierNotification(dto, actorId);
  }

  @Get('daily/:date/pdf')
  @Header('Content-Type', 'application/pdf')
  @Roles('admin', 'supervisor')
  @Permissions('reports.pdf')
  async getDailyPdf(
    @Param('date') date: string,
    @Res() response: Response,
    @CurrentUser('permissions') permissions?: string[],
  ) {
    const buffer = await this.reportsService.generateDailyPdf(date, permissions);
    response.setHeader('Content-Disposition', `inline; filename="daily-close-${date}.pdf"`);
    response.send(buffer);
  }
}
