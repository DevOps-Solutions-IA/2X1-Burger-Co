import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { AuthUser } from '../common/types/auth-user.type';
import { DeliveryPricingService } from './delivery-pricing/delivery-pricing.service';
import { EstimateDeliveryPricingDto } from './dto/estimate-delivery-pricing.dto';

@Controller('delivery-pricing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveryPricingController {
  constructor(private readonly deliveryPricingService: DeliveryPricingService) {}

  @Post('estimate')
  @HttpCode(200)
  @Roles('admin', 'cashier', 'supervisor')
  estimate(@Body() dto: EstimateDeliveryPricingDto, @CurrentUser() actor: AuthUser) {
    return this.deliveryPricingService.estimate({
      orderSubtotal: dto.orderSubtotal,
      customerId: dto.customerId,
      addressText: dto.addressText ?? dto.address,
      neighborhood: dto.neighborhood,
      reference: dto.reference,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      location: dto.location,
      latitude: dto.location?.latitude ?? dto.latitude,
      longitude: dto.location?.longitude ?? dto.longitude,
      requestedAt: dto.requestedAt,
      operatorId: actor.sub,
    });
  }
}
