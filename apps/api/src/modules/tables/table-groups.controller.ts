import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateTableGroupDto } from './dto/create-table-group.dto';
import { UpdateTableGroupDto } from './dto/update-table-group.dto';
import { TablesService } from './tables.service';

@Controller('table-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TableGroupsController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @Roles('admin', 'cashier', 'supervisor')
  findAll() {
    return this.tablesService.findTableGroups();
  }

  @Post()
  @Roles('admin', 'supervisor')
  create(@Body() dto: CreateTableGroupDto, @CurrentUser('sub') actorId: string) {
    return this.tablesService.createTableGroup(dto, actorId);
  }

  @Patch(':id')
  @Roles('admin', 'supervisor')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTableGroupDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.updateTableGroup(id, dto, actorId);
  }

  @Delete(':id')
  @Roles('admin', 'supervisor')
  deactivate(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.tablesService.deactivateTableGroup(id, actorId);
  }

  @Post(':id/tables')
  @Roles('admin', 'supervisor')
  addTable(
    @Param('id') id: string,
    @Body('tableId') tableId: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.addTableToGroup(id, tableId, actorId);
  }

  @Delete(':id/tables/:tableId')
  @Roles('admin', 'supervisor')
  removeTable(
    @Param('id') id: string,
    @Param('tableId') tableId: string,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.tablesService.removeTableFromGroup(id, tableId, actorId);
  }
}
