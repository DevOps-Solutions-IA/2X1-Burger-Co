import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ReleaseMetadataService } from './release-metadata.service';

@Controller('version')
export class ReleaseController {
  constructor(private readonly releaseMetadata: ReleaseMetadataService) {}

  @Public()
  @Get()
  getVersion() {
    return this.releaseMetadata.getVersion();
  }
}
