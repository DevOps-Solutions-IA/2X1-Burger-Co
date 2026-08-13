import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CrmLeadSource,
  CrmLeadStatus,
  CrmPipelineStageOutcome,
  CrmPipelineStatus,
  CrmTaskPriority,
  CrmTaskStatus,
  CrmTaskType,
  CustomerConsentChannel,
  CustomerConsentPurpose,
  CustomerInteractionChannel,
  CustomerInteractionDirection,
} from '@prisma/client';

export class ListCustomersDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit = 25;
}

export class ResolveCustomerByPhoneDto {
  @IsString()
  @MinLength(7)
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;
}

export class CustomerConsentDto {
  @IsEnum(CustomerConsentPurpose)
  purpose!: CustomerConsentPurpose;

  @IsEnum(CustomerConsentChannel)
  channel!: CustomerConsentChannel;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[A-Z][A-Z0-9_]+$/)
  source!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  evidence!: string;
}

export class ListTimelineDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit = 25;
}

export class CreateCustomerInteractionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  kind!: string;

  @IsEnum(CustomerInteractionChannel)
  channel!: CustomerInteractionChannel;

  @IsEnum(CustomerInteractionDirection)
  direction!: CustomerInteractionDirection;

  @IsString()
  @MinLength(1)
  @MaxLength(1_000)
  summary!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;
}

export class CreateCustomerSegmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1_000)
  @IsString({ each: true })
  customerIds?: string[];
}

export class CreateCustomerCampaignDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  segmentId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  messageTemplate!: string;
}

export class CrmPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}

export class CreateCrmPipelineStageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  position!: number;

  @IsOptional()
  @IsEnum(CrmPipelineStageOutcome)
  outcome: CrmPipelineStageOutcome = CrmPipelineStageOutcome.OPEN;
}

export class CreateCrmPipelineDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreateCrmPipelineStageDto)
  stages!: CreateCrmPipelineStageDto[];
}

export class ListCrmPipelinesDto extends CrmPaginationDto {
  @IsOptional()
  @IsEnum(CrmPipelineStatus)
  status?: CrmPipelineStatus;
}

export class CreateCrmLeadDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  customerId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  pipelineId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  currentStageId!: string;

  @IsEnum(CrmLeadSource)
  source!: CrmLeadSource;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  sourceReference!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ownerId?: string;
}

export class ListCrmLeadsDto extends CrmPaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pipelineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ownerId?: string;

  @IsOptional()
  @IsEnum(CrmLeadStatus)
  status?: CrmLeadStatus;
}

export class TransitionCrmLeadDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  toStageId!: string;

  @IsEnum(CrmLeadStatus)
  toStatus!: CrmLeadStatus;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  idempotencyKey!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[A-Z][A-Z0-9_]+$/)
  reasonCode!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateCrmTaskDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  customerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  leadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerServiceCaseId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[A-Z][A-Z0-9_]+$/)
  source!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  sourceReference!: string;

  @IsEnum(CrmTaskType)
  type!: CrmTaskType;

  @IsOptional()
  @IsEnum(CrmTaskPriority)
  priority: CrmTaskPriority = CrmTaskPriority.MEDIUM;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedToId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dueAt?: string;
}

export class ListCrmTasksDto extends CrmPaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  leadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedToId?: string;

  @IsOptional()
  @IsEnum(CrmTaskType)
  type?: CrmTaskType;

  @IsOptional()
  @IsEnum(CrmTaskStatus)
  status?: CrmTaskStatus;
}

export class UpdateCrmTaskDto {
  @IsString()
  @MinLength(8)
  @MaxLength(160)
  idempotencyKey!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsEnum(CrmTaskStatus)
  status!: CrmTaskStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedToId?: string;
}

export class CreateCrmNoteDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  customerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  leadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerServiceCaseId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[A-Z][A-Z0-9_]+$/)
  source!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  sourceReference!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  body!: string;
}

export class ListCrmNotesDto extends CrmPaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  leadId?: string;
}

export class CreateCustomerTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;
}

export class AssignCustomerTagDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  tagId!: string;
}
