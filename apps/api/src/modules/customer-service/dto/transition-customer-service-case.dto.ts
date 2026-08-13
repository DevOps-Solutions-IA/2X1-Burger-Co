import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CustomerServiceCaseStatus } from '@prisma/client';

export class TransitionCustomerServiceCaseDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsEnum(CustomerServiceCaseStatus)
  fromStatus!: CustomerServiceCaseStatus;

  @IsEnum(CustomerServiceCaseStatus)
  toStatus!: CustomerServiceCaseStatus;

  @IsString()
  @MaxLength(200)
  idempotencyKey!: string;

  @IsString()
  @MaxLength(200)
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resolutionCode?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string | number | boolean | null>;
}
