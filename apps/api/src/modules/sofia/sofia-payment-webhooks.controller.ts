import { Body, Controller, Headers, Param, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { MockSofiaPaymentWebhookDto } from './dto/sofia.dto';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';

@Controller('integrations/payments/webhook')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class SofiaPaymentWebhooksController {
  constructor(private readonly paymentLinkService: SofiaPaymentLinkService) {}

  @Post(':provider')
  receiveWebhook(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.paymentLinkService.processPaymentWebhook(provider, body, headers, request.rawBody);
  }
}

@Controller('dev/sofia/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'cashier', 'supervisor')
export class SofiaDevPaymentsController {
  constructor(private readonly paymentLinkService: SofiaPaymentLinkService) {}

  @Post('mock-webhook')
  simulateMockWebhook(@Body() dto: MockSofiaPaymentWebhookDto, @CurrentUser() _actor: AuthUser) {
    return this.paymentLinkService.simulateMockWebhook(dto);
  }
}
