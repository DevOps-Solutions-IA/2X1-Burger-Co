import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

export class DeliveryLocationSearchDto {
  @IsString()
  @MinLength(3)
  query!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;
}

export class DeliveryLocationResolveDto {
  @IsOptional()
  @IsIn(['google'])
  provider?: string;

  @IsOptional()
  @IsString()
  placeId?: string;

  @IsOptional()
  @IsString()
  fallbackText?: string;
}

export class DeliveryEstimateLocationDto {
  @IsOptional()
  @IsIn(['google'])
  provider?: string;

  @IsOptional()
  @IsString()
  placeId?: string;

  @IsOptional()
  @IsString()
  formattedAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsIn(['HIGH', 'MEDIUM', 'LOW'])
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export class DeliveryEstimateLocationWrapperDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryEstimateLocationDto)
  location?: DeliveryEstimateLocationDto;
}
