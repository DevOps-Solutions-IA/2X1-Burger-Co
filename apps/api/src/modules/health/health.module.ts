import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ObservabilityService } from './observability.service';
import { ReleaseModule } from '../../release/release.module';

@Module({
  imports: [ReleaseModule],
  controllers: [HealthController],
  providers: [HealthService, ObservabilityService],
  exports: [ObservabilityService],
})
export class HealthModule {}
