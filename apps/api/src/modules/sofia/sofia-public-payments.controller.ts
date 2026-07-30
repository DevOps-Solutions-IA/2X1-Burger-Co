import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SelectSofiaPaymentMethodDto } from './dto/sofia.dto';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';

@Controller('public/sofia/payments')
@UseGuards(ThrottlerGuard)
export class SofiaPublicPaymentsController {
  constructor(private readonly paymentLinkService: SofiaPaymentLinkService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getPayment(@Param('token') token: string) {
    return this.paymentLinkService.getPublicPayment(token);
  }

  @Post(':token/select-method')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  selectPaymentMethod(@Param('token') token: string, @Body() dto: SelectSofiaPaymentMethodDto) {
    return this.paymentLinkService.selectPublicPaymentMethod(token, dto.method);
  }
}
