import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { DeliveryEstimateLocationDto } from './delivery-location.dto';

export class EstimateDeliveryPricingDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  orderSubtotal?: number;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  addressText?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  neighborhood?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryEstimateLocationDto)
  location?: DeliveryEstimateLocationDto;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsDateString()
  requestedAt?: string;

  @IsOptional()
  @IsString()
  orderType?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  // LEGACY — accepted for backward compatibility, ignored by the automated backend pricing flow.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  manualFee?: number;

  // LEGACY — accepted for backward compatibility, ignored by the automated backend pricing flow.
  @IsOptional()
  @IsString()
  manualReason?: string;

  // LEGACY — accepted for backward compatibility, ignored by the automated backend pricing flow.
  @IsOptional()
  @IsBoolean()
  forceManual?: boolean;
}
