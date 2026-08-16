import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { AuthUser } from '../../../common/types/auth-user.type';
import {
  CreateCustomerCampaignDto,
  CreateCustomerInteractionDto,
  CreateCustomerSegmentDto,
  AssignCustomerTagDto,
  CreateCrmLeadDto,
  CreateCrmNoteDto,
  CreateCrmPipelineDto,
  CreateCrmTaskDto,
  CreateCustomerTagDto,
  CustomerConsentDto,
  ListCrmCampaignsDto,
  ListCrmLeadsDto,
  ListCrmNotesDto,
  ListCrmPipelinesDto,
  ListCrmTasksDto,
  ListCustomersDto,
  ListTimelineDto,
  ResolveCustomerByPhoneDto,
  TransitionCrmLeadDto,
  UpdateCrmTaskDto,
} from './dto/crm.dto';
import { SofiaCrmService } from './sofia-crm.service';

@Controller('admin/sofia/crm')
@UseGuards(JwtAuthGuard, RolesGuard)
@Permissions('orders.read')
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
  @Permissions('orders.update')
  resolveCustomer(@Body() dto: ResolveCustomerByPhoneDto, @CurrentUser() actor: AuthUser) {
    return this.crmService.resolveOrCreateByPhone(dto, actor);
  }

  @Get('customers/:customerId')
  @Roles('admin', 'supervisor', 'cashier')
  getCustomer(@Param('customerId') customerId: string) {
    return this.crmService.getCustomer(customerId);
  }

  @Post('customers/:customerId/consents/opt-in')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  grantOptIn(
    @Param('customerId') customerId: string,
    @Body() dto: CustomerConsentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.crmService.grantOptIn(customerId, dto, actor);
  }

  @Post('customers/:customerId/consents/revoke')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  revokeOptIn(
    @Param('customerId') customerId: string,
    @Body() dto: CustomerConsentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.crmService.revokeOptIn(customerId, dto, actor);
  }

  @Get('customers/:customerId/timeline')
  @Roles('admin', 'supervisor', 'cashier')
  listTimeline(@Param('customerId') customerId: string, @Query() dto: ListTimelineDto) {
    return this.crmService.listTimeline(customerId, dto);
  }

  @Get('customers/:customerId/unified-timeline')
  @Roles('admin', 'supervisor', 'cashier')
  listUnifiedTimeline(
    @Param('customerId') customerId: string,
    @Query() dto: ListTimelineDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.crmService.listUnifiedTimeline(customerId, dto, actor);
  }

  @Post('customers/:customerId/timeline')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  recordInteraction(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCustomerInteractionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.crmService.recordInteraction(customerId, dto, actor);
  }

  @Post('segments')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  createSegment(@Body() dto: CreateCustomerSegmentDto, @CurrentUser() actor: AuthUser) {
    return this.crmService.createSegment(dto, actor);
  }

  @Get('segments')
  @Roles('admin', 'supervisor', 'cashier')
  listSegments(@Query() dto: ListTimelineDto) {
    return this.crmService.listSegments(dto);
  }

  @Get('tags')
  @Roles('admin', 'supervisor', 'cashier')
  listTags(@Query() dto: ListTimelineDto) {
    return this.crmService.listTags(dto);
  }

  @Post('tags')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  createTag(@Body() dto: CreateCustomerTagDto, @CurrentUser() actor: AuthUser) {
    return this.crmService.createTag(dto, actor);
  }

  @Post('customers/:customerId/tags')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  assignTag(
    @Param('customerId') customerId: string,
    @Body() dto: AssignCustomerTagDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.crmService.assignTag(customerId, dto.tagId, actor);
  }

  @Get('pipelines')
  @Roles('admin', 'supervisor', 'cashier')
  listPipelines(@Query() dto: ListCrmPipelinesDto) {
    return this.crmService.listPipelines(dto);
  }

  @Post('pipelines')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  createPipeline(@Body() dto: CreateCrmPipelineDto, @CurrentUser() actor: AuthUser) {
    return this.crmService.createPipeline(dto, actor);
  }

  @Get('leads')
  @Roles('admin', 'supervisor', 'cashier')
  listLeads(@Query() dto: ListCrmLeadsDto) {
    return this.crmService.listLeads(dto);
  }

  @Post('leads')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  createLead(@Body() dto: CreateCrmLeadDto, @CurrentUser() actor: AuthUser) {
    return this.crmService.createLead(dto, actor);
  }

  @Get('leads/:leadId')
  @Roles('admin', 'supervisor', 'cashier')
  getLead(@Param('leadId') leadId: string) {
    return this.crmService.getLead(leadId);
  }

  @Post('leads/:leadId/transitions')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  transitionLead(
    @Param('leadId') leadId: string,
    @Body() dto: TransitionCrmLeadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.crmService.transitionLead(leadId, dto, actor);
  }

  @Get('tasks')
  @Roles('admin', 'supervisor', 'cashier')
  listTasks(@Query() dto: ListCrmTasksDto) {
    return this.crmService.listTasks(dto);
  }

  @Post('tasks')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  createTask(@Body() dto: CreateCrmTaskDto, @CurrentUser() actor: AuthUser) {
    return this.crmService.createTask(dto, actor);
  }

  @Patch('tasks/:taskId')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  updateTask(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateCrmTaskDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.crmService.updateTask(taskId, dto, actor);
  }

  @Get('notes')
  @Roles('admin', 'supervisor', 'cashier')
  listNotes(@Query() dto: ListCrmNotesDto) {
    return this.crmService.listNotes(dto);
  }

  @Post('notes')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  createNote(@Body() dto: CreateCrmNoteDto, @CurrentUser() actor: AuthUser) {
    return this.crmService.createNote(dto, actor);
  }

  @Get('campaigns')
  @Roles('admin', 'supervisor', 'cashier')
  listCampaigns(@Query() dto: ListCrmCampaignsDto) {
    return this.crmService.listCampaigns(dto);
  }

  @Post('campaigns')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  createCampaign(@Body() dto: CreateCustomerCampaignDto, @CurrentUser() actor: AuthUser) {
    return this.crmService.createDraftCampaign(dto, actor);
  }

  @Post('campaigns/:campaignId/send')
  @Roles('admin', 'supervisor')
  @Permissions('orders.update')
  attemptCampaignSend(@Param('campaignId') campaignId: string, @CurrentUser() actor: AuthUser) {
    return this.crmService.attemptCampaignSend(campaignId, actor);
  }
}
