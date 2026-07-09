import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SelectSofiaPaymentMethodDto } from './dto/sofia.dto';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';

@Controller('public/sofia/payments')
export class SofiaPublicPaymentsController {
  constructor(private readonly paymentLinkService: SofiaPaymentLinkService) {}

  @Get(':token')
  getPayment(@Param('token') token: string) {
    return this.paymentLinkService.getPublicPayment(token);
  }

  @Post(':token/select-method')
  selectPaymentMethod(@Param('token') token: string, @Body() dto: SelectSofiaPaymentMethodDto) {
    return this.paymentLinkService.selectPublicPaymentMethod(token, dto.method);
  }
}
