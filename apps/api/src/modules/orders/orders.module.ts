import { Module } from '@nestjs/common';
import { DeliveryModule } from '../../delivery/delivery.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SalesModule } from '../sales/sales.module';
import { SofiaModule } from '../sofia/sofia.module';
import { TablesModule } from '../tables/tables.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [SalesModule, RealtimeModule, DeliveryModule, TablesModule, SofiaModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
