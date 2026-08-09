import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { ObservabilityService } from './observability.service';
import { OperationalAlertPolicy } from './operational-alert-policy';
import { OperationalBacklogService } from './operational-backlog.service';
import { ReleaseModule } from '../../release/release.module';

@Module({
  imports: [ReleaseModule],
  controllers: [HealthController],
  providers: [HealthService, ObservabilityService, OperationalAlertPolicy, OperationalBacklogService],
  exports: [ObservabilityService, OperationalBacklogService],
})
export class HealthModule {}
