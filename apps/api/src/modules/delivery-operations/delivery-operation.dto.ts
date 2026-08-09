import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DeliveryIssueType, DeliveryWorkflowStatus } from '@prisma/client';

export class VersionedIdempotentDeliveryCommandDto {
  // This is the technical order revision, not the commercial receipt version.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9:._-]*$/)
  idempotencyKey!: string;
}

export class TransitionDeliveryWorkflowDto extends VersionedIdempotentDeliveryCommandDto {
  @IsEnum(DeliveryWorkflowStatus)
  workflowStatus!: DeliveryWorkflowStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsEnum(DeliveryIssueType)
  issueType?: DeliveryIssueType;
}

export class ApplyDeliveryLocationDto extends VersionedIdempotentDeliveryCommandDto {
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  senderIdentityCandidates!: string[];
}
