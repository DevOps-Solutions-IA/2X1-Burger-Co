import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import {
  CreateCustomerCampaignDto,
  CreateCustomerInteractionDto,
  CreateCustomerSegmentDto,
  CustomerConsentDto,
  ListCustomersDto,
  ListTimelineDto,
  ResolveCustomerByPhoneDto,
} from './dto/crm.dto';
import { SofiaCrmService } from './sofia-crm.service';

@Controller('admin/sofia/crm')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SofiaCrmController {
  constructor(private readonly crmService: SofiaCrmService) {}

  @Get('customers')
  @Roles('admin', 'supervisor', 'cashier')
  listCustomers(@Query() dto: ListCustomersDto) {
    return this.crmService.listCustomers(dto);
  }

  @Post('customers/search')
  @Roles('admin', 'supervisor', 'cashier')
  searchCustomers(@Body() dto: ListCustomersDto) {
    return this.crmService.listCustomers(dto, { allowPhoneSearch: true });
  }

  @Post('customers/resolve')
  @Roles('admin', 'supervisor')
  resolveCustomer(@Body() dto: ResolveCustomerByPhoneDto, @CurrentUser('sub') actorId: string) {
    return this.crmService.resolveOrCreateByPhone(dto, actorId);
  }

  @Get('customers/:customerId')
  @Roles('admin', 'supervisor', 'cashier')
  getCustomer(@Param('customerId') customerId: string) {
    return this.crmService.getCustomer(customerId);
  }

  @Post('customers/:customerId/consents/opt-in')
  @Roles('admin', 'supervisor')
  grantOptIn(
    @Param('customerId') customerId: string,
    @Body() dto: CustomerConsentDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.crmService.grantOptIn(customerId, dto, actorId);
  }

  @Post('customers/:customerId/consents/revoke')
  @Roles('admin', 'supervisor')
  revokeOptIn(
    @Param('customerId') customerId: string,
    @Body() dto: CustomerConsentDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.crmService.revokeOptIn(customerId, dto, actorId);
  }

  @Get('customers/:customerId/timeline')
  @Roles('admin', 'supervisor', 'cashier')
  listTimeline(@Param('customerId') customerId: string, @Query() dto: ListTimelineDto) {
    return this.crmService.listTimeline(customerId, dto);
  }

  @Post('customers/:customerId/timeline')
  @Roles('admin', 'supervisor')
  recordInteraction(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCustomerInteractionDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.crmService.recordInteraction(customerId, dto, actorId);
  }

  @Post('segments')
  @Roles('admin', 'supervisor')
  createSegment(@Body() dto: CreateCustomerSegmentDto, @CurrentUser('sub') actorId: string) {
    return this.crmService.createSegment(dto, actorId);
  }

  @Post('campaigns')
  @Roles('admin', 'supervisor')
  createCampaign(@Body() dto: CreateCustomerCampaignDto, @CurrentUser('sub') actorId: string) {
    return this.crmService.createDraftCampaign(dto, actorId);
  }

  @Post('campaigns/:campaignId/send')
  @Roles('admin', 'supervisor')
  attemptCampaignSend(@Param('campaignId') campaignId: string, @CurrentUser('sub') actorId: string) {
    return this.crmService.attemptCampaignSend(campaignId, actorId);
  }
}
