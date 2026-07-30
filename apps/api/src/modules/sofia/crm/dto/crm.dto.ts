import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
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
