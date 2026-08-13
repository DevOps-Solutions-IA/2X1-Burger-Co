import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaymentIntentProvider, PaymentIntentStatus, PaymentLinkStatus } from '@prisma/client';

export class ListAdminPaymentIntentsDto {
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

  @IsOptional()
  @IsEnum(PaymentIntentStatus)
  status?: PaymentIntentStatus;

  @IsOptional()
  @IsEnum(PaymentIntentProvider)
  provider?: PaymentIntentProvider;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checkoutId?: string;
}

export class ListAdminPaymentWebhooksDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(64)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  processedStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  paymentIntentId?: string;
}

export class ListAdminPaymentLinksDto {
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

  @IsOptional()
  @IsEnum(PaymentLinkStatus)
  status?: PaymentLinkStatus;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  paymentIntentId?: string;
}

export class ListAdminPaymentTransitionsDto {
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

  @IsOptional()
  @IsEnum(PaymentIntentStatus)
  toStatus?: PaymentIntentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  paymentIntentId?: string;
}
