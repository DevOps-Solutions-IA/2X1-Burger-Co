import { Controller, Get, GoneException, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

const retired = () => {
  throw new GoneException({
    code: 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED',
    canonicalAuthority: 'ORDER_CHECKOUT_PAYMENT_ORCHESTRATION',
  });
};

@Controller('public/sofia/payments')
@UseGuards(ThrottlerGuard)
export class SofiaPublicPaymentsController {
  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getPayment(@Param('token') _token: string): never {
    return retired();
  }

  @Post(':token/select-method')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  selectPaymentMethod(@Param('token') _token: string): never {
    return retired();
  }
}
