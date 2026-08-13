import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
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

  @Get('customers/:customerId/unified-timeline')
  @Roles('admin', 'supervisor', 'cashier')
  listUnifiedTimeline(@Param('customerId') customerId: string, @Query() dto: ListTimelineDto) {
    return this.crmService.listUnifiedTimeline(customerId, dto);
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
  createTag(@Body() dto: CreateCustomerTagDto, @CurrentUser('sub') actorId: string) {
    return this.crmService.createTag(dto, actorId);
  }

  @Post('customers/:customerId/tags')
  @Roles('admin', 'supervisor')
  assignTag(
    @Param('customerId') customerId: string,
    @Body() dto: AssignCustomerTagDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.crmService.assignTag(customerId, dto.tagId, actorId);
  }

  @Get('pipelines')
  @Roles('admin', 'supervisor', 'cashier')
  listPipelines(@Query() dto: ListCrmPipelinesDto) {
    return this.crmService.listPipelines(dto);
  }

  @Post('pipelines')
  @Roles('admin', 'supervisor')
  createPipeline(@Body() dto: CreateCrmPipelineDto, @CurrentUser('sub') actorId: string) {
    return this.crmService.createPipeline(dto, actorId);
  }

  @Get('leads')
  @Roles('admin', 'supervisor', 'cashier')
  listLeads(@Query() dto: ListCrmLeadsDto) {
    return this.crmService.listLeads(dto);
  }

  @Post('leads')
  @Roles('admin', 'supervisor')
  createLead(@Body() dto: CreateCrmLeadDto, @CurrentUser('sub') actorId: string) {
    return this.crmService.createLead(dto, actorId);
  }

  @Get('leads/:leadId')
  @Roles('admin', 'supervisor', 'cashier')
  getLead(@Param('leadId') leadId: string) {
    return this.crmService.getLead(leadId);
  }

  @Post('leads/:leadId/transitions')
  @Roles('admin', 'supervisor')
  transitionLead(
    @Param('leadId') leadId: string,
    @Body() dto: TransitionCrmLeadDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.crmService.transitionLead(leadId, dto, actorId);
  }

  @Get('tasks')
  @Roles('admin', 'supervisor', 'cashier')
  listTasks(@Query() dto: ListCrmTasksDto) {
    return this.crmService.listTasks(dto);
  }

  @Post('tasks')
  @Roles('admin', 'supervisor')
  createTask(@Body() dto: CreateCrmTaskDto, @CurrentUser('sub') actorId: string) {
    return this.crmService.createTask(dto, actorId);
  }

  @Patch('tasks/:taskId')
  @Roles('admin', 'supervisor')
  updateTask(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateCrmTaskDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.crmService.updateTask(taskId, dto, actorId);
  }

  @Get('notes')
  @Roles('admin', 'supervisor', 'cashier')
  listNotes(@Query() dto: ListCrmNotesDto) {
    return this.crmService.listNotes(dto);
  }

  @Post('notes')
  @Roles('admin', 'supervisor')
  createNote(@Body() dto: CreateCrmNoteDto, @CurrentUser('sub') actorId: string) {
    return this.crmService.createNote(dto, actorId);
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
