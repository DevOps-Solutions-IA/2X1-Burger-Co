import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DeliveryLocationSearchDto, DeliveryLocationResolveDto } from './dto/delivery-location.dto';
import { DeliveryLocationService } from './delivery-location.service';

@Controller('delivery-location')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveryLocationController {
  constructor(private readonly deliveryLocationService: DeliveryLocationService) {}

  @Post('search')
  @HttpCode(200)
  @Roles('admin', 'cashier', 'supervisor')
  search(@Body() dto: DeliveryLocationSearchDto) {
    return this.deliveryLocationService.search({
      query: dto.query,
      city: dto.city,
      state: dto.state,
      country: dto.country,
    });
  }

  @Post('resolve')
  @HttpCode(200)
  @Roles('admin', 'cashier', 'supervisor')
  resolve(@Body() dto: DeliveryLocationResolveDto) {
    return this.deliveryLocationService.resolve({
      provider: dto.provider,
      placeId: dto.placeId,
      fallbackText: dto.fallbackText,
    });
  }
}
