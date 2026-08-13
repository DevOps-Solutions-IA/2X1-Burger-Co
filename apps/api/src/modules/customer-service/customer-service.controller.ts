import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CustomerServiceCaseReadService } from './customer-service-case-read.service';
import { CustomerServiceCaseService } from './customer-service-case.service';
import { ListCustomerServiceCasesDto } from './dto/list-customer-service-cases.dto';
import { TransitionCustomerServiceCaseDto } from './dto/transition-customer-service-case.dto';

@Controller('admin/customer-service/cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'supervisor')
export class CustomerServiceController {
  constructor(
    private readonly cases: CustomerServiceCaseService,
    private readonly reads: CustomerServiceCaseReadService,
  ) {}

  @Get()
  list(@Query() query: ListCustomerServiceCasesDto) {
    return this.reads.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.reads.get(id);
  }

  @Post(':id/transitions')
  async transition(
    @Param('id') id: string,
    @Body() dto: TransitionCustomerServiceCaseDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const current = await this.reads.current(id);
    return this.cases.transition({
      caseId: id,
      expectedVersion: dto.expectedVersion,
      idempotencyKey: dto.idempotencyKey,
      fromStatus: current.status,
      toStatus: dto.toStatus,
      reasonCode: dto.reasonCode,
      actorId: actor.sub,
      resolutionCode: dto.resolutionCode,
      metadata: dto.metadata,
    });
  }
}
