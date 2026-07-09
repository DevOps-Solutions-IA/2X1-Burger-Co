import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Roles('admin', 'supervisor')
  findAll() {
    return this.settingsService.findAll();
  }

  @Get('operations-status')
  @Roles('admin')
  getOperationsStatus() {
    return this.settingsService.getOperationsStatus();
  }

  @Patch()
  @Roles('admin')
  update(@Body() dto: UpdateSettingsDto, @CurrentUser('sub') actorId: string) {
    return this.settingsService.update(dto, actorId);
  }
}
