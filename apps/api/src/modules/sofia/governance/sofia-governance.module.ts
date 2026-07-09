import { Module } from '@nestjs/common';
import { SofiaReadinessService } from './sofia-readiness.service';
import { SofiaGovernanceService } from './sofia-governance.service';

@Module({
  providers: [SofiaReadinessService, SofiaGovernanceService],
  exports: [SofiaReadinessService, SofiaGovernanceService],
})
export class SofiaGovernanceModule {}
