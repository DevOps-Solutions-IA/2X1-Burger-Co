import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  check() {
    return this.healthService.check();
  }

  @Public()
  @Get('live')
  live() {
    return this.healthService.liveness();
  }

  @Public()
  @Get('ready')
  ready() {
    return this.healthService.readiness();
  }

  @Public()
  @Get('metrics')
  metrics() {
    return this.healthService.metrics();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'supervisor')
  @Get('observability')
  observability() {
    return this.healthService.observabilitySnapshot();
  }
}
