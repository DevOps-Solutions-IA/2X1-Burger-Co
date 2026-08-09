import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { MockSofiaPaymentWebhookDto } from './dto/sofia.dto';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';
import { SofiaTestOnlyGuard } from './runtime-safety/sofia-test-only.guard';

@Controller('dev/sofia/payments')
@UseGuards(JwtAuthGuard, RolesGuard, SofiaTestOnlyGuard)
@Roles('admin', 'cashier', 'supervisor')
export class SofiaDevPaymentsController {
  constructor(private readonly paymentLinkService: SofiaPaymentLinkService) {}

  @Post('mock-webhook')
  simulateMockWebhook(@Body() dto: MockSofiaPaymentWebhookDto, @CurrentUser() _actor: AuthUser) {
    return this.paymentLinkService.simulateMockWebhook(dto);
  }
}
