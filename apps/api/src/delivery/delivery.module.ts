import { Module } from '@nestjs/common';
import { DeliveryLocationController } from './delivery-location.controller';
import { DeliveryLocationService } from './delivery-location.service';
import { DeliveryPricingController } from './delivery-pricing.controller';
import { DeliveryPricingService } from './delivery-pricing/delivery-pricing.service';
import { DeliveryExternalDataService } from './providers/delivery-external-data.service';
import { DeliveryProviderUsageService } from './providers/delivery-provider-usage.service';
import { PrismaExternalCache } from './providers/prisma-external-cache';

@Module({
  controllers: [DeliveryPricingController, DeliveryLocationController],
  providers: [DeliveryPricingService, DeliveryLocationService, DeliveryExternalDataService, PrismaExternalCache, DeliveryProviderUsageService],
  exports: [DeliveryPricingService, DeliveryLocationService, DeliveryExternalDataService, PrismaExternalCache, DeliveryProviderUsageService],
})
export class DeliveryModule {}
