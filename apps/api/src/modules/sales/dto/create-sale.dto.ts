import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class SaleItemDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class SalePaymentDto {
  @IsString()
  paymentMethodId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  receivedAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  changeAmount?: number;
}

export class CreateSaleDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  baseSubtotal?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['MOSTRADOR', 'PARA_LLEVAR', 'MESA', 'DOMICILIO'])
  channel?: 'MOSTRADOR' | 'PARA_LLEVAR' | 'MESA' | 'DOMICILIO';

  @IsOptional()
  @IsString()
  tableLabel?: string;

  @IsOptional()
  @IsString()
  deliveryReference?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @IsOptional()
  @IsString()
  deliveryFeeEditReason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryDistanceKm?: number;

  @IsOptional()
  @IsString()
  deliveryZoneLabel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryFeeSuggested?: number;

  @IsOptional()
  deliveryFeeEdited?: boolean;

  @IsOptional()
  deliveryPricingBreakdown?: unknown;

  @IsOptional()
  @IsString()
  deliveryCalculationVersion?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  payments!: SalePaymentDto[];
}
