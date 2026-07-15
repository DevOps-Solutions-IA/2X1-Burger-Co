import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AUDIT_RESULTS } from '../audit.types';

export class ListAuditEventsDto {
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
  limit = 50;

  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(128) actorId?: string;
  @IsOptional() @IsString() @MaxLength(64) actorRole?: string;
  @IsOptional() @IsString() @MaxLength(96) module?: string;
  @IsOptional() @IsString() @MaxLength(128) action?: string;
  @IsOptional() @IsString() @MaxLength(96) entityType?: string;
  @IsOptional() @IsString() @MaxLength(128) entityId?: string;
  @IsOptional() @IsIn(AUDIT_RESULTS) result?: (typeof AUDIT_RESULTS)[number];
  @IsOptional() @IsString() @MaxLength(128) requestId?: string;
  @IsOptional() @IsString() @MaxLength(128) correlationId?: string;
  @IsOptional() @IsString() @MaxLength(128) idempotencyKey?: string;
}
