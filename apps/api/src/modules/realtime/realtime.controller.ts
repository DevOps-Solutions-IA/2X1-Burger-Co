import { Controller, Sse, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RealtimeService } from './realtime.service';

@Controller('realtime')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  @Sse('operational')
  @Roles('admin', 'cashier', 'supervisor', 'waiter', 'delivery')
  operationalStream() {
    return this.realtimeService.createOperationalStream();
  }
}
