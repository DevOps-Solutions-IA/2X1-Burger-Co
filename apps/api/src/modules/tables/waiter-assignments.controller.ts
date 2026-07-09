import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CreateWaiterAssignmentDto } from './dto/create-waiter-assignment.dto';
import { UpdateWaiterAssignmentDto } from './dto/update-waiter-assignment.dto';
import { TablesService } from './tables.service';

@Controller('waiter-assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WaiterAssignmentsController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @Roles('admin', 'supervisor')
  findAll() {
    return this.tablesService.findWaiterAssignments();
  }

  @Get('me')
  @Roles('waiter')
  findMine(@CurrentUser() actor: AuthUser) {
    return this.tablesService.findMyWaiterAssignments(actor);
  }

  @Post()
  @Roles('admin', 'supervisor')
  create(@Body() dto: CreateWaiterAssignmentDto, @CurrentUser('sub') actorId: string) {
    return this.tablesService.createWaiterAssignment(dto, actorId);
  }

  @Patch(':id')
  @Roles('admin', 'supervisor')
  update(
    @Param('id') id: string,
    @Query('scope') scope: 'GROUP' | 'TABLE' = 'GROUP',
    @Body() dto: UpdateWaiterAssignmentDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.updateWaiterAssignment(scope, id, dto, actorId);
  }

  @Delete(':id')
  @Roles('admin', 'supervisor')
  deactivate(
    @Param('id') id: string,
    @Query('scope') scope: 'GROUP' | 'TABLE' = 'GROUP',
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.deactivateWaiterAssignment(scope, id, actorId);
  }
}
