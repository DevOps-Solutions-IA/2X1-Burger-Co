import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LinkWhatsappGroupDto } from './dto/link-whatsapp-group.dto';
import { SelectWhatsappGroupDto } from './dto/select-whatsapp-group.dto';
import { SendWhatsappReceiptDto } from './dto/send-whatsapp-receipt.dto';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'cashier', 'supervisor')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('session')
  getSessionStatus() {
    return this.whatsappService.getSessionStatus();
  }

  @Get('groups')
  listGroups() {
    return this.whatsappService.listParticipatingGroups();
  }

  @Post('session/refresh')
  refreshSession() {
    return this.whatsappService.refreshSession();
  }

  @Post('session/disconnect')
  disconnectSession() {
    return this.whatsappService.disconnectSession();
  }

  @Post('daily-close-group/link')
  linkDailyCloseGroup(
    @Body() dto: LinkWhatsappGroupDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.whatsappService.linkDailyCloseGroup(dto.inviteLink, actorId);
  }

  @Post('daily-close-group/select')
  selectDailyCloseGroup(
    @Body() dto: SelectWhatsappGroupDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.whatsappService.selectDailyCloseGroup(dto.groupJid, actorId, dto.groupLabel);
  }

  @Post('daily-close/:id/send')
  sendDailyClose(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.whatsappService.sendClosingSummary(id, actorId);
  }

  @Post('sales/:id/send-receipt')
  sendSaleReceipt(
    @Param('id') id: string,
    @Body() dto: SendWhatsappReceiptDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.whatsappService.sendSaleReceipt(id, dto.phone, actorId);
  }

  @Post('orders/:id/send-delivery-summary')
  sendDeliveryOrderSummary(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.whatsappService.sendDeliveryOrderSummary(id, actorId);
  }
}
