import { Body, Controller, Get, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { AssignDeliveryRiderDto } from './dto/assign-delivery-rider.dto';
import { CheckoutOrderTicketDto } from './dto/checkout-order-ticket.dto';
import { ClaimOrderTicketDto } from './dto/claim-order-ticket.dto';
import { CreateOrderTicketDto } from './dto/create-order-ticket.dto';
import { ReplaceOrderTicketItemsDto } from './dto/replace-order-ticket-items.dto';
import { ReopenOrderTicketDto } from './dto/reopen-order-ticket.dto';
import { ResolveDeliveryLocationInboxDto } from './dto/resolve-delivery-location-inbox.dto';
import { SyncWaiterOrderDto } from './dto/sync-waiter-order.dto';
import { UpdateOperationalAlertDto } from './dto/update-operational-alert.dto';
import { UpdateDeliveryWorkflowDto } from './dto/update-delivery-workflow.dto';
import { UpdateOrderTicketDto } from './dto/update-order-ticket.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('waiter-active')
  @Roles('admin', 'cashier', 'supervisor', 'waiter')
  findWaiterActive(@CurrentUser() actor: AuthUser) {
    return this.ordersService.findWaiterActive(actor);
  }

  @Get('delivery-active')
  @Roles('admin', 'cashier', 'supervisor', 'delivery')
  findDeliveryActive(@CurrentUser() actor: AuthUser) {
    return this.ordersService.findDeliveryActive(actor);
  }

  @Get('delivery-location-inbox')
  @Roles('admin', 'cashier', 'supervisor')
  findDeliveryLocationInbox(@Query('status') status?: 'PENDING' | 'APPLIED' | 'REQUIRES_REVIEW' | 'IGNORED') {
    return this.ordersService.findDeliveryLocationInbox(status);
  }

  @Post('delivery-location-inbox/:id/resolve')
  @Roles('admin', 'cashier', 'supervisor')
  resolveDeliveryLocationInbox(
    @Param('id') id: string,
    @Body() dto: ResolveDeliveryLocationInboxDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersService.resolveDeliveryLocationInbox(id, dto, actor);
  }

  @Get('operational-alerts')
  @Roles('admin', 'cashier', 'supervisor', 'waiter', 'delivery')
  listOperationalAlerts(@Query('module') module?: string) {
    return this.ordersService.listOperationalAlerts(module);
  }

  @Patch('operational-alerts/:id')
  @Roles('admin', 'cashier', 'supervisor', 'waiter', 'delivery')
  updateOperationalAlert(
    @Param('id') id: string,
    @Body() dto: UpdateOperationalAlertDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersService.updateOperationalAlert(id, dto.status, actor, dto.notes);
  }

  @Get()
  @Roles('admin', 'cashier', 'supervisor')
  findAll(@Query('status') status?: string, @Query('activeOnly') activeOnly?: string) {
    return this.ordersService.findAll(status, activeOnly === 'true');
  }

  @Get(':id/delivery-receipt')
  @Roles('admin', 'cashier', 'supervisor', 'delivery')
  async getDeliveryReceipt(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.ordersService.generateCurrentDeliveryReceiptPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="cuenta-domicilio-${id}.pdf"`);
    res.send(pdf);
  }

  @Get(':id/delivery-receipt-status')
  @Roles('admin', 'cashier', 'supervisor', 'delivery')
  getDeliveryReceiptStatus(@Param('id') id: string) {
    return this.ordersService.getDeliveryReceiptStatus(id);
  }

  @Get(':id/delivery-receipt-history')
  @Roles('admin', 'cashier', 'supervisor', 'delivery')
  getDeliveryReceiptHistory(@Param('id') id: string) {
    return this.ordersService.getDeliveryReceiptHistory(id);
  }

  @Get(':id')
  @Roles('admin', 'cashier', 'supervisor')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Post()
  @Roles('admin', 'cashier', 'supervisor', 'waiter')
  create(@Body() dto: CreateOrderTicketDto, @CurrentUser() actor: AuthUser) {
    return this.ordersService.create(dto, actor);
  }

  @Patch(':id')
  @Roles('admin', 'cashier', 'supervisor', 'waiter')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrderTicketDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersService.update(id, dto, actor);
  }

  @Put(':id/items')
  @Roles('admin', 'cashier', 'supervisor', 'waiter')
  replaceItems(
    @Param('id') id: string,
    @Body() dto: ReplaceOrderTicketItemsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersService.replaceItems(id, dto, actor);
  }

  @Post('waiter-sync')
  @Roles('admin', 'cashier', 'supervisor', 'waiter')
  syncWaiterOrder(@Body() dto: SyncWaiterOrderDto, @CurrentUser() actor: AuthUser) {
    return this.ordersService.syncWaiterOrder(dto, actor);
  }

  @Post(':id/claim')
  @Roles('admin', 'cashier', 'supervisor', 'waiter')
  claim(@Param('id') id: string, @Body() dto: ClaimOrderTicketDto, @CurrentUser() actor: AuthUser) {
    return this.ordersService.claim(id, dto, actor);
  }

  @Post(':id/claim-delivery')
  @Roles('admin', 'cashier', 'supervisor', 'delivery')
  claimDelivery(
    @Param('id') id: string,
    @Body() dto: ClaimOrderTicketDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersService.claimDelivery(id, dto, actor);
  }

  @Post(':id/assign-rider')
  @Roles('admin', 'cashier', 'supervisor')
  assignRider(
    @Param('id') id: string,
    @Body() dto: AssignDeliveryRiderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersService.assignDeliveryRider(id, dto, actor);
  }

  @Post(':id/assign-delivery')
  @Roles('admin', 'cashier', 'supervisor')
  assignDelivery(
    @Param('id') id: string,
    @Body() dto: AssignDeliveryRiderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersService.assignDeliveryRider(id, dto, actor);
  }

  @Post(':id/delivery-workflow')
  @Roles('admin', 'cashier', 'supervisor', 'delivery')
  updateDeliveryWorkflow(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryWorkflowDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersService.updateDeliveryWorkflow(id, dto, actor);
  }

  @Patch(':id/delivery-status')
  @Roles('admin', 'cashier', 'supervisor', 'delivery')
  patchDeliveryStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryWorkflowDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.ordersService.updateDeliveryWorkflow(id, dto, actor);
  }

  @Post(':id/checkout')
  @Roles('admin', 'cashier', 'supervisor')
  checkout(
    @Param('id') id: string,
    @Body() dto: CheckoutOrderTicketDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.ordersService.checkout(id, dto, actorId);
  }

  @Post(':id/reopen')
  @Roles('admin', 'cashier', 'supervisor')
  reopen(
    @Param('id') id: string,
    @Body() dto: ReopenOrderTicketDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.ordersService.reopen(id, dto, actorId);
  }

  @Get('delivery-fee/estimate')
  @Roles('admin', 'cashier', 'supervisor', 'waiter', 'delivery')
  estimateDeliveryFee(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('address') address?: string,
  ) {
    return this.ordersService.estimateDeliveryFee({ lat, lng, address });
  }

  @Get('delivery-customers/search')
  @Roles('admin', 'cashier', 'supervisor', 'waiter', 'delivery')
  findDeliveryCustomer(
    @Query('phone') phone?: string,
    @Query('name') name?: string,
  ) {
    if (phone || name) {
      return this.ordersService.findDeliveryCustomer(phone, name);
    }
    return null;
  }

  @Get('customers/search')
  @Roles('admin', 'cashier', 'supervisor', 'waiter', 'delivery')
  searchCustomers(@Query('q') q: string) {
    return this.ordersService.searchCustomers(q);
  }

  @Post('customers/find-or-create')
  @Roles('admin', 'cashier', 'supervisor', 'waiter', 'delivery')
  findOrCreateCustomer(
    @Body() dto: { fullName?: string; phone?: string; defaultAddress?: string },
  ) {
    return this.ordersService.findOrCreateCustomer(dto);
  }

  @Post('delivery-customers')
  @Roles('admin', 'cashier', 'supervisor', 'waiter', 'delivery')
  upsertDeliveryCustomer(
    @Body() dto: { phone: string; fullName?: string; address?: string },
  ) {
    return this.ordersService.upsertDeliveryCustomer(dto);
  }
}
