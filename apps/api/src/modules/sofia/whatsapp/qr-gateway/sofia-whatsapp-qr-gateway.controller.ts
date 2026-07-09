import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import { SofiaWhatsappQrTestInboundDto, SofiaWhatsappQrTestSendDto } from '../../dto/sofia.dto';
import { SofiaWhatsappQrGatewayService } from './sofia-whatsapp-qr-gateway.service';

@Controller('admin/sofia/whatsapp/qr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'cashier', 'supervisor')
export class SofiaWhatsappQrGatewayController {
  constructor(private readonly qrGatewayService: SofiaWhatsappQrGatewayService) {}

  @Get('status')
  getStatus() {
    return this.qrGatewayService.getStatus();
  }

  @Post('connect')
  connect(@CurrentUser() actor: AuthUser) {
    return this.qrGatewayService.connect(actor.sub);
  }

  @Get('code')
  getCode() {
    return this.qrGatewayService.getCode();
  }

  @Post('disconnect')
  disconnect(@CurrentUser() actor: AuthUser) {
    return this.qrGatewayService.disconnect(actor.sub);
  }

  @Post('logout')
  logout(@CurrentUser() actor: AuthUser) {
    return this.qrGatewayService.logout(actor.sub);
  }

  @Post('test-inbound')
  testInbound(@Body() dto: SofiaWhatsappQrTestInboundDto) {
    return this.qrGatewayService.testInbound(dto);
  }

  @Get('inbound-events')
  inboundEvents(@Query('limit') limit?: string) {
    return this.qrGatewayService.listInboundEvents(limit ? Number(limit) : 20);
  }

  @Post('test-send')
  testSend(@Body() dto: SofiaWhatsappQrTestSendDto) {
    return this.qrGatewayService.testSend(dto);
  }
}
