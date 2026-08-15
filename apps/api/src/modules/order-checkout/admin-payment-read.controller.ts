import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminPaymentReadService } from './admin-payment-read.service';
import {
  ListAdminPaymentIntentsDto,
  ListAdminPaymentLinksDto,
  ListAdminPaymentTransitionsDto,
  ListAdminPaymentWebhooksDto,
} from './dto/list-admin-payments.dto';

@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'supervisor')
@Permissions('reports.read')
export class AdminPaymentReadController {
  constructor(private readonly payments: AdminPaymentReadService) {}

  @Get('intents')
  listIntents(@Query() query: ListAdminPaymentIntentsDto) {
    return this.payments.listIntents(query);
  }

  @Get('intents/:id')
  getIntent(@Param('id') id: string) {
    return this.payments.getIntent(id);
  }

  @Get('links')
  listLinks(@Query() query: ListAdminPaymentLinksDto) {
    return this.payments.listLinks(query);
  }

  @Get('links/:id')
  getLink(@Param('id') id: string) {
    return this.payments.getLink(id);
  }

  @Get('transitions')
  listTransitions(@Query() query: ListAdminPaymentTransitionsDto) {
    return this.payments.listTransitions(query);
  }

  @Get('transitions/:id')
  getTransition(@Param('id') id: string) {
    return this.payments.getTransition(id);
  }

  @Get('webhooks')
  listWebhooks(@Query() query: ListAdminPaymentWebhooksDto) {
    return this.payments.listWebhooks(query);
  }

  @Get('webhooks/:id')
  getWebhook(@Param('id') id: string) {
    return this.payments.getWebhook(id);
  }
}
