import { Module } from '@nestjs/common';
import { GlobalSearchController } from './global-search.controller';
import { GlobalSearchService } from './global-search.service';

@Module({
  controllers: [GlobalSearchController],
  providers: [GlobalSearchService],
})
export class GlobalSearchModule {}
