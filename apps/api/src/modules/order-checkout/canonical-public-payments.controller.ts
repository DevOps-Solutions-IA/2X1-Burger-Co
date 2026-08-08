import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PaymentOrchestrationService } from './payment-orchestration.service';

@Controller('public/payments')
@UseGuards(ThrottlerGuard)
export class CanonicalPublicPaymentsController {
  constructor(private readonly payments: PaymentOrchestrationService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  get(@Param('token') token: string) {
    return this.payments.getPublicPayment(token);
  }

  @Post(':token/start-online')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  startOnline(@Param('token') token: string, @Body() body: { method?: string }) {
    if (body.method !== 'ONLINE') throw new BadRequestException({ code: 'CHECKOUT_PAYMENT_COMBINATION_INVALID' });
    return this.payments.startBoldPayment(token);
  }
}
