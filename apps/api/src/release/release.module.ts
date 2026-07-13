import { Module } from '@nestjs/common';
import { ReleaseController } from './release.controller';
import { ReleaseMetadataService } from './release-metadata.service';

@Module({
  controllers: [ReleaseController],
  providers: [ReleaseMetadataService],
  exports: [ReleaseMetadataService],
})
export class ReleaseModule {}
