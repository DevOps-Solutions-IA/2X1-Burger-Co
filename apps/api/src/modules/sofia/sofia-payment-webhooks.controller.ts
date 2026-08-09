import { Controller, GoneException, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SofiaTestOnlyGuard } from './runtime-safety/sofia-test-only.guard';

@Controller('dev/sofia/payments')
@UseGuards(JwtAuthGuard, RolesGuard, SofiaTestOnlyGuard)
@Roles('admin', 'cashier', 'supervisor')
export class SofiaDevPaymentsController {
  @Post('mock-webhook')
  simulateMockWebhook(): never {
    throw new GoneException({
      code: 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED',
      canonicalAuthority: 'ORDER_CHECKOUT_PAYMENT_ORCHESTRATION',
    });
  }
}
