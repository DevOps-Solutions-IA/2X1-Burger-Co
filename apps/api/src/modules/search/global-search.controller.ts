import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { GlobalSearchDto } from './dto/global-search.dto';
import { GlobalSearchService } from './global-search.service';

@Controller('admin/search')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'supervisor', 'cashier')
@Permissions('orders.read')
export class GlobalSearchController {
  constructor(private readonly searchService: GlobalSearchService) {}

  @Get()
  search(@Query() query: GlobalSearchDto, @CurrentUser() actor: AuthUser) {
    return this.searchService.search(query, actor);
  }
}
