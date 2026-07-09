import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { AssignTableGroupDto } from './dto/assign-table-group.dto';
import { CreateDiningTableDto } from './dto/create-dining-table.dto';
import { CreateTableGroupDto } from './dto/create-table-group.dto';
import { CreateWaiterAssignmentDto } from './dto/create-waiter-assignment.dto';
import { UpdateDiningTableDto } from './dto/update-dining-table.dto';
import { UpdateTableGroupDto } from './dto/update-table-group.dto';
import { UpdateWaiterAssignmentDto } from './dto/update-waiter-assignment.dto';
import { TablesService } from './tables.service';

@Controller('tables')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get('waiter')
  @Roles('admin', 'cashier', 'supervisor', 'waiter')
  findWaiterView(@CurrentUser() actor: AuthUser) {
    return this.tablesService.findWaiterView(actor);
  }

  @Get('groups')
  @Roles('admin', 'cashier', 'supervisor')
  findTableGroups() {
    return this.tablesService.findTableGroups();
  }

  @Post('groups')
  @Roles('admin', 'supervisor')
  createTableGroup(@Body() dto: CreateTableGroupDto, @CurrentUser('sub') actorId: string) {
    return this.tablesService.createTableGroup(dto, actorId);
  }

  @Patch('groups/:id')
  @Roles('admin', 'supervisor')
  updateTableGroup(
    @Param('id') id: string,
    @Body() dto: UpdateTableGroupDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.updateTableGroup(id, dto, actorId);
  }

  @Delete('groups/:id')
  @Roles('admin', 'supervisor')
  deactivateTableGroup(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.tablesService.deactivateTableGroup(id, actorId);
  }

  @Post('groups/:id/tables')
  @Roles('admin', 'supervisor')
  addTableToGroup(
    @Param('id') id: string,
    @Body('tableId') tableId: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.addTableToGroup(id, tableId, actorId);
  }

  @Delete('groups/:id/tables/:tableId')
  @Roles('admin', 'supervisor')
  removeTableFromGroup(
    @Param('id') id: string,
    @Param('tableId') tableId: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.removeTableFromGroup(id, tableId, actorId);
  }

  @Get('waiter-assignments')
  @Roles('admin', 'supervisor')
  findWaiterAssignments() {
    return this.tablesService.findWaiterAssignments();
  }

  @Get('waiter-assignments/me')
  @Roles('waiter')
  findMyWaiterAssignments(@CurrentUser() actor: AuthUser) {
    return this.tablesService.findMyWaiterAssignments(actor);
  }

  @Post('waiter-assignments')
  @Roles('admin', 'supervisor')
  createWaiterAssignment(@Body() dto: CreateWaiterAssignmentDto, @CurrentUser('sub') actorId: string) {
    return this.tablesService.createWaiterAssignment(dto, actorId);
  }

  @Patch('waiter-assignments/:id')
  @Roles('admin', 'supervisor')
  updateWaiterAssignment(
    @Param('id') id: string,
    @Query('scope') scope: 'GROUP' | 'TABLE' = 'GROUP',
    @Body() dto: UpdateWaiterAssignmentDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.updateWaiterAssignment(scope, id, dto, actorId);
  }

  @Delete('waiter-assignments/:id')
  @Roles('admin', 'supervisor')
  deactivateWaiterAssignment(
    @Param('id') id: string,
    @Query('scope') scope: 'GROUP' | 'TABLE' = 'GROUP',
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.deactivateWaiterAssignment(scope, id, actorId);
  }

  @Get()
  @Roles('admin', 'cashier', 'supervisor')
  findAll() {
    return this.tablesService.findAll();
  }

  @Post()
  @Roles('admin', 'supervisor')
  create(@Body() dto: CreateDiningTableDto, @CurrentUser('sub') actorId: string) {
    return this.tablesService.create(dto, actorId);
  }

  @Patch(':id')
  @Roles('admin', 'supervisor')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDiningTableDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.update(id, dto, actorId);
  }

  @Delete(':id')
  @Roles('admin', 'supervisor')
  deleteTable(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.tablesService.deleteTable(id, actorId);
  }

  @Patch(':id/group')
  @Roles('admin', 'supervisor')
  assignTableGroup(
    @Param('id') id: string,
    @Body() dto: AssignTableGroupDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.assignTableGroup(id, dto, actorId);
  }
}
