import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Permissions } from '../../../../common/decorators/permissions.decorator';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import { SofiaWhatsappQrTestInboundDto, SofiaWhatsappQrTestSendDto } from '../../dto/sofia.dto';
import { SofiaWhatsappQrGatewayService } from './sofia-whatsapp-qr-gateway.service';
import { SofiaTestOnlyGuard } from '../../runtime-safety/sofia-test-only.guard';

@Controller('admin/sofia/whatsapp/qr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'supervisor')
@Permissions('settings.read')
export class SofiaWhatsappQrGatewayController {
  constructor(private readonly qrGatewayService: SofiaWhatsappQrGatewayService) {}

  @Get('status')
  getStatus() {
    return this.qrGatewayService.getStatus();
  }

  @Post('connect')
  @Permissions('settings.update')
  connect(@CurrentUser() actor: AuthUser) {
    return this.qrGatewayService.connect(actor);
  }

  @Get('code')
  getCode() {
    return this.qrGatewayService.getCode();
  }

  /**
   * Solo relevante con `WHATSAPP_QR_DISCOVERY_MODE=true` (prohibido en
   * producción). Lectura única del `@lid`/cuenta capturados en el último
   * escaneo de descubrimiento — el valor se borra de memoria al leerse.
   */
  @Get('discovery-result')
  @Permissions('settings.update')
  getDiscoveryResult() {
    return this.qrGatewayService.getDiscoveryResult();
  }

  @Post('disconnect')
  @Permissions('settings.update')
  disconnect(@CurrentUser() actor: AuthUser) {
    return this.qrGatewayService.disconnect(actor);
  }

  @Post('logout')
  @Permissions('settings.update')
  logout(@CurrentUser() actor: AuthUser) {
    return this.qrGatewayService.logout(actor);
  }

  @Post('test-inbound')
  @Permissions('settings.update')
  @UseGuards(SofiaTestOnlyGuard)
  testInbound(@Body() dto: SofiaWhatsappQrTestInboundDto, @CurrentUser() actor: AuthUser) {
    return this.qrGatewayService.testInbound(dto, actor);
  }

  @Get('inbound-events')
  inboundEvents(@Query('limit') limit?: string) {
    return this.qrGatewayService.listInboundEvents(limit ? Number(limit) : 20);
  }

  @Post('test-send')
  @Permissions('settings.update')
  @UseGuards(SofiaTestOnlyGuard)
  testSend(@Body() dto: SofiaWhatsappQrTestSendDto, @CurrentUser() actor: AuthUser) {
    return this.qrGatewayService.testSend(dto, actor);
  }
}
