import { Module } from '@nestjs/common';
import { SofiaAutoSafeEngineService } from './sofia-auto-safe-engine.service';

@Module({
  providers: [SofiaAutoSafeEngineService],
  exports: [SofiaAutoSafeEngineService],
})
export class SofiaAutoSafeModule {}
