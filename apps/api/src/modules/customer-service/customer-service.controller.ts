import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CustomerServiceCaseReadService } from './customer-service-case-read.service';
import { CustomerServiceCaseError, CustomerServiceCaseService } from './customer-service-case.service';
import { CustomerServiceCasePersistenceError } from './persistence/prisma-customer-service-case.repository';
import { ListCustomerServiceCasesDto } from './dto/list-customer-service-cases.dto';
import { TransitionCustomerServiceCaseDto } from './dto/transition-customer-service-case.dto';

@Controller('admin/customer-service/cases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'supervisor')
@Permissions('orders.read')
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
  @Permissions('orders.update')
  async transition(
    @Param('id') id: string,
    @Body() dto: TransitionCustomerServiceCaseDto,
    @CurrentUser() actor: AuthUser,
  ) {
    try {
      return await this.cases.transition({
        caseId: id,
        expectedVersion: dto.expectedVersion,
        idempotencyKey: dto.idempotencyKey,
        fromStatus: dto.fromStatus,
        toStatus: dto.toStatus,
        reasonCode: dto.reasonCode,
        actorId: actor.sub,
        resolutionCode: dto.resolutionCode,
        metadata: dto.metadata,
      });
    } catch (error) {
      if (error instanceof CustomerServiceCasePersistenceError) {
        if (error.code === 'CASE_NOT_FOUND') throw new NotFoundException(error.code);
        throw new ConflictException(error.code);
      }
      if (error instanceof CustomerServiceCaseError) {
        if (error.code === 'CUSTOMER_SERVICE_CASE_TRANSITION_BLOCKED') {
          throw new ConflictException(error.code);
        }
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }
}
