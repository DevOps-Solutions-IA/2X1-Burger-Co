import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { TableGroupsController } from './table-groups.controller';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { WaiterAssignmentsController } from './waiter-assignments.controller';

@Module({
  imports: [RealtimeModule],
  controllers: [TablesController, TableGroupsController, WaiterAssignmentsController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
