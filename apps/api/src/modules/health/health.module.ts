import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ObservabilityService } from './observability.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, ObservabilityService],
  exports: [ObservabilityService],
})
export class HealthModule {}
